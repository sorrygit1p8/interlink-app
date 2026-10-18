#!/usr/bin/env python3
"""Install/check the pinned Linux x86_64 Android tools in a separate workspace path.

No repository, node_modules, system Java, existing tool installation or cache is
removed. Downloads retain HTTPS verification and are checked before extraction.
SDK licenses require explicit acceptance; --check-only never writes or downloads.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile


JDKS = {
    "jdk17": {
        "version": "17.0.20.1", "semantic": "17.0.20.1+1",
        "archive": "OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz",
        "url": "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz",
        "sha256": "3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e",
    },
    "jdk21": {
        "version": "21.0.12.1", "semantic": "21.0.12.1+1",
        "archive": "OpenJDK21U-jdk_x64_linux_hotspot_21.0.12.1_1.tar.gz",
        "url": "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_linux_hotspot_21.0.12.1_1.tar.gz",
        "sha256": "ce79869e1307ed8ee1e2baa86a412b1eb5b75d10a01006d788a6f968bcfaee94",
    },
}
CLI = {
    "archive": "commandlinetools-linux-16111833_latest.zip",
    "url": "https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip",
    # SHA-1 is Google's repository checksum. SHA-256 was additionally computed
    # from that verified archive and is pinned here for subsequent reproduction.
    "sha1": "e025545c62a8e64c7559119566a569fb1dec5f60",
    "sha256": "0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8",
}
PACKAGES = {
    "platforms;android-37.0": ("platforms/android-37.0", {"Pkg.Revision": "2", "AndroidVersion.ApiLevel": "37.0"}, "android.jar"),
    "build-tools;37.0.0": ("build-tools/37.0.0", {"Pkg.Revision": "37.0.0"}, "aapt2"),
    "build-tools;36.0.0": ("build-tools/36.0.0", {"Pkg.Revision": "36.0.0"}, "aapt2"),
    "ndk;27.1.12297006": ("ndk/27.1.12297006", {"Pkg.Revision": "27.1.12297006"}, "ndk-build"),
    "cmake;3.22.1": ("cmake/3.22.1", {"Pkg.Revision": "3.22.1"}, "bin/cmake"),
    "platform-tools": ("platform-tools", {"Pkg.Revision": "37.0.1"}, "adb"),
}
CERT_PATTERN = re.compile(r"-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----")


class SetupError(Exception):
    pass


def properties(path: Path, *, quoted: bool = False, java_escapes: bool = False) -> dict[str, str]:
    if not path.is_file():
        raise SetupError(f"Missing version/configuration file: {path}. Existing files are preserved.")
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith(("#", "!")) or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"') if quoted else value.strip()
        if java_escapes:
            value = re.sub(r"\\(u[0-9a-fA-F]{4}|.)", lambda match: chr(int(match[1][1:], 16)) if match[1].startswith("u") and len(match[1]) == 5 else {"n": "\n", "r": "\r", "t": "\t", "f": "\f"}.get(match[1], match[1]), value)
        result[key.strip()] = value
    return result


def verify_properties(path: Path, expected: dict[str, str]) -> None:
    installed = properties(path, quoted=path.name == "release")
    for key, value in expected.items():
        if installed.get(key) != value:
            raise SetupError(f"Version mismatch in {path} ({key}). Inspect the existing installation; it will not be replaced.")


def verify_archive(path: Path, spec: dict[str, str]) -> None:
    hashes = {name: hashlib.new(name) for name in ("sha256", "sha1") if name in spec}
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            for digest in hashes.values():
                digest.update(block)
    if any(digest.hexdigest() != spec[name] for name, digest in hashes.items()):
        raise SetupError(f"Checksum mismatch for {path.name}. No existing tool/cache is replaced and the archive will not be extracted; inspect or choose a new tools root.")


def proxy_pem() -> str | None:
    binding = os.environ.get("CODEX_PROXY_CERT")
    if not binding:
        return None
    if "-----BEGIN CERTIFICATE-----" in binding:
        pem = binding
    else:
        try:
            pem = Path(binding).read_text()
        except OSError as error:
            raise SetupError("CODEX_PROXY_CERT is configured but its certificate file cannot be read.") from error
    if not CERT_PATTERN.search(pem):
        raise SetupError("CODEX_PROXY_CERT does not contain a PEM certificate. TLS verification remains enabled.")
    return pem


def certificates(pem: str) -> dict[str, str]:
    result = {}
    for encoded in CERT_PATTERN.findall(pem):
        der = base64.b64decode(re.sub(r"\s", "", encoded), validate=True)
        digest = hashlib.sha256(der).hexdigest()
        result[digest] = "-----BEGIN CERTIFICATE-----\n" + base64.encodebytes(der).decode().strip() + "\n-----END CERTIFICATE-----\n"
    return result


def run_checked(command: list[str], *, env: dict[str, str] | None = None, input_text: str | None = None, timeout: int = 60) -> str:
    try:
        completed = subprocess.run(command, env=env, input=input_text, text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SetupError(f"{Path(command[0]).name} could not complete. Check its installation, network and proxy settings.") from error
    if completed.returncode:
        combined = completed.stdout + completed.stderr
        if "PKIX" in combined or "SSLHandshakeException" in combined:
            reason = "TLS trust validation failed; verify the supplied proxy CA without disabling verification."
        elif "license" in combined.lower():
            reason = "Review the official SDK licenses and accept them explicitly before retrying."
        else:
            reason = "Check the tool version, network/proxy and supported package availability."
        # Tool output can echo inherited JVM/proxy credentials. Never print it.
        raise SetupError(f"{Path(command[0]).name} failed (exit {completed.returncode}). {reason} Existing tools and caches are preserved.")
    return completed.stdout + completed.stderr


def download(cache: Path, spec: dict[str, str], pem: str | None) -> Path:
    destination = cache / spec["archive"]
    if destination.exists():
        verify_archive(destination, spec)
        return destination
    context = ssl.create_default_context()
    if pem:
        context.load_verify_locations(cadata=pem)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=cache, prefix=".download-", delete=False) as target:
            temporary = Path(target.name)
            request = urllib.request.Request(spec["url"], headers={"User-Agent": "Interlink-Android-Setup/1"})
            with urllib.request.urlopen(request, timeout=120, context=context) as response:
                if urllib.parse.urlsplit(response.url).scheme != "https":
                    raise SetupError("Artifact redirected to an insecure URL; download stopped.")
                shutil.copyfileobj(response, target)
        verify_archive(temporary, spec)
        if destination.exists():
            verify_archive(destination, spec)
        else:
            temporary.rename(destination)
            temporary = None
    except SetupError:
        raise
    except Exception as error:
        # In particular, urllib proxy errors may contain credential-bearing URLs.
        raise SetupError(f"HTTPS download failed for {spec['archive']}. Check network access and proxy trust; no verification was bypassed.") from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return destination


def install_archive(archive: Path, destination: Path, cache: Path, kind: str) -> None:
    if destination.exists():
        raise SetupError(f"Refusing to overwrite {destination}. Inspect it or choose another tools root.")
    with tempfile.TemporaryDirectory(dir=cache, prefix=".extract-") as temp:
        staging = Path(temp)
        if kind == "tar":
            if not hasattr(tarfile, "data_filter"):
                raise SetupError("This Python lacks safe tar extraction filters; use Python 3.12 or a patched Python 3.11.")
            with tarfile.open(archive, "r:gz") as source:
                source.extractall(staging, filter="data")
        else:
            with zipfile.ZipFile(archive) as source:
                for member in source.infolist():
                    target = (staging / member.filename).resolve()
                    if not target.is_relative_to(staging) or (member.external_attr >> 16) & 0o170000 == 0o120000:
                        raise SetupError("Unsafe path or symlink in the SDK archive; extraction stopped.")
                    source.extract(member, staging)
                    mode = (member.external_attr >> 16) & 0o777
                    if mode:
                        target.chmod(mode)
        roots = list(staging.iterdir())
        if len(roots) != 1 or not roots[0].is_dir():
            raise SetupError("Unexpected artifact directory layout; inspect the verified archive.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        roots[0].rename(destination)


def check_jdk(root: Path, name: str, spec: dict[str, str]) -> None:
    directory = root / name
    verify_properties(directory / "release", {"IMPLEMENTOR": "Eclipse Adoptium", "JAVA_VERSION": spec["version"], "SEMANTIC_VERSION": spec["semantic"]})
    for executable in ("java", "javac", "keytool"):
        if not os.access(directory / "bin" / executable, os.X_OK):
            raise SetupError(f"Incomplete {name}: missing executable {executable}. Existing files are preserved.")
    # Do not inherit arbitrary JVM options while inspecting a tool's version.
    environment = {key: value for key, value in os.environ.items() if key not in {"JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"}}
    actual = run_checked([str(directory / "bin/javac"), "-version"], env=environment).strip()
    if actual != "javac " + spec["version"]:
        raise SetupError(f"{name} compiler does not match its release metadata; manual inspection required.")
    cached = root / "cache" / spec["archive"]
    if cached.exists():
        verify_archive(cached, spec)
    print(f"Verified {name}: Temurin {spec['semantic']}")


def keytool_certificates(keytool: Path, store: Path) -> set[str]:
    environment = {key: value for key, value in os.environ.items() if key not in {"JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"}}
    content = run_checked([str(keytool), "-list", "-rfc", "-keystore", str(store), "-storepass", "changeit"], env=environment)
    return set(certificates(content))


def ensure_trust(root: Path, pem: str | None, check_only: bool) -> Path:
    keytool = root / "jdk21/bin/keytool"
    # Current cloud images may provide their standard Java roots through the
    # OS certificate package. Preserve that complete baseline when present;
    # otherwise use the unmodified, checksum-verified Temurin default store.
    system_default = Path("/etc/ssl/certs/java/cacerts")
    default_store = system_default if system_default.is_file() else root / "jdk21/lib/security/cacerts"
    store = root / "cache/gradle/java-cacerts"
    defaults = keytool_certificates(keytool, default_store)
    if not defaults:
        raise SetupError("Default Java trust anchors could not be inspected.")
    if not store.exists():
        if check_only:
            raise SetupError("The local Java truststore has not been prepared; run setup to copy the default anchors.")
        store.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(default_store, store)
        store.chmod(0o600)
    installed = keytool_certificates(keytool, store)
    if not defaults.issubset(installed):
        raise SetupError("Existing custom truststore is missing default Java trust anchors; inspect it instead of replacing it silently.")
    missing = {fingerprint: cert for fingerprint, cert in certificates(pem or "").items() if fingerprint not in installed}
    if missing and check_only:
        raise SetupError("Current CODEX_PROXY_CERT is not trusted by the local Java store; run setup to add it while preserving default roots.")
    for fingerprint, certificate in missing.items():
        run_checked([str(keytool), "-importcert", "-noprompt", "-alias", "interlink-proxy-" + fingerprint[:24], "-keystore", str(store), "-storepass", "changeit"], input_text=certificate)
    print("Verified Java trust: default roots preserved; configured proxy CA trusted")
    return store


def proxy_settings() -> dict[str, str]:
    result = {}
    http = os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY")
    https = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY")
    for protocol, binding in (("http", http or https), ("https", https or http)):
        if not binding:
            continue
        try:
            parsed = urllib.parse.urlsplit(binding)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                raise ValueError("unsupported proxy")
            result[f"systemProp.{protocol}.proxyHost"] = parsed.hostname
            result[f"systemProp.{protocol}.proxyPort"] = str(parsed.port or (443 if parsed.scheme == "https" else 80))
            if parsed.username is not None:
                result[f"systemProp.{protocol}.proxyUser"] = urllib.parse.unquote(parsed.username)
                result[f"systemProp.{protocol}.proxyPassword"] = urllib.parse.unquote(parsed.password or "")
        except ValueError as error:
            raise SetupError("A configured proxy URL is invalid or unsupported. Its value is intentionally not printed.") from error
    return result


def property_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r").replace(" ", "\\ ").replace("=", "\\=").replace(":", "\\:")


def configure_gradle(root: Path, store: Path, check_only: bool, update_managed: bool) -> None:
    path = root / "cache/gradle/gradle.properties"
    desired = {
        "systemProp.javax.net.ssl.trustStore": str(store),
        "systemProp.javax.net.ssl.trustStorePassword": "changeit",
        "org.gradle.workers.max": "2", "org.gradle.daemon": "false",
        "org.gradle.java.installations.paths": str(root / "jdk17") + "," + str(root / "jdk21"),
        "org.gradle.java.installations.auto-download": "false",
        **proxy_settings(),
    }
    existing = properties(path, java_escapes=True) if path.exists() else {}
    desired["systemProp.http.nonProxyHosts"] = existing.get("systemProp.http.nonProxyHosts", "localhost|127.*|[::1]")
    conflicts = [key for key, value in desired.items() if key in existing and existing[key] not in {value, property_escape(value)}]
    if conflicts and (check_only or not update_managed):
        raise SetupError("Existing Gradle managed settings differ: " + ", ".join(conflicts) + ". Review them; use --update-managed-config only for an intentional change. Values are not printed.")
    if check_only:
        if any(key not in existing for key in desired):
            raise SetupError("Some local Gradle proxy/toolchain settings are missing; run setup to add them.")
    else:
        lines = path.read_text().splitlines() if path.exists() else []
        keys_written = set()
        rewritten = []
        for line in lines:
            key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith(("#", "!")) else None
            if key in desired:
                rewritten.append(key + "=" + property_escape(desired[key]))
                keys_written.add(key)
            else:
                rewritten.append(line)
        rewritten.extend(key + "=" + property_escape(value) for key, value in desired.items() if key not in keys_written)
        content = "\n".join(rewritten) + "\n"
        if not path.exists() or content != path.read_text():
            with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".gradle-properties-", delete=False) as temporary:
                temporary.write(content)
                candidate = Path(temporary.name)
            candidate.chmod(0o600)
            candidate.replace(path)
    print("Verified Gradle settings (proxy credentials, if present, are never printed)")


def check_sdk(sdk: Path) -> list[str]:
    missing = []
    for package, (directory, expected, required) in PACKAGES.items():
        location = sdk / directory
        if not location.exists():
            missing.append(package)
            continue
        verify_properties(location / "source.properties", expected)
        if not (location / required).is_file():
            raise SetupError(f"Incomplete SDK package {package}; preserve and inspect its directory before retrying.")
    return missing


def sdk_install(root: Path, store: Path, missing: list[str], accept_licenses: bool) -> None:
    sdk = root / "android-sdk"
    manager = sdk / "cmdline-tools/latest/bin/sdkmanager"
    environment = dict(os.environ)
    environment.update(JAVA_HOME=str(root / "jdk21"), ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk), ANDROID_USER_HOME=str(root / "config/.android"))
    environment["JAVA_TOOL_OPTIONS"] = environment.get("JAVA_TOOL_OPTIONS", "") + f" -Djavax.net.ssl.trustStore={store} -Djavax.net.ssl.trustStorePassword=changeit"
    environment["PATH"] = str(root / "jdk21/bin") + os.pathsep + environment.get("PATH", "")
    arguments = [str(manager), "--sdk_root=" + str(sdk)]
    proxy = proxy_settings()
    if proxy.get("systemProp.https.proxyHost"):
        arguments.extend(["--proxy=http", "--proxy_host=" + proxy["systemProp.https.proxyHost"], "--proxy_port=" + proxy["systemProp.https.proxyPort"]])
    if accept_licenses:
        run_checked(arguments + ["--licenses"], env=environment, input_text="y\n" * 100, timeout=300)
    elif not (sdk / "licenses/android-sdk-license").is_file():
        raise SetupError("Android SDK licenses are not accepted. Review the official terms, then run sdkmanager --licenses interactively or rerun with explicit --accept-sdk-licenses.")
    if missing:
        # Closed stdin prevents accidental implicit acceptance of any new terms.
        run_checked(arguments + missing, env=environment, input_text="", timeout=1800)


def write_environment(root: Path, store: Path) -> None:
    path = root / "env-android.sh"
    lines = ["# Generated by Interlink setup-android-cloud.py; contains no proxy credentials."]
    bindings = {"JAVA_HOME": root / "jdk21", "ANDROID_HOME": root / "android-sdk", "ANDROID_SDK_ROOT": root / "android-sdk", "GRADLE_USER_HOME": root / "cache/gradle", "ANDROID_USER_HOME": root / "config/.android"}
    lines.extend("export " + key + "=" + shlex.quote(str(value)) for key, value in bindings.items())
    lines.append('export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"')
    content = "\n".join(lines) + "\n"
    if path.exists() and not path.read_text().startswith("# Generated by Interlink setup-android-cloud.py;"):
        raise SetupError("Existing env-android.sh is user-owned; it has been preserved. Export the tool paths manually or choose another root.")
    if not path.exists() or path.read_text() != content:
        path.write_text(content)
        path.chmod(0o600)
    print("Ready. Source " + str(path) + " before the Android build.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tools-root", type=Path, default=Path("/workspace/mobile-tools"))
    parser.add_argument("--check-only", action="store_true", help="Verify existing tools/config only; no writes or network requests")
    parser.add_argument("--accept-sdk-licenses", action="store_true", help="Explicitly confirm you have reviewed and accept the official Android SDK license terms")
    parser.add_argument("--update-managed-config", action="store_true", help="After review, update only named Gradle proxy/trust/toolchain settings; preserve other settings")
    args = parser.parse_args()
    try:
        if platform.system() != "Linux" or platform.machine() not in {"x86_64", "AMD64"}:
            raise SetupError("This pinned toolchain supports Linux x86_64 only.")
        root = args.tools_root.resolve()
        repository = Path(__file__).resolve().parents[1]
        if not any(root.is_relative_to(base) for base in (Path("/workspace"), Path("/tmp"))) or root.is_relative_to(repository):
            raise SetupError("Choose a tools root under /workspace or /tmp, outside the source checkout.")
        if not re.fullmatch(r"[A-Za-z0-9_./-]+", str(root)):
            raise SetupError("Use a tools path without whitespace or shell metacharacters for Java/Gradle compatibility.")
        if args.check_only and (args.accept_sdk_licenses or args.update_managed_config):
            raise SetupError("--check-only cannot be combined with options that approve configuration changes.")
        pem = proxy_pem()
        cache = root / "cache"
        if not args.check_only:
            cache.mkdir(parents=True, exist_ok=True)
            (root / "cache/gradle").mkdir(parents=True, exist_ok=True)
            (root / "config/.android").mkdir(parents=True, exist_ok=True)
        for name, spec in JDKS.items():
            if not (root / name).exists():
                if args.check_only:
                    raise SetupError(f"{name} is missing; run setup to install its pinned artifact.")
                install_archive(download(cache, spec, pem), root / name, cache, "tar")
            check_jdk(root, name, spec)
        command_tools = root / "android-sdk/cmdline-tools/latest"
        if not command_tools.exists():
            if args.check_only:
                raise SetupError("Android command-line tools are missing; run setup.")
            install_archive(download(cache, CLI, pem), command_tools, cache, "zip")
        verify_properties(command_tools / "source.properties", {"Pkg.Revision": "23.0", "Pkg.Path": "cmdline-tools;23.0"})
        if not os.access(command_tools / "bin/sdkmanager", os.X_OK):
            raise SetupError("sdkmanager is not executable; inspect the existing command-line tools.")
        if (cache / CLI["archive"]).exists():
            verify_archive(cache / CLI["archive"], CLI)
        store = ensure_trust(root, pem, args.check_only)
        configure_gradle(root, store, args.check_only, args.update_managed_config)
        missing = check_sdk(root / "android-sdk")
        if args.check_only:
            if missing:
                raise SetupError("Missing SDK packages: " + ", ".join(missing))
            if not (root / "android-sdk/licenses/android-sdk-license").is_file():
                raise SetupError("SDK license acceptance is not present; review and accept official terms explicitly.")
            print("Verified all pinned SDK packages and existing license configuration. Check-only made no changes.")
        else:
            if missing or args.accept_sdk_licenses or not (root / "android-sdk/licenses/android-sdk-license").is_file():
                sdk_install(root, store, missing, args.accept_sdk_licenses)
            remaining = check_sdk(root / "android-sdk")
            if remaining:
                raise SetupError("SDK installation is incomplete: " + ", ".join(remaining))
            write_environment(root, store)
        return 0
    except (SetupError, OSError, ValueError, tarfile.TarError, zipfile.BadZipFile) as error:
        print("Android setup: " + str(error) if isinstance(error, SetupError) else "Android setup: file or archive validation failed; existing files are preserved. Inspect the configured paths.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
