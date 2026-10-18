package id.petalytix.ayailmu.feature.session.interact

/**
 * How target-language text is set (CR-I18N-3). Han characters have regional forms (the same code point is drawn
 * differently in Japanese and Simplified Chinese), so the text locale must name the language: Android then picks
 * the matching font. Arabic keeps its bundled font and direction.
 */
object TargetScript {
    /** BCP-47 tag for the text locale of [lang] (a pack's `target_lang`); null = leave the device locale. */
    fun localeTag(lang: String?): String? =
        when (lang?.lowercase()) {
            null, "" -> null
            "ja" -> "ja-JP"
            "zh" -> "zh-Hans-CN"
            "ko" -> "ko-KR"
            else -> lang
        }

    /** Arabic, or no language given (the pre-follow-up-11 callers): drawn by the Arabic-capable TargetText. */
    fun usesArabicStyle(lang: String?): Boolean = lang == null || lang.equals("ar", ignoreCase = true)
}
