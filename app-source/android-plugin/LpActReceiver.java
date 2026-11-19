package com.largepami.finance;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * A notification button was pressed (after unlock - see LpNotif.action), or a local snooze alarm fired.
 * - Personal reminder (tag "wc|...", scheduled on the phone by tasks-wc.js): "טופל" removes it at once, "מחר"/"בעוד שעה" snooze it
 *   locally; the press is kept (LpNotif.wcQueue) and the app applies it (and updates the server) when it opens next.
 * - Task reminder ('tk') "בעוד שעה" / "מחר": local snooze - the same notification (same token) comes back later.
 * - Anything else ("טופל", and the server-side snooze of 'sec'): the notification is removed AT ONCE (no "מעדכן…", no re-post,
 *   so the shade does not re-sort) and LpActJob sends {t: token, a: action, f: this device's FCM token} in the background
 *   (JobScheduler: waits for a network, retries with backoff) to the server address that came with the message
 *   (only https://us-central1-<this APK's Firebase project>.cloudfunctions.net/pushAct - see allowed()).
 *   Success / r:'used' -> nothing more. Refused -> one note without buttons, tap opens the item (see LpActJob).
 * Not exported: only our own PendingIntents (and LpActActivity) reach it.
 */
public class LpActReceiver extends BroadcastReceiver {
    static final long H = 3600L * 1000;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        final Context c = ctx.getApplicationContext();
        if (LpNotif.ACTION_SNZ.equals(intent.getAction())) {
            String tag = intent.getStringExtra("tag");
            if (tag != null) LpNotif.fire(c, tag);
            return;
        }
        if (!LpNotif.ACTION_ACT.equals(intent.getAction())) return;
        final Map<String, String> d = LpNotif.fromBundle(intent.getExtras());
        final String a = intent.getStringExtra("a");
        final String tag = LpNotif.s(d, "tag");
        if (a == null || tag.isEmpty() || LpNotif.s(d, "at").isEmpty()) return;
        if (!a.equals("done") && !a.equals("h1") && !a.equals("d1")) return;

        // Personal reminder (tasks-wc.js, scheduled on the phone): everything happens here, the app applies it when it opens
        if (tag.startsWith(LpNotif.WC)) {
            long now = System.currentTimeMillis();
            if (a.equals("done")) {
                LpNotif.dropSnooze(c, tag);
                LpNotif.cancel(c, tag);
                LpNotif.wcQueue(c, tag, a, 0);
            } else {
                long w = now + (a.equals("h1") ? H : 24 * H); // "מחר" = exactly 24 hours
                LpNotif.snooze(c, d, w);
                LpNotif.wcQueue(c, tag, a, w);
                LpNotif.result(c, d, a.equals("h1") ? "נזכיר לך בעוד שעה" : "נזכיר לך מחר", 4000);
            }
            return;
        }

        if ("tk".equals(d.get("k")) && (a.equals("h1") || a.equals("d1"))) {
            LpNotif.snooze(c, d, System.currentTimeMillis() + (a.equals("h1") ? H : 24 * H));
            LpNotif.result(c, d, a.equals("h1") ? "נזכיר לך בעוד שעה" : "נזכיר לך מחר", 4000);
            return;
        }

        final URL url = allowed(c, LpNotif.s(d, "u"));
        if (url == null) {
            LpNotif.result(c, d, "אי אפשר לבצע מההתראה – פתחו את האפליקציה", 0);
            return;
        }
        // optimistic: gone now, the server is updated in the background; could not schedule -> the buttons come back with a note
        LpNotif.cancel(c, tag);
        if (!LpActJob.schedule(c, d, a, url)) LpNotif.show(c, d, "לא הצלחנו לשלוח – נסו שוב");
    }

    /**
     * Only this APK's own Firebase project: exactly https://us-central1-<project_id>.cloudfunctions.net/pushAct (the address
     * push-act.js urlOf() puts in the message; us-central1 = LEGACY_REGION). project_id is the string resource the
     * google-services Gradle plugin writes from google-services.json - the same file push needs (test builds carry their own project).
     * No project_id -> nothing is allowed.
     */
    static URL allowed(Context c, String u) {
        try {
            String pid = projectId(c);
            if (pid.isEmpty() || !pid.matches("[a-z0-9-]{4,40}")) return null;
            URL url = new URL(u);
            String h = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
            if (!"https".equals(url.getProtocol())) return null;
            if (url.getUserInfo() != null || url.getPort() != -1 || url.getQuery() != null) return null;
            if (!h.equals("us-central1-" + pid + ".cloudfunctions.net")) return null;
            if (!"/pushAct".equals(url.getPath())) return null;
            return url;
        } catch (Exception e) {
            return null;
        }
    }

    /** "project_id" string resource (from google-services.json), looked up like PushGatePlugin looks up google_app_id. */
    static String projectId(Context c) {
        try {
            String pkg;
            try {
                pkg = c.getResources().getResourcePackageName(R.string.app_name);
            } catch (Exception e) {
                pkg = c.getPackageName();
            }
            int id = c.getResources().getIdentifier("project_id", "string", pkg);
            if (id == 0) id = c.getResources().getIdentifier("project_id", "string", c.getPackageName());
            return id == 0 ? "" : c.getString(id).trim().toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return "";
        }
    }

    static String fcmToken(Context c, long waitMs) {
        try {
            String t = Tasks.await(FirebaseMessaging.getInstance().getToken(), waitMs, TimeUnit.MILLISECONDS);
            if (t != null && !t.isEmpty()) {
                c.getSharedPreferences(LpMessagingService.TOK, Context.MODE_PRIVATE).edit().putString("t", t).apply();
                return t;
            }
        } catch (Exception e) {
            // slow or no Firebase - use the last known token
        }
        return c.getSharedPreferences(LpMessagingService.TOK, Context.MODE_PRIVATE).getString("t", null);
    }

    static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream i = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n, total = 0;
            while ((n = i.read(buf)) > 0 && total < 65536) {
                b.write(buf, 0, n);
                total += n;
            }
            return new String(b.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
