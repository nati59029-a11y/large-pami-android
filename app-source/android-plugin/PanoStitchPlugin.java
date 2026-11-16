package com.largepami.finance;

import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.opencv.core.Mat;

/**
 * Native high quality 360 stitching (task 2026-11-14, stage 21c). The work is done by PanoStitchCore (OpenCV only).
 * OpenCV (libopencv_java4.so) is packaged for arm64-v8a only (patch-android.sh); on other ABIs isAvailable() returns ok:false
 * and the screens keep stitching in JS (store3d-pano-cap.js).
 *
 * JS (window.Capacitor.Plugins.PanoStitch, wrapped by www/store3d-pano-native.js):
 *   isAvailable()                                  -> { ok }
 *   begin({ n, W, fovL, yawRef, w, h })            -> {}          starts a new job (drops an unfinished one)
 *   addFrame({ i, jpeg: base64, q: [w,x,y,z] })    -> {}          one frame at a time (memory)
 *   run()                                          -> { jpeg: base64 (quality 92), fovL, stats }   on a background thread
 *   cancel()                                       -> {}          run() then rejects with "cancelled"
 *   listener "progress": { p } (0..1)
 */
@CapacitorPlugin(name = "PanoStitch")
public class PanoStitchPlugin extends Plugin {

    private static Boolean loaded;
    private PanoStitchCore core;
    private boolean running;

    private static synchronized boolean loadOpenCv() {
        if (loaded == null) {
            try {
                System.loadLibrary("opencv_java4");
                loaded = Boolean.TRUE;
            } catch (Throwable e) {
                loaded = Boolean.FALSE; // not packaged for this ABI (x86, armeabi-v7a) or failed to load
            }
        }
        return loaded;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", loadOpenCv());
        call.resolve(r);
    }

    @PluginMethod
    public void begin(PluginCall call) {
        if (!loadOpenCv()) { call.reject("unavailable"); return; }
        Integer n = call.getInt("n");
        Double fov = call.getDouble("fovL"), yaw = call.getDouble("yawRef");
        Integer W = call.getInt("W");
        if (n == null || n < 1 || n > 200 || fov == null || !(fov > 20 && fov < 150)) { call.reject("bad args"); return; }
        PanoStitchCore.Options o = new PanoStitchCore.Options();
        o.W = W == null ? 4096 : Math.max(512, Math.min(8192, W));
        o.fovL = fov;
        o.yawRef = yaw == null ? 0 : yaw;
        synchronized (this) {
            if (running) { call.reject("busy"); return; }
            if (core != null) core.cancel();
            core = new PanoStitchCore(n, o);
        }
        call.resolve();
    }

    @PluginMethod
    public void addFrame(PluginCall call) {
        PanoStitchCore c;
        synchronized (this) { c = running ? null : core; }
        if (c == null) { call.reject("no job"); return; }
        try {
            Integer i = call.getInt("i");
            String b64 = call.getString("jpeg");
            JSArray qa = call.getArray("q");
            if (i == null || b64 == null || qa == null || qa.length() != 4) { call.reject("bad args"); return; }
            int k = b64.indexOf(',');
            if (b64.startsWith("data:") && k > 0) b64 = b64.substring(k + 1);
            double[] q = new double[4];
            for (int j = 0; j < 4; j++) q[j] = qa.getDouble(j);
            c.setFrame(i, Base64.decode(b64, Base64.DEFAULT), q);
            call.resolve();
        } catch (Throwable e) {
            call.reject("frame: " + e.getMessage());
        }
    }

    @PluginMethod
    public void run(final PluginCall call) {
        final PanoStitchCore c;
        synchronized (this) {
            if (running || core == null) { call.reject(running ? "busy" : "no job"); return; }
            running = true;
            c = core;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                Mat pano = null;
                try {
                    final double[] last = {-1};
                    PanoStitchCore.Result r = c.run(new PanoStitchCore.Progress() {
                        @Override
                        public void on(double p) {
                            if (p - last[0] < .01 && p < 1) return;
                            last[0] = p;
                            JSObject ev = new JSObject();
                            ev.put("p", Double.valueOf(p)); // boxed: JSONObject.put(String, double) throws a checked JSONException
                            notifyListeners("progress", ev);
                        }
                    });
                    pano = r.pano;
                    byte[] jpg = PanoStitchCore.jpeg(pano, 92);
                    pano.release();
                    pano = null;
                    JSObject out = new JSObject();
                    out.put("jpeg", Base64.encodeToString(jpg, Base64.NO_WRAP));
                    jpg = null;
                    out.put("fovL", r3(r.fovL));
                    out.put("stats", stats(r.stats));
                    call.resolve(out);
                } catch (PanoStitchCore.Cancelled e) {
                    call.reject("cancelled");
                } catch (Throwable e) { // includes OutOfMemoryError: the screens fall back to the JS stitching
                    call.reject("stitch failed: " + e);
                } finally {
                    if (pano != null) pano.release();
                    synchronized (PanoStitchPlugin.this) {
                        running = false;
                        if (core == c) core = null; // frees the frames
                    }
                }
            }
        }, "pano-stitch").start();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        synchronized (this) {
            if (core != null) core.cancel();
            if (!running) core = null;
        }
        call.resolve();
    }

    private static JSObject stats(PanoStitchCore.Stats s) {
        JSObject o = new JSObject();
        o.put("frames", s.frames);
        o.put("pairs", s.pairs);
        o.put("inlierPairs", s.inlierPairs);
        o.put("matches", s.matches);
        o.put("rms0Deg", r3(s.rms0Deg));
        o.put("rmsDeg", r3(s.rmsDeg));
        o.put("fovL0", r3(s.fovL0));
        o.put("fovL", r3(s.fovL));
        o.put("meanCorrDeg", r3(s.meanCorrDeg));
        o.put("maxCorrDeg", r3(s.maxCorrDeg));
        o.put("holesPct", r3(s.holesPct));
        o.put("optimized", s.optimized);
        o.put("feat", s.feat);
        o.put("ms", s.ms);
        o.put("msFeat", s.msFeat);
        o.put("msMatch", s.msMatch);
        o.put("msOpt", s.msOpt);
        o.put("msBlend", s.msBlend);
        JSArray g = new JSArray();
        if (s.gains != null) {
            for (double[] v : s.gains) {
                JSArray a = new JSArray();
                for (double x : v) a.put(r3(x));
                g.put(a);
            }
        }
        o.put("gains", g);
        return o;
    }

    /** boxed on purpose: put(String, Double) -> put(String, Object), no checked JSONException */
    private static Double r3(double v) { return Double.isNaN(v) || Double.isInfinite(v) ? 0.0 : Math.round(v * 1000) / 1000.0; }
}
