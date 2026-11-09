package nl.timvanbergen.notities

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.webkit.WebResourceResponse
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * PDF's openen met Notities: het bestand wordt in de app bewaard en de pagina's worden met
 * Androids eigen PdfRenderer als plaatjes getekend. De pagina zelf toont ze (/__pdf/<token>/<n>.jpg).
 */
object Pdf {
    private const val WIDTH = 1600
    private var token: String? = null
    private var file: File? = null
    private var name = "Document.pdf"
    private var renderer: PdfRenderer? = null

    /** Kopieert de PDF uit de andere app en geeft de gegevens voor de pagina terug (of null). */
    @Synchronized
    fun open(context: Context, uri: Uri): JSONObject? = runCatching {
        close()
        val dir = File(context.cacheDir, "pdf").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        name = displayName(context, uri) ?: "Document.pdf"
        val id = System.currentTimeMillis().toString(36)
        val copy = File(dir, "$id.pdf")
        context.contentResolver.openInputStream(uri)!!.use { input -> copy.outputStream().use { input.copyTo(it) } }
        val pdf = PdfRenderer(ParcelFileDescriptor.open(copy, ParcelFileDescriptor.MODE_READ_ONLY))
        val pages = JSONArray()
        for (i in 0 until pdf.pageCount) {
            pdf.openPage(i).use { pages.put(JSONObject().put("w", it.width).put("h", it.height)) }
        }
        renderer = pdf
        file = copy
        token = id
        JSONObject().put("token", id).put("name", name).put("pages", pages)
    }.getOrNull()

    private fun displayName(context: Context, uri: Uri): String? =
        if (uri.scheme == "file") uri.lastPathSegment
        else context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }

    @Synchronized
    private fun close() {
        runCatching { renderer?.close() }
        renderer = null
        token = null
    }

    /** /__pdf/<token>/<n>.jpg: één pagina als plaatje, zo breed dat inzoomen scherp blijft. */
    @Synchronized
    fun serve(path: String): WebResourceResponse? {
        val parts = path.removePrefix("/__pdf/").split('/')
        if (parts.size != 2 || parts[0] != token) return notFound()
        val index = parts[1].substringBefore('.').toIntOrNull() ?: return notFound()
        val pdf = renderer ?: return notFound()
        if (index !in 0 until pdf.pageCount) return notFound()
        val bytes = pdf.openPage(index).use { page ->
            val scale = WIDTH.toFloat() / page.width
            val w = WIDTH
            val h = (page.height * scale).roundToInt().coerceAtMost(WIDTH * 3)
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
            bitmap.recycle()
            out.toByteArray()
        }
        return WebResourceResponse("image/jpeg", null, 200, "OK", mapOf("Cache-Control" to "private, max-age=3600"), ByteArrayInputStream(bytes))
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    /** De tekst uit de PDF (Android 15+); op oudere toestellen een lege tekst. */
    @Synchronized
    fun text(id: String): String {
        if (id != token || Build.VERSION.SDK_INT < 35) return ""
        val pdf = renderer ?: return ""
        val out = StringBuilder()
        for (i in 0 until min(pdf.pageCount, 200)) {
            runCatching {
                pdf.openPage(i).use { page ->
                    val text = page.textContents.joinToString("\n") { it.text }.trim()
                    if (text.isNotEmpty()) out.append(text).append("\n\n")
                }
            }
            if (out.length > 150_000) break
        }
        return out.toString().trim()
    }

    private fun shareable(context: Context, id: String): Uri? {
        val f = file?.takeIf { id == token } ?: return null
        val named = File(f.parentFile, name.replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").ifEmpty { "Document.pdf" })
        if (!named.exists()) f.copyTo(named, overwrite = true)
        return FileProvider.getUriForFile(context, "${context.packageName}.files", named)
    }

    fun share(context: Context, id: String) {
        val uri = shareable(context, id) ?: return
        val send = Intent(Intent.ACTION_SEND).setType("application/pdf")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, "PDF delen"))
    }

    fun openWith(context: Context, id: String) {
        val uri = shareable(context, id) ?: return
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            context.startActivity(Intent.createChooser(view, "Openen met"))
        } catch (_: ActivityNotFoundException) {
        }
    }
}
