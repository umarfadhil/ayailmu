package id.petalytix.ayailmu.core.design.sound

/**
 * «Efek suara» (Settings, INTERACTIONS_AUDIO.md §3.2): passes an effect on to [inner] only while [enabled] says the
 * switch is on. [enabled] is read at every play, so flipping the switch needs no new object and no recomposition;
 * the app root keeps it in step with the stored setting. Voice clips do not go through here: they always play.
 */
class SwitchableSoundFx(
    private val inner: SoundFx,
    private val enabled: () -> Boolean,
) : SoundFx {
    override fun play(sfx: Sfx) {
        if (enabled()) inner.play(sfx)
    }
}
