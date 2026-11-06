package com.largepami.finance;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Local app lock for managers (multi-business task 2026-11-05, contract update 3).
 * Fingerprint / face through the system BiometricPrompt, with the device screen lock (PIN, pattern, password) as fallback.
 * No external library: only the Android framework (android.hardware.biometrics, API 29+) and KeyguardManager (API 23-28).
 *
 * JS (window.Capacitor.Plugins.BiometricLock):
 *   isAvailable()          -> { available, biometric, deviceCredential, api }   available == the device has a secure screen lock
 *   authenticate({reason}) -> { ok: true } | { ok: false, reason: 'cancelled'|'lockout'|'not-available'|'busy'|'error', code? }
 *                             never rejects: the app always shows "try again" / "sign out", so the user is never locked out forever
 *   setSecureWindow({on})  -> { on }   FLAG_SECURE now, and remembered so the next launch sets it before the first frame
 *
 * This is a LOCAL lock only. It does not change any permission on the server.
 */
@CapacitorPlugin(name = "BiometricLock")
public class BiometricLockPlugin extends Plugin {

    static final String PREFS = "BiometricLock";
    static final String KEY_SECURE = "secureWindow";
    private static final int MAX_REASON = 120;

    private boolean busy = false;
    private CancellationSignal cancel;

    /** MainActivity.onCreate, before super.onCreate: no app content in "recent apps" from the very first frame. */
    public static void applyEarly(Activity activity) {
        try {
            if (activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_SECURE, false)) {
                activity.getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
            }
        } catch (Exception ignored) {
            // never block the app start
        }
    }

    private boolean deviceSecure() {
        if (Build.VERSION.SDK_INT < 23) return false;
        KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isDeviceSecure();
    }

    private boolean biometricEnrolled() {
        if (Build.VERSION.SDK_INT < 29) return false;
        BiometricManager bm = getContext().getSystemService(BiometricManager.class);
        if (bm == null) return false;
        if (Build.VERSION.SDK_INT >= 30) {
            return bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        return bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean secure = deviceSecure();
        JSObject r = new JSObject();
        r.put("available", secure);
        r.put("biometric", secure && biometricEnrolled());
        r.put("deviceCredential", secure);
        r.put("api", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    private static void done(PluginCall call, boolean ok, String reason, int code) {
        JSObject r = new JSObject();
        r.put("ok", ok);
        if (!ok) {
            r.put("reason", reason);
            if (code != 0) r.put("code", code);
        }
        call.resolve(r);
    }

    private void finish(PluginCall call, boolean ok, String reason, int code) {
        busy = false;
        cancel = null;
        done(call, ok, reason, code);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        if (busy) {
            done(call, false, "busy", 0); // one prompt at a time: no endless loop of prompts
            return;
        }
        if (!deviceSecure()) {
            done(call, false, "not-available", 0);
            return;
        }
        String reason = call.getString("reason", "");
        if (reason == null || reason.trim().isEmpty()) reason = "אימות לפתיחת האפליקציה";
        if (reason.length() > MAX_REASON) reason = reason.substring(0, MAX_REASON);
        final String subtitle = reason;
        busy = true;
        if (Build.VERSION.SDK_INT >= 29) {
            getActivity().runOnUiThread(() -> showPrompt(call, subtitle));
        } else {
            KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
            Intent i = km == null ? null : km.createConfirmDeviceCredentialIntent("נעילת האפליקציה", subtitle);
            if (i == null) {
                finish(call, false, "not-available", 0);
                return;
            }
            startActivityForResult(call, i, "credentialResult");
        }
    }

    @SuppressWarnings("deprecation")
    private void showPrompt(PluginCall call, String subtitle) {
        try {
            BiometricPrompt.Builder b = new BiometricPrompt.Builder(getActivity())
                .setTitle("נעילת האפליקציה")
                .setSubtitle(subtitle);
            if (Build.VERSION.SDK_INT >= 30) {
                // fingerprint/face, or the screen lock as fallback (no negative button allowed with DEVICE_CREDENTIAL)
                b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } else {
                b.setDeviceCredentialAllowed(true); // API 29
            }
            cancel = new CancellationSignal();
            b.build().authenticate(cancel, getContext().getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    finish(call, true, null, 0);
                }

                @Override
                public void onAuthenticationError(int errorCode, CharSequence errString) {
                    String r;
                    if (errorCode == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED || errorCode == BiometricPrompt.BIOMETRIC_ERROR_CANCELED) r = "cancelled";
                    else if (errorCode == BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT || errorCode == BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT) r = "lockout";
                    else if (errorCode == BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS || errorCode == BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT
                        || errorCode == BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE || errorCode == BiometricPrompt.BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL) r = "not-available";
                    else r = "error";
                    finish(call, false, r, errorCode);
                }
                // onAuthenticationFailed = one wrong finger; the system prompt stays open, nothing to do here
            });
        } catch (Exception e) {
            finish(call, false, "error", 0);
        }
    }

    @ActivityCallback
    private void credentialResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            busy = false;
            return;
        }
        finish(call, result.getResultCode() == Activity.RESULT_OK, "cancelled", 0);
    }

    @PluginMethod
    public void setSecureWindow(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putBoolean(KEY_SECURE, on).apply();
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            JSObject r = new JSObject();
            r.put("on", on);
            call.resolve(r);
        });
    }

    @Override
    protected void handleOnDestroy() {
        CancellationSignal c = cancel;
        if (c != null) c.cancel();
        cancel = null;
        busy = false;
    }
}
