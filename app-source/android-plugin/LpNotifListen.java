package com.largepami.finance;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Notifications from the phone for the secretary (22.11.2026, decision of the owner).
 * The manager gives "notification access" in Android settings; then Android sends every notification here.
 * We keep ONLY notifications of the apps the manager chose (allow list, or "all apps" - 24.11.2026, off by default) and drop senders on his skip list.
 * One-time codes / passwords (OTP) are never kept (isOtp - same rule as sec-notif.js and firebase/functions/lib/sec-perm.js).
 * Kept: package, app name, title (sender), text (up to 1,000 chars), time and a key against duplicates.
 * Ongoing / foreground / group-summary notifications are ignored. Nothing leaves the phone from here:
 * the queue stays in private app storage (SharedPreferences "lp_notif_in", excluded from Android backup) and
 * the screens (sec-notif.js) take it with LpNotifPlugin.pull(). Notification content is never written to the log.
 */
public class LpNotifListen extends NotificationListenerService {
    static final String PREF = "lp_notif_in";
    static final int MAX_Q = 300;
    static final int MAX_SEEN = 500;
    static final long SEEN_MS = 12L * 3600 * 1000; // the same text from the same sender again within 12 hours = an update of the same notification
    static final Object LOCK = new Object();

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (add(this, sbn)) LpNotifPlugin.emitNew();
        } catch (Throwable e) {
            // never crash the listener (Android would unbind it)
        }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    static JSONObject cfg(Context c) {
        try {
            return new JSONObject(prefs(c).getString("cfg", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static JSONArray arr(SharedPreferences p, String k) {
        try {
            return new JSONArray(p.getString(k, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Sender for comparing with the skip list: lower case, no "(3 messages)" suffix, single spaces. Same rule as senderKey in sec-notif.js. */
    static String senderKey(String s) {
        if (s == null) return "";
        String t = s.replaceAll("\\s*\\(\\d+[^)]*\\)\\s*$", "").replaceAll("\\s+", " ").trim();
        return t.toLowerCase(Locale.ROOT);
    }

    static final Pattern OTP_KW = Pattern.compile("(קוד\\s*(ה)?(אימות|זיהוי|כניסה|חד[\\s-]?פעמי|סודי|גישה)|סיסמ[אה]\\s*(חד[\\s-]?פעמית|זמנית)?|סיסמתך|קוד\\s*ה?OTP|\\bOTP\\b|verification\\s*code|security\\s*code|one[\\s-]?time\\s*(pass(word|code)?|code|pin)|\\bpasscode\\b|\\bpassword\\b|login\\s*code|auth(entication)?\\s*code|\\b2FA\\b|confirmation\\s*code|your\\s*code\\s*is|is\\s+your\\s+(\\w+\\s+)?code|\\bcode\\s*[:：]|הקוד\\s*(שלך|שלכם|הוא)|קוד\\s*[:：]|\\bPIN\\b|\\bG-\\d{6}\\b)", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    static final Pattern OTP_NUM = Pattern.compile("(^|[^\\d])\\d{4,8}([^\\d]|$)|\\b[A-Z0-9]{3,4}-[A-Z0-9]{3,4}\\b");
    static final Pattern OTP_PW = Pattern.compile("סיסמ|password|passcode", Pattern.CASE_INSENSITIVE);

    /** One-time code / password in the notification (24.11.2026). Same rule as isOtp in sec-notif.js. */
    static boolean isOtp(String title, String text) {
        String s = (title == null ? "" : title) + " " + (text == null ? "" : text);
        if (!OTP_KW.matcher(s).find()) return false;
        return OTP_NUM.matcher(s).find() || OTP_PW.matcher(s).find();
    }

    static String cs(Bundle b, String k) {
        if (b == null) return "";
        CharSequence v = b.getCharSequence(k);
        return v == null ? "" : v.toString().trim();
    }

    static String cut(String s, int n) {
        return s.length() > n ? s.substring(0, n) : s;
    }

    static String appName(Context c, String pkg) {
        try {
            PackageManager pm = c.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            CharSequence l = pm.getApplicationLabel(ai);
            return l == null ? pkg : l.toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    /** true = a new item was queued. */
    static boolean add(Context c, StatusBarNotification sbn) {
        if (sbn == null) return false;
        JSONObject cfg = cfg(c);
        if (!cfg.optBoolean("on", false)) return false;
        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(c.getPackageName())) return false;
        JSONArray pk = cfg.optJSONArray("pkgs");
        boolean allowed = cfg.optBoolean("all", false);
        if (pk != null) for (int i = 0; i < pk.length(); i++) if (pkg.equals(pk.optString(i))) allowed = true;
        if (!allowed) return false;
        Notification n = sbn.getNotification();
        if (n == null) return false;
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return false;
        if (sbn.isOngoing() || (n.flags & Notification.FLAG_ONGOING_EVENT) != 0 || (n.flags & Notification.FLAG_FOREGROUND_SERVICE) != 0) return false;
        Bundle ex = n.extras;
        String title = cs(ex, Notification.EXTRA_TITLE);
        String text = "";
        // Chat apps (MessagingStyle): the last message of the conversation is the new one
        try {
            Parcelable[] ms = ex == null ? null : ex.getParcelableArray(Notification.EXTRA_MESSAGES);
            if (ms != null && ms.length > 0 && ms[ms.length - 1] instanceof Bundle) {
                CharSequence t = ((Bundle) ms[ms.length - 1]).getCharSequence("text");
                if (t != null) text = t.toString().trim();
            }
        } catch (Exception e) {
            text = "";
        }
        if (text.length() == 0) text = cs(ex, Notification.EXTRA_BIG_TEXT);
        if (text.length() == 0) text = cs(ex, Notification.EXTRA_TEXT);
        if (title.length() == 0 && text.length() == 0) return false;
        title = cut(title, 200);
        text = cut(text, 1000);
        if (isOtp(title, text)) return false; // never stored, never shown, never sent to AI
        String sk = senderKey(title);
        JSONArray skip = cfg.optJSONArray("skip");
        if (skip != null && sk.length() > 0) for (int i = 0; i < skip.length(); i++) if (sk.equals(senderKey(skip.optString(i)))) return false;
        String key = pkg + "|" + Integer.toHexString((sk + "\u0001" + text).hashCode()) + Integer.toHexString(text.length());
        long now = System.currentTimeMillis();
        long t = sbn.getPostTime() > 0 ? sbn.getPostTime() : now;
        String app = appName(c, pkg);
        synchronized (LOCK) {
            SharedPreferences p = prefs(c);
            JSONArray seen = arr(p, "seen");
            JSONArray seen2 = new JSONArray();
            boolean dup = false;
            for (int i = 0; i < seen.length(); i++) {
                JSONObject o = seen.optJSONObject(i);
                if (o == null || now - o.optLong("t", 0) > SEEN_MS) continue;
                if (key.equals(o.optString("k"))) dup = true;
                seen2.put(o);
            }
            if (dup) return false;
            try {
                JSONObject s = new JSONObject();
                s.put("k", key);
                s.put("t", now);
                seen2.put(s);
                while (seen2.length() > MAX_SEEN) seen2.remove(0);
                JSONObject it = new JSONObject();
                it.put("k", key + "|" + Long.toString(t, 36));
                it.put("p", pkg);
                it.put("a", app);
                it.put("s", title);
                it.put("x", text);
                it.put("t", t);
                it.put("d", 0);
                JSONArray q = arr(p, "q");
                q.put(it);
                while (q.length() > MAX_Q) q.remove(0);
                p.edit().putString("q", q.toString()).putString("seen", seen2.toString()).apply();
            } catch (Exception e) {
                return false;
            }
        }
        return true;
    }

    /** Items not taken yet; marks them as taken (they stay in the queue until pushed out, so a lost answer can be taken again with all=true). */
    static JSONArray pull(Context c, boolean all) {
        JSONArray out = new JSONArray();
        synchronized (LOCK) {
            SharedPreferences p = prefs(c);
            JSONArray q = arr(p, "q");
            boolean ch = false;
            for (int i = 0; i < q.length(); i++) {
                JSONObject o = q.optJSONObject(i);
                if (o == null) continue;
                if (all || o.optInt("d", 0) == 0) out.put(o);
                if (o.optInt("d", 0) == 0) {
                    try {
                        o.put("d", 1);
                        ch = true;
                    } catch (Exception e) {
                        // keep it as not taken
                    }
                }
            }
            if (ch) p.edit().putString("q", q.toString()).apply();
        }
        return out;
    }

    static void clear(Context c) {
        synchronized (LOCK) {
            prefs(c).edit().remove("q").remove("seen").apply();
        }
    }

    static void setCfg(Context c, boolean on, boolean all, JSONArray pkgs, JSONArray skip, String uid) {
        JSONObject o = new JSONObject();
        try {
            JSONArray pk = new JSONArray();
            Set<String> uniq = new HashSet<>();
            if (pkgs != null) for (int i = 0; i < pkgs.length() && pk.length() < 40; i++) {
                String s = pkgs.optString(i, "");
                if (s.matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+") && s.length() <= 150 && uniq.add(s)) pk.put(s);
            }
            JSONArray sk = new JSONArray();
            if (skip != null) for (int i = 0; i < skip.length() && sk.length() < 200; i++) {
                String s = skip.optString(i, "").trim();
                if (s.length() > 0) sk.put(cut(s, 100));
            }
            o.put("on", on);
            o.put("all", all);
            o.put("pkgs", pk);
            o.put("skip", sk);
            o.put("u", uid == null ? "" : cut(uid, 128));
        } catch (Exception e) {
            return;
        }
        synchronized (LOCK) {
            prefs(c).edit().putString("cfg", o.toString()).apply();
        }
    }
}
