# Shared learning core

Standalone Kotlin2.2.20 project; Android is not converted or modified. `prepare-shared-sources.py` mechanically derives19 original Kotlin files into ignored build output and records hashes/replacements. Platform seams cover Foundation/JVM normalization, the Unicode character-class regex, date/time/calendar and UUID functions. The native regex uses Foundation ICU and expands Java's default ASCII whitespace class explicitly. Grading/session/projection decisions remain in original Kotlin functions.

`LearningBridge` exports throwing string-only start/submit/advance/project operations. Opaque SessionState, exact AnswerEvent JSON and authored feedback cross the ABI. Unsigned framework builds target both ARM64 iOS Simulator and ARM64 iOS device using the existing SDK. Physical-device app installation, signing and runtime validation remain future work. Source and adapter changes update the persisted core fingerprint.

`jvmTest` produces `build/parity/jvm-golden.json` from fixture-only resources. The iOS XCTest target compares actual native transitions/events/projection and standard platform seams against that JVM output, then exercises the actual Swift adapter/session/SQLite/presentation path. It also confirms malformed inputs throw NSError without terminating the process. No fixture resources are part of native main/framework sources or the normal app.
