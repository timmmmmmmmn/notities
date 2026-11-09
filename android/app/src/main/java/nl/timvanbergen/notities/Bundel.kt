package nl.timvanbergen.notities

import android.content.Context
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

/** Levert de bestanden van de ingebouwde website (assets/www), inclusief stukjes voor muziek (Range). */
object Bundel {
    private val types = mapOf(
        "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
        "json" to "application/json", "webmanifest" to "application/manifest+json", "png" to "image/png",
        "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "svg" to "image/svg+xml", "ico" to "image/x-icon",
        "woff2" to "font/woff2", "mp3" to "audio/mpeg", "m4a" to "audio/mp4", "mp4" to "video/mp4", "wav" to "audio/wav", "txt" to "text/plain",
    )

    fun serve(ctx: Context, path: String, range: String?): WebResourceResponse? {
        val clean = path.trimStart('/').substringBefore('?')
        if (clean.contains("..")) return null
        val ext = clean.substringAfterLast('.', "").lowercase()
        val mime = types[ext] ?: "application/octet-stream"
        val text = mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript")
        val bytes = try { ctx.assets.open("www/$clean").use { it.readBytes() } } catch (e: Exception) { return null } // niet ingebouwd: van internet
        val headers = mutableMapOf("Cache-Control" to "no-cache", "Accept-Ranges" to "bytes")
        val m = range?.let { Regex("bytes=(\\d*)-(\\d*)").find(it) }
        if (m != null && bytes.isNotEmpty()) {
            val start = m.groupValues[1].toLongOrNull() ?: 0L
            val end = (m.groupValues[2].toLongOrNull() ?: (bytes.size - 1L)).coerceAtMost(bytes.size - 1L)
            if (start <= end) {
                headers["Content-Range"] = "bytes $start-$end/${bytes.size}"
                headers["Content-Length"] = (end - start + 1).toString()
                return WebResourceResponse(mime, if (text) "utf-8" else null, 206, "Partial Content", headers,
                    ByteArrayInputStream(bytes, start.toInt(), (end - start + 1).toInt()))
            }
        }
        headers["Content-Length"] = bytes.size.toString()
        return WebResourceResponse(mime, if (text) "utf-8" else null, 200, "OK", headers, ByteArrayInputStream(bytes))
    }
}
