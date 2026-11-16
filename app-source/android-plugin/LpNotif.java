package com.largepami.finance;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONObject;

/**
 * Notifications with action buttons (16.11.2026) - builder and local snooze store.
 * The server sends a data-only FCM message: {k:'sec'|'tk', v, id, title, body, tag, at (one-time token), acts, u}.
 * We build the notification here: buttons "טופל" (or "פתח"), "הזכר לי מחר", "הזכר לי בעוד שעה".
 * The one-time token travels only in the extras of the button intents (and in the private snooze store for a local snooze).
 * Tapping the text opens the app with the same extras an FCM notification has (google.message_id + k, v, id), so the
 * existing "pushNotificationActionPerformed" listener in secretary.js keeps working.
 */
public class LpNotif {
    public static final String CH = "lp_act";
    public static final int NID = 7301;
    public static final String ACTION_ACT = "com.largepami.finance.LP_ACT";
    public static final String ACTION_SNZ = "com.largepami.finance.LP_SNZ";
    static final String PREF = "lp_notif_snz";
    /** Keys of the data map that are kept (button extras, snooze store). */
    static final String[] KEYS = {"k", "v", "id", "title", "body", "tag", "at", "acts", "u"};

    static void channel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CH) != null) return;
        NotificationChannel ch = new NotificationChannel(CH, "התראות ותזכורות", NotificationManager.IMPORTANCE_HIGH);
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
    }

    static String s(Map<String, String> d, String k) {
        String v = d.get(k);
        return v == null ? "" : v;
    }

    static Map<String, String> fromBundle(Bundle b) {
        Map<String, String> d = new HashMap<>();
        if (b == null) return d;
        for (String k : KEYS) {
            String v = b.getString(k);
            if (v != null) d.put(k, v);
        }
        return d;
    }

    static void toIntent(Intent i, Map<String, String> d) {
        for (String k : KEYS) {
            String v = d.get(k);
            if (v != null) i.putExtra(k, v);
        }
    }

    static int req(String tag, String what) {
        return (tag + "|" + what).hashCode();
    }

    /** Opens the app like a tap on an FCM notification (no token in these extras). */
    static Intent openIntent(Context c, Map<String, String> d) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra("google.message_id", "lp:" + s(d, "tag"));
        for (String k : new String[] {"k", "v", "id"}) {
            String v = d.get(k);
            if (v != null) i.putExtra(k, v);
        }
        return i;
    }

    static PendingIntent openPi(Context c, Map<String, String> d) {
        return PendingIntent.getActivity(c, req(s(d, "tag"), "open"), openIntent(c, d),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static NotificationCompat.Builder base(Context c, String title) {
        channel(c);
        NotificationCompat.Builder pub = new NotificationCompat.Builder(c, CH)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ContextCompat.getColor(c, R.color.notif_accent))
            .setContentTitle("התראה חדשה");
        return new NotificationCompat.Builder(c, CH)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ContextCompat.getColor(c, R.color.notif_accent))
            .setContentTitle(title)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(pub.build());
    }

    static void post(Context c, String tag, NotificationCompat.Builder b) {
        try {
            NotificationManagerCompat.from(c).notify(tag, NID, b.build());
        } catch (SecurityException e) {
            // no notification permission (Android 13+) - nothing to show
        }
    }

    public static void cancel(Context c, String tag) {
        if (tag == null || tag.isEmpty()) return;
        NotificationManagerCompat.from(c).cancel(tag, NID);
    }

    static String label(String a) {
        switch (a) {
            case "done": return "טופל";
            case "open": return "פתח";
            case "d1": return "הזכר לי מחר";
            case "h1": return "הזכר לי בעוד שעה";
            default: return null;
        }
    }

    /** Builds one button. Android 12+: unlock required; 8-11: through LpActActivity (asks to unlock); below 8: opens the app. */
    static NotificationCompat.Action action(Context c, Map<String, String> d, String a) {
        String tag = s(d, "tag");
        PendingIntent pi;
        if ("open".equals(a)) {
            if (Build.VERSION.SDK_INT >= 26) {
                Intent i = new Intent(c, LpActActivity.class);
                i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                i.putExtra("a", "open");
                i.putExtra("k", s(d, "k"));
                i.putExtra("v", s(d, "v"));
                i.putExtra("id", s(d, "id"));
                i.putExtra("tag", tag);
                pi = PendingIntent.getActivity(c, req(tag, a), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            } else {
                pi = openPi(c, d);
            }
            return new NotificationCompat.Action.Builder(0, label(a), pi).build();
        }
        if (Build.VERSION.SDK_INT >= 31) {
            Intent i = new Intent(c, LpActReceiver.class).setAction(ACTION_ACT);
            toIntent(i, d);
            i.putExtra("a", a);
            pi = PendingIntent.getBroadcast(c, req(tag, a), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            return new NotificationCompat.Action.Builder(0, label(a), pi).setAuthenticationRequired(true).build();
        }
        if (Build.VERSION.SDK_INT >= 26) {
            Intent i = new Intent(c, LpActActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            toIntent(i, d);
            i.putExtra("a", a);
            pi = PendingIntent.getActivity(c, req(tag, a), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            return new NotificationCompat.Action.Builder(0, label(a), pi).build();
        }
        // Android 7 and older: no safe way to ask for unlock from a button - the button opens the app (documented limitation)
        return new NotificationCompat.Action.Builder(0, label(a), openPi(c, d)).build();
    }

    /** Shows (or replaces) the notification with its buttons. err = an extra line under the text (or null). */
    public static void show(Context c, Map<String, String> d, String err) {
        String tag = s(d, "tag");
        if (tag.isEmpty()) return;
        String body = s(d, "body");
        String text = err == null ? body : (body.isEmpty() ? err : body + "\n" + err);
        NotificationCompat.Builder b = base(c, s(d, "title"))
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openPi(c, d))
            .setAutoCancel(true)
            .setOnlyAlertOnce(err != null);
        String acts = "," + s(d, "acts") + ",";
        boolean canAct = !s(d, "at").isEmpty();
        // fixed order: done/open, tomorrow, in an hour
        for (String a : new String[] {"done", "open", "d1", "h1"}) {
            if (!acts.contains("," + a + ",")) continue;
            if (!"open".equals(a) && !canAct) continue;
            b.addAction(action(c, d, a));
        }
        post(c, tag, b);
    }

    /** "מעדכן…" while the request runs (no buttons, so no double tap). */
    static void progress(Context c, Map<String, String> d) {
        NotificationCompat.Builder b = base(c, s(d, "title"))
            .setContentText("מעדכן…")
            .setProgress(0, 0, true)
            .setOnlyAlertOnce(true)
            .setSilent(true);
        post(c, s(d, "tag"), b);
    }

    /** Result line without buttons. timeout > 0 = disappears by itself. Tap opens the item. */
    static void result(Context c, Map<String, String> d, String msg, long timeout) {
        NotificationCompat.Builder b = base(c, s(d, "title"))
            .setContentText(msg)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(msg))
            .setContentIntent(openPi(c, d))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setSilent(true);
        if (timeout > 0) b.setTimeoutAfter(timeout);
        post(c, s(d, "tag"), b);
    }

    // ---------- local snooze (task reminders): AlarmManager + private SharedPreferences, restored after reboot ----------

    static PendingIntent snzPi(Context c, String tag) {
        Intent i = new Intent(c, LpActReceiver.class).setAction(ACTION_SNZ);
        i.putExtra("tag", tag);
        return PendingIntent.getBroadcast(c, req(tag, "snz"), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void alarm(Context c, String tag, long when) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = snzPi(c, tag);
        try {
            boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
            if (Build.VERSION.SDK_INT < 23) am.set(AlarmManager.RTC_WAKEUP, when, pi);
            else if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        } catch (SecurityException e) {
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        }
    }

    public static void snooze(Context c, Map<String, String> d, long when) {
        String tag = s(d, "tag");
        if (tag.isEmpty()) return;
        try {
            JSONObject o = new JSONObject();
            o.put("t", when);
            JSONObject dd = new JSONObject();
            for (String k : KEYS) if (d.get(k) != null) dd.put(k, d.get(k));
            o.put("d", dd);
            c.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(tag, o.toString()).apply();
        } catch (Exception e) {
            return;
        }
        alarm(c, tag, when);
    }

    /** A newer message for the same item replaces an old snooze. */
    public static void dropSnooze(Context c, String tag) {
        if (tag == null || tag.isEmpty()) return;
        SharedPreferences p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        if (!p.contains(tag)) return;
        p.edit().remove(tag).apply();
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(snzPi(c, tag));
    }

    static Map<String, String> read(JSONObject dd) {
        Map<String, String> d = new HashMap<>();
        Iterator<String> it = dd.keys();
        while (it.hasNext()) {
            String k = it.next();
            d.put(k, dd.optString(k, ""));
        }
        return d;
    }

    /** The alarm fired: bring the same notification back (same token). */
    static void fire(Context c, String tag) {
        SharedPreferences p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        String raw = p.getString(tag, null);
        if (raw == null) return;
        p.edit().remove(tag).apply();
        try {
            show(c, read(new JSONObject(raw).getJSONObject("d")), null);
        } catch (Exception e) {
            // broken entry - dropped
        }
    }

    /** After reboot / app update: alarms are gone, set them again (past ones show now). Entries older than 8 days are dropped (token expired). */
    public static void restore(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        for (Map.Entry<String, ?> e : new HashMap<>(p.getAll()).entrySet()) {
            String tag = e.getKey();
            try {
                long t = new JSONObject(String.valueOf(e.getValue())).getLong("t");
                if (t < now - 8L * 24 * 3600 * 1000) p.edit().remove(tag).apply();
                else if (t <= now) fire(c, tag);
                else alarm(c, tag, t);
            } catch (Exception x) {
                p.edit().remove(tag).apply();
            }
        }
    }
}
