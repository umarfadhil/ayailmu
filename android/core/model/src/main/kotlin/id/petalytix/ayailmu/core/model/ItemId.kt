package id.petalytix.ayailmu.core.model

/**
 * Item identifiers are immutable strings. New AyaIlmu packs use `<TRACK>-<AUD>-<LVL>-<UNIT>-<nnn>`
 * (framework §7, e.g. `MAT-K-P-03-012`); the reviewed Arabic course keeps its own ids (`C04`, `E-D05`, …)
 * verbatim (CR-ENG-1), so this helper only *builds* the new scheme and never validates legacy ids.
 */
object ItemId {
    private val NEW_SCHEME = Regex("^[A-Z]{2,4}-[KA]-[PMHX]-\\d{2}-\\d{3}$")

    fun build(
        track: String,
        audience: Audience,
        level: Level,
        unit: Int,
        seq: Int,
    ): String {
        require(track.length in 2..4 && track.all { it.isUpperCase() }) { "track code must be 2–4 upper-case letters" }
        require(unit in 1..99) { "unit must be 1..99" }
        require(seq in 1..999) { "seq must be 1..999" }
        return "%s-%s-%s-%02d-%03d".format(track, audience.code, level.code, unit, seq)
    }

    fun isNewScheme(id: String): Boolean = NEW_SCHEME.matches(id)
}
