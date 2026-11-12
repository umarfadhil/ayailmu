#!/bin/bash
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${AYAILMU_GRADLE_BIN:?Set the approved Gradle8.14.3 executable}"
: "${AYAILMU_KOTLIN_NATIVE_HOME:?Set the verified Kotlin2.2.20 native compiler home}"
: "${GRADLE_USER_HOME:?Set a task-local Gradle cache}"
: "${KONAN_DATA_DIR:?Set a task-local native dependency cache}"
"$AYAILMU_GRADLE_BIN" -p "$ROOT/SharedLearningCore" --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1024m "-Pkotlin.native.home=$AYAILMU_KOTLIN_NATIVE_HOME" jvmTest
"$AYAILMU_GRADLE_BIN" -p "$ROOT/SharedLearningCore" --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1024m "-Pkotlin.native.home=$AYAILMU_KOTLIN_NATIVE_HOME" linkDebugFrameworkIosSimulatorArm64 linkDebugFrameworkIosArm64
