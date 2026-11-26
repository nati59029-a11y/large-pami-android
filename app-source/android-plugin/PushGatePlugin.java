package com.largepami.finance;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

/**
 * Push notifications gate (12.11.2026).
 * The push plugin needs Firebase. Firebase is set up only when the build added google-services.json
 * (the build writes the string resource "google_app_id" from it). Without that file, calling
 * PushNotifications.register() would crash the app, so the screens ask this plugin first.
 * ready=false -> the screens do not touch push at all (the app works exactly like before).
 * act=true (16.11.2026) -> this APK builds notifications with action buttons itself (LpMessagingService), so the screens
 * register the device with act:1 and the server may send it data-only messages. Comes from Java, not from the screens,
 * because a live update can bring new screens to an old APK that does not have the buttons.
 * rcv=true (24.11.2026) -> this APK also sends a delivery receipt for group messages (register with rcv:1). Same reason: Java only.
 */
@CapacitorPlugin(name = "PushGate")
public class PushGatePlugin extends Plugin {
    @PluginMethod
    public void state(PluginCall call) {
        boolean ready = false;
        try {
            // Business APKs: applicationId differs from the code namespace. Look the resource up in the package that
            // really holds this app's resources (same way Firebase itself does), not by getPackageName().
            String pkg;
            try {
                pkg = getContext().getResources().getResourcePackageName(R.string.app_name);
            } catch (Exception e) {
                pkg = getContext().getPackageName();
            }
            int id = getContext().getResources().getIdentifier("google_app_id", "string", pkg);
            if (id == 0) id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
            ready = id != 0 && getContext().getString(id).length() > 0;
        } catch (Exception e) {
            ready = false;
        }
        JSObject r = new JSObject();
        r.put("ready", ready);
        r.put("act", true);
        r.put("rem", true); // 16.11.2026: remSync / remPeek / remAck (personal reminders with working buttons)
        // 24.11.2026: this APK sends a group delivery receipt (LpActJob.receipt). Only then may the server send group messages
        // as data with a one-time token; older APKs with buttons keep getting the ordinary Firebase notification.
        r.put("rcv", true);
        call.resolve(r);
    }

    /** Sign-out (secPushOff, 16.11.2026): removes our notifications with buttons, local snoozes and the cached FCM token. */
    @PluginMethod
    public void clearLocal(PluginCall call) {
        try {
            LpNotif.clearAll(getContext());
        } catch (Exception e) {
            // nothing to clear / no notification service - sign-out goes on
        }
        call.resolve();
    }

    /** Personal reminders (tasks-wc.js): {p: "wc|<business>|<uid>|", n: [{t, title, body, at, acts}], keep: ["k|id"], q: true = also drop waiting presses}. */
    @PluginMethod
    public void remSync(PluginCall call) {
        try {
            LpNotif.wcSync(getContext(), call.getString("p"), call.getArray("n"), call.getArray("keep"));
            if (Boolean.TRUE.equals(call.getBoolean("q", false))) LpNotif.wcAck(getContext(), null, true);
            call.resolve();
        } catch (Exception e) {
            call.reject("remSync");
        }
    }

    /** Button presses waiting for this user: {q: [{q, tag, a, t, w}]}. */
    @PluginMethod
    public void remPeek(PluginCall call) {
        JSObject r = new JSObject();
        JSONArray q;
        try {
            q = LpNotif.wcPeek(getContext(), call.getString("p"));
        } catch (Exception e) {
            q = new JSONArray();
        }
        try {
            r.put("q", q);
        } catch (Exception e) {
            // cannot happen - an empty answer
        }
        call.resolve(r);
    }

    /** Presses the screens applied: {q: ["id", ...]}. */
    @PluginMethod
    public void remAck(PluginCall call) {
        try {
            LpNotif.wcAck(getContext(), call.getArray("q"), false);
        } catch (Exception e) {
        }
        call.resolve();
    }
}
