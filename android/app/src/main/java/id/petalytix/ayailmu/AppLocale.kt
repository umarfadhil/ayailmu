package id.petalytix.ayailmu

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import id.petalytix.ayailmu.core.model.Lang

/**
 * App language follows the active profile's instruction language (CR-I18N-2). Uses AppCompat's per-app
 * locale API, which maps to the platform LocaleManager on Android 13+ and is persisted by AppCompat below
 * that. Android may report Indonesian as the legacy code "in"; Lang.fromTag handles both.
 */
object AppLocale {
    fun current(): Lang? {
        val locales = AppCompatDelegate.getApplicationLocales()
        return if (locales.isEmpty) null else locales[0]?.language?.let { Lang.fromTag(it) }
    }

    /** Applies [lang] if it differs from the current per-app language. Returns true when a change was made. */
    fun apply(lang: Lang): Boolean {
        if (current() == lang) return false
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(lang.tag))
        return true
    }
}
