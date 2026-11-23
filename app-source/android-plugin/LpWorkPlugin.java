package com.largepami.finance;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Background work (17.11.2026) - the screens' side of LpWorkService.
 * start({text}): starts the service (only while the app is on screen - Android 12+ does not allow it from the background,
 * and this way the 2 hour safety limit is not renewed in the background) or just updates the notification text.
 * stop(): the queues are empty. While the service runs the WebView renderer keeps its "important" priority also when the
 * app is not visible (RENDERER_PRIORITY_IMPORTANT, waived=false), so Android does not kill it first; back to the default after.
 * Capacitor keeps JS timers running in the background already (KeepRunning = true, the default) - nothing to change there.
 * The screens check isPluginAvailable('LpWork') first: older APKs (live update) keep working exactly like before.
 */
@CapacitorPlugin(name = "LpWork")
public class LpWorkPlugin extends Plugin {
    static volatile LpWorkPlugin inst;

    @Override
    public void load() {
        inst = this;
    }

    @PluginMethod
    public void start(PluginCall call) {
        String text = call.getString("text", "");
        JSObject r = new JSObject();
        try {
            LpWorkService.jsHold = true;
            LpWorkService.jsText = text;
            LpWorkService s = LpWorkService.running;
            if (s != null) {
                // While an app update downloads its progress stays in the notification; this text comes back after
                if (!LpWorkService.updHold) s.update(text);
                r.put("on", true);
                call.resolve(r);
                return;
            }
            boolean visible = getActivity() != null && getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED);
            if (!visible) {
                r.put("on", false);
                call.resolve(r);
                return;
            }
            Context c = getContext();
            Intent i = new Intent(c, LpWorkService.class).putExtra(LpWorkService.EXTRA_TEXT, text);
            ContextCompat.startForegroundService(c, i);
            priority(true);
            r.put("on", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("start");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopService();
        call.resolve();
    }

    void stopService() {
        LpWorkService.jsHold = false;
        LpWorkService.jsText = "";
        if (LpWorkService.updHold) {
            // An app update is downloading - the service stays until it ends (AppUpdatePlugin stops it)
            priority(false);
            return;
        }
        try {
            Context c = getContext();
            c.stopService(new Intent(c, LpWorkService.class));
        } catch (Exception e) {
            // not running
        }
        priority(false);
    }

    /** Called by the service when it ends (stop, safety limit, task removed). */
    static void stopped() {
        LpWorkPlugin p = inst;
        if (p != null) p.priority(false);
    }

    void priority(boolean keep) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            getActivity().runOnUiThread(() -> {
                try {
                    WebView w = getBridge().getWebView();
                    if (w != null) w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !keep);
                } catch (Exception e) {
                    // keep the default
                }
            });
        } catch (Exception e) {
            // no screen - nothing to change
        }
    }

    /** The screen (and the WebView that runs the queues) is gone - nothing left to keep running. */
    @Override
    protected void handleOnDestroy() {
        stopService();
        if (inst == this) inst = null;
        super.handleOnDestroy();
    }
}
