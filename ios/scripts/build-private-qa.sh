#!/bin/bash
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVIDENCE="${AYAILMU_EVIDENCE_DIR:-${TMPDIR:-/tmp}/ayailmu-ios-m1}"
CA="${AYAILMU_QA_CA_PEM:?Set AYAILMU_QA_CA_PEM to the authorized public CA file}"
mkdir -p "$EVIDENCE"
openssl x509 -in "$CA" -outform der -out "$EVIDENCE/PrivateOwnerCA.der"
ACTUAL="$(shasum -a 256 "$EVIDENCE/PrivateOwnerCA.der" | cut -d ' ' -f 1)"
[ "$ACTUAL" = 75bf582db974accb5b4ed74936c8477fa6a6fc94f5d2ca33d8500b224f1ffbd0 ] || { echo 'Unexpected public CA'; exit 1; }
xcodebuild -project "$ROOT/AyaIlmu.xcodeproj" -scheme AyaIlmu -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,id=8568898D-1CF8-4B81-8CF9-3CC764D517CD' -derivedDataPath "$EVIDENCE/DerivedData" -jobs 2 CODE_SIGNING_ALLOWED=NO 'OTHER_SWIFT_FLAGS=$(inherited) -j2' 'SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG PRIVATE_OWNER_QA' "AYAILMU_QA_CA_DER=$EVIDENCE/PrivateOwnerCA.der" build
