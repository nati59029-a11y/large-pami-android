package com.largepami.finance;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.RemoteMessage;
import java.util.HashMap;
import java.util.Map;

/**
 * Receives FCM messages instead of the push plugin's service (patch-android.sh removes that one from the manifest).
 * super = the plugin's code, so the screens keep getting "pushNotificationReceived" and new tokens exactly as before.
 * Data message with a one-time token ("at") -> we build the notification with buttons (LpNotif). super is NOT called for it:
 * the screens get a copy without "at" and "u" (the one-time token never reaches the WebView / JS).
 * {k:'x', tag} -> remove that notification (the item was handled elsewhere).
 * Group message {k:'grp', at, acts:''} (24.11.2026) -> the same notification without buttons, and a delivery receipt
 * ("rcv", the one-time token) is sent to the server in the background (LpActJob.receipt), so the sender sees grey ✓✓.
 * Ordinary notification messages (old devices / old server) are shown by Firebase as before - not touched here.
 */
public class LpMessagingService extends MessagingService {
    static final String TOK = "lp_notif_tok";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        Map<String, String> d0 = null;
        try {
            d0 = msg.getData();
        } catch (Exception e) {
        }
        if (d0 == null || d0.get("at") == null) super.onMessageReceived(msg);
        else forwardWithoutToken(msg, d0);
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
            if ("grp".equals(k)) LpActJob.receipt(this, d);
        } catch (Exception e) {
            // never crash the messaging service
        }
    }

    /** Same event to the screens as super would send, but the data without the one-time token. Any problem -> no event (the notification is still shown). */
    static void forwardWithoutToken(RemoteMessage msg, Map<String, String> d) {
        try {
            Map<String, String> safe = new HashMap<>(d);
            safe.remove("at");
            safe.remove("u");
            String id = msg.getMessageId();
            RemoteMessage.Builder b = new RemoteMessage.Builder("lp@local").setData(safe);
            if (id != null) b.setMessageId(id);
            PushNotificationsPlugin.sendRemoteMessage(b.build());
        } catch (Throwable t) {
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
