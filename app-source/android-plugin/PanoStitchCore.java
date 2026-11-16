package com.largepami.finance;

import org.opencv.calib3d.Calib3d;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.DMatch;
import org.opencv.core.KeyPoint;
import org.opencv.core.Mat;
import org.opencv.core.MatOfByte;
import org.opencv.core.MatOfDMatch;
import org.opencv.core.MatOfInt;
import org.opencv.core.MatOfKeyPoint;
import org.opencv.core.MatOfPoint2f;
import org.opencv.core.Point;
import org.opencv.core.Rect;
import org.opencv.core.Scalar;
import org.opencv.core.Size;
import org.opencv.features2d.DescriptorMatcher;
import org.opencv.features2d.Feature2D;
import org.opencv.features2d.ORB;
import org.opencv.features2d.SIFT;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;
import org.opencv.photo.Photo;

import java.util.ArrayList;
import java.util.List;

/**
 * High quality 360 stitching (task 2026-11-14, stage 21c). Pure Java + OpenCV (no android.* imports),
 * so the same file is tested on a desktop (tools/pano-native-test) and used by PanoStitchPlugin on the phone.
 *
 * Conventions - EXACTLY as www/store3d-pano-cap.js (the viewer and the map yaw depend on them):
 *  - world x = east, y = north, z = up. q = [w,x,y,z] camera -> world. Camera: x right, y up (on screen), looks at -z.
 *  - fovL = field of view of the LONG side of the frame (degrees). Pixel focal f = (L/2) / tan(fovL/2), centre = (w/2, h/2),
 *    continuous pixel coordinates (pixel i covers [i, i+1)): u = w/2 + f*x/(-z), v = h/2 - f*y/(-z).
 *  - equirect W x W/2: lon(x) = ((x+.5)/W - .5)*360 + yawRef, lat(y) = (.5 - (y+.5)/H)*180,
 *    dir = (cos lat sin lon, cos lat cos lon, sin lat). So u = 0.5 is yawRef, right = clockwise seen from above, top row = zenith.
 *
 * Pipeline: features (SIFT, fallback ORB) on pairs whose sensor directions overlap (gated by the sensor pose) -> ratio test ->
 * RANSAC homography (pure rotation => H = K R K^-1, focal-independent) -> global Levenberg-Marquardt over all rotations + shared focal
 * (robust Huber loss, weak prior towards the sensor rotations: frames without matches stay at the sensor pose; the yaw of frame 0
 * is kept = sensor yaw, so u = 0.5 stays yawRef) -> per-frame per-channel gain compensation (least squares on overlaps, prior gain 1)
 * -> Voronoi labels (by distance from the frame edge) refined by minimal-difference DP seams per neighbour pair (low resolution)
 * -> multi-band blending (Laplacian pyramids, float, periodic in x) of each frame warped on its bounding region (cv remap)
 * -> uncovered zenith / nadir filled by Photo.inpaint at low resolution, upsampled, feathered.
 * Frames are decoded one at a time (memory); progress callback; cancel() -> Cancelled.
 * Memory (estimate, not measured on a phone): W=4096 -> about 250MB native at the peak (blend pyramid in float). W=2048 -> about 65MB.
 */
public final class PanoStitchCore {

    public interface Progress { void on(double p); }

    public static final class Cancelled extends RuntimeException {
        public Cancelled() { super("cancelled"); }
    }

    public static final class Options {
        public int W = 4096;            // output width (rounded to a multiple of 64); height = W/2
        public double fovL = 65;        // first guess of the long-side FOV (degrees)
        public double yawRef = 0;       // yaw (degrees) at u = 0.5 (= yaw of frame 0, as in JS)
        public boolean optimize = true; // false = sensor poses + given fovL only (comparison / fallback)
        public boolean gains = true, seams = true, multiband = true, fill = true;
        public int bands = 5;
        public int workMax = 1000;      // long side of the feature images
        public int nFeatures = 1500;
        public int seamW = 1024;        // width of the low resolution equirect used for gains and seams
    }

    public static final class Stats {
        public int frames, pairs, inlierPairs, matches;
        public double rms0Deg, rmsDeg, fovL0, fovL, meanCorrDeg, maxCorrDeg, holesPct;
        public boolean optimized;
        public String feat = "";
        public double[][] gains;        // [frame][B,G,R]
        public long ms, msFeat, msMatch, msOpt, msBlend;
    }

    public static final class Result {
        public Mat pano;                // 8UC3, BGR, W x W/2
        public double fovL;
        public double[][] quats;        // final camera -> world [w,x,y,z] (output gauge)
        public Stats stats;
    }

    private static final double D = Math.PI / 180;
    private static final int THUMB = 400;

    private final int n;
    private final Options o;
    private final byte[][] jpeg;
    private final double[][] qIn;
    private volatile boolean cancelled;

    public PanoStitchCore(int n, Options o) {
        if (n < 1 || n > 200) throw new IllegalArgumentException("n");
        this.n = n;
        this.o = o == null ? new Options() : o;
        this.jpeg = new byte[n][];
        this.qIn = new double[n][];
    }

    public void setFrame(int i, byte[] jpg, double[] q) {
        if (i < 0 || i >= n) throw new IllegalArgumentException("frame index");
        if (jpg == null || jpg.length < 4) throw new IllegalArgumentException("frame " + i + ": no jpeg");
        if (q == null || q.length != 4) throw new IllegalArgumentException("frame " + i + ": q");
        double s = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        if (!(s > 1e-9)) throw new IllegalArgumentException("frame " + i + ": q");
        jpeg[i] = jpg;
        qIn[i] = new double[]{q[0] / s, q[1] / s, q[2] / s, q[3] / s};
    }

    public void cancel() { cancelled = true; }

    private void chk() { if (cancelled) throw new Cancelled(); }

    /* ------------------------------------------------------------------ small math ------------------------------------------------------------------ */

    /** quaternion [w,x,y,z] -> row-major 3x3 camera -> world (same as JS qToMat) */
    public static double[] qToMat(double[] q) {
        double w = q[0], x = q[1], y = q[2], z = q[3];
        return new double[]{1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
                2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
                2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)};
    }

    public static double[] matToQ(double[] m) {
        double tr = m[0] + m[4] + m[8], w, x, y, z;
        if (tr > 0) {
            double s = Math.sqrt(tr + 1) * 2;
            w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
        } else if (m[0] > m[4] && m[0] > m[8]) {
            double s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
            w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
        } else if (m[4] > m[8]) {
            double s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
            w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s;
        } else {
            double s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
            w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4;
        }
        double k = Math.sqrt(w * w + x * x + y * y + z * z);
        if (w < 0) k = -k;
        return new double[]{w / k, x / k, y / k, z / k};
    }

    static double[] mul(double[] a, double[] b) {
        double[] c = new double[9];
        for (int r = 0; r < 3; r++) for (int k = 0; k < 3; k++)
            c[r * 3 + k] = a[r * 3] * b[k] + a[r * 3 + 1] * b[3 + k] + a[r * 3 + 2] * b[6 + k];
        return c;
    }

    static double[] tr(double[] a) { return new double[]{a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]}; }

    /** exp map (Rodrigues) of a rotation vector (radians) */
    static double[] expR(double wx, double wy, double wz) {
        double th = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (th < 1e-12) return new double[]{1, -wz, wy, wz, 1, -wx, -wy, wx, 1};
        double x = wx / th, y = wy / th, z = wz / th, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
        return new double[]{c + x * x * C, x * y * C - z * s, x * z * C + y * s,
                y * x * C + z * s, c + y * y * C, y * z * C - x * s,
                z * x * C - y * s, z * y * C + x * s, c + z * z * C};
    }

    /** log map: rotation matrix -> rotation vector (radians) */
    static double[] logR(double[] m) {
        double c = Math.max(-1, Math.min(1, (m[0] + m[4] + m[8] - 1) / 2)), th = Math.acos(c);
        double vx = m[7] - m[5], vy = m[2] - m[6], vz = m[3] - m[1];
        if (th < 1e-9) return new double[]{vx / 2, vy / 2, vz / 2};
        if (Math.PI - th < 1e-6) { // 180 degrees
            double x = Math.sqrt(Math.max(0, (m[0] + 1) / 2)), y = Math.sqrt(Math.max(0, (m[4] + 1) / 2)), z = Math.sqrt(Math.max(0, (m[8] + 1) / 2));
            if (m[1] < 0) y = -y;
            if (m[2] < 0) z = -z;
            return new double[]{x * th, y * th, z * th};
        }
        double k = th / (2 * Math.sin(th));
        return new double[]{vx * k, vy * k, vz * k};
    }

    /** angle (degrees) between two rotations */
    public static double angDeg(double[] a, double[] b) {
        double[] r = logR(mul(a, tr(b)));
        return Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]) / D;
    }

    /** yaw (degrees, clockwise from north) of the camera forward (-z) */
    static double yawOf(double[] m) { return Math.atan2(-m[2], -m[5]) / D; }

    /* floor mod / div (own copies: Math.floorMod needs API 24 on Android) */
    static int fm(int a, int b) { int r = a % b; return r < 0 ? r + b : r; }

    static int fd(int a, int b) { int q = a / b; return (a % b != 0 && ((a < 0) != (b < 0))) ? q - 1 : q; }

    static double wrap180(double a) { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; }

    /** world direction of equirect pixel (x, y) of a W x H canvas (same as JS eqDir) */
    public static double[] eqDir(double x, double y, int W, int H, double yawRef) {
        double lon = (((x + .5) / W) - .5) * 360 + yawRef, lat = (.5 - (y + .5) / H) * 180;
        double cl = Math.cos(lat * D);
        return new double[]{cl * Math.sin(lon * D), cl * Math.cos(lon * D), Math.sin(lat * D)};
    }

    /** pixel (u,v continuous) in a w x h frame of world direction d, or null if behind (same as JS projToFrame) */
    public static double[] project(double[] m, double[] d, double fovL, int w, int h) {
        double f = (Math.max(w, h) / 2.0) / Math.tan(fovL * D / 2);
        double x = m[0] * d[0] + m[3] * d[1] + m[6] * d[2], y = m[1] * d[0] + m[4] * d[1] + m[7] * d[2], z = m[2] * d[0] + m[5] * d[1] + m[8] * d[2];
        if (z >= -1e-6) return null;
        double iz = -1 / z;
        return new double[]{w / 2.0 + f * x * iz, h / 2.0 - f * y * iz};
    }

    /* ------------------------------------------------------------------ frames ------------------------------------------------------------------ */

    private static final class Fr {
        int w, h;
        double L;
        double[] Rs, R;
        double[] ka, kb;     // feature positions, normalised: a = (u - w/2)/(L/2), b = -(v - h/2)/(L/2)
        float[] dF;          // SIFT descriptors
        byte[] dB;           // ORB descriptors
        int nk, dLen;
        byte[] th; int tw, thh; // small BGR copy (gains, seams)
        double[] gain = {1, 1, 1};
        // low resolution warp (seam canvas)
        int lx0, ly0, lw, lh; float[] lsc; byte[] lcol;
    }

    private static final class Pair {
        int i, j, m;
        double[] ai, bi, aj, bj;
    }

    /** camera direction (normalised) of normalised coordinates (a,b) for t = tan(fovL/2) */
    private static void camDir(double a, double b, double t, double[] out) {
        double x = a * t, y = b * t, k = 1 / Math.sqrt(x * x + y * y + 1);
        out[0] = x * k; out[1] = y * k; out[2] = -k;
    }

    private static void rot(double[] m, double[] v, double[] out) {
        double x = m[0] * v[0] + m[1] * v[1] + m[2] * v[2], y = m[3] * v[0] + m[4] * v[1] + m[5] * v[2], z = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
        out[0] = x; out[1] = y; out[2] = z;
    }

    /* ------------------------------------------------------------------ run ------------------------------------------------------------------ */

    public Result run(Progress prog) {
        final Progress P = prog != null ? prog : new Progress() { public void on(double p) { } };
        long t0 = System.currentTimeMillis();
        for (int i = 0; i < n; i++) if (jpeg[i] == null) throw new IllegalStateException("frame " + i + " missing");
        int B = Math.max(1, Math.min(7, o.bands)), A = 1 << B;
        int W = Math.max(4 * A, (int) Math.round(o.W / (2.0 * A)) * 2 * A), H = W / 2;
        Stats st = new Stats();
        st.frames = n;
        st.fovL0 = o.fovL;
        Fr[] F = new Fr[n];
        for (int i = 0; i < n; i++) {
            F[i] = new Fr();
            F[i].Rs = qToMat(qIn[i]);
            F[i].R = F[i].Rs.clone();
        }
        double t = Math.tan(o.fovL * D / 2);

        // 1. decode, small copies, features
        Feature2D feat = null;
        boolean sift = false;
        if (o.optimize && n > 1) {
            try { feat = SIFT.create(o.nFeatures); sift = true; } catch (Throwable e) { feat = null; }
            if (feat == null) feat = ORB.create(o.nFeatures * 2);
            st.feat = sift ? "sift" : "orb";
        }
        for (int i = 0; i < n; i++) {
            chk();
            Fr f = F[i];
            Mat img = decode(i);
            try {
                f.w = img.cols(); f.h = img.rows(); f.L = Math.max(f.w, f.h);
                double s2 = Math.min(1, THUMB / f.L);
                Mat sm = new Mat();
                Imgproc.resize(img, sm, new Size(Math.max(2, Math.round(f.w * s2)), Math.max(2, Math.round(f.h * s2))), 0, 0, Imgproc.INTER_AREA);
                f.tw = sm.cols(); f.thh = sm.rows(); f.th = new byte[f.tw * f.thh * 3];
                sm.get(0, 0, f.th);
                sm.release();
                if (feat != null) detect(feat, sift, img, f);
            } finally { img.release(); }
            P.on(.25 * (i + 1) / n);
        }
        st.msFeat = System.currentTimeMillis() - t0;

        // 2. pairs + matches
        long tm = System.currentTimeMillis();
        List<Pair> pairs = new ArrayList<>();
        if (feat != null) {
            for (int i = 0; i < n; i++) {
                chk();
                for (int j = i + 1; j < n; j++) {
                    double c = -F[i].Rs[2] * -F[j].Rs[2] + -F[i].Rs[5] * -F[j].Rs[5] + -F[i].Rs[8] * -F[j].Rs[8];
                    if (Math.acos(Math.max(-1, Math.min(1, c))) / D > o.fovL * 0.95) continue;
                    st.pairs++;
                    Pair p = matchPair(F, i, j, t, sift);
                    if (p != null) { pairs.add(p); st.inlierPairs++; st.matches += p.m; }
                }
                P.on(.25 + .15 * (i + 1) / n);
            }
            feat.clear();
        }
        for (Fr f : F) { f.dF = null; f.dB = null; }
        st.msMatch = System.currentTimeMillis() - tm;

        // 3. global optimisation
        long to = System.currentTimeMillis();
        st.rms0Deg = rmsDeg(F, pairs, t);
        st.rmsDeg = st.rms0Deg;
        if (o.optimize && !pairs.isEmpty()) {
            double[][] R0 = new double[n][];
            for (int i = 0; i < n; i++) R0[i] = F[i].R.clone();
            double tNew = optimise(F, pairs, t);
            // keep the yaw of frame 0 = its sensor yaw (u = 0.5 stays yawRef)
            double dy = (yawOf(F[0].R) - yawOf(F[0].Rs)) * D;
            double[] Rz = expR(0, 0, dy);
            for (Fr f : F) f.R = mul(Rz, f.R);
            double mx = 0, sum = 0;
            for (Fr f : F) { double a = angDeg(f.R, f.Rs); mx = Math.max(mx, a); sum += a; }
            double fovNew = 2 * Math.atan(tNew) / D, rms = rmsDeg(F, pairs, tNew);
            if (mx > 25 || Math.abs(fovNew - o.fovL) > 15 || !(rms < 1.5) || Double.isNaN(fovNew)) {
                for (int i = 0; i < n; i++) F[i].R = R0[i]; // diverged: back to the sensor poses
            } else {
                t = tNew; st.optimized = true; st.rmsDeg = rms; st.maxCorrDeg = mx; st.meanCorrDeg = sum / n;
            }
        }
        double fovL = 2 * Math.atan(t) / D;
        st.fovL = fovL;
        st.msOpt = System.currentTimeMillis() - to;
        P.on(.45);
        chk();

        // 4. low resolution warps -> gains -> labels -> seams
        int Ws = Math.min(W, Math.max(256, o.seamW)), Hs = Ws / 2;
        for (Fr f : F) lowWarp(f, t, Ws, Hs);
        if (o.gains && n > 1) gains(F, Ws);
        st.gains = new double[n][];
        for (int i = 0; i < n; i++) st.gains[i] = F[i].gain.clone();
        int[] lab = labels(F, Ws, Hs);
        if (o.seams && n > 1) seams(F, lab, Ws, Hs);
        for (Fr f : F) { f.th = null; f.lcol = null; f.lsc = null; }
        P.on(.5);

        // 5. warp + multi-band blend
        long tb = System.currentTimeMillis();
        Mat pano = blend(F, lab, t, W, H, Ws, Hs, B, st, P);
        st.msBlend = System.currentTimeMillis() - tb;
        P.on(1);
        st.ms = System.currentTimeMillis() - t0;
        Result r = new Result();
        r.pano = pano;
        r.fovL = fovL;
        r.stats = st;
        r.quats = new double[n][];
        for (int i = 0; i < n; i++) r.quats[i] = matToQ(F[i].R);
        return r;
    }

    private Mat decode(int i) {
        MatOfByte b = new MatOfByte(jpeg[i]);
        Mat img = Imgcodecs.imdecode(b, Imgcodecs.IMREAD_COLOR);
        b.release();
        if (img == null || img.empty() || img.channels() != 3) {
            if (img != null) img.release();
            throw new IllegalArgumentException("frame " + i + ": bad jpeg");
        }
        return img;
    }

    private void detect(Feature2D feat, boolean sift, Mat img, Fr f) {
        double s = Math.min(1, o.workMax / f.L);
        Mat work = new Mat(), gray = new Mat(), none = new Mat(), desc = new Mat();
        MatOfKeyPoint kp = new MatOfKeyPoint();
        try {
            Imgproc.resize(img, work, new Size(Math.max(8, Math.round(f.w * s)), Math.max(8, Math.round(f.h * s))), 0, 0, Imgproc.INTER_AREA);
            Imgproc.cvtColor(work, gray, Imgproc.COLOR_BGR2GRAY);
            feat.detectAndCompute(gray, none, kp, desc);
            KeyPoint[] k = kp.toArray();
            int m = Math.min(k.length, desc.rows());
            double sx = gray.cols() / (double) f.w, sy = gray.rows() / (double) f.h, hL = f.L / 2;
            f.nk = m; f.ka = new double[m]; f.kb = new double[m];
            for (int q = 0; q < m; q++) {
                double u = (k[q].pt.x + .5) / sx, v = (k[q].pt.y + .5) / sy;
                f.ka[q] = (u - f.w / 2.0) / hL;
                f.kb[q] = -(v - f.h / 2.0) / hL;
            }
            f.dLen = desc.cols();
            if (m > 0) {
                if (sift) {
                    Mat d32 = desc;
                    if (desc.type() != CvType.CV_32F) { d32 = new Mat(); desc.convertTo(d32, CvType.CV_32F); }
                    f.dF = new float[m * f.dLen];
                    d32.get(0, 0, f.dF);
                    if (d32 != desc) d32.release();
                } else {
                    f.dB = new byte[m * f.dLen];
                    desc.get(0, 0, f.dB);
                }
            }
        } finally {
            work.release(); gray.release(); none.release(); desc.release(); kp.release();
        }
    }

    /** keypoints of frame i that (by the sensor pose) fall inside frame j */
    private static int[] inside(Fr fi, Fr fj, double t) {
        int[] out = new int[fi.nk];
        int c = 0;
        double[] d = new double[3], w = new double[3];
        double ma = fj.w / fj.L * 1.12, mb = fj.h / fj.L * 1.12;
        for (int q = 0; q < fi.nk; q++) {
            camDir(fi.ka[q], fi.kb[q], t, d);
            rot(fi.Rs, d, w);
            double x = fj.Rs[0] * w[0] + fj.Rs[3] * w[1] + fj.Rs[6] * w[2], y = fj.Rs[1] * w[0] + fj.Rs[4] * w[1] + fj.Rs[7] * w[2], z = fj.Rs[2] * w[0] + fj.Rs[5] * w[1] + fj.Rs[8] * w[2];
            if (z > -0.2) continue;
            if (Math.abs(x / -z / t) <= ma && Math.abs(y / -z / t) <= mb) out[c++] = q;
        }
        int[] r = new int[c];
        System.arraycopy(out, 0, r, 0, c);
        return r;
    }

    private static Mat descMat(Fr f, int[] idx, boolean sift) {
        int L = f.dLen;
        if (sift) {
            float[] a = new float[idx.length * L];
            for (int k = 0; k < idx.length; k++) System.arraycopy(f.dF, idx[k] * L, a, k * L, L);
            Mat m = new Mat(idx.length, L, CvType.CV_32F);
            m.put(0, 0, a);
            return m;
        }
        byte[] a = new byte[idx.length * L];
        for (int k = 0; k < idx.length; k++) System.arraycopy(f.dB, idx[k] * L, a, k * L, L);
        Mat m = new Mat(idx.length, L, CvType.CV_8U);
        m.put(0, 0, a);
        return m;
    }

    private static final double GATE_DEG = 12, RATIO = .8;
    private static final int MAX_PAIR_PTS = 150;

    private Pair matchPair(Fr[] F, int i, int j, double t, boolean sift) {
        Fr fi = F[i], fj = F[j];
        if (fi.nk < 8 || fj.nk < 8) return null;
        int[] si = inside(fi, fj, t), sj = inside(fj, fi, t);
        if (si.length < 8 || sj.length < 8) return null;
        Mat qd = descMat(fi, si, sift), td = descMat(fj, sj, sift);
        DescriptorMatcher bf = DescriptorMatcher.create(sift ? DescriptorMatcher.BRUTEFORCE : DescriptorMatcher.BRUTEFORCE_HAMMING);
        List<MatOfDMatch> km = new ArrayList<>();
        try {
            bf.knnMatch(qd, td, km, 2);
        } finally { qd.release(); td.release(); bf.clear(); }
        double cg = Math.cos(GATE_DEG * D);
        double[] d1 = new double[3], d2 = new double[3], w1 = new double[3], w2 = new double[3];
        List<int[]> cand = new ArrayList<>();
        boolean[] usedT = new boolean[sj.length];
        for (MatOfDMatch mm : km) {
            DMatch[] a = mm.toArray();
            mm.release();
            if (a.length < 2 || a[0].distance >= RATIO * a[1].distance) continue;
            int qi = si[a[0].queryIdx], ti = sj[a[0].trainIdx];
            if (usedT[a[0].trainIdx]) continue;
            camDir(fi.ka[qi], fi.kb[qi], t, d1); rot(fi.Rs, d1, w1);
            camDir(fj.ka[ti], fj.kb[ti], t, d2); rot(fj.Rs, d2, w2);
            if (w1[0] * w2[0] + w1[1] * w2[1] + w1[2] * w2[2] < cg) continue;
            usedT[a[0].trainIdx] = true;
            cand.add(new int[]{qi, ti});
        }
        int m = cand.size();
        if (m < 15) return null;
        Point[] pi = new Point[m], pj = new Point[m];
        for (int k = 0; k < m; k++) {
            int[] c = cand.get(k);
            pi[k] = new Point(fi.ka[c[0]] * fi.L / 2 + fi.w / 2.0, -fi.kb[c[0]] * fi.L / 2 + fi.h / 2.0);
            pj[k] = new Point(fj.ka[c[1]] * fj.L / 2 + fj.w / 2.0, -fj.kb[c[1]] * fj.L / 2 + fj.h / 2.0);
        }
        MatOfPoint2f mi = new MatOfPoint2f(pi), mj = new MatOfPoint2f(pj);
        Mat mask = new Mat(), Hm = null;
        byte[] in = new byte[m];
        try {
            double thr = Math.max(2.0, 2.5 * fi.L / o.workMax);
            Hm = Calib3d.findHomography(mj, mi, Calib3d.RANSAC, thr, mask, 4000, 0.995);
            if (Hm == null || Hm.empty() || mask.rows() != m) return null;
            mask.get(0, 0, in);
        } finally { mi.release(); mj.release(); mask.release(); if (Hm != null) Hm.release(); }
        int ni = 0;
        for (byte b : in) if (b != 0) ni++;
        if (ni < 12 || ni < 8 + 0.3 * m) return null;
        int keep = Math.min(ni, MAX_PAIR_PTS);
        Pair p = new Pair();
        p.i = i; p.j = j; p.m = keep;
        p.ai = new double[keep]; p.bi = new double[keep]; p.aj = new double[keep]; p.bj = new double[keep];
        double step = ni / (double) keep, next = 0;
        int seen = 0, c = 0;
        for (int k = 0; k < m && c < keep; k++) {
            if (in[k] == 0) continue;
            if (seen >= next) {
                int[] q = cand.get(k);
                p.ai[c] = fi.ka[q[0]]; p.bi[c] = fi.kb[q[0]]; p.aj[c] = fj.ka[q[1]]; p.bj[c] = fj.kb[q[1]];
                c++;
                next += step;
            }
            seen++;
        }
        p.m = c;
        return p;
    }

    /** RMS angle (degrees) between matched rays */
    private static double rmsDeg(Fr[] F, List<Pair> pairs, double t) {
        double s = 0;
        long c = 0;
        double[] d = new double[3], v1 = new double[3], v2 = new double[3];
        for (Pair p : pairs) {
            for (int k = 0; k < p.m; k++) {
                camDir(p.ai[k], p.bi[k], t, d); rot(F[p.i].R, d, v1);
                camDir(p.aj[k], p.bj[k], t, d); rot(F[p.j].R, d, v2);
                double x = v1[0] - v2[0], y = v1[1] - v2[1], z = v1[2] - v2[2];
                s += x * x + y * y + z * z;
                c++;
            }
        }
        return c == 0 ? 0 : Math.sqrt(s / c) / D;
    }

    /* ------------------------------------------------------------------ Levenberg-Marquardt ------------------------------------------------------------------ */

    private static final double SIG_PX = 1.0, HUBER_PX = 2.0, SIG_PRIOR = 5 * D, SIG_LOGT = .15;

    private double optimise(Fr[] F, List<Pair> pairs, double t0) {
        int np = 3 * n + 1;
        double[][] R = new double[n][];
        for (int i = 0; i < n; i++) R[i] = F[i].R.clone();
        double lt = Math.log(t0), lt0 = lt;
        double hL = F[0].L / 2;
        double lambda = 1e-3;
        double cost = lmCost(R, lt, lt0, pairs, F, hL);
        double[] Aa = new double[np * np], g = new double[np];
        double[] d1 = new double[3], d2 = new double[3], v1 = new double[3], v2 = new double[3], e1 = new double[3], e2 = new double[3];
        double[][] J = new double[3][7];
        int[] col = new int[7];
        for (int it = 0; it < 60; it++) {
            chk();
            java.util.Arrays.fill(Aa, 0);
            java.util.Arrays.fill(g, 0);
            double t = Math.exp(lt), s = hL / t / SIG_PX;
            for (Pair p : pairs) {
                for (int k = 0; k < 3; k++) { col[k] = 3 * p.i + k; col[3 + k] = 3 * p.j + k; }
                col[6] = np - 1;
                for (int q = 0; q < p.m; q++) {
                    camDir(p.ai[q], p.bi[q], t, d1); rot(R[p.i], d1, v1);
                    camDir(p.aj[q], p.bj[q], t, d2); rot(R[p.j], d2, v2);
                    dDirDlogt(p.ai[q], p.bi[q], t, d1, e1); rot(R[p.i], e1, e1);
                    dDirDlogt(p.aj[q], p.bj[q], t, d2, e2); rot(R[p.j], e2, e2);
                    double r0 = s * (v1[0] - v2[0]), r1 = s * (v1[1] - v2[1]), r2 = s * (v1[2] - v2[2]);
                    double rn = Math.sqrt(r0 * r0 + r1 * r1 + r2 * r2), w = rn <= HUBER_PX ? 1 : HUBER_PX / rn;
                    // d r / d w_i = -s [v1]x ; d r / d w_j = +s [v2]x
                    skew(v1, -s, J, 0);
                    skew(v2, s, J, 3);
                    J[0][6] = s * (e1[0] - e2[0]); J[1][6] = s * (e1[1] - e2[1]); J[2][6] = s * (e1[2] - e2[2]);
                    double[] r = {r0, r1, r2};
                    for (int a = 0; a < 7; a++) {
                        double ga = 0;
                        for (int rr = 0; rr < 3; rr++) ga += J[rr][a] * r[rr];
                        g[col[a]] += w * ga;
                        for (int b = 0; b < 7; b++) {
                            double v = 0;
                            for (int rr = 0; rr < 3; rr++) v += J[rr][a] * J[rr][b];
                            Aa[col[a] * np + col[b]] += w * v;
                        }
                    }
                }
            }
            for (int i = 0; i < n; i++) {
                double[] e = logR(mul(R[i], tr(F[i].Rs)));
                double k = 1 / (SIG_PRIOR * SIG_PRIOR);
                for (int a = 0; a < 3; a++) { Aa[(3 * i + a) * np + 3 * i + a] += k; g[3 * i + a] += k * e[a]; }
            }
            Aa[(np - 1) * np + np - 1] += 1 / (SIG_LOGT * SIG_LOGT);
            g[np - 1] += (lt - lt0) / (SIG_LOGT * SIG_LOGT);
            boolean better = false;
            for (int tries = 0; tries < 8 && !better; tries++) {
                double[] M = Aa.clone(), x = new double[np];
                for (int a = 0; a < np; a++) { M[a * np + a] += lambda * Aa[a * np + a] + 1e-9; x[a] = -g[a]; }
                if (!cholSolve(M, x, np)) { lambda *= 10; continue; }
                double[][] R2 = new double[n][];
                for (int i = 0; i < n; i++) R2[i] = mul(expR(x[3 * i], x[3 * i + 1], x[3 * i + 2]), R[i]);
                double lt2 = lt + x[np - 1];
                double c2 = lmCost(R2, lt2, lt0, pairs, F, hL);
                if (c2 < cost) {
                    double rel = (cost - c2) / Math.max(1e-12, cost);
                    R = R2; lt = lt2; cost = c2; lambda = Math.max(1e-7, lambda / 3); better = true;
                    if (rel < 1e-7) { it = 1000; }
                } else lambda *= 4;
            }
            if (!better) break;
        }
        for (int i = 0; i < n; i++) F[i].R = R[i];
        return Math.exp(lt);
    }

    private static void skew(double[] v, double s, double[][] J, int c) {
        J[0][c] = 0; J[0][c + 1] = -v[2] * s; J[0][c + 2] = v[1] * s;
        J[1][c] = v[2] * s; J[1][c + 1] = 0; J[1][c + 2] = -v[0] * s;
        J[2][c] = -v[1] * s; J[2][c + 1] = v[0] * s; J[2][c + 2] = 0;
    }

    /** derivative of the normalised camera direction by log(t) */
    private static void dDirDlogt(double a, double b, double t, double[] d, double[] out) {
        double px = a * t, py = b * t, nrm = Math.sqrt(px * px + py * py + 1);
        double dot = d[0] * px + d[1] * py; // dp = (px, py, 0)
        out[0] = (px - d[0] * dot) / nrm; out[1] = (py - d[1] * dot) / nrm; out[2] = (0 - d[2] * dot) / nrm;
    }

    private double lmCost(double[][] R, double lt, double lt0, List<Pair> pairs, Fr[] F, double hL) {
        double t = Math.exp(lt), s = hL / t / SIG_PX, c = 0;
        double[] d = new double[3], v1 = new double[3], v2 = new double[3];
        for (Pair p : pairs) {
            for (int q = 0; q < p.m; q++) {
                camDir(p.ai[q], p.bi[q], t, d); rot(R[p.i], d, v1);
                camDir(p.aj[q], p.bj[q], t, d); rot(R[p.j], d, v2);
                double x = s * (v1[0] - v2[0]), y = s * (v1[1] - v2[1]), z = s * (v1[2] - v2[2]), rn = Math.sqrt(x * x + y * y + z * z);
                c += rn <= HUBER_PX ? rn * rn : 2 * HUBER_PX * rn - HUBER_PX * HUBER_PX;
            }
        }
        for (int i = 0; i < n; i++) {
            double[] e = logR(mul(R[i], tr(F[i].Rs)));
            c += (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) / (SIG_PRIOR * SIG_PRIOR);
        }
        c += (lt - lt0) * (lt - lt0) / (SIG_LOGT * SIG_LOGT);
        return c;
    }

    /** in-place Cholesky solve of the symmetric positive definite n x n system M x = b (b -> x) */
    static boolean cholSolve(double[] M, double[] b, int N) {
        for (int j = 0; j < N; j++) {
            double s = M[j * N + j];
            for (int k = 0; k < j; k++) s -= M[j * N + k] * M[j * N + k];
            if (!(s > 0)) return false;
            double l = Math.sqrt(s);
            M[j * N + j] = l;
            for (int i = j + 1; i < N; i++) {
                double v = M[i * N + j];
                for (int k = 0; k < j; k++) v -= M[i * N + k] * M[j * N + k];
                M[i * N + j] = v / l;
            }
        }
        for (int i = 0; i < N; i++) { double v = b[i]; for (int k = 0; k < i; k++) v -= M[i * N + k] * b[k]; b[i] = v / M[i * N + i]; }
        for (int i = N - 1; i >= 0; i--) { double v = b[i]; for (int k = i + 1; k < N; k++) v -= M[k * N + i] * b[k]; b[i] = v / M[i * N + i]; }
        return true;
    }

    /* ------------------------------------------------------------------ footprint ------------------------------------------------------------------ */

    /** bounding region on a W x H equirect: {x0, x1 (exclusive, x0 in [0,W) or full), y0, y1 (exclusive), full 0/1} */
    static int[] roiOf(double[] m, double t, int w, int h, int W, int H, double yawRef) {
        double hL = Math.max(w, h) / 2.0, f = hL / t;
        int N = 16;
        double lc = Math.atan2(-m[2], -m[5]) / D, la0 = 90, la1 = -90, dl0 = 180, dl1 = -180;
        boolean full = false;
        for (int s = 0; s < 4 * N + 1; s++) {
            double u, v;
            int k = s % N; double tt = k / (double) N;
            if (s == 4 * N) { u = w / 2.0; v = h / 2.0; }
            else if (s < N) { u = tt * w; v = 0; } else if (s < 2 * N) { u = w; v = tt * h; } else if (s < 3 * N) { u = (1 - tt) * w; v = h; } else { u = 0; v = (1 - tt) * h; }
            double cx = (u - w / 2.0) / f, cy = -(v - h / 2.0) / f;
            double dx = m[0] * cx + m[1] * cy - m[2], dy = m[3] * cx + m[4] * cy - m[5], dz = m[6] * cx + m[7] * cy - m[8], nn = Math.sqrt(dx * dx + dy * dy + dz * dz);
            double lat = Math.asin(Math.max(-1, Math.min(1, dz / nn))) / D, dl = wrap180(Math.atan2(dx, dy) / D - lc);
            la0 = Math.min(la0, lat); la1 = Math.max(la1, lat); dl0 = Math.min(dl0, dl); dl1 = Math.max(dl1, dl);
            if (Math.abs(dl) > 150) full = true;
        }
        for (int sg = -1; sg <= 1; sg += 2) {
            double[] p = project(m, new double[]{0, 0, sg}, 2 * Math.atan(t) / D, w, h);
            if (p != null && p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h) { full = true; if (sg > 0) la1 = 90; else la0 = -90; }
        }
        // the lat range on the border can miss the extreme of a tilted frame near a pole: a small safety margin
        la1 = Math.min(90, la1 + 1); la0 = Math.max(-90, la0 - 1);
        int y0 = Math.max(0, (int) Math.floor((.5 - la1 / 180) * H) - 2), y1 = Math.min(H, (int) Math.ceil((.5 - la0 / 180) * H) + 3);
        if (full || dl1 - dl0 > 300) return new int[]{0, W, y0, y1, 1};
        double rel = wrap180(lc - yawRef);
        int x0 = (int) Math.floor(((rel + dl0) / 360 + .5) * W) - 2, x1 = (int) Math.ceil(((rel + dl1) / 360 + .5) * W) + 3;
        if (x1 - x0 >= W - 4) return new int[]{0, W, y0, y1, 1};
        int wd = x1 - x0;
        x0 = fm(x0, W);
        return new int[]{x0, x0 + wd, y0, y1, 0};
    }

    /* ------------------------------------------------------------------ low resolution: gains, labels, seams ------------------------------------------------------------------ */

    private void lowWarp(Fr f, double t, int Ws, int Hs) {
        int[] r = roiOf(f.R, t, f.w, f.h, Ws, Hs, o.yawRef);
        f.lx0 = r[0]; f.lw = r[1] - r[0]; f.ly0 = r[2]; f.lh = r[3] - r[2];
        f.lsc = new float[f.lw * f.lh];
        f.lcol = new byte[f.lw * f.lh * 3];
        double[] m = f.R;
        double hL = f.L / 2, fp = hL / t;
        double ex = Math.atan(f.w / 2.0 / fp) / D, ey = Math.atan(f.h / 2.0 / fp) / D; // half fov (deg)
        double kx = f.tw / (double) f.w, ky = f.thh / (double) f.h;
        for (int yy = 0; yy < f.lh; yy++) {
            for (int xx = 0; xx < f.lw; xx++) {
                int k = yy * f.lw + xx;
                f.lsc[k] = -1;
                double[] d = eqDir(f.lx0 + xx, f.ly0 + yy, Ws, Hs, o.yawRef);
                double cx = m[0] * d[0] + m[3] * d[1] + m[6] * d[2], cy = m[1] * d[0] + m[4] * d[1] + m[7] * d[2], cz = m[2] * d[0] + m[5] * d[1] + m[8] * d[2];
                if (cz >= -1e-6) continue;
                double u = f.w / 2.0 + fp * cx / -cz, v = f.h / 2.0 - fp * cy / -cz;
                double nx = Math.abs(u - f.w / 2.0) / (f.w / 2.0), ny = Math.abs(v - f.h / 2.0) / (f.h / 2.0);
                if (nx >= 1 || ny >= 1) continue;
                f.lsc[k] = (float) Math.min((1 - nx) * ex, (1 - ny) * ey);
                // bilinear from the small copy
                double fx = u * kx - .5, fy = v * ky - .5;
                int ix = (int) Math.floor(fx), iy = (int) Math.floor(fy);
                double ax = fx - ix, ay = fy - iy;
                int x0 = Math.max(0, Math.min(f.tw - 1, ix)), x1 = Math.max(0, Math.min(f.tw - 1, ix + 1)), y0 = Math.max(0, Math.min(f.thh - 1, iy)), y1 = Math.max(0, Math.min(f.thh - 1, iy + 1));
                for (int c = 0; c < 3; c++) {
                    double val = ((f.th[(y0 * f.tw + x0) * 3 + c] & 255) * (1 - ax) + (f.th[(y0 * f.tw + x1) * 3 + c] & 255) * ax) * (1 - ay)
                            + ((f.th[(y1 * f.tw + x0) * 3 + c] & 255) * (1 - ax) + (f.th[(y1 * f.tw + x1) * 3 + c] & 255) * ax) * ay;
                    f.lcol[k * 3 + c] = (byte) Math.max(0, Math.min(255, Math.round(val)));
                }
            }
        }
    }

    /** index into the low-res arrays of frame f at canvas (x,y), or -1 */
    private static int at(Fr f, int x, int y, int Ws) {
        int ly = y - f.ly0;
        if (ly < 0 || ly >= f.lh) return -1;
        int lx = x - f.lx0;
        if (lx < 0) lx += Ws;
        if (lx >= f.lw) return -1;
        int k = ly * f.lw + lx;
        return f.lsc[k] >= 0 ? k : -1;
    }

    /** per-frame per-channel gains: least squares on the overlaps (like cv::detail::GainCompensator), weak prior gain = 1 */
    private void gains(Fr[] F, int Ws) {
        double[][][] I = new double[3][n][n];
        double[][] N = new double[n][n];
        for (int i = 0; i < n; i++) {
            Fr a = F[i];
            for (int j = 0; j < n; j++) {
                if (j == i) continue;
                Fr b = F[j];
                double s0 = 0, s1 = 0, s2 = 0, c = 0;
                for (int yy = 0; yy < a.lh; yy++) {
                    int y = a.ly0 + yy;
                    if (y < b.ly0 || y >= b.ly0 + b.lh) continue;
                    for (int xx = 0; xx < a.lw; xx++) {
                        int ka = yy * a.lw + xx;
                        if (a.lsc[ka] < 0) continue;
                        int kb = at(b, (a.lx0 + xx) % Ws, y, Ws);
                        if (kb < 0) continue;
                        int pa = ka * 3, pb = kb * 3;
                        int ma = Math.max(a.lcol[pa] & 255, Math.max(a.lcol[pa + 1] & 255, a.lcol[pa + 2] & 255)), mb = Math.max(b.lcol[pb] & 255, Math.max(b.lcol[pb + 1] & 255, b.lcol[pb + 2] & 255));
                        if (ma > 250 || mb > 250 || ma < 6 || mb < 6) continue; // clipped
                        s0 += a.lcol[pa] & 255; s1 += a.lcol[pa + 1] & 255; s2 += a.lcol[pa + 2] & 255;
                        c++;
                    }
                }
                N[i][j] = c;
                if (c > 0) { I[0][i][j] = s0 / c; I[1][i][j] = s1 / c; I[2][i][j] = s2 / c; }
            }
        }
        double alpha = 1 / (10.0 * 10.0), beta = 1 / (0.5 * 0.5);
        for (int ch = 0; ch < 3; ch++) {
            double[] M = new double[n * n], b = new double[n];
            for (int i = 0; i < n; i++) {
                double nsum = 0;
                for (int j = 0; j < n; j++) {
                    if (j == i || N[i][j] < 20) continue;
                    double Nij = N[i][j];
                    nsum += Nij;
                    M[i * n + i] += 2 * alpha * I[ch][i][j] * I[ch][i][j] * Nij;
                    M[i * n + j] -= 2 * alpha * I[ch][i][j] * I[ch][j][i] * Nij;
                }
                double pw = beta * Math.max(nsum, 1);
                M[i * n + i] += pw;
                b[i] += pw;
            }
            if (!cholSolve(M, b, n)) continue;
            for (int i = 0; i < n; i++) F[i].gain[ch] = Math.max(.5, Math.min(2, b[i]));
        }
    }

    private int[] labels(Fr[] F, int Ws, int Hs) {
        int[] lab = new int[Ws * Hs];
        float[] best = new float[Ws * Hs];
        java.util.Arrays.fill(lab, -1);
        for (int i = 0; i < n; i++) {
            Fr f = F[i];
            for (int yy = 0; yy < f.lh; yy++) for (int xx = 0; xx < f.lw; xx++) {
                float s = f.lsc[yy * f.lw + xx];
                if (s < 0) continue;
                int p = (f.ly0 + yy) * Ws + (f.lx0 + xx) % Ws;
                if (lab[p] < 0 || s > best[p]) { lab[p] = i; best[p] = s; }
            }
        }
        return lab;
    }

    private double diff(Fr a, Fr b, int x, int y, int Ws) {
        int ka = at(a, x, y, Ws), kb = at(b, x, y, Ws);
        if (ka < 0 || kb < 0) return 300;
        double s = 0;
        for (int c = 0; c < 3; c++) s += Math.abs((a.lcol[ka * 3 + c] & 255) * a.gain[c] - (b.lcol[kb * 3 + c] & 255) * b.gain[c]);
        return s;
    }

    /** minimal-difference seams: for every pair of neighbouring labels, a DP path inside a band around the Voronoi border */
    private void seams(Fr[] F, int[] lab, int Ws, int Hs) {
        java.util.HashMap<Integer, int[]> adj = new java.util.HashMap<>();
        for (int y = 0; y < Hs; y++) for (int x = 0; x < Ws; x++) {
            int a = lab[y * Ws + x];
            if (a < 0) continue;
            int r = lab[y * Ws + (x + 1) % Ws], d = y + 1 < Hs ? lab[(y + 1) * Ws + x] : -1;
            for (int b : new int[]{r, d}) {
                if (b < 0 || b == a) continue;
                int key = Math.min(a, b) * n + Math.max(a, b);
                int[] c = adj.get(key);
                if (c == null) adj.put(key, new int[]{1}); else c[0]++;
            }
        }
        // centres of the labels (circular mean in x)
        double[] cs = new double[n], cc = new double[n], cy = new double[n], cnt = new double[n];
        for (int y = 0; y < Hs; y++) for (int x = 0; x < Ws; x++) {
            int a = lab[y * Ws + x];
            if (a < 0) continue;
            double ang = 2 * Math.PI * (x + .5) / Ws;
            cs[a] += Math.sin(ang); cc[a] += Math.cos(ang); cy[a] += y; cnt[a]++;
        }
        int band = Math.max(3, Ws * 6 / 360);
        List<Integer> keys = new ArrayList<>(adj.keySet());
        java.util.Collections.sort(keys);
        for (int key : keys) {
            if (adj.get(key)[0] < 3) continue;
            chk();
            int a = key / n, b = key % n;
            if (cnt[a] == 0 || cnt[b] == 0) continue;
            double xa = Math.atan2(cs[a], cc[a]) / (2 * Math.PI) * Ws - .5, xb = Math.atan2(cs[b], cc[b]) / (2 * Math.PI) * Ws - .5;
            double ra = Math.hypot(cs[a], cc[a]) / cnt[a], rb = Math.hypot(cs[b], cc[b]) / cnt[b];
            double ya = cy[a] / cnt[a], yb = cy[b] / cnt[b];
            double dxp = Math.IEEEremainder(xb - xa, Ws);
            double latm = (.5 - ((ya + yb) / 2 + .5) / Hs) * Math.PI;
            double dxs = (ra < .3 || rb < .3) ? 0 : dxp * Math.cos(latm);
            double dyv = yb - ya;
            int xc = (int) Math.round(xa + dxp / 2);
            boolean vertical = Math.abs(dxs) >= Math.abs(dyv);
            int nLines, nPos;
            if (vertical) { nLines = Hs; nPos = Ws / 2; } else { nLines = Ws; nPos = Hs; }
            boolean rev = vertical ? dxp < 0 : dyv < 0;
            seamPair(F, lab, Ws, Hs, a, b, vertical, rev, xc, nLines, nPos, band);
        }
    }

    private int pix(boolean vertical, boolean rev, int xc, int line, int pos, int nPos, int Ws, int Hs) {
        int pp = rev ? nPos - 1 - pos : pos;
        if (vertical) {
            int x = fm(xc - nPos / 2 + pp, Ws);
            return line * Ws + x;
        }
        int x = fm(xc - Ws / 2 + line, Ws);
        return pp * Ws + x;
    }

    private void seamPair(Fr[] F, int[] lab, int Ws, int Hs, int a, int b, boolean vertical, boolean rev, int xc, int nLines, int nPos, int band) {
        Fr fa = F[a], fb = F[b];
        int[] t0 = new int[nLines], lo = new int[nLines], hi = new int[nLines];
        int prev = -1;
        for (int L = 0; L < nLines; L++) {
            t0[L] = -1;
            int bestT = -1, bestD = Integer.MAX_VALUE;
            int ref = prev >= 0 ? prev : nPos / 2;
            for (int p = 1; p < nPos; p++) {
                if (lab[pix(vertical, rev, xc, L, p - 1, nPos, Ws, Hs)] == a && lab[pix(vertical, rev, xc, L, p, nPos, Ws, Hs)] == b) {
                    int dd = Math.abs(p - ref);
                    if (dd < bestD) { bestD = dd; bestT = p; }
                }
            }
            if (bestT < 0) { prev = -1; continue; }
            t0[L] = bestT; prev = bestT;
            int l = bestT, h = bestT;
            while (l > bestT - band && l - 1 >= 0) {
                int q = pix(vertical, rev, xc, L, l - 1, nPos, Ws, Hs), x = q % Ws, y = q / Ws;
                if ((lab[q] != a && lab[q] != b) || at(fb, x, y, Ws) < 0) break;
                l--;
            }
            while (h < bestT + band && h < nPos - 1) {
                int q = pix(vertical, rev, xc, L, h, nPos, Ws, Hs), x = q % Ws, y = q / Ws;
                if ((lab[q] != a && lab[q] != b) || at(fa, x, y, Ws) < 0) break;
                h++;
            }
            lo[L] = l; hi[L] = h;
        }
        // DP over runs of consecutive lines that have a border
        int L = 0;
        while (L < nLines) {
            if (t0[L] < 0) { L++; continue; }
            int s0 = L;
            while (L < nLines && t0[L] >= 0) L++;
            int s1 = L; // [s0, s1)
            double[][] E = new double[s1 - s0][];
            int[][] bk = new int[s1 - s0][];
            for (int k = s0; k < s1; k++) {
                int m = hi[k] - lo[k] + 1;
                E[k - s0] = new double[m];
                bk[k - s0] = new int[m];
                for (int s = lo[k]; s <= hi[k]; s++) {
                    double c = 1;
                    if (s - 1 >= 0) { int q = pix(vertical, rev, xc, k, s - 1, nPos, Ws, Hs); c += diff(fa, fb, q % Ws, q / Ws, Ws); }
                    if (s < nPos) { int q = pix(vertical, rev, xc, k, s, nPos, Ws, Hs); c += diff(fa, fb, q % Ws, q / Ws, Ws); }
                    double bestE = 0;
                    int arg = -1;
                    if (k > s0) {
                        bestE = Double.MAX_VALUE;
                        for (int s2 = lo[k - 1]; s2 <= hi[k - 1]; s2++) {
                            int dd = Math.abs(s - s2);
                            double e = E[k - 1 - s0][s2 - lo[k - 1]] + (dd <= 1 ? .5 * dd : 20.0 * dd);
                            if (e < bestE) { bestE = e; arg = s2; }
                        }
                    }
                    E[k - s0][s - lo[k]] = c + bestE;
                    bk[k - s0][s - lo[k]] = arg;
                }
            }
            int k = s1 - 1, sb = lo[k];
            double be = Double.MAX_VALUE;
            for (int s = lo[k]; s <= hi[k]; s++) if (E[k - s0][s - lo[k]] < be) { be = E[k - s0][s - lo[k]]; sb = s; }
            for (; k >= s0; k--) {
                int s = sb, tt = t0[k];
                if (s < tt) for (int p = s; p < tt; p++) { int q = pix(vertical, rev, xc, k, p, nPos, Ws, Hs); if (lab[q] == a) lab[q] = b; }
                else for (int p = tt; p < s; p++) { int q = pix(vertical, rev, xc, k, p, nPos, Ws, Hs); if (lab[q] == b) lab[q] = a; }
                sb = bk[k - s0][s - lo[k]];
            }
        }
    }

    /* ------------------------------------------------------------------ full resolution: warp + multi-band blend ------------------------------------------------------------------ */

    private Mat blend(Fr[] F, int[] lab, double t, int W, int H, int Ws, int Hs, int B, Stats st, Progress P) {
        int A = 1 << B, levels = o.multiband ? B : 0;
        Mat[] dst = new Mat[levels + 1], wsum = new Mat[levels + 1];
        Mat out = null;
        try {
            for (int l = 0; l <= levels; l++) {
                dst[l] = Mat.zeros(H >> l, W >> l, CvType.CV_32FC3);
                wsum[l] = Mat.zeros(H >> l, W >> l, CvType.CV_32FC1);
            }
            for (int i = 0; i < n; i++) {
                chk();
                addFrame(F, i, lab, t, W, H, Ws, Hs, A, levels, dst, wsum);
                P.on(.5 + .4 * (i + 1) / n);
            }
            // coverage (level 0) before normalising
            Mat cover = new Mat();
            Imgproc.threshold(wsum[0], cover, 1e-4, 255, Imgproc.THRESH_BINARY);
            Mat cover8 = new Mat();
            cover.convertTo(cover8, CvType.CV_8U);
            cover.release();
            for (int l = 0; l <= levels; l++) {
                Mat w3 = new Mat(), wp = new Mat();
                Core.add(wsum[l], new Scalar(1e-6), wp);
                Imgproc.cvtColor(wp, w3, Imgproc.COLOR_GRAY2BGR);
                Core.divide(dst[l], w3, dst[l]);
                w3.release(); wp.release();
            }
            // top level: extrapolate into uncovered areas (no dark halo when collapsing near holes)
            Mat topMask = new Mat();
            Imgproc.threshold(wsum[levels], topMask, 1e-3, 1, Imgproc.THRESH_BINARY);
            for (int l = 0; l <= levels; l++) { wsum[l].release(); wsum[l] = null; }
            pushPull(dst[levels], topMask, true);
            topMask.release();
            Mat R = dst[levels];
            dst[levels] = null;
            for (int l = levels - 1; l >= 0; l--) {
                Mat up = pyrUpWrap(R, dst[l].cols(), dst[l].rows());
                R.release();
                Core.add(up, dst[l], up);
                dst[l].release(); dst[l] = null;
                R = up;
            }
            out = new Mat();
            R.convertTo(out, CvType.CV_8UC3);
            R.release();
            P.on(.94);
            int holes = (int) (W * (long) H - Core.countNonZero(cover8));
            st.holesPct = 100.0 * holes / (W * (double) H);
            if (holes > 0 && o.fill) fillHoles(out, cover8);
            cover8.release();
            Mat r = out;
            out = null;
            return r;
        } finally {
            for (Mat m : dst) if (m != null) m.release();
            for (Mat m : wsum) if (m != null) m.release();
            if (out != null) out.release();
        }
    }

    /** pyrUp with horizontal wrap (equirect is periodic in x) */
    private static Mat pyrUpWrap(Mat src, int w, int h) {
        Mat pad = new Mat(), up = new Mat();
        Core.copyMakeBorder(src, pad, 2, 2, 0, 0, Core.BORDER_REFLECT_101);
        Mat pad2 = new Mat();
        Core.copyMakeBorder(pad, pad2, 0, 0, 2, 2, Core.BORDER_WRAP);
        pad.release();
        Imgproc.pyrUp(pad2, up, new Size(pad2.cols() * 2, pad2.rows() * 2));
        pad2.release();
        Mat r = up.submat(new Rect(4, 4, w, h)).clone();
        up.release();
        return r;
    }

    private static final int STRIP = 128;

    private void addFrame(Fr[] F, int i, int[] lab, double t, int W, int H, int Ws, int Hs, int A, int levels, Mat[] dst, Mat[] wsum) {
        Fr f = F[i];
        Mat img = decode(i);
        Mat src = img;
        List<Mat> lap = new ArrayList<>(), gw = new ArrayList<>();
        Mat roiImg = null, roiW = null, valid = null;
        try {
            int w = f.w, h = f.h;
            // pre-downscale so the source is not much finer than the output (anti-aliasing)
            double fp = (f.L / 2) / t, ppdEq = W / 360.0, ppdFr = fp * D, s = Math.min(1, 1.25 * ppdEq / ppdFr);
            if (s < .9) {
                src = new Mat();
                Imgproc.resize(img, src, new Size(Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s))), 0, 0, Imgproc.INTER_AREA);
                img.release();
            }
            int sw = src.cols(), sh = src.rows();
            double sfp = (Math.max(sw, sh) / 2.0) / t;
            int[] r = roiOf(f.R, t, w, h, W, H, o.yawRef);
            boolean full = r[4] == 1;
            int x0, x1;
            if (full) { x0 = -A; x1 = W + A; }
            else {
                x0 = fd(r[0], A) * A - A; x1 = -fd(-r[1], A) * A + A;
                if (x1 - x0 >= W - A) { full = true; x0 = -A; x1 = W + A; }
            }
            int y0 = Math.max(0, fd(r[2], A) * A - A), y1 = Math.min(H, -fd(-r[3], A) * A + A);
            int rw = x1 - x0, rh = y1 - y0;
            if (rh <= 0) return;
            roiImg = new Mat(rh, rw, CvType.CV_32FC3);
            roiW = new Mat(rh, rw, CvType.CV_32FC1);
            valid = new Mat(rh, rw, CvType.CV_32FC1);
            double[] m = f.R;
            double[] sinLo = new double[rw], cosLo = new double[rw];
            for (int xx = 0; xx < rw; xx++) {
                double lon = (((x0 + xx) + .5) / W - .5) * 360 + o.yawRef;
                sinLo[xx] = Math.sin(lon * D); cosLo[xx] = Math.cos(lon * D);
            }
            double ratio = Ws / (double) W;
            Mat tmp = new Mat(), mx = new Mat(), my = new Mat(), g3 = new Mat();
            try {
                for (int ys = 0; ys < rh; ys += STRIP) {
                    int sh2 = Math.min(STRIP, rh - ys);
                    float[] ax = new float[sh2 * rw], ay = new float[sh2 * rw], vw = new float[sh2 * rw], vv = new float[sh2 * rw];
                    for (int yy = 0; yy < sh2; yy++) {
                        int y = y0 + ys + yy;
                        double lat = (.5 - (y + .5) / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
                        double ly = (y + .5) * ratio - .5;
                        int ly0 = (int) Math.floor(ly);
                        double fy = ly - ly0;
                        int lyA = Math.max(0, Math.min(Hs - 1, ly0)), lyB = Math.max(0, Math.min(Hs - 1, ly0 + 1));
                        for (int xx = 0; xx < rw; xx++) {
                            int k = yy * rw + xx;
                            double d0 = cl * sinLo[xx], d1 = cl * cosLo[xx];
                            double cx = m[0] * d0 + m[3] * d1 + m[6] * sl, cy = m[1] * d0 + m[4] * d1 + m[7] * sl, cz = m[2] * d0 + m[5] * d1 + m[8] * sl;
                            if (cz >= -1e-6) { ax[k] = -1e4f; ay[k] = -1e4f; continue; }
                            double u = sw / 2.0 + sfp * cx / -cz, v = sh / 2.0 - sfp * cy / -cz;
                            ax[k] = (float) (u - .5); ay[k] = (float) (v - .5);
                            if (u < 1 || v < 1 || u > sw - 1 || v > sh - 1) continue;
                            vv[k] = 1;
                            // seam weight: bilinear indicator of (label == i) on the low-res canvas
                            double lx = ((x0 + xx) + .5) * ratio - .5;
                            int lx0 = (int) Math.floor(lx);
                            double fx = lx - lx0;
                            int xa = fm(lx0, Ws), xb = fm(lx0 + 1, Ws);
                            double ind = (lab[lyA * Ws + xa] == i ? (1 - fx) * (1 - fy) : 0) + (lab[lyA * Ws + xb] == i ? fx * (1 - fy) : 0)
                                    + (lab[lyB * Ws + xa] == i ? (1 - fx) * fy : 0) + (lab[lyB * Ws + xb] == i ? fx * fy : 0);
                            vw[k] = ind > .5 ? 1 : 0;
                        }
                    }
                    if (full) { // periodic copy: only the central W columns count
                        for (int yy = 0; yy < sh2; yy++) for (int xx = 0; xx < rw; xx++) if (xx < A || xx >= A + W) vw[yy * rw + xx] = 0;
                    }
                    mx.create(sh2, rw, CvType.CV_32FC1); my.create(sh2, rw, CvType.CV_32FC1);
                    mx.put(0, 0, ax); my.put(0, 0, ay);
                    Imgproc.remap(src, tmp, mx, my, Imgproc.INTER_CUBIC, Core.BORDER_REPLICATE, new Scalar(0, 0, 0));
                    Mat dstStrip = roiImg.submat(ys, ys + sh2, 0, rw);
                    tmp.convertTo(dstStrip, CvType.CV_32FC3);
                    dstStrip.release();
                    Mat ws = roiW.submat(ys, ys + sh2, 0, rw); ws.put(0, 0, vw); ws.release();
                    Mat vs = valid.submat(ys, ys + sh2, 0, rw); vs.put(0, 0, vv); vs.release();
                }
            } finally { tmp.release(); mx.release(); my.release(); g3.release(); }
            src.release();
            src = null;
            // gains
            Core.multiply(roiImg, new Scalar(f.gain[0], f.gain[1], f.gain[2]), roiImg);
            // invalid pixels: smooth extrapolation (clean Laplacian near the frame border)
            pushPull(roiImg, valid, false);
            valid.release(); valid = null;
            // pyramids
            lap.add(roiImg); roiImg = null;
            gw.add(roiW); roiW = null;
            for (int l = 1; l <= levels; l++) {
                Mat g = new Mat(), ww = new Mat();
                Imgproc.pyrDown(lap.get(l - 1), g);
                Imgproc.pyrDown(gw.get(l - 1), ww);
                lap.add(g); gw.add(ww);
            }
            for (int l = 0; l < levels; l++) {
                Mat up = new Mat();
                Imgproc.pyrUp(lap.get(l + 1), up, lap.get(l).size());
                Core.subtract(lap.get(l), up, lap.get(l));
                up.release();
            }
            for (int l = 0; l <= levels; l++) accumulate(lap.get(l), gw.get(l), dst[l], wsum[l], x0 >> l, y0 >> l, full, A >> l, W >> l);
        } finally {
            if (src != null) src.release();
            if (img != src) img.release();
            if (roiImg != null) roiImg.release();
            if (roiW != null) roiW.release();
            if (valid != null) valid.release();
            for (Mat m : lap) m.release();
            for (Mat m : gw) m.release();
        }
    }

    private static void accumulate(Mat L, Mat w, Mat dst, Mat ws, int x0, int y0, boolean full, int margin, int Wl) {
        int rw = L.cols(), rh = L.rows();
        int[][] blocks; // {srcX, dstX, width}
        if (full) blocks = new int[][]{{margin, 0, Wl}};
        else {
            int xs = fm(x0, Wl);
            if (xs + rw <= Wl) blocks = new int[][]{{0, xs, rw}};
            else blocks = new int[][]{{0, xs, Wl - xs}, {Wl - xs, 0, rw - (Wl - xs)}};
        }
        for (int[] b : blocks) {
            if (b[2] <= 0) continue;
            Mat sL = L.submat(0, rh, b[0], b[0] + b[2]), sw = w.submat(0, rh, b[0], b[0] + b[2]);
            Mat dL = dst.submat(y0, y0 + rh, b[1], b[1] + b[2]), dw = ws.submat(y0, y0 + rh, b[1], b[1] + b[2]);
            Mat w3 = new Mat(), prod = new Mat();
            Imgproc.cvtColor(sw, w3, Imgproc.COLOR_GRAY2BGR);
            Core.multiply(sL, w3, prod);
            Core.add(dL, prod, dL);
            Core.add(dw, sw, dw);
            w3.release(); prod.release(); sL.release(); sw.release(); dL.release(); dw.release();
        }
    }

    /** fills pixels with mask 0 by push-pull (pyramid) extrapolation; mask = CV_32FC1 0/1. wrapX: periodic in x */
    private static void pushPull(Mat img, Mat mask, boolean wrapX) {
        int total = img.rows() * img.cols();
        if (Core.countNonZero(mask) == total) return;
        if (Core.countNonZero(mask) == 0) return;
        List<Mat> Is = new ArrayList<>(), Ms = new ArrayList<>();
        Mat m3 = new Mat(), I0 = new Mat();
        Imgproc.cvtColor(mask, m3, Imgproc.COLOR_GRAY2BGR);
        Core.multiply(img, m3, I0);
        m3.release();
        Is.add(I0); Ms.add(mask.clone());
        try {
            while (Is.get(Is.size() - 1).cols() > 4 && Is.get(Is.size() - 1).rows() > 4) {
                Mat a = new Mat(), b = new Mat();
                Imgproc.pyrDown(Is.get(Is.size() - 1), a);
                Imgproc.pyrDown(Ms.get(Ms.size() - 1), b);
                Is.add(a); Ms.add(b);
            }
            int top = Is.size() - 1;
            Mat T = new Mat();
            {
                Mat w3 = new Mat(), wp = new Mat();
                Core.add(Ms.get(top), new Scalar(1e-6), wp);
                Imgproc.cvtColor(wp, w3, Imgproc.COLOR_GRAY2BGR);
                Core.divide(Is.get(top), w3, T);
                Scalar mean = Core.sumElems(Is.get(top));
                double ms = Core.sumElems(Ms.get(top)).val[0];
                if (ms > 1e-6) {
                    Mat holes = new Mat();
                    Imgproc.threshold(Ms.get(top), holes, 1e-4, 1, Imgproc.THRESH_BINARY_INV);
                    Mat h8 = new Mat();
                    holes.convertTo(h8, CvType.CV_8U);
                    T.setTo(new Scalar(mean.val[0] / ms, mean.val[1] / ms, mean.val[2] / ms), h8);
                    holes.release(); h8.release();
                }
                w3.release(); wp.release();
            }
            for (int l = top - 1; l >= 0; l--) {
                Mat up = wrapX ? pyrUpWrap(T, Is.get(l).cols(), Is.get(l).rows()) : new Mat();
                if (!wrapX) Imgproc.pyrUp(T, up, Is.get(l).size());
                T.release();
                // T_l = I_l + (1 - M_l) * up, where M_l is normalised (<= 1) and I_l premultiplied
                Mat mc = new Mat(), inv = new Mat(), inv3 = new Mat(), norm = new Mat(), m3b = new Mat();
                Core.min(Ms.get(l), new Scalar(1), mc);
                mc.convertTo(inv, -1, -1, 1); // 1 - M
                Imgproc.cvtColor(inv, inv3, Imgproc.COLOR_GRAY2BGR);
                // colour where the mask is partial: I/M * M = I (premultiplied) - scaled so that full weight keeps the exact value
                Mat w3 = new Mat(), wp = new Mat();
                Core.add(Ms.get(l), new Scalar(1e-6), wp);
                Imgproc.cvtColor(wp, w3, Imgproc.COLOR_GRAY2BGR);
                Core.divide(Is.get(l), w3, norm);
                Imgproc.cvtColor(mc, m3b, Imgproc.COLOR_GRAY2BGR);
                Core.multiply(norm, m3b, norm);
                Core.multiply(up, inv3, up);
                Core.add(norm, up, up);
                T = up;
                mc.release(); inv.release(); inv3.release(); norm.release(); m3b.release(); w3.release(); wp.release();
            }
            // keep the original pixels exactly where the mask is 1
            Mat keep = new Mat(), k8 = new Mat();
            Imgproc.threshold(mask, keep, .5, 1, Imgproc.THRESH_BINARY_INV);
            keep.convertTo(k8, CvType.CV_8U);
            T.copyTo(img, k8);
            keep.release(); k8.release(); T.release();
        } finally {
            for (Mat m : Is) m.release();
            for (Mat m : Ms) m.release();
        }
    }

    /** uncovered areas (zenith / nadir): Photo.inpaint at low resolution (periodic in x), upsampled, feathered */
    private static void fillHoles(Mat pano, Mat cover8) {
        int W = pano.cols(), H = pano.rows(), w = Math.min(512, W), h = w / 2, pad = w / 16;
        Mat small = new Mat(), hs = new Mat(), hole = new Mat(), sp = new Mat(), hp = new Mat(), fl = new Mat(), big = new Mat();
        Mat hf = new Mat(), dil = new Mat(), alpha = new Mat(), a3 = new Mat(), pf = new Mat(), bf = new Mat(), ker = null;
        try {
            Imgproc.resize(pano, small, new Size(w, h), 0, 0, Imgproc.INTER_AREA);
            Core.bitwise_not(cover8, hole);
            Imgproc.resize(hole, hs, new Size(w, h), 0, 0, Imgproc.INTER_AREA);
            Imgproc.threshold(hs, hs, 0, 255, Imgproc.THRESH_BINARY);
            Core.copyMakeBorder(small, sp, 0, 0, pad, pad, Core.BORDER_WRAP);
            Core.copyMakeBorder(hs, hp, 0, 0, pad, pad, Core.BORDER_WRAP);
            Photo.inpaint(sp, hp, fl, 6, Photo.INPAINT_TELEA);
            Mat flc = fl.submat(0, h, pad, pad + w);
            Mat sm2 = new Mat();
            Imgproc.GaussianBlur(flc, sm2, new Size(0, 0), 2);
            Imgproc.resize(sm2, big, new Size(W, H), 0, 0, Imgproc.INTER_CUBIC);
            flc.release(); sm2.release();
            // alpha = max(hole, blur(dilate(hole)))
            hole.convertTo(hf, CvType.CV_32F, 1 / 255.0);
            int r = Math.max(2, W / 512);
            ker = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, new Size(2 * r + 1, 2 * r + 1));
            Imgproc.dilate(hf, dil, ker);
            Imgproc.GaussianBlur(dil, alpha, new Size(0, 0), r);
            Core.max(alpha, hf, alpha);
            Imgproc.cvtColor(alpha, a3, Imgproc.COLOR_GRAY2BGR);
            pano.convertTo(pf, CvType.CV_32FC3);
            big.convertTo(bf, CvType.CV_32FC3);
            Core.subtract(bf, pf, bf);
            Core.multiply(bf, a3, bf);
            Core.add(pf, bf, pf);
            pf.convertTo(pano, CvType.CV_8UC3);
        } finally {
            small.release(); hs.release(); hole.release(); sp.release(); hp.release(); fl.release(); big.release();
            hf.release(); dil.release(); alpha.release(); a3.release(); pf.release(); bf.release();
            if (ker != null) ker.release();
        }
    }

    /** JPEG bytes of an 8UC3 BGR image */
    public static byte[] jpeg(Mat img, int quality) {
        MatOfByte buf = new MatOfByte();
        MatOfInt prm = new MatOfInt(Imgcodecs.IMWRITE_JPEG_QUALITY, quality);
        try {
            if (!Imgcodecs.imencode(".jpg", img, buf, prm)) throw new IllegalStateException("jpeg encode failed");
            return buf.toArray();
        } finally { buf.release(); prm.release(); }
    }
}
