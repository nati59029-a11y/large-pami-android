package com.largepami.finance;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.InputStream;
import java.util.Map;
import java.util.Properties;

/**
 * Live update ("עדכון חי"): connects LiveUpdateCore to Android and Capacitor.
 *
 * - beforeLoad(): called by MainActivity before Capacitor loads the screens. It decides which
 *   version to show and writes it to Capacitor's own setting (CapWebViewSettings/serverBasePath),
 *   which Capacitor reads when it starts (Bridge.loadWebView). "" = the screens built into the APK.
 * - ready(): the screens call it after they started. Only then a new bundle is kept.
 * - check(): looks for a newer signed bundle in the background, for the next start.
 * - If a new bundle does not call ready() within 20 seconds, the watchdog goes back at once.
 *
 * The settings (public key, address, native fingerprint) are in assets/live-update.properties,
 * written by the build only when the secrets exist. Without that file, live update is off and
 * the app works exactly like before.
 */
@CapacitorPlugin(name = "LiveUpdate")
public class LiveUpdatePlugin extends Plugin {

    static final String TAG = "LiveUpdate";
    static final String PREFS = "LiveUpdate";
    // Capacitor's setting (com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME / CAP_SERVER_PATH).
    static final String CAP_PREFS = "CapWebViewSettings";
    static final String CAP_PATH = "serverBasePath";
    static final long WATCHDOG_MS = 20000;

    private static LiveUpdateCore core;

    static synchronized LiveUpdateCore core(Context ctx) {
        if (core == null) {
            Context app = ctx.getApplicationContext();
            final SharedPreferences sp = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            Properties cfg = new Properties();
            try {
                InputStream in = app.getAssets().open("live-update.properties");
                cfg.load(in);
                in.close();
            } catch (Exception e) {
                // No settings in this build: live update is off.
            }
            byte[] key = LiveUpdateCore.hex(cfg.getProperty("publicKey", ""));
            core = new LiveUpdateCore(
                new File(app.getFilesDir(), "live-update"),
                new LiveUpdateCore.Store() {
                    @Override
                    public String get(String k) {
                        return sp.getString(k, null);
                    }

                    @Override
                    public void put(String k, String v) {
                        sp.edit().putString(k, v).commit();
                    }
                },
                key.length > 0 ? key : null,
                cfg.getProperty("nativeId", ""),
                apkVersion(app),
                cfg.getProperty("manifestUrl", "")
            );
        }
        return core;
    }

    @SuppressWarnings("deprecation")
    static long apkVersion(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private static void setCapacitorPath(Context ctx, String path) {
        ctx.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).edit().putString(CAP_PATH, path).commit();
    }

    /** MainActivity calls this before super.onCreate(). Never stops the app from starting. */
    public static void beforeLoad(Activity activity) {
        try {
            setCapacitorPath(activity, core(activity).boot());
        } catch (Throwable t) {
            Log.w(TAG, "boot failed, using the built-in screens", t);
            try {
                setCapacitorPath(activity, "");
            } catch (Throwable ignored) {
                // nothing else to do
            }
        }
    }

    @Override
    public void load() {
        final LiveUpdateCore c = core(getContext());
        if (!c.inTrial()) return;
        new Handler(Looper.getMainLooper()).postDelayed(
            new Runnable() {
                @Override
                public void run() {
                    try {
                        String to = c.rollbackIfStillTrial("no ready signal within " + (WATCHDOG_MS / 1000) + " seconds");
                        if (to == null) return;
                        setCapacitorPath(getContext(), to);
                        if (to.length() == 0) getBridge().setServerAssetPath("public");
                        else getBridge().setServerBasePath(to);
                    } catch (Throwable t) {
                        Log.w(TAG, "watchdog", t);
                    }
                }
            },
            WATCHDOG_MS
        );
    }

    @PluginMethod
    public void ready(PluginCall call) {
        boolean ok = false;
        try {
            ok = core(getContext()).ready(Long.parseLong(call.getString("version", "0")));
        } catch (Exception e) {
            // not a number (for example a development build): nothing to confirm
        }
        JSObject r = new JSObject();
        r.put("confirmed", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void check(final PluginCall call) {
        final LiveUpdateCore c = core(getContext());
        new Thread(
            new Runnable() {
                @Override
                public void run() {
                    String res = c.check();
                    Log.i(TAG, res);
                    JSObject r = new JSObject();
                    r.put("result", res);
                    call.resolve(r);
                }
            }
        ).start();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        for (Map.Entry<String, String> e : core(getContext()).status().entrySet()) r.put(e.getKey(), e.getValue());
        call.resolve(r);
    }
}
