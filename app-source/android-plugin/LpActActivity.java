package com.largepami.finance;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import java.util.Map;

/**
 * Invisible screen behind the notification buttons on Android 8-11 (Android 12+ asks for unlock by itself,
 * see LpNotif.action). If the phone is locked it asks to unlock (requestDismissKeyguard), and only after a
 * successful unlock passes the button on to LpActReceiver. Also used by the "פתח" button: removes the
 * notification and opens the item in the app. Not exported.
 */
public class LpActActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        final Intent in = getIntent();
        String a = in == null ? null : in.getStringExtra("a");
        if (a == null) {
            finish();
            return;
        }
        Map<String, String> d = LpNotif.fromBundle(in.getExtras());
        if ("open".equals(a)) {
            LpNotif.cancel(this, d.get("tag"));
            startActivity(LpNotif.openIntent(this, d));
            finish();
            return;
        }
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && km != null && km.isKeyguardLocked()) {
            if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true);
            else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    pass(in);
                    finish();
                }

                @Override
                public void onDismissCancelled() {
                    finish();
                }

                @Override
                public void onDismissError() {
                    finish();
                }
            });
            return;
        }
        pass(in);
        finish();
    }

    private void pass(Intent in) {
        Intent i = new Intent(this, LpActReceiver.class).setAction(LpNotif.ACTION_ACT);
        i.putExtras(in);
        sendBroadcast(i);
    }
}
