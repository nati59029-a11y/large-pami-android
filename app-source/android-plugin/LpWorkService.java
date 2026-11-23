package com.largepami.finance;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Background work (17.11.2026): customer feedback queues keep running when the user leaves the app.
 * A foreground service (type dataSync) with a quiet ongoing notification ("מזהה דפי משוב…" / "שולח סריקות…") keeps the
 * app process (and with it the WebView that runs the queues) from being frozen, plus a partial wake lock so the work goes on
 * with the screen off. The screens start it while there is pending work and stop it when the queues are empty.
 * Safety: stops by itself after MAX_MS, when the task is swiped away, and when Android 15 says the dataSync time is up.
 * Nothing is lost if it stops: the queues are saved on the phone and resume on the next open.
 */
public class LpWorkService extends Service {
    static final String CH = "lp_work";
    static final int NID = 7401;
    static final String EXTRA_TEXT = "text";
    static final long MAX_MS = 2L * 3600 * 1000;
    static volatile LpWorkService running;
    /** 23.11.2026: two users of the same service - the screens (jsHold, with their text) and the app update download (updHold).
     *  The service stops only when neither needs it. */
    static volatile boolean jsHold, updHold;
    static volatile String jsText = "";

    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable limit = this::stopSelf;
    private PowerManager.WakeLock wl;
    private String text = "";

    static void channel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CH) != null) return;
        NotificationChannel ch = new NotificationChannel(CH, "עבודה ברקע", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("מוצגת כשהאפליקציה ממשיכה לעבוד כשהיא סגורה (למשל זיהוי או שליחה של דפי משוב)");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    Notification build(String t) {
        channel(this);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, NID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ContextCompat.getColor(this, R.color.notif_accent))
            .setContentTitle(t == null || t.isEmpty() ? "עובד ברקע…" : t)
            .setContentText("ממשיך גם כשהאפליקציה סגורה")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(pi)
            .build();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "largepami:work");
                wl.setReferenceCounted(false);
                wl.acquire(MAX_MS);
            }
        } catch (Exception e) {
            wl = null;
        }
        h.postDelayed(limit, MAX_MS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String t = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        if (t != null) text = t;
        Notification n = build(text);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(NID, n);
        } catch (Exception e) {
            // Not allowed now (e.g. started from the background) - the queues simply wait for the next open, like before
            stopSelf();
        }
        // Restarted by Android without the screens = nothing to run; do not come back
        return START_NOT_STICKY;
    }

    /** New progress text, without calling startForegroundService again (not allowed from the background on Android 12+). */
    void update(String t) {
        if (t == null || t.equals(text)) return;
        text = t;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NID, build(t));
        } catch (Exception e) {
            // notification not shown - the work goes on
        }
    }

    /** Swiped away from recent apps: the screens are gone, nothing left to keep running. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // An app update download goes on (it does not need the screens); it stops the service itself when done
        if (!updHold) stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    /** Android 15+: the daily dataSync time is used up. No @Override - the method exists only from API 35. */
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        h.removeCallbacks(limit);
        try {
            if (wl != null && wl.isHeld()) wl.release();
        } catch (Exception e) {
            // already released
        }
        wl = null;
        if (running == this) running = null;
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception e) {
        }
        LpWorkPlugin.stopped();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
