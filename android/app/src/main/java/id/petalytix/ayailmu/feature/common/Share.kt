package id.petalytix.ayailmu.feature.common

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri

/** System share sheet for exported files; read permission goes to the receiving app only (CR-DAT-4). */
fun shareIntent(
    uris: List<Uri>,
    title: String,
): Intent {
    require(uris.isNotEmpty()) { "nothing to share" }
    val send =
        Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "text/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
            clipData = ClipData.newRawUri(null, uris.first()).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    return Intent.createChooser(send, title)
}

/** Returns false when Android cannot or will not open the chooser; the caller shows the existing export notice. */
fun startShare(
    context: Context,
    uris: List<Uri>,
    title: String,
): Boolean =
    try {
        context.startActivity(shareIntent(uris, title))
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }
