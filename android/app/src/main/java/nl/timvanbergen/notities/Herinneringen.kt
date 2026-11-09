package nl.timvanbergen.notities

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray

/**
 * Herinneringen van notities als echte meldingen, ook als de app dicht is.
 * De pagina geeft de lijst door (setReminders); die bewaren we, zodat ze na een herstart opnieuw ingepland worden.
 */
object Herinneringen {
    private const val PREFS = "notities-herinneringen"
    const val CHANNEL = "herinneringen"
    const val EXTRA_NOTE = "note"

    fun channel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Herinneringen", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Meldingen voor notities met een herinnering"
                }
            )
        }
    }

    /** Nieuwe lijst van de pagina: alle oude wekkers weg, de nieuwe erin. */
    fun replace(context: Context, json: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val old = runCatching { JSONArray(prefs.getString("list", "[]")) }.getOrDefault(JSONArray())
        for (i in 0 until old.length()) cancel(context, old.getJSONObject(i).getString("id"))
        prefs.edit().putString("list", json).apply()
        scheduleAll(context)
    }

    fun scheduleAll(context: Context) {
        val list = runCatching {
            JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("list", "[]"))
        }.getOrDefault(JSONArray())
        val alarms = context.getSystemService(AlarmManager::class.java)
        val now = System.currentTimeMillis()
        for (i in 0 until list.length()) {
            val r = list.getJSONObject(i)
            val at = r.getLong("at")
            if (at < now - 60_000) continue
            val pending = pendingFor(context, r.getString("id"), r.optString("title"), r.optString("text"))
            val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        }
    }

    private fun cancel(context: Context, id: String) {
        context.getSystemService(AlarmManager::class.java).cancel(pendingFor(context, id, "", ""))
    }

    private fun pendingFor(context: Context, id: String, title: String, text: String): PendingIntent {
        val intent = Intent(context, HerinneringReceiver::class.java)
            .setAction("nl.timvanbergen.notities.HERINNERING.$id")
            .putExtra(EXTRA_NOTE, id)
            .putExtra("title", title)
            .putExtra("text", text)
        return PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun show(context: Context, id: String, title: String, text: String) {
        channel(context)
        val open = Intent(context, MainActivity::class.java)
            .setAction("nl.timvanbergen.notities.OPEN.$id")
            .putExtra(EXTRA_NOTE, id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(context, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = android.app.Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(context.getColor(R.color.launcher_bg))
            .setContentTitle(title.ifEmpty { "Herinnering" })
            .setContentText(text)
            .setStyle(android.app.Notification.BigTextStyle().bigText(text))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setCategory(android.app.Notification.CATEGORY_REMINDER)
            .build()
        runCatching { context.getSystemService(NotificationManager::class.java).notify(id.hashCode(), notification) }
    }
}

class HerinneringReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> Herinneringen.scheduleAll(context)
            else -> {
                val id = intent.getStringExtra(Herinneringen.EXTRA_NOTE) ?: return
                Herinneringen.show(context, id, intent.getStringExtra("title").orEmpty(), intent.getStringExtra("text").orEmpty())
            }
        }
    }
}
