package com.largepami.finance;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * A notification button was pressed (after unlock - see LpNotif.action), or a local snooze alarm fired.
 * - Task reminder ('tk') "בעוד שעה" / "מחר": local snooze - the same notification (same token) comes back later.
 * - Anything else: POST {t: token, a: action, f: this device's FCM token} to the server address that came with the message
 *   (only https://us-central1-<this APK's Firebase project>.cloudfunctions.net/pushAct - see allowed()). While waiting the notification shows "מעדכן…".
 *   Success -> the server's message without buttons, gone after 4 seconds. No connection -> the buttons come back with a note.
 *   r:'used' (already handled, e.g. a second tap or another device) -> treated as success: "כבר טופל", gone after 4 seconds.
 * Time budget (goAsync gives ~10 s): FCM token 1 s + connect 2 s + read 7 s.
 * Not exported: only our own PendingIntents (and LpActActivity) reach it.
 */
public class LpActReceiver extends BroadcastReceiver {
    static final long H = 3600L * 1000;
    static final String NO_NET = "אין חיבור לאינטרנט – נסו שוב";

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
        LpNotif.progress(c, d);
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                run(c, d, a, url);
            } catch (Throwable t) {
                LpNotif.show(c, d, NO_NET);
            } finally {
                pr.finish();
            }
        }).start();
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

    static String fcmToken(Context c) {
        try {
            String t = Tasks.await(FirebaseMessaging.getInstance().getToken(), 1000, TimeUnit.MILLISECONDS);
            if (t != null && !t.isEmpty()) {
                c.getSharedPreferences(LpMessagingService.TOK, Context.MODE_PRIVATE).edit().putString("t", t).apply();
                return t;
            }
        } catch (Exception e) {
            // slow or no Firebase - use the last known token
        }
        return c.getSharedPreferences(LpMessagingService.TOK, Context.MODE_PRIVATE).getString("t", null);
    }

    static void run(Context c, Map<String, String> d, String a, URL url) {
        String f = fcmToken(c);
        if (f == null) {
            LpNotif.show(c, d, NO_NET);
            return;
        }
        HttpURLConnection con = null;
        int code;
        String body;
        try {
            JSONObject req = new JSONObject();
            req.put("t", LpNotif.s(d, "at"));
            req.put("a", a);
            req.put("f", f);
            byte[] out = req.toString().getBytes(StandardCharsets.UTF_8);
            con = (HttpURLConnection) url.openConnection();
            con.setInstanceFollowRedirects(false);
            con.setConnectTimeout(2000);
            con.setReadTimeout(7000); // the server checks permissions and runs a transaction - 4 s was too short on a cold start
            con.setDoOutput(true);
            con.setRequestMethod("POST");
            con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            con.setFixedLengthStreamingMode(out.length);
            try (OutputStream os = con.getOutputStream()) {
                os.write(out);
            }
            code = con.getResponseCode();
            InputStream in = code >= 400 ? con.getErrorStream() : con.getInputStream();
            body = read(in);
        } catch (Exception e) {
            LpNotif.show(c, d, NO_NET);
            return;
        } finally {
            if (con != null) con.disconnect();
        }
        JSONObject r = null;
        try {
            r = new JSONObject(body);
        } catch (Exception e) {
            // not JSON
        }
        if (r == null || code >= 500) {
            LpNotif.show(c, d, "לא הצלחנו לעדכן – נסו שוב");
            return;
        }
        String msg = r.optString("msg", "");
        if ("used".equals(r.optString("r", ""))) {
            // already done (second tap after a slow answer, or the same item from another device) - same as success
            LpNotif.dropSnooze(c, LpNotif.s(d, "tag"));
            LpNotif.result(c, d, "כבר טופל", 4000);
            return;
        }
        if (r.optBoolean("ok", false)) {
            LpNotif.dropSnooze(c, LpNotif.s(d, "tag"));
            if (r.optBoolean("open", false)) {
                // Android 10+ does not let a background receiver open a screen: the note stays until tapped (tap opens the item)
                LpNotif.result(c, d, msg.isEmpty() ? "לחצו לפתיחה באפליקציה" : msg, 0);
            } else {
                LpNotif.result(c, d, msg.isEmpty() ? "עודכן" : msg, 4000);
            }
        } else {
            // refused by the server (token used / expired / no permission): no buttons, tap opens the app
            LpNotif.result(c, d, msg.isEmpty() ? "הפעולה לא בוצעה – פתחו את האפליקציה" : msg, 0);
        }
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
