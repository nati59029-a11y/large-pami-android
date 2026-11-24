package com.largepami.finance;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Notifications from the phone for the secretary (22.11.2026) - the screens' side (www/sec-notif.js).
 * isEnabled()  {on}            - the manager gave "notification access" to this app in Android settings
 * openSettings()               - opens Android's "notification access" screen
 * getConfig()  {on, all, pkgs, skip, u} / setConfig({on, all, pkgs:[], skip:[], u})  - allow list of apps (or all apps), skip list of senders, owner uid
 * getApps()    {apps:[{p, l}]} - installed apps with a launcher icon (package + name), for choosing what to follow
 * pull({all})  {items:[{k, p, a, s, x, t}]} - queued notifications not taken yet (marked as taken)
 * clear()                      - empties the queue
 * Event "notif" {} while the app is open: something new was queued (the screens then call pull()).
 * Old APKs do not have this plugin: the screens then say "update the app".
 */
@CapacitorPlugin(name = "LpNotif")
public class LpNotifPlugin extends Plugin {
    static volatile LpNotifPlugin inst;

    @Override
    public void load() {
        inst = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (inst == this) inst = null;
        super.handleOnDestroy();
    }

    static void emitNew() {
        LpNotifPlugin p = inst;
        if (p == null) return;
        try {
            p.notifyListeners("notif", new JSObject());
        } catch (Exception e) {
            // the screens will pull when they come back
        }
    }

    static boolean enabled(Context c) {
        try {
            String s = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
            if (s == null || s.length() == 0) return false;
            ComponentName me = new ComponentName(c, LpNotifListen.class);
            for (String part : s.split(":")) {
                ComponentName cn = ComponentName.unflattenFromString(part);
                if (cn != null && me.equals(cn)) return true;
            }
        } catch (Exception e) {
            return false;
        }
        return false;
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject r = new JSObject();
        r.put("on", enabled(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent i = new Intent(Settings.ACTION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e2) {
                call.reject("לא ניתן לפתוח את ההגדרות", "settings");
            }
        }
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        JSONObject c = LpNotifListen.cfg(getContext());
        JSObject r = new JSObject();
        r.put("on", c.optBoolean("on", false));
        r.put("all", c.optBoolean("all", false));
        JSONArray pk = c.optJSONArray("pkgs");
        JSONArray sk = c.optJSONArray("skip");
        r.put("pkgs", pk == null ? new JSONArray() : pk);
        r.put("skip", sk == null ? new JSONArray() : sk);
        r.put("u", c.optString("u", ""));
        call.resolve(r);
    }

    @PluginMethod
    public void setConfig(PluginCall call) {
        try {
            JSArray pk = call.getArray("pkgs");
            JSArray sk = call.getArray("skip");
            LpNotifListen.setCfg(getContext(), Boolean.TRUE.equals(call.getBoolean("on", false)), Boolean.TRUE.equals(call.getBoolean("all", false)), pk, sk, call.getString("u", ""));
            call.resolve();
        } catch (Exception e) {
            call.reject("setConfig");
        }
    }

    @PluginMethod
    public void getApps(PluginCall call) {
        JSArray out = new JSArray();
        try {
            Context c = getContext();
            PackageManager pm = c.getPackageManager();
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> L = pm.queryIntentActivities(i, 0);
            Set<String> seen = new HashSet<>();
            List<String[]> apps = new ArrayList<>();
            for (ResolveInfo ri : L) {
                if (ri.activityInfo == null) continue;
                String p = ri.activityInfo.packageName;
                if (p == null || p.equals(c.getPackageName()) || !seen.add(p)) continue;
                CharSequence l = ri.loadLabel(pm);
                apps.add(new String[] {p, l == null ? p : l.toString()});
            }
            Collections.sort(apps, (a, b) -> a[1].compareToIgnoreCase(b[1]));
            for (String[] a : apps) {
                JSObject o = new JSObject();
                o.put("p", a[0]);
                o.put("l", a[1]);
                out.put(o);
            }
        } catch (Exception e) {
            // an empty list - the screens show the default apps only
        }
        JSObject r = new JSObject();
        r.put("apps", out);
        call.resolve(r);
    }

    @PluginMethod
    public void pull(PluginCall call) {
        JSObject r = new JSObject();
        JSONArray q;
        try {
            q = LpNotifListen.pull(getContext(), Boolean.TRUE.equals(call.getBoolean("all", false)));
        } catch (Exception e) {
            q = new JSONArray();
        }
        r.put("items", q);
        r.put("on", enabled(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            LpNotifListen.clear(getContext());
        } catch (Exception e) {
            // nothing to clear
        }
        call.resolve();
    }
}
