#!/usr/bin/env python3
"""Keep fixture generation and the consuming Gradle test in one exclusive run."""
import os
import subprocess
import sys
from fixtures import ROOT, fixture_lock, generate
if os.environ.get('UMAR_E2E_PROVIDER', 'gotrue') == 'gotrue':
    from gotrue_fixture import generate
    fixture_path = ROOT / '.local/gotrue/token-fixtures.json'
else:
    fixture_path = ROOT / '.local/token-fixtures.json'

mode = sys.argv[1]
if mode not in ('jvm', 'android'):
    raise SystemExit('Expected jvm or android')
os.chdir(ROOT.parent)
env = dict(os.environ)
env.setdefault('JAVA_HOME', '/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home')
project = 'android' if mode == 'android' else 'integration-jvm'
gradle = ['sh', 'android/gradlew', '-p', project]
options = ['--no-daemon', '--max-workers=2']
compile_task = ':app:compileSyncLabDebugUnitTestKotlin' if mode == 'android' else ':core:sync:testClasses'
test_tasks = [':app:testSyncLabDebugUnitTest', '--rerun', '--tests', '*NativeRoomSyncTest'] if mode == 'android' else [':core:sync:test']
with fixture_lock():
    try:
        subprocess.run(gradle + [compile_task] + options, env=env, check=True)
        generate()
        env['UMAR_E2E_FIXTURES'] = str(fixture_path)
        subprocess.run(gradle + test_tasks + options, env=env, check=True)
    finally:
        fixture_path.unlink(missing_ok=True)
