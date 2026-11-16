package com.largepami.finance;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a reboot or an app update the alarms are gone: set the local snoozes of notifications again (LpNotif.restore). */
public class LpBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            try {
                LpNotif.restore(c.getApplicationContext());
            } catch (Exception e) {
            }
        }
    }
}
