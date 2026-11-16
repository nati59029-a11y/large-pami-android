package com.largepami.finance;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Receives FCM messages instead of the push plugin's service (patch-android.sh removes that one from the manifest).
 * super = the plugin's code, so the screens keep getting "pushNotificationReceived" and new tokens exactly as before.
 * Data message with a one-time token ("at") -> we build the notification with buttons (LpNotif).
 * {k:'x', tag} -> remove that notification (the item was handled elsewhere).
 * Ordinary notification messages (old devices / old server) are shown by Firebase as before - not touched here.
 */
public class LpMessagingService extends MessagingService {
    static final String TOK = "lp_notif_tok";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        super.onMessageReceived(msg);
        try {
            Map<String, String> d = msg.getData();
            if (d == null || d.isEmpty()) return;
            String k = d.get("k"), tag = d.get("tag");
            if ("x".equals(k)) {
                LpNotif.dropSnooze(this, tag);
                LpNotif.cancel(this, tag);
                return;
            }
            if (tag == null || tag.isEmpty() || d.get("title") == null) return;
            if (d.get("at") == null) return;
            LpNotif.dropSnooze(this, tag);
            LpNotif.show(this, d, null);
        } catch (Exception e) {
            // never crash the messaging service
        }
    }

    @Override
    public void onNewToken(@NonNull String s) {
        super.onNewToken(s);
        // fallback for the buttons when getToken() is slow
        try {
            getSharedPreferences(TOK, MODE_PRIVATE).edit().putString("t", s).apply();
        } catch (Exception e) {
        }
    }
}
