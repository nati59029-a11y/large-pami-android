package com.largepami.finance;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Push notifications gate (12.11.2026).
 * The push plugin needs Firebase. Firebase is set up only when the build added google-services.json
 * (the build writes the string resource "google_app_id" from it). Without that file, calling
 * PushNotifications.register() would crash the app, so the screens ask this plugin first.
 * ready=false -> the screens do not touch push at all (the app works exactly like before).
 * act=true (16.11.2026) -> this APK builds notifications with action buttons itself (LpMessagingService), so the screens
 * register the device with act:1 and the server may send it data-only messages. Comes from Java, not from the screens,
 * because a live update can bring new screens to an old APK that does not have the buttons.
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
        call.resolve(r);
    }
}
