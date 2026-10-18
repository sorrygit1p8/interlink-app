#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -n "${INTERLINK_TOOLS_ENV:-}" ]; then
    if [ ! -f "$INTERLINK_TOOLS_ENV" ]; then
        printf '%s\n' 'INTERLINK_TOOLS_ENV must name an existing environment file.' >&2
        exit 1
    fi
    if [[ "$INTERLINK_TOOLS_ENV" = /* ]]; then
        source "$INTERLINK_TOOLS_ENV"
    else
        source "./$INTERLINK_TOOLS_ENV"
    fi
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d /workspace/mobile-tools/android-sdk ]; then export ANDROID_HOME=/workspace/mobile-tools/android-sdk; fi
if [ -z "${JAVA_HOME:-}" ] && [ -x /workspace/mobile-tools/jdk21/bin/javac ]; then export JAVA_HOME=/workspace/mobile-tools/jdk21; fi
if [ -z "${GRADLE_USER_HOME:-}" ] && [ -d /workspace/mobile-tools/cache/gradle ]; then export GRADLE_USER_HOME=/workspace/mobile-tools/cache/gradle; fi
if [ -z "${ANDROID_HOME:-}" ]; then printf '%s\n' 'Set ANDROID_HOME to an installed Android SDK. See docs/BUILD_AND_DOWNLOAD.md.' >&2; exit 1; fi
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then printf '%s\n' 'Set JAVA_HOME to a complete JDK 21, including javac (a JRE is insufficient).' >&2; exit 1; fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export EXPO_PUBLIC_DATA_MODE=demo
export EXPO_PUBLIC_APP_ENV=staging
export EXPO_OFFLINE=1
export EXPO_NO_TELEMETRY=1
export CI=1
export NODE_ENV=production
cd "$REPO_ROOT"
npm run check:config
cd apps/mobile
# Generate native configuration for this explicit demo build, not a retained production project.
npx --no-install expo prebuild --platform android --no-install
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
python3 - <<'PY'
from pathlib import Path
import re, urllib.request
p = Path('android/gradle/wrapper/gradle-wrapper.properties')
s = p.read_text()
if 'distributionSha256Sum=' not in s:
    url = next(line.split('=', 1)[1] for line in s.splitlines() if line.startswith('distributionUrl=')).replace('\\:', ':')
    if not url.startswith('https://services.gradle.org/distributions/'):
        raise SystemExit('Inspect nonstandard Gradle distribution before building')
    with urllib.request.urlopen(url + '.sha256', timeout=30) as response:
        checksum = response.read().decode().strip()
    assert re.fullmatch('[0-9a-f]{64}', checksum), 'Invalid official Gradle checksum'
    p.write_text(s + '\ndistributionSha256Sum=' + checksum + '\n')
PY
cd android
./gradlew :app:assembleRelease --no-daemon --max-workers=2 "-PreactNativeArchitectures=${INTERLINK_ANDROID_ARCHS:-arm64-v8a}"
cd "$REPO_ROOT"
python3 scripts/verify-demo-apk.py --expected-abis "${INTERLINK_ANDROID_ARCHS:-arm64-v8a}"
