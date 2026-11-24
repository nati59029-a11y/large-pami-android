package com.largepami.finance;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.PersistableBundle;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/**
 * Notification button -> server, in the background (19.11.2026). LpActReceiver removes the notification at once
 * (nothing is re-posted, so the shade does not re-sort) and schedules this job; JobScheduler runs it when there is
 * a network and retries with exponential backoff (5xx / no connection / no FCM token). Persisted across reboot
 * (RECEIVE_BOOT_COMPLETED is already in the manifest).
 * Result: ok, or r in done/closed/used/wait/h1/d1 -> nothing to show. Refused (open:true, expired, no permission, ...)
 * -> ONE notification without buttons, "לא הצלחנו לבצע מההתראה: <msg> – לחצו לפתיחה", tap opens the item.
 * No success within 7 days (the token's life) -> the same notification.
 * Job id: one per notification tag (always negative, so it never meets WorkManager's non-negative ids).
 * The one-time token is only in the job extras (private to the app, like the snooze store) - never logged.
 * Not exported; only the system (BIND_JOB_SERVICE) binds to it.
 * Group delivery receipt (a = "rcv", 24.11.2026): scheduled by LpMessagingService when a group message arrives. Same request,
 * but quiet: nothing is ever shown (success or failure), it only stops trying.
 */
public class LpActJob extends JobService {
    static final long MAX_AGE = 7L * 24 * 3600 * 1000;
    static final String FAIL = "לא הצלחנו לבצע מההתראה: ";
    static final String TAP = " – לחצו לפתיחה";
    /** Bumped on sign-out: a try that is already running then shows nothing to the next user. */
    static volatile int epoch;

    static int jobId(String tag) {
        return ("lpact|" + tag).hashCode() | 0x80000000;
    }

    /** Schedules the request. false = could not schedule (the caller shows the buttons again). Same token already pending -> true, nothing new. */
    static boolean schedule(Context c, Map<String, String> d, String a, URL url) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return false;
            String tag = LpNotif.s(d, "tag");
            int id = jobId(tag);
            for (JobInfo j : js.getAllPendingJobs()) {
                if (j.getId() != id) continue;
                PersistableBundle old = j.getExtras();
                // second press on the same token while the first is waiting: send only once
                if (old != null && LpNotif.s(d, "at").equals(old.getString("at"))) return true;
            }
            PersistableBundle x = new PersistableBundle();
            for (String k : LpNotif.KEYS) {
                String v = d.get(k);
                if (v != null) x.putString(k, v);
            }
            x.putString("a", a);
            x.putString("url", url.toString());
            x.putLong("t0", System.currentTimeMillis());
            ComponentName cn = new ComponentName(c, LpActJob.class);
            if (Build.VERSION.SDK_INT >= 31) {
                // expedited = runs right away when possible; if not allowed (quota / build check) -> an ordinary job below
                try {
                    JobInfo ji = builder(id, cn, x).setExpedited(true).build();
                    if (js.schedule(ji) == JobScheduler.RESULT_SUCCESS) return true;
                } catch (Exception e) {
                    // fall through
                }
            }
            return js.schedule(builder(id, cn, x).build()) == JobScheduler.RESULT_SUCCESS;
        } catch (Exception e) {
            return false;
        }
    }

    /** Group message arrived: tell the server it was received (same address check as the buttons). */
    static void receipt(Context c, Map<String, String> d) {
        if (LpNotif.s(d, "at").isEmpty()) return;
        URL url = LpActReceiver.allowed(c, LpNotif.s(d, "u"));
        if (url != null) schedule(c, d, "rcv", url);
    }

    static JobInfo.Builder builder(int id, ComponentName cn, PersistableBundle x) {
        return new JobInfo.Builder(id, cn)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .setPersisted(true)
            .setExtras(x);
    }

    /** Sign-out (LpNotif.clearAll): cancels every waiting request of ours. */
    static void cancelAll(Context c) {
        epoch++;
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            String me = LpActJob.class.getName();
            for (JobInfo j : js.getAllPendingJobs()) {
                if (j.getService() != null && me.equals(j.getService().getClassName())) js.cancel(j.getId());
            }
        } catch (Exception e) {
            // nothing to cancel
        }
    }

    @Override
    public boolean onStartJob(final JobParameters p) {
        final Context c = getApplicationContext();
        new Thread(() -> {
            boolean retry;
            try {
                retry = run(c, p.getExtras());
            } catch (Throwable t) {
                retry = true;
            }
            jobFinished(p, retry);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters p) {
        // stopped by the system (network lost / time limit): try again later. A request already sent -> r:'used' next time = success
        return true;
    }

    /** One try. true = try again later. */
    static boolean run(Context c, PersistableBundle x) {
        if (x == null) return false;
        final int ep0 = epoch;
        Map<String, String> d = new HashMap<>();
        for (String k : LpNotif.KEYS) {
            String v = x.getString(k);
            if (v != null) d.put(k, v);
        }
        String a = x.getString("a");
        long t0 = x.getLong("t0", 0);
        boolean old = System.currentTimeMillis() - t0 > MAX_AGE;
        // delivery receipt: never shows anything - epoch -1 never matches, so fail() is silent
        final int ep = "rcv".equals(a) ? -1 : ep0;
        URL url = a == null ? null : LpActReceiver.allowed(c, x.getString("url"));
        if (url == null || LpNotif.s(d, "at").isEmpty()) {
            fail(c, d, ep, FAIL + "אי אפשר לבצע מההתראה" + TAP);
            return false;
        }
        String f = LpActReceiver.fcmToken(c, 5000);
        if (f == null) return giveUpOrRetry(c, d, ep, old);
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
            con.setConnectTimeout(10_000);
            con.setReadTimeout(25_000); // cold start + permission checks + transaction (the server allows 30 s)
            con.setDoOutput(true);
            con.setRequestMethod("POST");
            con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            con.setFixedLengthStreamingMode(out.length);
            try (OutputStream os = con.getOutputStream()) {
                os.write(out);
            }
            code = con.getResponseCode();
            InputStream in = code >= 400 ? con.getErrorStream() : con.getInputStream();
            body = LpActReceiver.read(in);
        } catch (Exception e) {
            return giveUpOrRetry(c, d, ep, old);
        } finally {
            if (con != null) con.disconnect();
        }
        if (code >= 500 || code == 429 || code == 408) return giveUpOrRetry(c, d, ep, old);
        JSONObject r = null;
        try {
            r = new JSONObject(body);
        } catch (Exception e) {
            // not JSON
        }
        if (r == null) return giveUpOrRetry(c, d, ep, old);
        String rr = r.optString("r", "");
        if (r.optBoolean("ok", false) && !r.optBoolean("open", false) || ok(rr)) {
            LpNotif.dropSnooze(c, LpNotif.s(d, "tag"));
            return false;
        }
        // refused (token expired / used up, no permission, needs the app): one note, tap opens the item
        String msg = r.optString("msg", "");
        fail(c, d, ep, FAIL + (msg.isEmpty() ? "הפעולה לא בוצעה" : msg) + TAP);
        return false;
    }

    static boolean ok(String r) {
        switch (r) {
            case "done": case "closed": case "used": case "wait": case "h1": case "d1": return true;
            default: return false;
        }
    }

    static void fail(Context c, Map<String, String> d, int ep, String msg) {
        if (ep >= 0 && ep == epoch) LpNotif.failed(c, d, msg);
    }

    static boolean giveUpOrRetry(Context c, Map<String, String> d, int ep, boolean old) {
        if (!old) return true;
        fail(c, d, ep, FAIL + "לא היה חיבור לשרת" + TAP);
        return false;
    }
}
