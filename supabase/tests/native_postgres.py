"""Disposable PostgreSQL 17 runtime for the SQL suite when Docker is unavailable.

Set INTERLINK_PG_BIN to a PostgreSQL 17 bin directory. Never connects to an
existing database: each run initializes its own cluster, password and database.
"""
from pathlib import Path
import os
import secrets
import shutil
import socket
import subprocess
import tempfile


class NativePostgres:
    def __init__(self, bin_dir, root):
        self.bin_dir = Path(bin_dir).resolve(strict=True)
        self.artifacts = (Path(root) / "artifacts" / "native-postgres").resolve()
        self.artifacts.mkdir(parents=True, exist_ok=True)
        self.work = Path(tempfile.mkdtemp(prefix="run-", dir=self.artifacts)).resolve()
        self.data = self.work / "data"
        self.log = self.work / "postgres.log"
        self.started = False
        self.env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
        self.env.update(PGPASSWORD=secrets.token_urlsafe(32), PGCLIENTENCODING="UTF8")
        self.flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]

    def binary(self, name):
        return str(self.bin_dir / (name + (".exe" if os.name == "nt" else "")))

    def execute(self, name, *args, **kwargs):
        return subprocess.run(
            [self.binary(name), *map(str, args)], env=self.env,
            creationflags=self.flags, text=True, encoding="utf-8",
            capture_output=True, **kwargs,
        )

    @property
    def psql_command(self):
        return [self.binary("psql"), "-h", "127.0.0.1", "-p", str(self.port),
                "-X", "-qAt", "-U", "postgres", "-d", "interlink", "-v", "ON_ERROR_STOP=1"]

    def start(self):
        version = self.execute("postgres", "--version", check=True).stdout.strip()
        if not version.startswith("postgres (PostgreSQL) 17."):
            raise RuntimeError(f"The SQL harness requires PostgreSQL 17, found: {version}")
        password_file = self.work / "init-password"
        password_file.write_text(self.env["PGPASSWORD"] + "\n", encoding="utf-8")
        try:
            self.execute("initdb", "-D", self.data, "-U", "postgres", "-E", "UTF8",
                         "--locale=C", "--auth=scram-sha-256", "--pwfile", password_file,
                         "--no-instructions", check=True)
        finally:
            password_file.unlink(missing_ok=True)
        # Empty Unix sockets and a numeric loopback address exclude external listeners.
        with (self.data / "postgresql.conf").open("a", encoding="utf-8") as config:
            config.write(f"\nlisten_addresses = '127.0.0.1'\nport = {self.port}\n"
                         "unix_socket_directories = ''\nwal_level = logical\n")
        # On Windows postgres inherits pg_ctl's pipes, keeping communicate()
        # blocked after pg_ctl exits. Use a regular file for the launcher output.
        with (self.work / "launcher.log").open("w", encoding="utf-8") as output:
            result = subprocess.run(
                [self.binary("pg_ctl"), "-D", str(self.data), "-l", str(self.log),
                 "-w", "-t", "45", "start"], env=self.env, stdin=subprocess.DEVNULL,
                stdout=output, stderr=output, creationflags=self.flags,
            )
        if result.returncode != 0:
            log = self.log.read_text(encoding="utf-8", errors="replace") if self.log.exists() else ""
            raise RuntimeError(f"Native PostgreSQL failed to start: {result.stderr}\n{log}")
        self.started = True
        self.execute("createdb", "-h", "127.0.0.1", "-p", self.port,
                     "-U", "postgres", "interlink", check=True)
        print(f"SQL runtime: {version}; disposable authenticated cluster on 127.0.0.1:{self.port}", flush=True)

    def stop(self):
        # pg_ctl also detects a server started just before startup observation failed.
        if (self.data / "postmaster.pid").exists():
            result = self.execute("pg_ctl", "-D", self.data, "-m", "fast", "-w", "-t", "45", "stop")
            if result.returncode != 0:
                raise RuntimeError(f"Could not stop test PostgreSQL; files preserved at {self.work}: {result.stderr}")
        self.started = False
        target = self.work.resolve()
        if target.parent != self.artifacts or not target.name.startswith("run-"):
            raise RuntimeError(f"Refusing to remove a directory not owned by this test: {target}")
        # Only this invocation's generated directory is removed, after shutdown.
        shutil.rmtree(target)
