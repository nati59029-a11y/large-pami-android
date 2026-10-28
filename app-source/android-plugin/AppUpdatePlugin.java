package com.largepami.finance;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Downloads the new APK inside the app (with progress) and opens Android's install screen. */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    @PluginMethod
    public void install(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null) {
            call.reject("no url");
            return;
        }
        final Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(s);
            } catch (Exception e) {
                // ignore; the JS side tells the user what to do
            }
            call.reject("permission");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    c.setInstanceFollowRedirects(true);
                    c.connect();
                    if (c.getResponseCode() != 200) {
                        call.reject("http " + c.getResponseCode());
                        return;
                    }
                    long total = c.getContentLengthLong();
                    File f = new File(ctx.getCacheDir(), "app-update.apk");
                    InputStream in = c.getInputStream();
                    FileOutputStream out = new FileOutputStream(f);
                    byte[] buf = new byte[32768];
                    long done = 0;
                    int last = -1;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : 0;
                        if (pct != last) {
                            last = pct;
                            JSObject p = new JSObject();
                            p.put("pct", pct);
                            notifyListeners("progress", p);
                        }
                    }
                    out.flush();
                    out.close();
                    in.close();
                    Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(i);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("download failed: " + e.getMessage());
                }
            }
        }).start();
    }

    // ---------------------------------------------------------------------------------------
    // Silent self-update (Android 12 and up). install() above stays as it was: it is the backup.
    //
    // installSession(): downloads the APK like install(), and installs it through PackageInstaller.
    // From Android 12 (API 31) it asks for USER_ACTION_NOT_REQUIRED, so when Android allows it there is
    // no "Install" screen. Android decides; when it still wants a confirmation it returns
    // STATUS_PENDING_USER_ACTION, and we open its confirmation screen (the same "Install" as today).
    // Below Android 12, or if anything in the session fails, it opens the installer exactly like
    // install() does. An update never removes the app and never deletes data.
    // Result: {status: "silent" | "user" | "legacy", detail}.
    // ---------------------------------------------------------------------------------------

    static final long SESSION_TIMEOUT_MS = 60000;

    @PluginMethod
    public void installSession(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null) {
            call.reject("no url");
            return;
        }
        final Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(s);
            } catch (Exception e) {
                // ignore; the JS side tells the user what to do
            }
            call.reject("permission");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                final File f;
                try {
                    f = downloadApk(ctx, url);
                } catch (Exception e) {
                    call.reject("download failed: " + e.getMessage());
                    return;
                }
                if (Build.VERSION.SDK_INT < 31) {
                    openInstaller(ctx, f, call, "legacy", "android " + Build.VERSION.SDK_INT);
                    return;
                }
                try {
                    commitSession(ctx, f, call);
                } catch (Exception e) {
                    openInstaller(ctx, f, call, "legacy", "session: " + e.getMessage());
                }
            }
        }).start();
    }

    private File downloadApk(Context ctx, String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        c.connect();
        if (c.getResponseCode() != 200) throw new Exception("http " + c.getResponseCode());
        long total = c.getContentLength(); // getContentLengthLong() needs Android 7; the app supports Android 5.1
        File f = new File(ctx.getCacheDir(), "app-update.apk");
        InputStream in = c.getInputStream();
        FileOutputStream out = new FileOutputStream(f);
        try {
            byte[] buf = new byte[32768];
            long done = 0;
            int last = -1;
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                int pct = total > 0 ? (int) (done * 100 / total) : 0;
                if (pct != last) {
                    last = pct;
                    JSObject p = new JSObject();
                    p.put("pct", pct);
                    notifyListeners("progress", p);
                }
            }
            out.flush();
        } finally {
            out.close();
            in.close();
        }
        return f;
    }

    /** The old way (same as install()): Android's install screen. */
    private void openInstaller(Context ctx, File f, PluginCall call, String status, String detail) {
        try {
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            done(call, status, detail);
        } catch (Exception e) {
            call.reject("install failed: " + e.getMessage());
        }
    }

    private static void done(PluginCall call, String status, String detail) {
        JSObject r = new JSObject();
        r.put("status", status);
        r.put("detail", detail == null ? "" : detail);
        call.resolve(r);
    }

    private void commitSession(final Context ctx, final File apk, final PluginCall call) throws Exception {
        PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());
        params.setSize(apk.length());
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        final int id = pi.createSession(params);
        PackageInstaller.Session session = pi.openSession(id);
        try {
            OutputStream out = session.openWrite("base.apk", 0, apk.length());
            InputStream in = new FileInputStream(apk);
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            } finally {
                in.close();
                out.close();
            }
            final String action = ctx.getPackageName() + ".SELF_UPDATE_STATUS." + id;
            final boolean[] finished = {false};
            final BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent intent) {
                    int st = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                    String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                    if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        // Android wants a confirmation after all: open its own "Install" screen.
                        @SuppressWarnings("deprecation")
                        Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                        if (confirm != null) {
                            try {
                                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                ctx.startActivity(confirm);
                                finish(this, "user", msg);
                                return;
                            } catch (Exception e) {
                                // fall through to the old way
                            }
                        }
                        finishLegacy(this, "no confirmation screen");
                    } else if (st == PackageInstaller.STATUS_SUCCESS) {
                        finish(this, "silent", msg);
                    } else {
                        finishLegacy(this, "status " + st + (msg == null ? "" : ": " + msg));
                    }
                }

                private void finish(BroadcastReceiver self, String status, String detail) {
                    synchronized (finished) {
                        if (finished[0]) return;
                        finished[0] = true;
                    }
                    try {
                        ctx.unregisterReceiver(self);
                    } catch (Exception e) {
                        // already unregistered
                    }
                    done(call, status, detail);
                }

                private void finishLegacy(BroadcastReceiver self, String detail) {
                    synchronized (finished) {
                        if (finished[0]) return;
                        finished[0] = true;
                    }
                    try {
                        ctx.unregisterReceiver(self);
                    } catch (Exception e) {
                        // already unregistered
                    }
                    openInstaller(ctx, apk, call, "legacy", detail);
                }
            };
            IntentFilter filter = new IntentFilter(action);
            if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else ctx.registerReceiver(receiver, filter);
            Intent cb = new Intent(action).setPackage(ctx.getPackageName());
            PendingIntent pending = PendingIntent.getBroadcast(ctx, id, cb, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
            session.commit(pending.getIntentSender());
            // If Android never answers, use the old way after a minute.
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    synchronized (finished) {
                        if (finished[0]) return;
                        finished[0] = true;
                    }
                    try {
                        ctx.unregisterReceiver(receiver);
                    } catch (Exception e) {
                        // already unregistered
                    }
                    openInstaller(ctx, apk, call, "legacy", "no answer from the installer");
                }
            }, SESSION_TIMEOUT_MS);
        } catch (Exception e) {
            try {
                session.abandon();
            } catch (Exception ignored) {
                // nothing to clean
            }
            throw e;
        } finally {
            session.close();
        }
    }
}
