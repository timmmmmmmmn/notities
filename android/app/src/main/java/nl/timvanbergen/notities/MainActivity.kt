package nl.timvanbergen.notities

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.RectF
import android.os.Build
import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import nl.timvanbergen.notities.glass.GlassMenu
import nl.timvanbergen.notities.glass.records.GlassMenuItemRecord
import org.json.JSONObject

/**
 * Notities als app. De website zit in de app zelf (assets/www) en wordt onder het eigen webadres
 * getoond, zodat hij ook zonder internet opent; alleen /api gaat naar de server.
 * De menu's zijn hier glazen menu's van de app (Android 13+), de rest van de pagina blijft plat.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var bars: WindowInsetsControllerCompat
    private var glassMenu: GlassMenu? = null
    @Volatile private var insetTop = 0f
    @Volatile private var insetBottom = 0f

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Tekenen tot onder status- en navigatiebalk; de pagina houdt zelf die ruimte vrij.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
            @Suppress("DEPRECATION")
            window.isStatusBarContrastEnforced = false
        }

        val root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            glassMenu = GlassMenu(window.decorView as ViewGroup)
        }

        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        bars = WindowCompat.getInsetsController(window, root)
        setDarkBars(night)

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val density = resources.displayMetrics.density
            // Toetsenbord open: de WebView krimpt, zodat je altijd ziet wat je typt.
            view.setPadding(sys.left, 0, sys.right, ime.bottom)
            insetTop = sys.top / density
            insetBottom = if (ime.bottom > 0) 0f else sys.bottom / density
            pushInsets()
            WindowInsetsCompat.CONSUMED
        }

        CookieManager.getInstance().setAcceptCookie(true)
        web.setBackgroundColor(getColor(R.color.page_bg))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportZoom(false)
            builtInZoomControls = false
            userAgentString = "$userAgentString NotitiesApp/${Updater.currentName(this@MainActivity)}"
        }
        web.addJavascriptInterface(Bridge(), "NotitiesNative")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = Client()

        // Terug-knop: eerst menu, instellingen of de open notitie sluiten, anders de app wegzetten.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.notitiesBack ? window.notitiesBack() : false") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(HOME)
        Updater.checkQuietly(this)
    }

    private fun setDarkBars(dark: Boolean) {
        bars.isAppearanceLightStatusBars = !dark
        bars.isAppearanceLightNavigationBars = !dark
    }

    private fun pushInsets() {
        web.evaluateJavascript(
            "(function(r){r.setProperty('--sat','${insetTop}px');r.setProperty('--sab','${insetBottom}px');})(document.documentElement.style)",
            null
        )
    }

    /** Opent het glazen menu vanuit een knop in de pagina (positie in CSS-pixels). */
    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun showGlassMenu(menu: JSONObject) {
        val density = resources.displayMetrics.density
        val origin = IntArray(2).also { web.getLocationInWindow(it) }
        val left = origin[0] + menu.getDouble("x").toFloat() * density
        val top = origin[1] + menu.getDouble("y").toFloat() * density
        val from = RectF(left, top, left + menu.getDouble("w").toFloat() * density, top + menu.getDouble("h").toFloat() * density)
        val rows = menu.getJSONArray("items")
        val items = List(rows.length()) { i ->
            val row = rows.getJSONObject(i)
            GlassMenuItemRecord(
                id = row.optString("id"),
                title = row.optString("title"),
                subtitle = row.optString("subtitle").ifEmpty { null },
                icon = row.optString("icon").ifEmpty { null },
                checked = if (row.has("checked")) row.optBoolean("checked") else null,
                destructive = row.optBoolean("destructive"),
                disabled = row.optBoolean("disabled"),
                separator = row.optBoolean("separator"),
                heading = row.optBoolean("heading"),
            )
        }
        glassMenu?.show(from, items, menu.optBoolean("dark")) { id ->
            web.evaluateJavascript("window.notitiesGlassPick && notitiesGlassPick(${JSONObject.quote(id)})", null)
        }
    }

    private fun onOurSite(): Boolean = web.url?.let { android.net.Uri.parse(it).host == HOST } ?: false

    override fun onResume() {
        super.onResume()
        Updater.resume(this)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    /** Wat de pagina van de app mag vragen. */
    private inner class Bridge {

        @JavascriptInterface
        fun insets(): String = "$insetTop,$insetBottom"

        @JavascriptInterface
        fun setDark(dark: Boolean) {
            runOnUiThread { if (onOurSite()) setDarkBars(dark) }
        }

        @JavascriptInterface
        fun haptic(kind: String) {
            runOnUiThread {
                if (!onOurSite()) return@runOnUiThread
                val effect = when {
                    kind == "confirm" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> HapticFeedbackConstants.CONFIRM
                    kind == "reject" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> HapticFeedbackConstants.REJECT
                    kind == "long" -> HapticFeedbackConstants.LONG_PRESS
                    else -> HapticFeedbackConstants.CLOCK_TICK
                }
                web.performHapticFeedback(effect)
            }
        }

        /** Geeft false terug als het hier niet kan (ouder dan Android 13); de pagina toont dan haar eigen menu. */
        @JavascriptInterface
        fun glassMenu(json: String): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
            val menu = JSONObject(json)
            runOnUiThread { if (onOurSite()) showGlassMenu(menu) }
            return true
        }

        /** Een notitie delen via het deelmenu van Android (WhatsApp, mail, ...). */
        @JavascriptInterface
        fun share(title: String, text: String) {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, title)
                .putExtra(Intent.EXTRA_TEXT, text)
            runOnUiThread { startActivity(Intent.createChooser(send, "Notitie delen")) }
        }

        @JavascriptInterface
        fun appVersion(): String = Updater.currentName(this@MainActivity)

        @JavascriptInterface
        fun checkForUpdate() {
            runOnUiThread { if (onOurSite()) Updater.check(this@MainActivity, manual = true) }
        }
    }

    private inner class Client : WebViewClient() {

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.host != HOST || request.method != "GET") return null
            val path = url.path ?: "/"
            if (path.startsWith("/api/")) return null
            return Bundel.serve(this@MainActivity, if (path == "/" || path.isEmpty()) "/index.html" else path, null)
        }

        // Links naar andere sites openen in de browser.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == HOST) return false
            try {
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
            } catch (_: ActivityNotFoundException) {
            }
            return true
        }

        override fun onPageCommitVisible(view: WebView, url: String?) = pushInsets()

        override fun onPageFinished(view: WebView, url: String?) {
            pushInsets()
            CookieManager.getInstance().flush()
        }
    }

    private companion object {
        const val HOST = "notities.timvanbergen.nl"
        const val HOME = "https://$HOST/"
    }
}
