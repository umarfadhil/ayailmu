# AyaIlmu R8 rules. Keep this file small; prefer library consumer rules.

# kotlinx.serialization: keep serializers for pack models (generated classes are referenced reflectively).
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class id.petalytix.ayailmu.**$$serializer { *; }
-keepclassmembers class id.petalytix.ayailmu.** { *** Companion; }
-keepclasseswithmembers class id.petalytix.ayailmu.** { kotlinx.serialization.KSerializer serializer(...); }
