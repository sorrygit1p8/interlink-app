#!/usr/bin/env bash
# React Native's supported composite source build, retaining the pinned Hermes AAR.
# Does not edit application source, the lockfile, or the standard APK build script.
set -euo pipefail
INTERLINK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
export JAVA_HOME="${INTERLINK_SOURCE_JAVA_HOME:-/workspace/mobile-tools/jdk21}"
export ANDROID_HOME="${ANDROID_HOME:-/workspace/mobile-tools/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-/workspace/mobile-tools/cache/gradle}"
export CMAKE_VERSION="${CMAKE_VERSION:-3.22.1}"
export CMAKE_BUILD_PARALLEL_LEVEL=2
export EXPO_PUBLIC_DATA_MODE=demo
export EXPO_PUBLIC_APP_ENV=staging
export EXPO_OFFLINE=1
export EXPO_NO_TELEMETRY=1
export CI=1
export NODE_ENV=production
if [ ! -x "$JAVA_HOME/bin/javac" ]; then printf '%s\n' 'A complete JDK21 is required.' >&2; exit 1; fi
if [ ! -x "$ANDROID_HOME/cmake/$CMAKE_VERSION/bin/cmake" ]; then printf '%s\n' 'Install the selected CMake version using the official Android SDK manager first.' >&2; exit 1; fi
cd "$INTERLINK_ROOT"
npm run check:config
if [[ " $* " != *" --dry-run "* ]]; then
  # Use the same upstream versions selected by the signed npm package's catalog.
  # Git verifies content-addressed objects; pinned commits and gitlinks make the
  # official source checkout reproducible without an unchecked archive mirror.
  python3 - <<'PY'
from pathlib import Path
import json,subprocess
base=Path('node_modules/react-native/ReactAndroid/build/source-deps').resolve()
base.mkdir(parents=True,exist_ok=True)
sources=[
 ('boost_1_83_0','boostorg/boost','boost-1.83.0','564e2ac16907019696cdaba8a93e3588ec596062'),
 ('double-conversion-1.1.6','google/double-conversion','v1.1.6','361924fb61c043627d4179e941a102d543f6efa0'),
 ('folly-2024.11.18.00','facebook/folly','v2024.11.18.00','0660ead5b610047a279cc291129e98e3f2a1fc37'),
 ('fast_float-8.0.0','fastfloat/fast_float','v8.0.0','77cc847c842c49e7e3477c1e95da2b6540166d66'),
 ('fmt-12.1.0','fmtlib/fmt','12.1.0','407c905e45ad75fc29bf0f9bb7c5c2fd3475976f'),
 ('glog-0.3.5','google/glog','v0.3.5','a6a166db069520dbbd653c97c2e5b12e08a8bb26'),
]
records=[]
for folder,repository,tag,commit in sources:
    destination=base/folder
    url='https://github.com/'+repository+'.git'
    if not destination.exists():
        subprocess.run(['git','clone','--quiet','--depth=1','--branch',tag,url,str(destination)],check=True)
    actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=destination,text=True).strip()
    assert actual==commit, f'Unexpected source commit for {repository}: stop and review upstream identity'
    subprocess.run(['git','fsck','--full','--no-reflogs'],cwd=destination,check=True)
    subprocess.run(['git','diff','HEAD','--exit-code','--quiet'],cwd=destination,check=True)
    assert not subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=destination,text=True).strip(), f'Unexpected source additions for {repository}'
    if repository=='boostorg/boost':
        subprocess.run(['git','submodule','update','--init','--recursive','--depth=1','--jobs=2'],cwd=destination,check=True)
        status=subprocess.check_output(['git','submodule','status','--recursive'],cwd=destination,text=True)
        assert all(line.startswith(' ') for line in status.splitlines()), 'Boost submodule checksums do not match their pinned gitlinks'
        subprocess.run(['git','submodule','foreach','--quiet','--recursive','git fsck --full --no-reflogs && git diff HEAD --exit-code --quiet'],cwd=destination,check=True)
        if not (destination/'b2').exists(): subprocess.run(['./bootstrap.sh'],cwd=destination,check=True)
        subprocess.run(['./b2','headers','-j2'],cwd=destination,check=True)
    records.append({'repository':url,'tag':tag,'commit':commit,'verification':'git fsck; exact pinned HEAD; Boost recursive gitlinks checked'})
(base/'provenance.json').write_text(json.dumps(records,indent=2)+'\n')
PY
  export REACT_NATIVE_DEPENDENCIES="$INTERLINK_ROOT/node_modules/react-native/ReactAndroid/build/source-deps"
fi
cd apps/mobile
if [ "${INTERLINK_SOURCE_SKIP_PREBUILD:-0}" != 1 ]; then npx --no-install expo prebuild --platform android --no-install; fi
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
python3 - <<'PY'
from pathlib import Path
import json,re,urllib.request
root=Path('../..').resolve()
native=root/'node_modules/react-native'
assert json.loads((native/'package.json').read_text())['version']=='0.88.0', 'Review source-build compatibility before changing the pinned React Native version'
settings=Path('android/settings.gradle')
marker='// INTERLINK_REACT_ANDROID_SOURCE_BUILD'
text=settings.read_text()
text=text.split(marker,1)[0].rstrip()
text+='''\n// INTERLINK_REACT_ANDROID_SOURCE_BUILD
includeBuild(new File(rootDir, "../../../node_modules/react-native")) {
  dependencySubstitution {
    substitute(module("com.facebook.react:react-android")).using(project(":packages:react-native:ReactAndroid"))
    substitute(module("com.facebook.react:react-native")).using(project(":packages:react-native:ReactAndroid"))
  }
}
'''
settings.write_text(text)
hermes=(native/'sdks/hermes-engine/version.properties').read_text().split('=',1)[1].strip()
assert re.fullmatch(r'[0-9.]+',hermes)
Path('android/interlink-source-build.init.gradle').write_text('''// Generated local source-build override; no dependency version changes.
allprojects { candidate ->
  // AGP invokes Ninja directly, so CMAKE_BUILD_PARALLEL_LEVEL alone is insufficient.
  ['com.android.application', 'com.android.library'].each { pluginId ->
    candidate.plugins.withId(pluginId) {
      candidate.extensions.getByName('androidComponents').finalizeDsl { androidDsl ->
        androidDsl.defaultConfig.externalNativeBuild.cmake.arguments.addAll([
          '-DCMAKE_JOB_POOLS=interlink_native=2',
          '-DCMAKE_JOB_POOL_COMPILE=interlink_native',
          '-DCMAKE_JOB_POOL_LINK=interlink_native'
        ])
      }
    }
  }
  candidate.plugins.withId('com.facebook.react') {
    if (candidate.path == ':app') {
      candidate.extensions.getByName('react').extraPackagerArgs.addAll(['--max-workers', '2'])
    }
  }
  if (candidate.rootProject.name == "react-native-build-from-source") {
    candidate.configurations.configureEach {
      resolutionStrategy.dependencySubstitution {
        substitute(project(":packages:react-native:ReactAndroid:hermes-engine")).using(module("com.facebook.hermes:hermes-android:HER_MES_VERSION"))
      }
    }
    candidate.afterEvaluate {
      if (candidate.path == ':packages:react-native:ReactAndroid' && System.getenv('REACT_NATIVE_DEPENDENCIES')) {
        // RN 0.88 assigns boostPath from itself; replace that empty input after registration.
        candidate.tasks.named('prepareBoost').configure { boostTask ->
          boostTask.boostPath.setFrom(System.getenv('REACT_NATIVE_DEPENDENCIES'))
        }
        candidate.tasks.named('preparePrefab').configure { prefabTask ->
          // Upstream's prefab input records paths, not prepared header contents.
          // Rescan a previously cached empty Boost tree after prepareBoost repairs it.
          prefabTask.inputs.dir(new File(candidate.buildDir, 'third-party-ndk/boost/boost_1_83_0'))
            .withPropertyName('interlinkPreparedBoostHeaders')
        }
      }
    }
  }
}
'''.replace('HER_MES_VERSION',hermes))
wrapper=Path('android/gradle/wrapper/gradle-wrapper.properties')
text=wrapper.read_text()
if 'distributionSha256Sum=' not in text:
    url=next(line.split('=',1)[1] for line in text.splitlines() if line.startswith('distributionUrl=')).replace('\\:',':')
    assert url.startswith('https://services.gradle.org/distributions/')
    with urllib.request.urlopen(url+'.sha256',timeout=30) as response: checksum=response.read().decode().strip()
    assert re.fullmatch('[0-9a-f]{64}',checksum)
    wrapper.write_text(text+'\ndistributionSha256Sum='+checksum+'\n')
PY
cd android
./gradlew :app:assembleRelease --no-daemon --max-workers=1 \
  -Dorg.gradle.parallel=false \
  '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:ActiveProcessorCount=2' \
  -PreactNativeArchitectures=arm64-v8a \
  --init-script interlink-source-build.init.gradle "$@"
if [[ " $* " == *" --dry-run "* ]]; then exit 0; fi
cd "$INTERLINK_ROOT"
python3 scripts/verify-demo-apk.py --source-build
