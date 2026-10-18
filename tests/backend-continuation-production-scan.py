"""Isolated production scanner regressions; no Expo build or remote requests."""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


class ProductionScannerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='interlink-scanner-')
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.output = self.root / 'artifacts' / 'prod-check'
        scripts = self.root / 'scripts'
        scripts.mkdir()
        self.scanner = scripts / 'check-production-bundle.py'
        shutil.copyfile(pathlib.Path(__file__).resolve().parents[1] / 'scripts' / self.scanner.name, self.scanner)
        self.sources = {
            'packages/data/src/production.ts': 'export const production = true;\r\n',
            'packages/data/src/supabase.ts': 'export const adapter = "실제 연결";\r\n',
            'apps/mobile/src/example.ts': 'export const title = "팀과 연결해요";\r\n',
        }
        for relative, content in self.sources.items():
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content.encode('utf-8'))
        for platform in ('android', 'ios', 'web'):
            folder = self.output / platform
            folder.mkdir(parents=True)
            (folder / 'index.js').write_bytes('interlink_command; interlink_query; "https://static-bundle-check.invalid"; "연결";\n'.encode('utf-8'))
            (folder / 'index.js.map').write_bytes(json.dumps({
                'version': 3,
                'sources': ['webpack:///' + source for source in self.sources],
                'sourcesContent': list(self.sources.values()),
            }, ensure_ascii=False).encode('utf-8'))

    def scan(self):
        result = subprocess.run([sys.executable, str(self.scanner)], env={**os.environ, 'PYTHONUTF8': '1'}, capture_output=True)
        report = self.output / 'production-fixture-scan.json'
        self.assertTrue(report.is_file(), result.stderr.decode('utf-8', errors='replace'))
        return result, json.loads(report.read_text(encoding='utf-8'))

    def test_utf8_crlf_source_matches_exact_export_snapshot(self):
        result, report = self.scan()
        self.assertEqual(result.returncode, 0, result.stdout.decode('utf-8'))
        self.assertTrue(report['passed'])
        self.assertEqual(report['changedOwnedSources'], [])

    def test_line_ending_change_is_detected_as_source_change(self):
        source = self.root / 'apps/mobile/src/example.ts'
        source.write_bytes(self.sources['apps/mobile/src/example.ts'].replace('\r\n', '\n').encode('utf-8'))
        result, report = self.scan()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report['changedOwnedSources'], ['apps/mobile/src/example.ts'])

    def test_unicode_escaped_fixture_still_fails_validation(self):
        bundle = self.output / 'android/index.js'
        with bundle.open('a', encoding='utf-8', newline='') as handle:
            handle.write(json.dumps('가상 나래', ensure_ascii=True))
        result, report = self.scan()
        self.assertEqual(result.returncode, 1)
        self.assertFalse(report['fixtureIsolationPassed'])
        self.assertTrue(any('android' in failure for failure in report['failures']))


if __name__ == '__main__':
    unittest.main()
