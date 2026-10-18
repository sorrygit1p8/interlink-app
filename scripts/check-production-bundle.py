#!/usr/bin/env python3
"""Verify fixture exclusion from the synthetic three-platform production export."""
import hashlib
import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone

root = pathlib.Path(__file__).resolve().parents[1]
output = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'artifacts/prod-check'
if not output.is_dir():
    raise SystemExit('Export directory is missing. Run npm run check:production first.')
head = subprocess.run(['git', 'rev-parse', '--verify', 'HEAD'], cwd=root, capture_output=True, text=True)
markers = [
    'interlink.demo.state.v1',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'DEMO_PROVIDER_UNAVAILABLE',
    'DEMO_STORAGE_RETRY_REQUIRED',
    '가상 나래', '가상 두리', '가상 하린',
    '우리 동네, 초록 지도', '상상으로 만드는 작은 전시',
    '인터링크 가상 프로젝트실',
]
def marker_scan_text(content):
    # This exact form placeholder is explanatory UI copy, not a seeded title.
    # Only complete quoted literals are exempt; fixture values still fail.
    label = '예: 우리 동네, 초록 지도'
    for representation in (label, json.dumps(label, ensure_ascii=True)[1:-1]):
        for quote in ('"', "'"):
            content = content.replace(quote + representation + quote, quote + quote)
    return content

def sections(data):
    yield data
    for section in data.get('sections', []):
        yield from sections(section['map'])

def source_label(source):
    normalized = source.replace('\\', '/')
    for prefix in ('apps/mobile/', 'packages/data/', 'packages/shared/', 'node_modules/'):
        if prefix in normalized:
            return prefix + normalized.split(prefix, 1)[1]
    return pathlib.PurePosixPath(normalized).name

result = {
    'checkedAtUtc': datetime.now(timezone.utc).isoformat(),
    'mode': 'production/supabase static export with deliberately non-working synthetic configuration',
    'sourceRevisionAtScan': head.stdout.strip() if head.returncode == 0 else None,
    'sourceRevisionNote': 'Current HEAD is informational; per-file source hashes below verify the exported source snapshot.',
    'markers': markers,
    'bundles': [], 'sourceMaps': [], 'failures': [],
}
platforms = set()
for path in sorted(output.rglob('*.js')):
    content = path.read_text(encoding='utf-8')
    platform = next((p for p in ('android', 'ios', 'web') if p in path.parts), None)
    if not platform:
        continue
    platforms.add(platform)
    scan_text = marker_scan_text(content)
    matches = [m for m in markers if m in scan_text or json.dumps(m, ensure_ascii=True)[1:-1] in scan_text]
    record = {
        'path': str(path.relative_to(output)), 'platform': platform,
        'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'demoMarkerMatches': matches,
        'realRpcPresent': 'interlink_command' in content and 'interlink_query' in content,
        'syntheticUrlPresent': 'https://static-bundle-check.invalid' in content,
    }
    result['bundles'].append(record)
    if matches:
        result['failures'].append('Bundle validation failed: ' + record['path'])

for path in sorted(output.rglob('*.map')):
    data = json.loads(path.read_text(encoding='utf-8'))
    sources, matched, snapshots = [], [], []
    for part in sections(data):
        for source, content in zip(part.get('sources', []), part.get('sourcesContent', [])):
            source = source.replace('\\', '/')
            sources.append(source)
            if content:
                scan_text = marker_scan_text(content)
                for marker in markers:
                    if marker in scan_text:
                        matched.append({'source': source_label(source), 'marker': marker})
                for prefix in ('apps/mobile/', 'packages/data/', 'packages/shared/'):
                    if prefix in source and '?ctx=' not in source and source.endswith(('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json')):
                        relative = prefix + source.split(prefix, 1)[1]
                        actual = root / relative
                        snapshots.append({
                            'source': relative,
                            'exportedSourceSha256': hashlib.sha256(content.encode('utf-8')).hexdigest(),
                            # read_text normalizes CRLF. Compare exact UTF-8 bytes
                            # so Windows source snapshots remain verifiable.
                            'matchesCurrentFile': actual.is_file() and actual.read_bytes() == content.encode('utf-8'),
                        })
                        break
    demo = [s for s in sources if s.endswith('/packages/data/src/demo.ts') or s.endswith('/packages/data/src/fixtures.ts')]
    production = [s for s in sources if s.endswith('/packages/data/src/production.ts')]
    real = [s for s in sources if s.endswith('/packages/data/src/supabase.ts')]
    if demo or matched:
        result['failures'].append('Source-map validation failed: ' + str(path.relative_to(output)))
    result['sourceMaps'].append({
        'path': str(path.relative_to(output)), 'platform': next((p for p in ('android', 'ios', 'web') if p in path.parts), None), 'moduleCount': len(sources),
        'productionEntryModules': [source_label(source) for source in production],
        'realAdapterModules': [source_label(source) for source in real],
        'demoModules': [source_label(source) for source in demo], 'demoMarkerMatches': matched, 'ownedSourceSnapshots': snapshots,
    })
if platforms != {'android', 'ios', 'web'}:
    result['failures'].append('Expected Android, iOS and web JS outputs; found ' + ', '.join(sorted(platforms)))
for platform in ('android', 'ios', 'web'):
    bundles = [b for b in result['bundles'] if b['platform'] == platform]
    maps = [m for m in result['sourceMaps'] if m['platform'] == platform]
    if not any(b['realRpcPresent'] for b in bundles) or not any(b['syntheticUrlPresent'] for b in bundles):
        result['failures'].append('Missing real RPC or synthetic runtime config for ' + platform)
    if not any(m['productionEntryModules'] for m in maps) or not any(m['realAdapterModules'] for m in maps):
        result['failures'].append('Missing production entry or real adapter module for ' + platform)
changed = sorted({snapshot['source'] for m in result['sourceMaps'] for snapshot in m['ownedSourceSnapshots'] if not snapshot['matchesCurrentFile']})
result['fixtureIsolationPassed'] = not result['failures']
result['sourceSnapshotMatchesWorkingTree'] = not changed
result['changedOwnedSources'] = changed
result['passed'] = result['fixtureIsolationPassed'] and result['sourceSnapshotMatchesWorkingTree']
report = output / 'production-fixture-scan.json'
report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
(output / 'PRODUCTION_BUNDLE_PROOF.md').write_text(f"""# Production mobile bundle isolation proof

This is a static verification export, not a deployable release, APK, IPA, installed app, or verified remote connection. The URL `https://static-bundle-check.invalid`, public key `sb_publishable_static_bundle_check_not_a_real_key`, and application identifier `invalid.interlink.staticcheck` are synthetic and deliberately non-working. They are not claimed as user-owned.

Checked at: {result['checkedAtUtc']}. Passed: **{result['passed']}**.

- JavaScript chunks: {len(result['bundles'])}; source maps: {len(result['sourceMaps'])}.
- Platforms: {', '.join(sorted(platforms))}.
- Fixture exclusion: {result['fixtureIsolationPassed']}.
- Embedded owned source matches working-tree files: {result['sourceSnapshotMatchesWorkingTree']}.
- Changed source files: {json.dumps(changed)}.
- Validation failures: {json.dumps(result['failures'])}.

The check requires the production data entry and real Supabase RPC adapter on every platform. It rejects demo/fixture modules and checks {len(markers)} fictional-data markers, including Unicode-escaped JavaScript and decoded source-map content. Explanatory demo wording and the fail-closed compatibility factory may remain; this is not a search for every occurrence of the word demo.

`production-fixture-scan.json` records exact filenames, byte sizes, bundle SHA-256 hashes, embedded source hashes, and module evidence. Current Git HEAD is informational; the source-byte comparison verifies the actual export snapshot, including any uncommitted source changes. No Auth, database, Storage or push operation is performed.

From the repository root, run `npm run check:production` to repeat the complete synthetic three-platform export and check on Windows, macOS or Linux. Bytecode is deliberately disabled and external source maps enabled for transparent inspection. The scripts are included in source control; local success does not claim a remote GitHub Actions run.

To check an existing export again without rebuilding, run `npm run check:production -- --scan-only`. Set `INTERLINK_PYTHON` to a Python 3.10+ executable path if it is not available on PATH. Any later application source change requires re-exporting. Keep this proof separate from the demo APK and actual remote/device verification.
""", encoding='utf-8', newline='\n')
print(json.dumps({
    'passed': result['passed'], 'platforms': sorted(platforms),
    'bundles': len(result['bundles']), 'sourceMaps': len(result['sourceMaps']),
    'failures': result['failures'],
    'fixtureIsolationPassed': result['fixtureIsolationPassed'],
    'sourceSnapshotMatchesWorkingTree': result['sourceSnapshotMatchesWorkingTree'],
    'changedOwnedSources': changed,
    'report': report.relative_to(root).as_posix() if report.is_relative_to(root) else report.name,
}, ensure_ascii=False, indent=2))
raise SystemExit(0 if result['passed'] else 1)
