#!/usr/bin/env python3
"""Shared APK signature, mode, runtime and provenance verification for both build paths."""
from pathlib import Path
import hashlib,json,subprocess,zipfile,datetime,os,re,shutil
import argparse
parser=argparse.ArgumentParser(description='Verify and package a standalone demo/staging APK')
parser.add_argument('--source-build',action='store_true',help='Require pinned native-source provenance for the official source fallback')
parser.add_argument('--expected-abis',default='arm64-v8a')
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
os.chdir(root)
p=Path('apps/mobile/android/app/build/outputs/apk/release/app-release.apk')
expected_abis=sorted(set(args.expected_abis.split(',')))
assert expected_abis and all(abi in ('arm64-v8a','armeabi-v7a','x86','x86_64') for abi in expected_abis), 'Invalid expected APK ABIs'
tools=Path(os.environ['ANDROID_HOME'])/'build-tools/37.0.0'
subprocess.run([str(tools/'apksigner'),'verify','--verbose',str(p)],check=True)

digest=lambda data: hashlib.sha256(data).hexdigest()
with zipfile.ZipFile(p) as archive:
    bundle=archive.read('assets/index.android.bundle')
    assert len(bundle)>1024, 'APK has no nonempty embedded offline JS bundle'
    config_bytes=archive.read('assets/app.config')
    config=json.loads(config_bytes)
    assert config['extra']['dataMode']=='demo' and config['extra']['appEnvironment']=='staging', 'APK embedded config is not staging/demo'
    abis=sorted({entry.split('/')[1] for entry in archive.namelist() if entry.startswith('lib/') and entry.endswith('.so')})
    assert abis==expected_abis, f'Unexpected APK native ABIs: {abis}; expected {expected_abis}'
    for abi in abis:
        for library in ('libreactnative.so','libhermesvm.so','libappmodules.so'):
            assert f'lib/{abi}/{library}' in archive.namelist(), f'APK missing native runtime {abi}/{library}'
tools=Path(os.environ['ANDROID_HOME'])/'build-tools/37.0.0'
badging=subprocess.check_output([str(tools/'aapt2'),'dump','badging',str(p)],text=True)
assert "uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'" not in badging, 'Demo APK unexpectedly requests overlay permission'
package=re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'",badging)
assert package and package[1]==config['android']['package'], 'APK manifest and embedded package identity disagree'
signing=subprocess.check_output([str(tools/'apksigner'),'verify','--print-certs',str(p)],text=True)
certificate=re.search(r'^(?:Signer #1|V2 Signer:)\s+certificate SHA-256 digest: ([0-9a-f]{64})$',signing,re.MULTILINE)
assert certificate, 'APK signing certificate digest missing'
head=subprocess.run(['git','rev-parse','--verify','HEAD'],text=True,capture_output=True)
assets={str(path):digest(path.read_bytes()) for path in [Path('apps/mobile/assets')/name for name in ('icon.png','adaptive-icon.png','splash.png')]}
resources={str(path):{'sha256':digest(path.read_bytes()),'modifiedAt':datetime.datetime.fromtimestamp(path.stat().st_mtime,datetime.timezone.utc).isoformat()} for path in Path('apps/mobile/android/app/src/main/res').rglob('*') if path.is_file() and (path.name.startswith('ic_launcher') or path.name=='splashscreen_logo.png')}
hermes=Path('node_modules/react-native/sdks/hermes-engine/version.properties').read_text().split('=',1)[1].strip()
metadata={'artifact':'interlink-demo-android.apk','kind':'APK','mode':'demo','environment':'staging','applicationId':package[1],'versionCode':package[2],'versionName':package[3],'standaloneBundle':True,'embeddedBundleSha256':digest(bundle),'embeddedConfigSha256':digest(config_bytes),'architectures':abis,'reactNativeBuild':('0.88.0 from pinned npm source; pinned official Hermes AAR' if args.source_build else '0.88.0 official release artifacts'),'hermesVersion':hermes,'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size,'sourceScriptSha256':digest(Path('scripts/build-demo-apk-from-source.sh' if args.source_build else 'scripts/build-demo-apk.sh').read_bytes()),'verifierSha256':digest(Path(__file__).read_bytes()),'sourceAssetSha256':assets,'generatedNativeResources':resources,'sourceCommit':head.stdout.strip() if head.returncode==0 else None,'sourceMayIncludeUncommittedChanges':bool(subprocess.run(['git','status','--porcelain'],text=True,capture_output=True).stdout),'builtAt':datetime.datetime.fromtimestamp(p.stat().st_mtime,datetime.timezone.utc).isoformat(),'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'deviceInstallationVerified':False,'signing':'local preview/debug signing; not for store publication','signerCertificateSha256':certificate[1]}
if args.source_build:
    metadata['nativeSourceProvenance']=json.loads(Path('node_modules/react-native/ReactAndroid/build/source-deps/provenance.json').read_text())
if head.returncode==0:
    source_paths=['apps/mobile','packages/shared','packages/data','package.json','package-lock.json']
    metadata['applicationSourceMatchesCommit']=not bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=all','--',*source_paths],text=True))
    metadata['sourceTrees']={path:subprocess.check_output(['git','rev-parse','HEAD:'+path],text=True).strip() for path in source_paths}
Path('artifacts').mkdir(exist_ok=True)
shutil.copy2(p,Path('artifacts')/metadata['artifact'])
Path('artifacts/android-build.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(metadata,ensure_ascii=False,indent=2))
