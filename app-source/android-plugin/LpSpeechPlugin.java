package com.largepami.finance;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/**
 * Live dictation for the secretary chat (16.11.2026).
 * Uses the phone's own speech recognizer (no server, no cost): words appear while the user speaks,
 * the text goes into the input box and the user edits it and presses "send" himself.
 * Android's recognizer stops by itself after a pause, so while "active" we start it again (continuous dictation).
 * Events to the screens:
 *   "partial" {text}  - the words of the current sentence so far (replaced on every event)
 *   "final"   {text}  - a finished sentence (the screens append it)
 *   "level"   {on}    - true while sound is heard (for the indicator)
 *   "end"     {code}  - dictation ended (code "" = normal stop; otherwise the reason)
 * Old APKs do not have this plugin: the screens then use the recording + server transcription as before.
 */
@CapacitorPlugin(name = "LpSpeech", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "mic") })
public class LpSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private boolean active = false;
    private String lang = "he-IL";
    private int quickFails = 0;
    private long startedAt = 0;

    @PluginMethod
    public void available(PluginCall call) {
        boolean ok;
        try {
            ok = SpeechRecognizer.isRecognitionAvailable(getContext());
        } catch (Exception e) {
            ok = false;
        }
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String l = call.getString("lang", "he-IL");
        lang = l != null && l.matches("[a-zA-Z]{2,3}(-[a-zA-Z]{2})?") ? l : "he-IL";
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micPerm");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void micPerm(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            call.reject("אין הרשאה למיקרופון", "perm");
            return;
        }
        begin(call);
    }

    private void begin(PluginCall call) {
        main.post(() -> {
            try {
                if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                    call.reject("אין זיהוי דיבור בטלפון", "na");
                    return;
                }
                stopRec();
                active = true;
                quickFails = 0;
                listen();
                call.resolve();
            } catch (Exception e) {
                active = false;
                stopRec();
                call.reject("לא הצלחנו להפעיל את זיהוי הדיבור", "fail");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            // stopListening: the recognizer still returns the last sentence ("final"), then "end"
            active = false;
            if (rec != null) {
                try {
                    rec.stopListening();
                } catch (Exception e) {
                    finish("");
                }
                // safety: if the recognizer never answers, end anyway
                main.postDelayed(() -> { if (!active && rec != null) finish(""); }, 2500);
            } else {
                finish("");
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            active = false;
            stopRec();
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        // leaving the app: stop listening (the microphone is not kept open in the background)
        main.post(() -> {
            if (rec != null || active) {
                active = false;
                finish("pause");
            }
        });
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        active = false;
        stopRec();
        super.handleOnDestroy();
    }

    private void listen() {
        if (rec == null) {
            rec = SpeechRecognizer.createSpeechRecognizer(getContext());
            rec.setRecognitionListener(new Listener());
        }
        Intent it = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        it.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        it.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        it.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        it.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        // longer pause before the recognizer decides the sentence ended (not every phone honours it)
        it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500);
        it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500);
        startedAt = System.currentTimeMillis();
        rec.startListening(it);
    }

    private void again() {
        if (!active) {
            finish("");
            return;
        }
        main.postDelayed(() -> {
            if (!active) return;
            try {
                listen();
            } catch (Exception e) {
                active = false;
                finish("fail");
            }
        }, 150);
    }

    private void stopRec() {
        if (rec != null) {
            try {
                rec.cancel();
            } catch (Exception e) {
                // already stopped
            }
            try {
                rec.destroy();
            } catch (Exception e) {
                // already destroyed
            }
            rec = null;
        }
    }

    private void finish(String code) {
        stopRec();
        JSObject r = new JSObject();
        r.put("code", code == null ? "" : code);
        notifyListeners("end", r);
    }

    private static String first(Bundle b) {
        if (b == null) return "";
        ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return l != null && !l.isEmpty() && l.get(0) != null ? l.get(0) : "";
    }

    private void emit(String ev, String text) {
        JSObject r = new JSObject();
        r.put("text", text);
        notifyListeners(ev, r);
    }

    private class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() { JSObject r = new JSObject(); r.put("on", true); notifyListeners("level", r); }
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() { JSObject r = new JSObject(); r.put("on", false); notifyListeners("level", r); }
        @Override public void onEvent(int eventType, Bundle params) {}

        @Override
        public void onPartialResults(Bundle b) {
            String t = first(b);
            if (!t.isEmpty()) emit("partial", t);
        }

        @Override
        public void onResults(Bundle b) {
            String t = first(b);
            quickFails = 0;
            if (!t.isEmpty()) emit("final", t);
            again();
        }

        @Override
        public void onError(int error) {
            boolean quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            if (active && quiet) {
                // silence: listen again. Many instant failures in a row = the recognizer is broken, stop
                quickFails = System.currentTimeMillis() - startedAt < 1000 ? quickFails + 1 : 0;
                if (quickFails < 5) { again(); return; }
            }
            if (active && error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                stopRec();
                again();
                return;
            }
            if (!active && (quiet || error == SpeechRecognizer.ERROR_CLIENT)) { finish(""); return; }
            active = false;
            String code;
            switch (error) {
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: code = "perm"; break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                case SpeechRecognizer.ERROR_SERVER: code = "net"; break;
                case SpeechRecognizer.ERROR_AUDIO: code = "audio"; break;
                case 12: /* ERROR_LANGUAGE_NOT_SUPPORTED (Android 12+) */
                case 13: /* ERROR_LANGUAGE_UNAVAILABLE */ code = "lang"; break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: code = "silence"; break;
                default: code = "fail";
            }
            finish(code);
        }
    }
}
