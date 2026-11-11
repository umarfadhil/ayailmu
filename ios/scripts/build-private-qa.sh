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
SHARED_ARGS=()
AYAILMU_SHARED_FRAMEWORK_DIR="${AYAILMU_SHARED_FRAMEWORK_DIR:-$ROOT/SharedLearningCore/build/bin/iosSimulatorArm64/debugFramework}"
if [ -n "$AYAILMU_SHARED_FRAMEWORK_DIR" ]; then
  [ -f "$AYAILMU_SHARED_FRAMEWORK_DIR/AyaIlmuSharedLearning.framework/AyaIlmuSharedLearning" ] || { echo 'Missing shared learning framework'; exit 1; }
  SHARED_ARGS+=("FRAMEWORK_SEARCH_PATHS=\$(inherited) $AYAILMU_SHARED_FRAMEWORK_DIR" 'OTHER_LDFLAGS=$(inherited) -framework AyaIlmuSharedLearning')
fi
xcodebuild -project "$ROOT/AyaIlmu.xcodeproj" -scheme AyaIlmu -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,id=8568898D-1CF8-4B81-8CF9-3CC764D517CD' -derivedDataPath "$EVIDENCE/DerivedData" -jobs 2 CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= 'OTHER_SWIFT_FLAGS=$(inherited) -j2' 'SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG PRIVATE_OWNER_QA REQUIRE_SHARED_CORE' "AYAILMU_QA_CA_DER=$EVIDENCE/PrivateOwnerCA.der" "${SHARED_ARGS[@]}" build
