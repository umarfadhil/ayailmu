package id.petalytix.ayailmu.core.billing

import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Local signature check of a Play purchase (CR-BIL-4). [base64PublicKey] is the app's licence key from Play
 * Console (Monetisation setup), passed in through BuildConfig on the build machine and never committed.
 * With no key (demo builds, or before the Play Console app exists) the check is skipped: [enabled] is false.
 * Without a backend this is the strongest check available; it stops forged purchase JSON, not a rooted device.
 */
class PurchaseVerifier(
    private val base64PublicKey: String,
) {
    val enabled: Boolean get() = base64PublicKey.isNotBlank()

    fun verify(
        originalJson: String,
        signature: String,
    ): Boolean {
        if (!enabled) return true
        if (originalJson.isEmpty() || signature.isEmpty()) return false
        return try {
            val key = KeyFactory.getInstance(KEY_ALGORITHM).generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(base64PublicKey.trim())))
            Signature.getInstance(SIGNATURE_ALGORITHM).run {
                initVerify(key)
                update(originalJson.toByteArray(Charsets.UTF_8))
                verify(Base64.getDecoder().decode(signature))
            }
        } catch (e: java.security.GeneralSecurityException) {
            false
        } catch (e: IllegalArgumentException) {
            false
        }
    }

    private companion object {
        const val KEY_ALGORITHM = "RSA"
        const val SIGNATURE_ALGORITHM = "SHA1withRSA"
    }
}
