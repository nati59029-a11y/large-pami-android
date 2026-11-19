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
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONArray;
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
    /** Personal reminders scheduled by the screens (tasks-wc.js): tag = "wc|<business>|<uid>|<k>|<id>|<n>". */
    public static final String WC = "wc|";
    /** Button presses on personal reminders, waiting for the app to open (the screens apply them). */
    static final String QPREF = "lp_wc_q";
    static final long DAY = 24L * 3600 * 1000;
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

    /**
     * Post time of our notification with this tag that is showing now (0 = none / Android below 6). A re-post keeps it
     * (setWhen), so an update never moves the notification - or the app's notification bundle - to the top of the shade.
     */
    static long whenOf(Context c, String tag) {
        if (Build.VERSION.SDK_INT < 23 || tag == null || tag.isEmpty()) return 0;
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return 0;
            for (StatusBarNotification sb : nm.getActiveNotifications()) {
                if (sb.getId() == NID && tag.equals(sb.getTag())) {
                    long w = sb.getNotification().when;
                    return w > 0 ? w : sb.getPostTime();
                }
            }
        } catch (Exception e) {
            // unknown - a new time
        }
        return 0;
    }

    /** Re-post of a notification that may be showing: its original time, no new sound / heads-up. */
    static NotificationCompat.Builder keepTime(Context c, String tag, NotificationCompat.Builder b) {
        long w = whenOf(c, tag);
        return b.setWhen(w > 0 ? w : System.currentTimeMillis()).setShowWhen(true).setOnlyAlertOnce(true);
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
            .setShowWhen(true)
            .setOnlyAlertOnce(err != null);
        // err != null = an update of a notification that is showing: keep its time (new message / snooze alarm = a new time)
        if (err != null) keepTime(c, tag, b);
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
        keepTime(c, s(d, "tag"), b);
        post(c, s(d, "tag"), b);
    }

    /**
     * A button press that the server refused / could not do (LpActJob): one note without buttons, tap opens the item.
     * Not silent (the user believed it was done). If a newer notification for the same item is showing, it is not replaced.
     */
    static void failed(Context c, Map<String, String> d, String msg) {
        String tag = s(d, "tag");
        if (tag.isEmpty() || whenOf(c, tag) > 0) return;
        NotificationCompat.Builder b = base(c, s(d, "title"))
            .setContentText(msg)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(msg))
            .setContentIntent(openPi(c, d))
            .setAutoCancel(true)
            .setShowWhen(true)
            .setOnlyAlertOnce(true);
        post(c, tag, b);
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

    /**
     * Sign-out (PushGate.clearLocal from secPushOff): waiting button presses (LpActJob), all local snoozes and their alarms, the cached FCM token,
     * and every notification we built (id NID) are removed, so the next user of this phone sees none of them.
     */
    public static void clearAll(Context c) {
        LpActJob.cancelAll(c); // button presses still waiting to be sent
        SharedPreferences p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        for (String tag : new HashMap<>(p.getAll()).keySet()) {
            if (am != null) am.cancel(snzPi(c, tag));
            cancel(c, tag);
        }
        p.edit().clear().apply();
        c.getSharedPreferences(QPREF, Context.MODE_PRIVATE).edit().clear().apply();
        c.getSharedPreferences(LpMessagingService.TOK, Context.MODE_PRIVATE).edit().clear().apply();
        if (Build.VERSION.SDK_INT >= 23) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            for (StatusBarNotification sb : nm.getActiveNotifications()) {
                if (sb.getId() == NID && sb.getTag() != null) nm.cancel(sb.getTag(), NID);
            }
        }
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
    // ---------- personal reminders (16.11.2026): scheduled here so their buttons work without opening the app ----------

    /** "k|id" of a tag after its prefix ("k|id|n"). */
    static String item(String rest) {
        int i = rest.lastIndexOf('|');
        return i < 0 ? rest : rest.substring(0, i);
    }

    /**
     * Replaces all scheduled personal reminders with the list from the screens (prefix = "wc|<business>|<uid>|").
     * Shown reminders stay, unless their item is gone (not in keep) or they belong to another user / business.
     * n: [{t: "k|id|n", title, body, at, acts}] - only future times are scheduled.
     */
    public static synchronized void wcSync(Context c, String prefix, JSONArray n, JSONArray keep) {
        if (prefix == null || !prefix.startsWith(WC)) return;
        SharedPreferences p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences.Editor ed = p.edit();
        for (String tag : new HashMap<>(p.getAll()).keySet()) {
            if (!tag.startsWith(WC)) continue;
            if (am != null) am.cancel(snzPi(c, tag));
            ed.remove(tag);
        }
        ed.commit();
        java.util.Set<String> k = new java.util.HashSet<>();
        if (keep != null) for (int i = 0; i < keep.length(); i++) k.add(keep.optString(i, ""));
        if (Build.VERSION.SDK_INT >= 23) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                for (StatusBarNotification sb : nm.getActiveNotifications()) {
                    String tag = sb.getTag();
                    if (sb.getId() != NID || tag == null || !tag.startsWith(WC)) continue;
                    if (!tag.startsWith(prefix) || !k.contains(item(tag.substring(prefix.length())))) nm.cancel(tag, NID);
                }
            }
        }
        if (n == null) return;
        long now = System.currentTimeMillis();
        for (int i = 0; i < n.length() && i < 64; i++) {
            JSONObject o = n.optJSONObject(i);
            if (o == null) continue;
            String t = o.optString("t", "");
            long at = o.optLong("at", 0);
            if (t.isEmpty() || at <= now || at > now + 400 * DAY) continue;
            Map<String, String> d = new HashMap<>();
            d.put("k", "tk"); // tap on the text opens "היום שלי" (same as a task notification from the server)
            d.put("tag", prefix + t);
            d.put("title", o.optString("title", ""));
            d.put("body", o.optString("body", ""));
            d.put("at", "L"); // local: the buttons are handled on the phone (LpActReceiver), no server token
            d.put("acts", o.optString("acts", ""));
            snooze(c, d, at);
        }
    }

    /** A button was pressed on a personal reminder: kept until the screens read it (wcPeek) and confirm (wcAck). */
    static synchronized void wcQueue(Context c, String tag, String a, long w) {
        try {
            SharedPreferences q = c.getSharedPreferences(QPREF, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(q.getString("q", "[]")), out = new JSONArray();
            long now = System.currentTimeMillis();
            for (int i = Math.max(0, arr.length() - 199); i < arr.length(); i++) out.put(arr.get(i));
            JSONObject o = new JSONObject();
            o.put("q", now + ":" + Math.abs((tag + a + System.nanoTime()).hashCode()));
            o.put("tag", tag);
            o.put("a", a);
            o.put("t", now);
            o.put("w", w);
            out.put(o);
            q.edit().putString("q", out.toString()).commit();
        } catch (Exception e) {
            // broken store - the press still worked on the notification
        }
    }

    /** Waiting presses of this user and business (prefix). Older than 8 days are dropped. */
    public static synchronized JSONArray wcPeek(Context c, String prefix) {
        JSONArray r = new JSONArray();
        if (prefix == null || !prefix.startsWith(WC)) return r;
        try {
            SharedPreferences q = c.getSharedPreferences(QPREF, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(q.getString("q", "[]")), keep = new JSONArray();
            long old = System.currentTimeMillis() - 8 * DAY;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null || o.optLong("t", 0) < old) continue;
                keep.put(o);
                if (o.optString("tag", "").startsWith(prefix)) r.put(o);
            }
            if (keep.length() != arr.length()) q.edit().putString("q", keep.toString()).commit();
        } catch (Exception e) {
            c.getSharedPreferences(QPREF, Context.MODE_PRIVATE).edit().clear().commit();
        }
        return r;
    }

    /** The screens applied these presses (by "q" id) - remove them. all = sign-out: remove every press. */
    public static synchronized void wcAck(Context c, JSONArray ids, boolean all) {
        SharedPreferences q = c.getSharedPreferences(QPREF, Context.MODE_PRIVATE);
        if (all) {
            q.edit().clear().commit();
            return;
        }
        try {
            java.util.Set<String> k = new java.util.HashSet<>();
            for (int i = 0; ids != null && i < ids.length(); i++) k.add(ids.optString(i, ""));
            JSONArray arr = new JSONArray(q.getString("q", "[]")), keep = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && !k.contains(o.optString("q", ""))) keep.put(o);
            }
            q.edit().putString("q", keep.toString()).commit();
        } catch (Exception e) {
            q.edit().clear().commit();
        }
    }
}
