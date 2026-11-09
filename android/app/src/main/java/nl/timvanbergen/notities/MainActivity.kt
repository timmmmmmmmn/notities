package nl.timvanbergen.notities

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
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
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import nl.timvanbergen.notities.glass.GlassBar
import nl.timvanbergen.notities.glass.GlassMenu
import nl.timvanbergen.notities.glass.records.GlassMenuItemRecord
import org.json.JSONArray
import org.json.JSONObject

/**
 * Notities als app. De website zit in de app zelf (assets/www) en wordt onder het eigen webadres
 * getoond, zodat hij ook zonder internet opent; alleen /api gaat naar de server.
 * De navigatiebalk en de menu's zijn glas van de app zelf (Android 13+), de rest van de pagina blijft plat.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var bars: WindowInsetsControllerCompat
    private var glassMenu: GlassMenu? = null
    @Volatile private var insetTop = 0f
    @Volatile private var insetBottom = 0f

    // Een snelkoppeling, melding of gedeelde tekst wacht tot de pagina klaar is (ingelogd en geladen).
    private var pending: String? = null
    private var pageReady = false

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

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

        // Terug-knop: eerst menu, paneel of de open notitie sluiten, anders de app wegzetten.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.notitiesBack ? window.notitiesBack() : false") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })

        Herinneringen.channel(this)
        handle(intent)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(HOME)
        Updater.checkQuietly(this)
    }

    /** Wat er moet gebeuren voor een snelkoppeling, melding of gedeelde tekst, als stukje JavaScript. */
    private fun actionOf(intent: Intent?): String? {
        intent ?: return null
        val note = intent.getStringExtra(Herinneringen.EXTRA_NOTE)
        if (note != null) return "window.notitiesOpen && notitiesOpen(${JSONObject.quote(note)})"
        return when (intent.action) {
            ACTION_NEW -> {
                val kind = intent.getStringExtra("kind") ?: "tekst"
                "window.notitiesNew && notitiesNew(${JSONObject.quote(kind)})"
            }
            Intent.ACTION_SEND -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
                val title = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty()
                "window.notitiesNew && notitiesNew('tekst', ${JSONObject.quote(title)}, ${JSONObject.quote(text)})"
            }
            else -> null
        }
    }

    /** Een PDF wordt eerst gekopieerd en geopend (niet op de hoofddraad), de rest kan meteen. */
    private fun handle(intent: Intent?) {
        val uri = intent?.data
        if (intent?.action == Intent.ACTION_VIEW && uri != null) {
            Thread {
                val info = Pdf.open(this, uri)
                runOnUiThread {
                    if (info == null) {
                        android.widget.Toast.makeText(this, "Deze PDF kon niet worden geopend", android.widget.Toast.LENGTH_LONG).show()
                    } else {
                        pending = "window.notitiesPdf && notitiesPdf($info)"
                        runPending()
                    }
                }
            }.start()
            return
        }
        actionOf(intent)?.let {
            pending = it
            runPending()
        }
    }

    private fun runPending() {
        val js = pending ?: return
        if (!pageReady) return
        web.evaluateJavascript(js) { done -> if (done == "true") pending = null }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun setDarkBars(dark: Boolean) {
        bars.isAppearanceLightStatusBars = !dark
        bars.isAppearanceLightNavigationBars = !dark
    }

    private fun pushInsets() {
        web.evaluateJavascript(
            "(function(r){r.setProperty('--sat','${insetTop}px');r.setProperty('--sab','${insetBottom}px');})(document.documentElement.style);" +
                "window.dispatchEvent(new Event('resize'))",
            null
        )
    }

    private fun windowRect(box: JSONObject): RectF {
        val density = resources.displayMetrics.density
        val origin = IntArray(2).also { web.getLocationInWindow(it) }
        val left = origin[0] + box.getDouble("x").toFloat() * density
        val top = origin[1] + box.getDouble("y").toFloat() * density
        return RectF(left, top, left + box.getDouble("w").toFloat() * density, top + box.getDouble("h").toFloat() * density)
    }

    /** Opent het glazen menu vanuit een knop in de pagina (positie in CSS-pixels). */
    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun showGlassMenu(menu: JSONObject) {
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
        glassMenu?.show(windowRect(menu), items, menu.optBoolean("dark")) { id ->
            web.evaluateJavascript("window.notitiesGlassPick && notitiesGlassPick(${JSONObject.quote(id)})", null)
        }
    }

    /** De zwevende glazen navigatie; de pagina meet zelf waar die hoort te staan. */
    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun showGlassBar(bar: JSONObject) {
        val tabs = bar.getJSONArray("tabs")
        glassMenu?.setBar(
            windowRect(bar.getJSONObject("pill")),
            windowRect(bar.getJSONObject("add")),
            List(tabs.length()) { i ->
                val tab = tabs.getJSONObject(i)
                GlassBar.Tab(tab.getString("id"), tab.getString("title"), tab.getString("icon"))
            },
            bar.getString("active"),
            bar.optBoolean("dark"),
            bar.optBoolean("visible", true),
        ) { id ->
            web.evaluateJavascript("window.notitiesGlassNav && notitiesGlassNav(${JSONObject.quote(id)})", null)
        }
    }

    /** Update is gedownload: zeggen dat hij erin gaat zodra je de app wegzet. */
    fun updateReady(name: String) {
        web.evaluateJavascript(
            "window.notitiesToast && notitiesToast(${JSONObject.quote("Versie $name staat klaar en wordt geïnstalleerd zodra je de app sluit")})",
            null
        )
    }

    private fun onOurSite(): Boolean = web.url?.let { android.net.Uri.parse(it).host == HOST } ?: false

    override fun onResume() {
        super.onResume()
        inFront = true
        Updater.resume(this)
        Updater.checkQuietly(this)
    }

    override fun onPause() {
        super.onPause()
        inFront = false
        CookieManager.getInstance().flush()
    }

    override fun onStop() {
        super.onStop()
        // Pas installeren als de app weg is: dan wordt niemand midden in een notitie onderbroken.
        Updater.installIfReady(this)
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

        /** Of de glazen navigatie en menu's kunnen (Android 13+). */
        @JavascriptInterface
        fun glassUi(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

        /** Geeft false terug als het hier niet kan; de pagina toont dan haar eigen menu. */
        @JavascriptInterface
        fun glassMenu(json: String): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
            val menu = JSONObject(json)
            runOnUiThread { if (onOurSite()) showGlassMenu(menu) }
            return true
        }

        @JavascriptInterface
        fun glassBar(json: String) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
            val bar = JSONObject(json)
            runOnUiThread { if (onOurSite()) showGlassBar(bar) }
        }

        /** Alle herinneringen opnieuw inplannen; bij de eerste ook om toestemming voor meldingen vragen. */
        @JavascriptInterface
        fun setReminders(json: String) {
            val list = runCatching { JSONArray(json) }.getOrNull() ?: return
            Herinneringen.replace(this@MainActivity, list.toString())
            if (list.length() > 0 && Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                runOnUiThread { askNotifications.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
            }
        }

        /** De pagina is ingelogd en klaar: wachtende acties uitvoeren, en melden als de app net is bijgewerkt. */
        @JavascriptInterface
        fun ready() {
            runOnUiThread {
                pageReady = true
                runPending()
                Updater.justUpdated(this@MainActivity)?.let { name ->
                    web.evaluateJavascript("window.notitiesToast && notitiesToast(${JSONObject.quote("Bijgewerkt naar versie $name")})", null)
                }
            }
        }

        /** Een notitie delen via het deelmenu van Android (WhatsApp, mail, ...). */
        @JavascriptInterface
        fun share(title: String, text: String) {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, title)
                .putExtra(Intent.EXTRA_TEXT, text)
            runOnUiThread { startActivity(Intent.createChooser(send, "Delen")) }
        }

        /** Inzoomen mag alleen in de PDF-weergave; de notities zelf blijven vast op schermbreedte. */
        @JavascriptInterface
        fun pdfZoom(on: Boolean) {
            runOnUiThread {
                web.settings.setSupportZoom(on)
                web.settings.builtInZoomControls = on
                web.settings.displayZoomControls = false
            }
        }

        @JavascriptInterface
        fun pdfText(token: String): String = Pdf.text(token)

        @JavascriptInterface
        fun pdfShare(token: String) {
            runOnUiThread { Pdf.share(this@MainActivity, token) }
        }

        @JavascriptInterface
        fun pdfOpenWith(token: String) {
            runOnUiThread { Pdf.openWith(this@MainActivity, token) }
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
            if (path.startsWith("/__pdf/")) return Pdf.serve(path)
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

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            pageReady = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) glassMenu?.hideBar()
        }

        override fun onPageCommitVisible(view: WebView, url: String?) = pushInsets()

        override fun onPageFinished(view: WebView, url: String?) {
            pushInsets()
            CookieManager.getInstance().flush()
        }
    }

    companion object {
        private const val HOST = "notities.timvanbergen.nl"
        private const val HOME = "https://$HOST/"
        const val ACTION_NEW = "nl.timvanbergen.notities.NIEUW"
        @Volatile var inFront = false
    }
}
