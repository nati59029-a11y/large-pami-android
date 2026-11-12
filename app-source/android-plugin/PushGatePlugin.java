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
 */
@CapacitorPlugin(name = "PushGate")
public class PushGatePlugin extends Plugin {
    @PluginMethod
    public void state(PluginCall call) {
        boolean ready = false;
        try {
            int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
            ready = id != 0 && getContext().getString(id).length() > 0;
        } catch (Exception e) {
            ready = false;
        }
        JSObject r = new JSObject();
        r.put("ready", ready);
        call.resolve(r);
    }
}
