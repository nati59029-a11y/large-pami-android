package com.largepami.finance;

import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.DMatch;
import org.opencv.core.KeyPoint;
import org.opencv.core.Mat;
import org.opencv.core.MatOfByte;
import org.opencv.core.MatOfDMatch;
import org.opencv.core.MatOfInt;
import org.opencv.core.MatOfKeyPoint;
import org.opencv.core.Rect;
import org.opencv.core.Scalar;
import org.opencv.core.Size;
import org.opencv.core.TermCriteria;
import org.opencv.features2d.DescriptorMatcher;
import org.opencv.features2d.Feature2D;
import org.opencv.features2d.ORB;
import org.opencv.features2d.SIFT;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.CLAHE;
import org.opencv.imgproc.Imgproc;
import org.opencv.photo.MergeMertens;
import org.opencv.photo.Photo;
import org.opencv.video.Video;

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
 * Fixes after the first real capture (16.11, white bedroom, 29 video-grab frames: 2 of 83 pairs matched, output 45% darker):
 * CLAHE + low SIFT contrast threshold; ratio test inside the sensor gate; RANSAC of a pure rotation on bearings (1.5 deg); two passes
 * (re-match with the pass-1 poses, gate 5 deg); smoothness prior between overlapping frames (frames without matches follow their
 * neighbours); log-domain gains (geometric mean 1) + shared radial vignetting; white pixels never darkened; 7 bands.
 * Stability fixes 16.11 (photos of the same room, the fov came out 51.9 / 50.6 / 56.1 from the starts 52 / 60 / 66): pass 1 matching
 * tolerates the whole fov range FOV_LO..FOV_HI (gate + RANSAC at several focals, threshold constant in pixels); the fov is the one at
 * which the matched yaw steps of a row close the 360 degree ring (fixed in the LM, the priors cannot pull it); the LM residual scale
 * no longer depends on the focal; a shared camera offset (same small rotation in every frame vs the sensor) is estimated; pairs that
 * disagree with the rest are dropped; frames moved > 12 degrees on weak evidence are kept near the sensor.
 * Safety guard: run() throws IllegalStateException("native stitch refused: ...") if the optimisation is not applied or fewer than
 * Options.minPairFrac of the pairs overlapping >= 20% have matches (the caller then uses the JS stitching).
 * Parallax (stage 21e, 17.11: the tablet moves between the shots -> wall AC unit doubled, wardrobe in vertical strips, smeared floor):
 *  - smart seams: the DP seam cost = colour difference + EDGE_W x the stronger gradient of the two frames, in a wider band (10 deg),
 *    so the seams run through flat wall / ceiling and around objects (Options.smartSeams);
 *  - local mesh warp: the residual displacement along every overlap is measured by patch matching (ZNCC) on the seam canvas and each
 *    frame gets a smooth displacement field (half the way each, Gaussian radius WARP_SIG_DEG, at most WARP_MAX_DEG, no fold), applied
 *    to the seam canvas and to the final warp (Options.meshWarp);
 *  - ghost removal: where two neighbouring frames still disagree (structure difference after gains), the whole connected region
 *    goes to ONE frame (the one where it lies further from the frame border); the other frames are excluded there at EVERY pyramid
 *    level (weight ramp of LOCK_RAMP_DEG outside), so two copies are never averaged (Options.deghost);
 *  - nadir frame (setFrame(.., role "nadir"): a floor photo taken after stepping aside): not part of the pose optimisation; only its
 *    own rotation is refined against the lower frames (else sensor pose + camera offset); it owns the area below NADIR_LAT (others
 *    excluded there), so feet / tripod / smear disappear.
 * Stage 21f ("highest level", 17.11):
 *  - HDR: setFrame(i, jpg, q, role, g, ev): frames with the same group g are aligned to the ev = 0 bracket (ECC, rotation +
 *    translation) and fused (Mertens, 8 bit) into ONE frame before everything else (fuseGroups); group by group, only the fused
 *    JPEG is kept; at most Options.hdrMaxPx pixels per bracket (~70 bytes per pixel inside MergeMertens: 4.5MP -> ~300MB, estimate);
 *  - seams: graph cut (max-flow, Boykov-Kolmogorov) per pair of neighbouring labels on the seam canvas, same cost terms as the DP
 *    (colour difference + edge term) + a penalty inside regions where the two frames disagree (parallax); DP stays as the fallback
 *    (Options.graphCut = false, time budget Options.seamMs, very large bands);
 *  - W = 8192: the blend runs in horizontal strips when the whole-canvas blend would exceed Options.memBudgetMB (blendStrips: low
 *    bands on the whole canvas at 1/8 resolution, high bands strip by strip). The per-frame pyramid is built one level at a time,
 *    push-pull and hole filling no longer make whole-canvas float copies.
 * Frames are decoded one at a time (memory); progress callback; cancel() -> Cancelled.
 * Memory (estimate printed in the log / Stats.memEstMB, not measured on a phone): W=4096 whole canvas ~330MB (accumulator pyramids
 * 180MB + one frame's working set); W=8192 in 6 strips ~575MB. Desktop peak RSS growth during run() (glibc, MALLOC_ARENA_MAX=2,
 * incl. ~80MB JVM non-heap) on the real 29-frame capture: 4096 ~400-440MB (before 21f ~620MB), 8192 ~580MB (before 21f ~2.35GB).
 */
public final class PanoStitchCore {

    public interface Progress { void on(double p); }

    /** diagnostics (per frame / per pair numbers); null = silent */
    public interface Log { void d(String s); }

    public static final class Cancelled extends RuntimeException {
        public Cancelled() { super("cancelled"); }
    }

    public static final class Options {
        public int W = 4096;            // output width (rounded to a multiple of 64); height = W/2
        public double fovL = 65;        // first guess of the long-side FOV (degrees)
        public double yawRef = 0;       // yaw (degrees) at u = 0.5 (= yaw of frame 0, as in JS)
        public boolean optimize = true; // false = sensor poses + given fovL only (comparison / fallback)
        public boolean gains = true, seams = true, multiband = true, fill = true;
        public int bands = 7;           // 7 (was 5): wider low-frequency transitions on white ceilings / walls (no blotchy seams)
        public int workMax = 1000;      // long side of the feature images
        public int nFeatures = 1500;
        public int seamW = 1024;        // width of the low resolution equirect used for gains and seams
        public Log log;                 // diagnostics, null = silent
        /** safety guard (16.11): run() throws IllegalStateException("native stitch refused: ...") when the optimisation was not applied
         *  or fewer than minPairFrac of the overlapping pairs have matches - the caller then uses the JS stitching */
        public boolean guard = true;
        public double minPairFrac = .25;
        /** estimate a shared camera offset (the same small rotation in every frame between the camera and the orientation sensor) */
        public boolean camOffset = true;
        /** stage 21e (parallax): seams avoid edges, local mesh warp near the seams, one source for regions that disagree */
        public boolean smartSeams = true, meshWarp = true, deghost = true;
        /** diagnostics: Stats.debugLab / debugLock <- the final labels / exclusive owners on the seam canvas */
        public boolean debugMaps;
        /** stage 21f: seams by graph cut (max-flow on the seam canvas, per pair of neighbouring labels); false = the older DP seams.
         *  seamMs: time budget of the graph cuts - pairs after it (or with more than GC_MAX_NODES pixels in the band) use DP */
        public boolean graphCut = true;
        public long seamMs = 20000;
        /** stage 21f: warp + blend in horizontal strips (bounded memory for W = 8192): 0 = auto (when the whole-canvas blend would
         *  need more than memBudgetMB), 1 = always, -1 = never (whole canvas, as before) */
        public int stripBlend = 0;
        public int memBudgetMB = 600;
        /** stage 21f HDR: exposure fusion works on at most this many pixels per frame (larger brackets are scaled down; memory) */
        public int hdrMaxPx = 4500000;
    }

    public static final class Stats {
        public int frames, pairs, inlierPairs, matches;
        public double rms0Deg, rmsDeg, fovL0, fovL, meanCorrDeg, maxCorrDeg, holesPct;
        public double offsetDeg;        // shared camera offset (Options.camOffset); mean/maxCorrDeg are measured from the sensor pose + this offset
        public int guardPairs, guardHits; // safety guard: pairs with >= 20% overlap / of them with matches
        public double vigA, vigB;       // vignetting V(r) = exp(vigA r^2 + vigB r^4), r = radius / half diagonal (0 = none)
        public boolean optimized;
        public String feat = "";
        public double[][] gains;        // [frame][B,G,R]
        public long ms, msFeat, msMatch, msOpt, msBlend, msSeam;
        /** mesh warp: measured points, median / 90th percentile residual (deg) before and after the warp */
        public int warpPts;
        public double warpMedDeg, warpP90Deg, warpMedAfterDeg, warpP90AfterDeg;
        public int ghostRegions;         // regions given to one frame (ghost removal)
        public int nadirFrames;          // frames with role "nadir"
        public boolean nadirRegistered;  // the (first) nadir frame was registered against the lower frames (else sensor pose)
        public double nadirCorrDeg;      // its rotation change from the sensor pose (+ camera offset)
        public int[] debugLab, debugLock; // Options.debugMaps: seam canvas (seamW x seamW/2) labels / exclusive owners (-1 = none)
        /** stage 21f */
        public int inputFrames, hdrGroups, hdrAligned, hdrAlignFailed; // HDR: groups fused (>= 2 brackets), brackets aligned / kept unaligned
        public long msHdr;
        public int gcPairs, dpPairs, gcNodes;  // seams: pairs cut by graph cut / by DP, largest graph (pixels)
        public int strips;                     // blend strips (0 = whole canvas)
        public double memEstMB;                // estimated native peak of the blend stage (MB)
    }

    public static final class Result {
        public Mat pano;                // 8UC3, BGR, W x W/2
        public double fovL;
        public double[][] quats;        // final camera -> world [w,x,y,z] (output gauge), per frame after the HDR fusion
        public int[] frameIndex;        // input index (setFrame i) of each of those frames (the ev = 0 bracket of a group)
        public Stats stats;
    }

    private static final double D = Math.PI / 180;
    private static final int THUMB = 400;

    /** frames: before run() = the input frames (exposure brackets included); run() replaces them by the fused frames (HDR groups) */
    private int n;
    private final Options o;
    private byte[][] jpeg;
    private double[][] qIn;
    private boolean[] nadir;
    private int[] grp, evIdx, srcIdx; // HDR group (-1 = none) / exposure index (0 = normal) / input index of the output frame
    private volatile boolean cancelled;

    /** n = number of input frames (exposure brackets counted one by one) */
    public PanoStitchCore(int n, Options o) {
        if (n < 1 || n > MAX_FRAMES) throw new IllegalArgumentException("n");
        this.n = n;
        this.o = o == null ? new Options() : o;
        this.jpeg = new byte[n][];
        this.qIn = new double[n][];
        this.nadir = new boolean[n];
        this.grp = new int[n];
        this.evIdx = new int[n];
        java.util.Arrays.fill(grp, -1);
    }

    /** largest n: 3 exposures per target (stage 21f HDR) x ~60 targets + floor frames */
    public static final int MAX_FRAMES = 300;

    public void setFrame(int i, byte[] jpg, double[] q) { setFrame(i, jpg, q, null); }

    /** role: null / "" = a normal frame; "nadir" = floor photo taken after the user stepped aside, pointing at where they stood */
    public void setFrame(int i, byte[] jpg, double[] q, String role) { setFrame(i, jpg, q, role, -1, 0); }

    /** g: HDR group (>= 0: the exposure brackets of one target, fused into ONE frame before everything else; -1 = none);
     *  ev: exposure index inside the group (0 = normal exposure: the fused frame takes its pose q and role; < 0 darker, > 0 brighter) */
    public void setFrame(int i, byte[] jpg, double[] q, String role, int g, int ev) {
        if (role != null && !role.isEmpty() && !"nadir".equals(role)) throw new IllegalArgumentException("frame " + i + ": role " + role);
        if (i < 0 || i >= n) throw new IllegalArgumentException("frame index");
        if (jpg == null || jpg.length < 4) throw new IllegalArgumentException("frame " + i + ": no jpeg");
        if (q == null || q.length != 4) throw new IllegalArgumentException("frame " + i + ": q");
        if (g < -1 || ev < -8 || ev > 8) throw new IllegalArgumentException("frame " + i + ": g / ev");
        double s = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        if (!(s > 1e-9)) throw new IllegalArgumentException("frame " + i + ": q");
        jpeg[i] = jpg;
        qIn[i] = new double[]{q[0] / s, q[1] / s, q[2] / s, q[3] / s};
        nadir[i] = "nadir".equals(role);
        grp[i] = g;
        evIdx[i] = g < 0 ? 0 : ev;
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
        double[] Rs, R, Rg; // sensor, current, pose used to gate the matching
        double[] ka, kb;     // feature positions, normalised: a = (u - w/2)/(L/2), b = -(v - h/2)/(L/2)
        float[] dF;          // SIFT descriptors
        byte[] dB;           // ORB descriptors
        int nk, dLen;
        byte[] th; int tw, thh; // small BGR copy (gains, seams)
        double[] gain = {1, 1, 1};
        // low resolution warp (seam canvas)
        int lx0, ly0, lw, lh; float[] lsc, lr2; byte[] lcol;
        float[] lgr;          // gradient magnitude of the luminance on the seam canvas (smart seams)
        float[] lal;          // weight factor 0..1 on the seam canvas (ghost / nadir exclusion), null = 1
        float[] wE, wN;       // mesh warp field (radians, east / north tangent offset of the sampled direction), WF_W x WF_H grid, null = none
        double wLon, wLat;    // largest shift of the field in longitude / latitude (degrees): footprint margin
        boolean nadir;
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
        final Progress P0 = prog != null ? prog : new Progress() { public void on(double p) { } };
        long t0 = System.currentTimeMillis();
        for (int i = 0; i < n; i++) if (jpeg[i] == null) throw new IllegalStateException("frame " + i + " missing");
        Stats st = new Stats();
        st.inputFrames = n;
        // 0. HDR: the exposure brackets of every group -> ONE fused frame (the rest of the pipeline sees only fused frames)
        boolean groups = false;
        for (int g : grp) if (g >= 0) groups = true;
        final Progress P;
        if (groups) {
            fuseGroups(st, new Progress() { public void on(double p) { P0.on(.1 * p); } });
            P = new Progress() { public void on(double p) { P0.on(.1 + .9 * p); } };
        } else {
            srcIdx = new int[n];
            for (int i = 0; i < n; i++) srcIdx[i] = i;
            P = P0;
        }
        int B = Math.max(1, Math.min(7, o.bands)), A = 1 << B;
        int W = Math.max(4 * A, (int) Math.round(o.W / (2.0 * A)) * 2 * A), H = W / 2;
        pw = new double[n];
        java.util.Arrays.fill(pw, 1);
        off = new double[]{1, 0, 0, 0, 1, 0, 0, 0, 1};
        st.frames = n;
        st.fovL0 = o.fovL;
        Fr[] F = new Fr[n];
        for (int i = 0; i < n; i++) {
            F[i] = new Fr();
            F[i].Rs = qToMat(qIn[i]);
            F[i].R = F[i].Rs.clone();
            F[i].nadir = nadir[i];
            if (nadir[i]) st.nadirFrames++;
        }
        double t = Math.tan(o.fovL * D / 2);

        // 1. decode, small copies, features
        Feature2D feat = null;
        boolean sift = false;
        if (o.optimize && n > 1) {
            // low contrast threshold (default .04): white walls / video-grab frames have very few strong features (real capture 16.11: 14-55 per frame)
            try { feat = SIFT.create(o.nFeatures, 3, SIFT_CONTRAST, 10, 1.6); sift = true; } catch (Throwable e) { feat = null; }
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
                if (feat != null) { detect(feat, sift, img, f); log("frame " + i + ": " + f.w + "x" + f.h + " features " + f.nk); }
            } finally { img.release(); }
            P.on(.25 * (i + 1) / n);
        }
        st.msFeat = System.currentTimeMillis() - t0;

        // 2. pairs + matches
        long tm = System.currentTimeMillis();
        List<Pair> pairs = new ArrayList<>();
        // fov search range: a fixed wide range (the result must not depend on the first guess), widened if the guess lies outside
        double fLo = Math.max(20, Math.min(FOV_LO, o.fovL - 10)), fHi = Math.min(120, Math.max(FOV_HI, o.fovL + 10));
        double fovEst = o.fovL;
        List<int[]> nb = neighbours(F, o.fovL); // all overlapping pairs (by the sensor): smoothness of the corrections
        st.pairs = nb.size();
        long to = 0, msOpt = 0;
        String reason = feat == null ? null : "no pairs";
        List<Pair> pairs1 = null;
        // pass 1: gate by the sensor poses, tolerant to the whole fov range; the fov is estimated from the matches (ring closure);
        // pass 2: re-match with the poses + fov of pass 1 and a narrow gate (more correct matches on repeated / weak texture), then
        // estimate the fov and optimise again from the sensor priors
        for (int pass = 0; pass < 2 && feat != null; pass++) {
            for (Fr f : F) f.Rg = f.R.clone();
            double gate = pass == 0 ? GATE_DEG : GATE2_DEG;
            double[] ts;
            if (pass == 0) {
                int ns = (int) Math.ceil((fHi - fLo) / FOV_STEP) + 1;
                ts = new double[ns];
                for (int k = 0; k < ns; k++) ts[k] = Math.tan((fLo + (fHi - fLo) * k / (ns - 1)) * D / 2);
            } else ts = new double[]{Math.tan(fovEst * D / 2)};
            List<int[]> cl = neighbours(F, pass == 0 ? fHi : fovEst);
            List<Pair> pp = new ArrayList<>();
            for (int k = 0; k < cl.size(); k++) {
                if (k % 8 == 0) chk();
                int[] q = cl.get(k);
                Pair p = matchPair(F, q[0], q[1], ts, sift, gate);
                if (p != null) pp.add(p);
                P.on(.25 + (pass == 0 ? .1 : .05) * (k + 1) / cl.size() + (pass == 0 ? 0 : .1));
            }
            if (pass == 1 && pp.size() < pairs.size()) { log("pass 2: " + pp.size() + " pairs < " + pairs.size() + ", kept pass 1"); break; }
            to = System.currentTimeMillis();
            pairs = pp;
            st.inlierPairs = pairs.size(); st.matches = 0;
            for (Pair p : pairs) st.matches += p.m;
            if (pass == 0) { st.msMatch = System.currentTimeMillis() - tm; st.rms0Deg = rmsDeg(F, pairs, t); }
            // 3. global optimisation (always from the sensor poses); fixed fov when the ring closure gave one
            for (Fr f : F) f.R = f.Rs.clone();
            st.optimized = false; st.rmsDeg = st.rms0Deg; st.maxCorrDeg = 0; st.meanCorrDeg = 0;
            String why = optimiseChecked(F, pairs, nb, st, fLo, fHi, pass == 0 ? Double.NaN : fovEst);
            st.inlierPairs = pairs.size(); st.matches = 0; // without the dropped pairs
            for (Pair p : pairs) st.matches += p.m;
            msOpt += System.currentTimeMillis() - to;
            log("pass " + (pass + 1) + ": gate " + gate + " pairs " + pairs.size() + "/" + cl.size() + " "
                    + (why == null ? "optimised rms " + r1(st.rms0Deg) + " -> " + r3(st.rmsDeg) + " fov " + r1(st.fovL) + " corr " + r1(st.meanCorrDeg) + "/" + r1(st.maxCorrDeg) + " offset " + r1(st.offsetDeg) : "not applied: " + why));
            if (!st.optimized && pass == 1) { // pass 2 worse than pass 1: back to pass 1
                pairs = pairs1;
                for (Fr f : F) f.R = f.Rs.clone();
                optimiseChecked(F, pairs, nb, st, fLo, fHi, fovEst);
                st.inlierPairs = pairs.size(); st.matches = 0;
                for (Pair p : pairs) st.matches += p.m;
                log("pass 2 rejected (" + why + "), kept pass 1");
                break;
            }
            if (!st.optimized) { reason = why; break; }
            reason = null;
            pairs1 = pairs;
            fovEst = st.fovL;
            nb = neighbours(F, fovEst);
        }
        // nadir frame(s): not in the optimisation above; own rotation refined against the lower frames (else sensor pose + offset)
        if (feat != null && st.nadirFrames > 0) {
            for (int k = 0; k < n; k++) if (F[k].nadir) { chk(); refineNadir(F, k, sift, st); }
        }
        if (feat != null) feat.clear();
        for (Fr f : F) { f.dF = null; f.dB = null; f.Rg = null; }
        st.msOpt = msOpt;
        if (feat != null && o.guard) {
            // safety guard: on weak data the result is not better than the JS stitching (which shows its own fallback) -> refuse clearly
            // counted on the pairs that really overlap (>= 20% of the frame by the sensor): corner-to-corner pairs of a sphere capture
            // overlap by a few percent and rarely match even on good data
            java.util.HashSet<Integer> ok = new java.util.HashSet<>();
            for (Pair p : pairs) ok.add(p.i * n + p.j);
            int cand = 0, hit = 0;
            for (int[] q : nb) if (q[2] >= 20) { cand++; if (ok.contains(q[0] * n + q[1])) hit++; }
            st.guardPairs = cand; st.guardHits = hit;
            double frac = cand == 0 ? 0 : hit / (double) cand;
            log("guard: " + hit + "/" + cand + " pairs with >= 20% overlap have matches (" + Math.round(frac * 100) + "%), all pairs " + st.inlierPairs + "/" + nb.size());
            if (reason != null) throw new IllegalStateException("native stitch refused: optimisation not applied (" + reason + "); pairs with matches " + st.inlierPairs + "/" + nb.size());
            if (frac < o.minPairFrac) throw new IllegalStateException("native stitch refused: only " + hit + " of " + cand + " overlapping frame pairs have matches (" + Math.round(frac * 100) + "% < " + Math.round(o.minPairFrac * 100) + "%)");
        }
        if (!st.optimized) st.fovL = o.fovL;
        t = Math.tan(st.fovL * D / 2);
        P.on(.45);
        chk();

        double fovL = st.fovL;

        // 4. low resolution warps -> gains -> mesh warp -> labels -> seams -> ghost removal / nadir ownership
        long tsm = System.currentTimeMillis();
        int Ws = Math.min(W, Math.max(256, o.seamW)), Hs = Ws / 2;
        for (Fr f : F) lowWarp(f, t, Ws, Hs);
        if (o.gains && n > 1) gains(F, Ws, st);
        st.gains = new double[n][];
        for (int i = 0; i < n; i++) st.gains[i] = F[i].gain.clone();
        chk();
        if (o.meshWarp && n > 1 && meshWarp(F, Ws, Hs, st)) {
            for (Fr f : F) if (f.wE != null) { lowWarp(f, t, Ws, Hs); devig(f); }
            double[] after = residuals(F, Ws, Hs, null);
            st.warpMedAfterDeg = after[0]; st.warpP90AfterDeg = after[1];
            log("mesh warp: " + st.warpPts + " points, residual median / p90 " + r3(st.warpMedDeg) + " / " + r3(st.warpP90Deg) + " -> " + r3(st.warpMedAfterDeg) + " / " + r3(st.warpP90AfterDeg) + " deg");
        }
        P.on(.47);
        chk();
        if (o.smartSeams || o.deghost) for (Fr f : F) edges(f);
        int[] lab = labels(F, Ws, Hs);
        if (o.seams && n > 1) seams(F, lab, Ws, Hs, st);
        int[] lock = new int[Ws * Hs];
        java.util.Arrays.fill(lock, -1);
        if (st.nadirFrames > 0) lockNadir(F, lab, lock, Ws, Hs);
        if (o.deghost && n > 1) deghost(F, lab, lock, Ws, Hs, st);
        allowed(F, lock, Ws, Hs);
        if (o.debugMaps) { st.debugLab = lab.clone(); st.debugLock = lock; }
        for (Fr f : F) { f.th = null; f.lcol = null; f.lsc = null; f.lr2 = null; f.lgr = null; }
        st.msSeam = System.currentTimeMillis() - tsm;
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
        r.frameIndex = srcIdx.clone();
        return r;
    }

    /** LM + sanity checks; on success sets st.optimized / rmsDeg / fovL / corrections and keeps F[].R, else restores the sensor poses.
     *  Removes the pairs found to be wrong from 'pairs'. fovPrev: fov to use when the ring closure fails (NaN = free fov in the LM).
     *  Returns null or the reason why the result was not applied. */
    private String optimiseChecked(Fr[] F, List<Pair> pairs, List<int[]> nb, Stats st, double fLo, double fHi, double fovPrev) {
        if (!o.optimize) return "off";
        if (pairs.isEmpty()) return "no pairs with matches";
        double[][] R0 = new double[n][];
        for (int i = 0; i < n; i++) R0[i] = F[i].R.clone();
        java.util.Arrays.fill(pw, 1);
        double tNew = 0;
        // robust loop: fov by the ring closure (fixed in the LM, so the priors cannot pull it), LM, then drop the pair that disagrees
        // most with all the others (wrong match on repeated texture, e.g. floor tiles) and repeat. Then frames that moved far from the
        // sensor (+ camera offset) on weak evidence get a strong sensor prior, and the loop runs once more.
        for (int round = 0; round < 2; round++) {
            for (int rep = 0; ; rep++) {
                double fv = closureFov(F, pairs, fLo, fHi);
                if (Double.isNaN(fv)) fv = fovPrev;
                boolean fix = !Double.isNaN(fv);
                for (int i = 0; i < n; i++) F[i].R = R0[i].clone();
                off = new double[]{1, 0, 0, 0, 1, 0, 0, 0, 1};
                tNew = optimise(F, pairs, nb, Math.tan((fix ? fv : o.fovL) * D / 2), fix, null);
                if (rep >= MAX_DROP || pairs.size() < 3) break;
                double[] md = new double[pairs.size()];
                for (int k = 0; k < md.length; k++) md[k] = pairMed(F, pairs.get(k), tNew);
                double[] so = md.clone();
                java.util.Arrays.sort(so);
                double lim = Math.max(PAIR_OUT_DEG, 4 * so[so.length / 2]);
                int w = 0;
                for (int k = 1; k < md.length; k++) if (md[k] > md[w]) w = k;
                if (md[w] <= lim) break;
                Pair p = pairs.remove(w);
                log("pair " + p.i + "-" + p.j + " dropped: median residual " + r1(md[w]) + " deg > " + r1(lim));
            }
            if (round == 1) break;
            int[] sup = new int[n];
            for (Pair p : pairs) { sup[p.i] += p.m; sup[p.j] += p.m; }
            boolean any = false;
            for (int i = 0; i < n; i++) {
                double a = angDeg(F[i].R, mul(F[i].Rs, off));
                if (a > CORR_WEAK && sup[i] < SUPPORT_MIN) { pw[i] = PW_WEAK; any = true; log("frame " + i + ": correction " + r1(a) + " deg on " + sup[i] + " matches -> kept near the sensor"); }
            }
            // and its pairs that contradict the sensor (+ offset) by more than half of that are not trusted
            for (int k = pairs.size() - 1; k >= 0 && any; k--) {
                Pair p = pairs.get(k);
                if (pw[p.i] == 1 && pw[p.j] == 1) continue;
                double[] Rij = pairRot(p, tNew);
                double dev = Rij == null ? 180 : angDeg(Rij, mul(tr(mul(F[p.i].Rs, off)), mul(F[p.j].Rs, off)));
                if (dev > CORR_WEAK / 2) { pairs.remove(k); log("pair " + p.i + "-" + p.j + " dropped: " + r1(dev) + " deg from the sensor at a weak frame"); }
            }
            if (!any) break;
        }
        // keep the yaw of frame 0 = its sensor yaw (u = 0.5 stays yawRef); already (almost) exact by the gauge term in the LM
        double dy = (yawOf(F[0].R) - yawOf(F[0].Rs)) * D;
        double[] Rz = expR(0, 0, dy);
        for (Fr f : F) f.R = mul(Rz, f.R);
        double mx = 0, sum = 0;
        for (Fr f : F) { double a = angDeg(f.R, mul(f.Rs, off)); mx = Math.max(mx, a); sum += a; }
        double fovNew = 2 * Math.atan(tNew) / D, rms = rmsDeg(F, pairs, tNew);
        if (o.log != null) {
            StringBuilder sb = new StringBuilder("corrections (deg, world x,y,z):");
            for (int i = 0; i < n; i++) { double[] e = logR(mul(F[i].R, tr(mul(F[i].Rs, off)))); sb.append(" " + i + ":" + r1(e[0] / D) + "," + r1(e[1] / D) + "," + r1(e[2] / D)); }
            log(sb.toString());
        }
        String why = null;
        if (Double.isNaN(fovNew) || Double.isNaN(rms)) why = "NaN";
        else if (mx > 25) why = "correction " + r1(mx) + " deg > 25";
        else if (angDeg(off, new double[]{1, 0, 0, 0, 1, 0, 0, 0, 1}) > 20) why = "camera offset " + r1(angDeg(off, new double[]{1, 0, 0, 0, 1, 0, 0, 0, 1})) + " deg > 20";
        else if (fovNew < fLo + .5 || fovNew > fHi - .5) why = "fov " + r1(fovNew) + " at the edge of " + r1(fLo) + ".." + r1(fHi);
        else if (!(rms < 1.5)) why = "rms " + r1(rms) + " deg >= 1.5";
        if (why != null) {
            for (int i = 0; i < n; i++) F[i].R = R0[i]; // diverged: back to the sensor poses
            return why;
        }
        st.optimized = true; st.rmsDeg = rms; st.maxCorrDeg = mx; st.meanCorrDeg = sum / n; st.fovL = fovNew; st.offsetDeg = angDeg(off, new double[]{1, 0, 0, 0, 1, 0, 0, 0, 1});
        return null;
    }

    /** fov (degrees) at which the yaw steps between neighbours of a row add up to 360 (the matched pairs give the steps as a function of
     *  the focal, unmatched neighbours keep the sensor step; sensor errors cancel around the ring). Rows: frames grouped by sensor
     *  pitch (|pitch| < 75); the row with the fewest unmatched degrees is used (the horizon on a tie). NaN if no row has >= 180 degrees of matched steps. */
    private double closureFov(Fr[] F, List<Pair> pairs, double fLo, double fHi) {
        java.util.HashMap<Integer, Pair> pm = new java.util.HashMap<>();
        for (Pair p : pairs) pm.put(p.i * n + p.j, p);
        // rows = groups of frames at about the same sensor pitch (sorted by pitch, split at gaps > 10 degrees), zenith / nadir excluded
        final double[] pt = new double[n];
        List<Integer> all = new ArrayList<>();
        for (int i = 0; i < n; i++) { pt[i] = Math.asin(Math.max(-1, Math.min(1, -F[i].Rs[8]))) / D; if (Math.abs(pt[i]) < 75 && !F[i].nadir) all.add(i); }
        java.util.Collections.sort(all, (x, y) -> Double.compare(pt[x], pt[y]));
        List<List<Integer>> rows = new ArrayList<>();
        for (int k = 0; k < all.size(); k++) {
            if (k == 0 || pt[all.get(k)] - pt[all.get(k - 1)] > 10) rows.add(new ArrayList<>());
            rows.get(rows.size() - 1).add(all.get(k));
        }
        // horizon row first (wins ties: least parallax from a near ceiling / floor)
        java.util.Collections.sort(rows, (x, y) -> Double.compare(Math.abs(pt[x.get(x.size() / 2)]), Math.abs(pt[y.get(y.size() / 2)])));
        double res = Double.NaN, bestSens = 1e9;
        for (int r = 0; r < rows.size(); r++) {
            List<Integer> idx = rows.get(r);
            if (idx.size() < 3) continue;
            final double[] yw = new double[n];
            for (int i : idx) yw[i] = yawOf(F[i].Rs);
            java.util.Collections.sort(idx, (x, y) -> Double.compare(yw[x], yw[y]));
            int m = idx.size();
            double sens = 0, matched = 0, maxGap = 0;
            List<Pair> ring = new ArrayList<>();
            List<int[]> dir = new ArrayList<>();
            for (int k = 0; k < m; k++) {
                int a = idx.get(k), b = idx.get((k + 1) % m);
                double step = wrap180(yw[b] - yw[a]);
                if (step < 0) step += 360;
                maxGap = Math.max(maxGap, step);
                Pair p = pm.get(Math.min(a, b) * n + Math.max(a, b));
                if (p == null) { sens += step; continue; }
                matched += step;
                ring.add(p); dir.add(new int[]{a, b});
            }
            if (maxGap > 90 || matched < 180) { log("closure row " + r + ": " + ring.size() + "/" + m + " steps matched (" + Math.round(matched) + " deg) - skipped"); continue; }
            double lo = fLo, hi = fHi, gLo = ringSum(F, ring, dir, lo) + sens - 360, gHi = ringSum(F, ring, dir, hi) + sens - 360;
            if (Double.isNaN(gLo) || Double.isNaN(gHi) || gLo * gHi > 0) { log("closure row " + r + ": no root (" + r1(gLo) + " / " + r1(gHi) + ")"); continue; }
            for (int it = 0; it < 40; it++) {
                double mid = (lo + hi) / 2, g = ringSum(F, ring, dir, mid) + sens - 360;
                if (g * gLo > 0) { lo = mid; gLo = g; } else hi = mid;
            }
            double f = (lo + hi) / 2;
            log("closure row " + r + ": " + ring.size() + "/" + m + " steps matched (" + Math.round(matched) + " deg) -> fov " + r3(f));
            // the row with the least sensor (unmatched) steps wins, the horizon on a tie (least parallax from a near ceiling / floor)
            if (sens < bestSens - 1) { bestSens = sens; res = f; }
        }
        return res;
    }

    /** sum of the yaw steps a -> b of the matched pairs at the given fov (relative rotation by Kabsch on the inlier bearings) */
    private static double ringSum(Fr[] F, List<Pair> ring, List<int[]> dir, double fov) {
        double t = Math.tan(fov * D / 2), sum = 0;
        for (int k = 0; k < ring.size(); k++) {
            Pair p = ring.get(k);
            double[] Rij = pairRot(p, t); // camera j -> camera i
            if (Rij == null) return Double.NaN;
            // yaw step i -> j = minus the vertical component of the world rotation vector Rs_i log(Rij) (yaw is clockwise from above);
            // only the direction of the axis comes from the sensor, so its tilt error hardly matters (rows at +-45 included)
            double[] w = logR(Rij), m = F[p.i].Rs;
            double step = -(m[6] * w[0] + m[7] * w[1] + m[8] * w[2]) / D;
            sum += dir.get(k)[0] == p.i ? step : -step;
        }
        return sum;
    }

    /* ------------------------------------------------------------------ stage 21f: HDR exposure fusion ------------------------------------------------------------------ */

    /** frames with the same group g -> ONE frame: brackets aligned to the ev = 0 one (ECC, rotation + translation: the phone moves a
     *  little between the shots), Mertens exposure fusion, 8 bit, JPEG 95. The fused frame takes the ev = 0 pose and the place of the
     *  group's first frame in the order (frame 0 keeps the yaw anchor). Group by group: only the fused JPEGs are kept */
    private void fuseGroups(Stats st, Progress P) {
        long t0 = System.currentTimeMillis();
        List<List<Integer>> order = new ArrayList<>();
        java.util.HashMap<Integer, List<Integer>> byG = new java.util.HashMap<>();
        for (int i = 0; i < n; i++) {
            if (grp[i] < 0) { List<Integer> one = new ArrayList<>(); one.add(i); order.add(one); continue; }
            List<Integer> L = byG.get(grp[i]);
            if (L == null) { L = new ArrayList<>(); byG.put(grp[i], L); order.add(L); }
            L.add(i);
        }
        int m = order.size();
        byte[][] nj = new byte[m][];
        double[][] nq = new double[m][];
        boolean[] nn = new boolean[m];
        int[] src = new int[m];
        int[] al = new int[2];
        for (int k = 0; k < m; k++) {
            List<Integer> L = order.get(k);
            int ref = L.get(0);
            for (int i : L) if (Math.abs(evIdx[i]) < Math.abs(evIdx[ref])) ref = i;
            nq[k] = qIn[ref];
            src[k] = ref;
            for (int i : L) nn[k] |= nadir[i];
            if (L.size() == 1) { nj[k] = jpeg[ref]; continue; }
            chk();
            List<Mat> imgs = new ArrayList<>();
            int r = 0;
            try {
                for (int i : L) { if (i == ref) r = imgs.size(); imgs.add(decode(i)); }
                al[0] = 0; al[1] = 0;
                Mat f = fuseExposures(imgs, r, o.hdrMaxPx, al);
                try { nj[k] = jpeg(f, 95); } finally { f.release(); }
            } finally { for (Mat x : imgs) x.release(); }
            for (int i : L) jpeg[i] = null; // memory: only the fused JPEG stays
            st.hdrGroups++; st.hdrAligned += al[0]; st.hdrAlignFailed += al[1];
            log("hdr group " + grp[ref] + ": frames " + L + " (ref " + ref + " ev 0) aligned " + al[0] + " not aligned " + al[1]);
            P.on((k + 1) / (double) m);
        }
        n = m; jpeg = nj; qIn = nq; nadir = nn; srcIdx = src;
        grp = new int[m]; evIdx = new int[m];
        java.util.Arrays.fill(grp, -1);
        st.msHdr = System.currentTimeMillis() - t0;
        log("hdr: " + st.inputFrames + " input frames -> " + m + " frames (" + st.hdrGroups + " groups fused) " + st.msHdr + " ms");
    }

    /** Mertens exposure fusion of the brackets imgs (8UC3 BGR) after aligning each to imgs[ref]; on at most maxPx pixels (scaled
     *  down, INTER_AREA). align (optional) += {aligned, kept unaligned}. Returns a new 8UC3 image */
    public static Mat fuseExposures(List<Mat> imgs, int ref, int maxPx, int[] align) {
        Mat R = imgs.get(ref);
        double px = R.cols() * (double) R.rows(), s = maxPx > 0 && px > maxPx ? Math.sqrt(maxPx / px) : 1;
        Size sz = s < 1 ? new Size(Math.max(8, Math.round(R.cols() * s)), Math.max(8, Math.round(R.rows() * s))) : R.size();
        List<Mat> use = new ArrayList<>(), own = new ArrayList<>();
        Mat f = new Mat(), out = new Mat();
        try {
            Mat Rs = R;
            if (s < 1) { Rs = new Mat(); Imgproc.resize(R, Rs, sz, 0, 0, Imgproc.INTER_AREA); own.add(Rs); }
            for (int k = 0; k < imgs.size(); k++) {
                if (k == ref) { use.add(Rs); continue; }
                Mat I = imgs.get(k);
                if (I.cols() != (int) sz.width || I.rows() != (int) sz.height) {
                    Mat t = new Mat();
                    Imgproc.resize(I, t, sz, 0, 0, Imgproc.INTER_AREA);
                    own.add(t);
                    I = t;
                }
                double[] w = alignEcc(Rs, I);
                if (w == null) { if (align != null) align[1]++; use.add(I); continue; }
                if (align != null) align[0]++;
                Mat M = new Mat(2, 3, CvType.CV_64F), a = new Mat();
                M.put(0, 0, w);
                Imgproc.warpAffine(I, a, M, sz, Imgproc.INTER_LINEAR | Imgproc.WARP_INVERSE_MAP, Core.BORDER_REPLICATE);
                M.release();
                own.add(a);
                use.add(a);
            }
            MergeMertens mm = Photo.createMergeMertens();
            mm.process(use, f);
            f.convertTo(out, CvType.CV_8UC3, 255);
            Mat r = out;
            out = null;
            return r;
        } finally {
            for (Mat x : own) x.release();
            f.release();
            if (out != null) out.release();
        }
    }

    /** rotation + translation (ECC, coarse to fine, on grey images with the clipped pixels of the reference masked out) that maps
     *  pixels of ref to img: img(A [x y 1]) ~ ref(x, y). Returns A row-major (2 x 3, pixels of the given images) or null when ECC failed
     *  or the motion is implausible (> HDR_MAX_ROT_DEG, > HDR_MAX_SHIFT of the long side) */
    public static double[] alignEcc(Mat ref, Mat img) {
        int L = Math.max(ref.cols(), ref.rows());
        double sc = Math.min(1, HDR_ALIGN_PX / (double) L);
        Mat g1 = new Mat(), g2 = new Mat(), t = new Mat(), in = new Mat(), mask = new Mat(), warp = Mat.eye(2, 3, CvType.CV_32F);
        try {
            Imgproc.cvtColor(ref, g1, Imgproc.COLOR_BGR2GRAY);
            Imgproc.cvtColor(img, g2, Imgproc.COLOR_BGR2GRAY);
            double cc = 0, prev = 0;
            for (double k : new double[]{.25, 1}) {
                double s = sc * k;
                Size sz = new Size(Math.max(16, Math.round(ref.cols() * s)), Math.max(16, Math.round(ref.rows() * s)));
                Imgproc.resize(g1, t, sz, 0, 0, Imgproc.INTER_AREA);
                Imgproc.resize(g2, in, sz, 0, 0, Imgproc.INTER_AREA);
                Core.inRange(t, new Scalar(8), new Scalar(247), mask);
                if (prev > 0) { // translation to this scale
                    float[] w = new float[6];
                    warp.get(0, 0, w);
                    w[2] *= (float) (s / prev); w[5] *= (float) (s / prev);
                    warp.put(0, 0, w);
                }
                prev = s;
                cc = Video.findTransformECC(t, in, warp, Video.MOTION_EUCLIDEAN, new TermCriteria(TermCriteria.COUNT + TermCriteria.EPS, 80, 1e-5), mask, 3);
            }
            float[] w = new float[6];
            warp.get(0, 0, w);
            double ang = Math.atan2(w[3], w[0]) / D, k = 1 / sc;
            double tx = w[2] * k, ty = w[5] * k;
            // brackets 2 stops apart: the correlation stays low (clipping, noise x4), .3 with a plausible motion is a good alignment
            if (!(cc > HDR_MIN_CC) || Math.abs(ang) > HDR_MAX_ROT_DEG || Math.hypot(tx, ty) > HDR_MAX_SHIFT * L) return null;
            return new double[]{w[0], w[1], tx, w[3], w[4], ty};
        } catch (RuntimeException e) { // ECC did not converge (CvException)
            return null;
        } finally { g1.release(); g2.release(); t.release(); in.release(); mask.release(); warp.release(); }
    }

    private static final int HDR_ALIGN_PX = 800;
    private static final double HDR_MAX_ROT_DEG = 4, HDR_MAX_SHIFT = .08, HDR_MIN_CC = .3;

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
            // local contrast (CLAHE): faint edges / shading on white surfaces become detectable; matching is on descriptors, so the
            // same enhancement on both frames does not bias the geometry
            CLAHE cl = Imgproc.createCLAHE(2.5, new Size(8, 8));
            cl.apply(gray, gray);
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

    /** fraction (0..1) of frame i that falls inside frame j by the sensor poses (grid 12 x 12, the smaller of both directions) */
    private static double overlapFrac(Fr fi, Fr fj, double t) {
        int c = 0;
        double[] d = new double[3], w = new double[3];
        double ma = fj.w / fj.L, mb = fj.h / fj.L;
        for (int y = 0; y < 12; y++) for (int x = 0; x < 12; x++) {
            camDir(((x + .5) / 12 * 2 - 1) * fi.w / fi.L, ((y + .5) / 12 * 2 - 1) * fi.h / fi.L, t, d);
            rot(fi.Rs, d, w);
            double px = fj.Rs[0] * w[0] + fj.Rs[3] * w[1] + fj.Rs[6] * w[2], py = fj.Rs[1] * w[0] + fj.Rs[4] * w[1] + fj.Rs[7] * w[2], pz = fj.Rs[2] * w[0] + fj.Rs[5] * w[1] + fj.Rs[8] * w[2];
            if (pz < -.1 && Math.abs(px / -pz / t) <= ma && Math.abs(py / -pz / t) <= mb) c++;
        }
        return c / 144.0;
    }

    /** frame pairs whose footprints overlap by the sensor poses at the given fov: {i, j, overlap %} */
    private List<int[]> neighbours(Fr[] F, double fov) {
        double t = Math.tan(fov * D / 2);
        List<int[]> nb = new ArrayList<>();
        for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) {
            if (F[i].nadir || F[j].nadir) continue; // the nadir frame is not part of the pose optimisation (refineNadir)
            double c = -F[i].Rs[2] * -F[j].Rs[2] + -F[i].Rs[5] * -F[j].Rs[5] + -F[i].Rs[8] * -F[j].Rs[8];
            if (Math.acos(Math.max(-1, Math.min(1, c))) / D > fov * 0.95) continue;
            double ov = Math.min(overlapFrac(F[i], F[j], t), overlapFrac(F[j], F[i], t));
            if (ov > 0) nb.add(new int[]{i, j, (int) Math.round(ov * 100)});
        }
        return nb;
    }

    /** keypoints of frame i that (by the gating poses) fall inside frame j for any of the focal values ts */
    private static int[] inside(Fr fi, Fr fj, double[] ts) {
        int[] out = new int[fi.nk];
        int c = 0;
        double[] d = new double[3], w = new double[3];
        double ma = fj.w / fj.L * 1.12, mb = fj.h / fj.L * 1.12;
        for (int q = 0; q < fi.nk; q++) {
            for (double t : ts) {
                camDir(fi.ka[q], fi.kb[q], t, d);
                rot(fi.Rg, d, w);
                double x = fj.Rg[0] * w[0] + fj.Rg[3] * w[1] + fj.Rg[6] * w[2], y = fj.Rg[1] * w[0] + fj.Rg[4] * w[1] + fj.Rg[7] * w[2], z = fj.Rg[2] * w[0] + fj.Rg[5] * w[1] + fj.Rg[8] * w[2];
                if (z > -0.2) continue;
                if (Math.abs(x / -z / t) <= ma && Math.abs(y / -z / t) <= mb) { out[c++] = q; break; }
            }
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

    /* Matching (fixed 16.11 after the first real capture: 2 of 83 pairs had inliers). Gate = sensor pose (real error 3-6 degrees per frame,
       so up to ~10 between two frames); the model is a pure rotation fitted on bearings (3 dof, 2-point minimal sample) instead of a
       homography (8 dof, needs many points and was too strict at 3 px) - a white room gives only 10-40 good matches per pair. */
    private static final double T60 = Math.tan(30 * D);
    private static final double PAIR_OUT_DEG = 1.5; // a pair whose median residual after the LM is above max(this, 4 x the median pair) is dropped
    private static final int MAX_DROP = 12;
    // a frame corrected by more than CORR_WEAK degrees with fewer than SUPPORT_MIN matches in its pairs gets PW_WEAK x the sensor prior
    private static final double CORR_WEAK = 12, PW_WEAK = 16;
    private static final int SUPPORT_MIN = 40;
    private static final double FOV_LO = 40, FOV_HI = 85, FOV_STEP = 6; // fov search range (degrees, long side) and the sampling of the pass 1 gate
    private static final double GATE_DEG = 12, GATE2_DEG = 5, RATIO = .85, RANSAC_DEG = 1.5, SIFT_CONTRAST = .015;
    private static final int MAX_PAIR_PTS = 150, MIN_IN = 8, RANSAC_IT = 500, KNN = 6;

    /** ts: focal values (tan(fovL/2)) the gate must tolerate (pass 1: the fov search range; pass 2: the estimated fov). The pixel
     *  correspondences do not depend on the focal; the rotation RANSAC is run for each ts and the largest inlier set is kept. */
    private double ransacDeg = RANSAC_DEG; // refineNadir: looser (the nadir frame is taken from another place: floor parallax)

    private Pair matchPair(Fr[] F, int i, int j, double[] ts, boolean sift, double gateDeg) {
        Fr fi = F[i], fj = F[j];
        if (fi.nk < MIN_IN || fj.nk < MIN_IN) { log("pair " + i + "-" + j + ": few features " + fi.nk + "/" + fj.nk); return null; }
        int[] si = inside(fi, fj, ts), sj = inside(fj, fi, ts);
        if (si.length < MIN_IN || sj.length < MIN_IN) { log("pair " + i + "-" + j + ": few features in overlap " + si.length + "/" + sj.length); return null; }
        Mat qd = descMat(fi, si, sift), td = descMat(fj, sj, sift);
        DescriptorMatcher bf = DescriptorMatcher.create(sift ? DescriptorMatcher.BRUTEFORCE : DescriptorMatcher.BRUTEFORCE_HAMMING);
        List<MatOfDMatch> km = new ArrayList<>();
        try {
            bf.knnMatch(qd, td, km, KNN);
        } finally { qd.release(); td.release(); bf.clear(); }
        double cg = Math.cos(gateDeg * D);
        double[] Rrs = mul(tr(fi.Rg), fj.Rg); // gating pose (sensor, or the first pass): camera j -> camera i
        int nt = ts.length;
        double[] w2 = new double[3], d1 = new double[3];
        double[][][] dj = new double[nt][sj.length][];
        for (int s = 0; s < nt; s++) for (int k = 0; k < sj.length; k++) { double[] v = new double[3]; camDir(fj.ka[sj[k]], fj.kb[sj[k]], ts[s], v); dj[s][k] = v; }
        List<int[]> cand = new ArrayList<>();
        boolean[] usedT = new boolean[sj.length];
        int nRatio = 0;
        // guided ratio test: the ratio is taken between the two best descriptors INSIDE the sensor gate (repeated texture such as
        // floor tiles has many similar descriptors elsewhere in the frame, which made the plain ratio test drop the right match)
        for (MatOfDMatch mm : km) {
            DMatch[] a = mm.toArray();
            mm.release();
            if (a.length < 2) continue;
            int qi = si[a[0].queryIdx];
            int b1 = -1;
            double best1 = 0, best2 = a[a.length - 1].distance;
            for (DMatch dm : a) {
                boolean ok = false;
                for (int s = 0; s < nt && !ok; s++) {
                    camDir(fi.ka[qi], fi.kb[qi], ts[s], d1);
                    rot(Rrs, dj[s][dm.trainIdx], w2);
                    ok = d1[0] * w2[0] + d1[1] * w2[1] + d1[2] * w2[2] >= cg;
                }
                if (!ok) continue;
                if (b1 < 0) { b1 = dm.trainIdx; best1 = dm.distance; } else { best2 = dm.distance; break; }
            }
            if (b1 < 0 || best1 >= RATIO * best2) continue;
            nRatio++;
            if (usedT[b1]) continue;
            usedT[b1] = true;
            cand.add(new int[]{qi, sj[b1]});
        }
        int m = cand.size();
        String head = "pair " + i + "-" + j + ": feat " + si.length + "/" + sj.length + " ratio " + nRatio + " gate " + m;
        if (m < MIN_IN) { log(head + " -> rejected (few)"); return null; }
        // RANSAC of the relative rotation for each focal (seeded: the result is reproducible). The threshold is constant in pixels
        // (RANSAC_DEG at fov 60), otherwise a small focal (compressed bearings) would always win
        boolean[] in = new boolean[m], tmp = new boolean[m], inS = new boolean[m];
        int ni = 0;
        double[] best = null;
        double bestT = ts[0], dev = 1e9;
        for (int s = 0; s < nt; s++) {
            List<double[]> vI = new ArrayList<>(), vJ = new ArrayList<>();
            for (int[] q : cand) {
                double[] v = new double[3]; camDir(fi.ka[q[0]], fi.kb[q[0]], ts[s], v); vI.add(v);
                double[] u = new double[3]; camDir(fj.ka[q[1]], fj.kb[q[1]], ts[s], u); vJ.add(u);
            }
            java.util.Random rnd = new java.util.Random(1000003L * i + j);
            double ct = Math.cos(ransacDeg * D * ts[s] / T60);
            int nS = 0;
            double[] bS = null;
            for (int it = 0; it < RANSAC_IT; it++) {
                int a = rnd.nextInt(m), b = rnd.nextInt(m);
                if (a == b) continue;
                double[] R = triad(vI.get(a), vI.get(b), vJ.get(a), vJ.get(b));
                if (R == null) continue;
                int c = countIn(R, vI, vJ, ct, tmp);
                if (c > nS) { nS = c; bS = R; System.arraycopy(tmp, 0, inS, 0, m); }
            }
            if (bS == null) continue;
            for (int rep = 0; rep < 2; rep++) { // least squares refinement on the inliers
                double[] R = kabsch(vI, vJ, inS);
                if (R == null) break;
                int c = countIn(R, vI, vJ, ct, tmp);
                if (c < nS) break;
                nS = c; bS = R; System.arraycopy(tmp, 0, inS, 0, m);
            }
            double dS = angDeg(bS, Rrs);
            if (nS > ni || (nS == ni && dS < dev)) { ni = nS; best = bS; bestT = ts[s]; dev = dS; System.arraycopy(inS, 0, in, 0, m); }
        }
        if (best == null || ni < MIN_IN) { log(head + " ransac " + ni + " -> rejected"); return null; }
        // deviation from the gating pose: the smallest over the focal range (a wrong focal changes the measured rotation of the pair)
        if (nt > 1) {
            for (int s = 0; s < nt; s++) {
                List<double[]> vI = new ArrayList<>(), vJ = new ArrayList<>();
                for (int[] q : cand) {
                    double[] v = new double[3]; camDir(fi.ka[q[0]], fi.kb[q[0]], ts[s], v); vI.add(v);
                    double[] u = new double[3]; camDir(fj.ka[q[1]], fj.kb[q[1]], ts[s], u); vJ.add(u);
                }
                double[] R = kabsch(vI, vJ, in);
                if (R != null) dev = Math.min(dev, angDeg(R, Rrs));
            }
        }
        if (ni < MIN_IN || ni < .15 * m || dev > gateDeg) { log(head + " ransac " + ni + " dev " + r1(dev) + " -> rejected"); return null; }
        log(head + " ransac " + ni + " dev " + r1(dev) + (nt > 1 ? " fov " + r1(2 * Math.atan(bestT) / D) : "") + " -> ok");
        int keep = Math.min(ni, MAX_PAIR_PTS);
        Pair p = new Pair();
        p.i = i; p.j = j; p.m = keep;
        p.ai = new double[keep]; p.bi = new double[keep]; p.aj = new double[keep]; p.bj = new double[keep];
        double step = ni / (double) keep, next = 0;
        int seen = 0, c = 0;
        for (int k = 0; k < m && c < keep; k++) {
            if (!in[k]) continue;
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

    private void log(String s) { if (o.log != null) o.log.d(s); }

    static String r1(double v) { return String.valueOf(Math.round(v * 10) / 10.0); }

    private static int countIn(double[] R, List<double[]> vI, List<double[]> vJ, double ct, boolean[] in) {
        int c = 0;
        double[] w = new double[3];
        for (int k = 0; k < vI.size(); k++) {
            double[] a = vI.get(k);
            rot(R, vJ.get(k), w);
            in[k] = a[0] * w[0] + a[1] * w[1] + a[2] * w[2] >= ct;
            if (in[k]) c++;
        }
        return c;
    }

    private static double[] cross(double[] a, double[] b) { return new double[]{a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]}; }

    /** rotation R with p1 = R q1 exactly and p2 ~ R q2 (triad); null if the two directions are (almost) parallel or their angles disagree */
    static double[] triad(double[] p1, double[] p2, double[] q1, double[] q2) {
        double[] cp = cross(p1, p2), cq = cross(q1, q2);
        double np = Math.sqrt(cp[0] * cp[0] + cp[1] * cp[1] + cp[2] * cp[2]), nq = Math.sqrt(cq[0] * cq[0] + cq[1] * cq[1] + cq[2] * cq[2]);
        if (np < Math.sin(1.5 * D) || nq < Math.sin(1.5 * D)) return null;
        if (Math.abs(Math.asin(Math.min(1, np)) - Math.asin(Math.min(1, nq))) > 2 * RANSAC_DEG * D) return null;
        for (int k = 0; k < 3; k++) { cp[k] /= np; cq[k] /= nq; }
        double[] tp = cross(p1, cp), tq = cross(q1, cq);
        // R = [p1 cp tp] [q1 cq tq]^T
        double[] R = new double[9];
        for (int r = 0; r < 3; r++) for (int c = 0; c < 3; c++) R[r * 3 + c] = p1[r] * q1[c] + cp[r] * cq[c] + tp[r] * tq[c];
        return R;
    }

    /** least squares rotation R minimising sum |p - R q|^2 over the inliers (Kabsch, SVD) */
    static double[] kabsch(List<double[]> vI, List<double[]> vJ, boolean[] in) {
        double[] M = new double[9];
        for (int k = 0; k < vI.size(); k++) {
            if (!in[k]) continue;
            double[] p = vI.get(k), q = vJ.get(k);
            for (int r = 0; r < 3; r++) for (int c = 0; c < 3; c++) M[r * 3 + c] += p[r] * q[c];
        }
        Mat a = new Mat(3, 3, CvType.CV_64F), w = new Mat(), u = new Mat(), vt = new Mat();
        try {
            a.put(0, 0, M);
            Core.SVDecomp(a, w, u, vt);
            double[] U = new double[9], V = new double[9];
            u.get(0, 0, U); vt.get(0, 0, V);
            double[] R = mul(U, V);
            double det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
            if (det < 0) { for (int c = 0; c < 3; c++) U[c * 3 + 2] = -U[c * 3 + 2]; R = mul(U, V); }
            return R;
        } catch (Throwable e) {
            return null;
        } finally { a.release(); w.release(); u.release(); vt.release(); }
    }

    /** relative rotation (camera j -> camera i) measured by all the matches of a pair at focal t (Kabsch) */
    private static double[] pairRot(Pair p, double t) {
        List<double[]> vI = new ArrayList<>(), vJ = new ArrayList<>();
        for (int q = 0; q < p.m; q++) {
            double[] v = new double[3]; camDir(p.ai[q], p.bi[q], t, v); vI.add(v);
            double[] u = new double[3]; camDir(p.aj[q], p.bj[q], t, u); vJ.add(u);
        }
        boolean[] all = new boolean[p.m];
        java.util.Arrays.fill(all, true);
        return kabsch(vI, vJ, all);
    }

    /** median angle (degrees) between the matched rays of one pair at the current poses */
    private static double pairMed(Fr[] F, Pair p, double t) {
        double[] r = new double[p.m], d = new double[3], v1 = new double[3], v2 = new double[3];
        for (int k = 0; k < p.m; k++) {
            camDir(p.ai[k], p.bi[k], t, d); rot(F[p.i].R, d, v1);
            camDir(p.aj[k], p.bj[k], t, d); rot(F[p.j].R, d, v2);
            double c = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
            r[k] = Math.acos(Math.min(1, c)) / D;
        }
        java.util.Arrays.sort(r);
        return p.m == 0 ? 0 : r[p.m / 2];
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

    private static final double SIG_PX = 1.0, HUBER_PX = 2.0, SIG_PRIOR = 8 * D, SIG_SMOOTH = 3 * D, SIG_LOGT = .15, SIG_OFF = 15 * D;
    /** shared camera offset (camera frame, camera -> sensor camera): R_i ~ Rs_i off. Real capture 16.11 (photos): about 6 degrees, the same
     *  in every frame (camera mounting / photo vs preview); without it every frame needed a 'correction' of 5-10 degrees */
    private double[] off = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    private double[] pw; // per-frame weight of the sensor prior (1, or more for frames with weak matches)

    private double optimise(Fr[] F, List<Pair> pairs, List<int[]> nb, double t0) { return optimise(F, pairs, nb, t0, false, null); }

    /** fixT: the focal stays t0 (1-D fov search); comp (optional, length 3) <- final cost parts {matches, sensor prior, smoothness} */
    private double optimise(Fr[] F, List<Pair> pairs, List<int[]> nb, double t0, boolean fixT, double[] comp) {
        // parameters: 3 per frame (world rotation vector), 3 for the shared camera offset (camera frame), log(t)
        int np = 3 * n + 4, oD = 3 * n;
        double[][] R = new double[n][];
        for (int i = 0; i < n; i++) R[i] = F[i].R.clone();
        double[] Dl = off.clone();
        double lt = Math.log(t0), lt0 = lt;
        double hL = F[0].L / 2;
        double lambda = 1e-3;
        double cost = lmCost(R, Dl, lt, lt0, pairs, nb, F, hL, null);
        double[] Aa = new double[np * np], g = new double[np];
        double[] d1 = new double[3], d2 = new double[3], v1 = new double[3], v2 = new double[3], e1 = new double[3], e2 = new double[3];
        double[][] J = new double[3][7];
        int[] col = new int[7];
        for (int it = 0; it < 60; it++) {
            chk();
            java.util.Arrays.fill(Aa, 0);
            java.util.Arrays.fill(g, 0);
            double t = Math.exp(lt), s = hL / T60 / SIG_PX;
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
            // prior: R_i ~ T_i = Rs_i Dl (sensor pose with the shared camera offset); e_i = log(R_i T_i^T) ~ w_i - T_i d
            double[][] T = new double[n][];
            for (int i = 0; i < n; i++) T[i] = mul(F[i].Rs, Dl);
            for (int i = 0; i < n; i++) {
                double[] e = logR(mul(R[i], tr(T[i])));
                double k = 1 / (SIG_PRIOR * SIG_PRIOR) * pw[i];
                for (int a = 0; a < 3; a++) {
                    Aa[(3 * i + a) * np + 3 * i + a] += k; g[3 * i + a] += k * e[a];
                    for (int b = 0; b < 3; b++) {
                        Aa[(3 * i + a) * np + oD + b] -= k * T[i][a * 3 + b];
                        Aa[(oD + b) * np + 3 * i + a] -= k * T[i][a * 3 + b];
                        Aa[(oD + a) * np + oD + b] += a == b ? k : 0;
                        g[oD + a] -= k * T[i][b * 3 + a] * e[b];
                    }
                }
            }
            // smoothness: overlapping frames get similar world corrections C = R Rs^T (the sensor error drifts slowly), so a frame
            // without matches (white ceiling) follows its matched neighbours instead of staying at its own sensor pose.
            // e = log(Ci Cj^T) ~ ci - cj  =>  J = [I, -I] (Gauss-Newton approximation; the cost itself is exact)
            // with the offset: e ~ (w_i - T_i d) - (w_j - T_j d)  =>  J_d = -(T_i - T_j) = -Mq
            for (int[] q : nb) {
                double[] e = logR(mul(mul(R[q[0]], tr(T[q[0]])), tr(mul(R[q[1]], tr(T[q[1]])))));
                double k = 1 / (SIG_SMOOTH * SIG_SMOOTH);
                double[] Mq = new double[9];
                for (int a = 0; a < 9; a++) Mq[a] = T[q[0]][a] - T[q[1]][a];
                for (int a = 0; a < 3; a++) {
                    int ia = 3 * q[0] + a, ja = 3 * q[1] + a;
                    Aa[ia * np + ia] += k; Aa[ja * np + ja] += k; Aa[ia * np + ja] -= k; Aa[ja * np + ia] -= k;
                    g[ia] += k * e[a]; g[ja] -= k * e[a];
                    for (int b = 0; b < 3; b++) {
                        Aa[ia * np + oD + b] -= k * Mq[a * 3 + b]; Aa[(oD + b) * np + ia] -= k * Mq[a * 3 + b];
                        Aa[ja * np + oD + b] += k * Mq[a * 3 + b]; Aa[(oD + b) * np + ja] += k * Mq[a * 3 + b];
                        double mm = 0;
                        for (int c = 0; c < 3; c++) mm += Mq[c * 3 + a] * Mq[c * 3 + b];
                        Aa[(oD + a) * np + oD + b] += k * mm;
                        g[oD + a] -= k * Mq[b * 3 + a] * e[b];
                    }
                }
            }
            // weak prior on the offset; none when the offset is off (fixed at identity)
            for (int a = 0; a < 3; a++) {
                double[] lo = logR(Dl);
                Aa[(oD + a) * np + oD + a] += o.camOffset ? 1 / (SIG_OFF * SIG_OFF) : 1e12;
                g[oD + a] += o.camOffset ? lo[a] / (SIG_OFF * SIG_OFF) : 0;
            }
            // gauge: frame 0 keeps its sensor yaw inside the optimisation (a rotation about world z = a pure yaw change). Re-anchoring
            // only afterwards rotated the frames without matches away from their matched neighbours (real capture 16.11: 5.6 degrees)
            Aa[2 * np + 2] += 1e8;
            g[2] += 1e8 * wrap180(yawOf(R[0]) - yawOf(F[0].Rs)) * D;
            Aa[(np - 1) * np + np - 1] += fixT ? 1e12 : 1 / (SIG_LOGT * SIG_LOGT);
            g[np - 1] += fixT ? 0 : (lt - lt0) / (SIG_LOGT * SIG_LOGT);
            boolean better = false;
            for (int tries = 0; tries < 8 && !better; tries++) {
                double[] M = Aa.clone(), x = new double[np];
                for (int a = 0; a < np; a++) { M[a * np + a] += lambda * Aa[a * np + a] + 1e-9; x[a] = -g[a]; }
                if (!cholSolve(M, x, np)) { lambda *= 10; continue; }
                double[][] R2 = new double[n][];
                for (int i = 0; i < n; i++) R2[i] = mul(expR(x[3 * i], x[3 * i + 1], x[3 * i + 2]), R[i]);
                double[] D2 = mul(Dl, expR(x[oD], x[oD + 1], x[oD + 2]));
                double lt2 = fixT ? lt : lt + x[np - 1];
                double c2 = lmCost(R2, D2, lt2, lt0, pairs, nb, F, hL, null);
                if (c2 < cost) {
                    double rel = (cost - c2) / Math.max(1e-12, cost);
                    R = R2; Dl = D2; lt = lt2; cost = c2; lambda = Math.max(1e-7, lambda / 3); better = true;
                    if (rel < 1e-7) { it = 1000; }
                } else lambda *= 4;
            }
            if (!better) break;
        }
        for (int i = 0; i < n; i++) F[i].R = R[i];
        off = Dl;
        if (comp != null) lmCost(R, Dl, lt, lt0, pairs, nb, F, hL, comp);
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

    private double lmCost(double[][] R, double[] Dl, double lt, double lt0, List<Pair> pairs, List<int[]> nb, Fr[] F, double hL, double[] comp) {
        double t = Math.exp(lt), s = hL / T60 / SIG_PX, c = 0, c1 = 0;
        double[] d = new double[3], v1 = new double[3], v2 = new double[3];
        for (Pair p : pairs) {
            for (int q = 0; q < p.m; q++) {
                camDir(p.ai[q], p.bi[q], t, d); rot(R[p.i], d, v1);
                camDir(p.aj[q], p.bj[q], t, d); rot(R[p.j], d, v2);
                double x = s * (v1[0] - v2[0]), y = s * (v1[1] - v2[1]), z = s * (v1[2] - v2[2]), rn = Math.sqrt(x * x + y * y + z * z);
                c += rn <= HUBER_PX ? rn * rn : 2 * HUBER_PX * rn - HUBER_PX * HUBER_PX;
            }
        }
        if (comp != null) comp[0] = c1 = c;
        double[][] T = new double[n][];
        for (int i = 0; i < n; i++) T[i] = mul(F[i].Rs, Dl);
        for (int i = 0; i < n; i++) {
            double[] e = logR(mul(R[i], tr(T[i])));
            c += (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) / (SIG_PRIOR * SIG_PRIOR) * pw[i];
        }
        if (comp != null) { comp[1] = c - c1; c1 = c; }
        for (int[] q : nb) {
            double[] e = logR(mul(mul(R[q[0]], tr(T[q[0]])), tr(mul(R[q[1]], tr(T[q[1]])))));
            c += (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) / (SIG_SMOOTH * SIG_SMOOTH);
        }
        if (o.camOffset) { double[] lo = logR(Dl); c += (lo[0] * lo[0] + lo[1] * lo[1] + lo[2] * lo[2]) / (SIG_OFF * SIG_OFF); }
        if (comp != null) comp[2] = c - c1;
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
        int[] r = roiOfF(f, t, Ws, Hs);
        f.lx0 = r[0]; f.lw = r[1] - r[0]; f.ly0 = r[2]; f.lh = r[3] - r[2];
        f.lsc = new float[f.lw * f.lh];
        f.lr2 = new float[f.lw * f.lh];
        double hd2 = (f.w * f.w + f.h * f.h) / 4.0;
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
                if (f.wE != null) displace(f, f.lx0 + xx, f.ly0 + yy, Ws, Hs, d);
                double cx = m[0] * d[0] + m[3] * d[1] + m[6] * d[2], cy = m[1] * d[0] + m[4] * d[1] + m[7] * d[2], cz = m[2] * d[0] + m[5] * d[1] + m[8] * d[2];
                if (cz >= -1e-6) continue;
                double u = f.w / 2.0 + fp * cx / -cz, v = f.h / 2.0 - fp * cy / -cz;
                double nx = Math.abs(u - f.w / 2.0) / (f.w / 2.0), ny = Math.abs(v - f.h / 2.0) / (f.h / 2.0);
                if (nx >= 1 || ny >= 1) continue;
                f.lsc[k] = (float) Math.min((1 - nx) * ex, (1 - ny) * ey);
                f.lr2[k] = (float) (((u - f.w / 2.0) * (u - f.w / 2.0) + (v - f.h / 2.0) * (v - f.h / 2.0)) / hd2);
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

    /* Brightness (fixed 16.11: on the first real capture the old linear solve pushed every gain to the 0.5 clamp - the whole pano was
       ~45% darker than the frames). Now in the log domain, which has no bias towards 0:
       1. vignetting V(r) = exp(a r^2 + b r^4) (r = distance from the frame centre / half diagonal), shared by all frames, fitted on the
          overlaps jointly with per-frame luminance gains; only darkening towards the border is corrected (V <= 1, V(1) >= .35);
       2. per-frame per-channel gains on the vignetting-corrected overlaps; normalised so that their geometric mean is 1 per channel
          (the overall brightness / white balance of the inputs is kept);
       3. near-white pixels are never darkened (protect(): a gain < 1 fades out between 225 and 250). */
    private double vigA, vigB;

    double vig(double r2) { return Math.exp(vigA * r2 + vigB * r2 * r2); }

    /** factor k applied to a pixel whose brightest channel is mx: no darkening of (almost) white pixels */
    static double protect(double k, double mx) {
        if (k >= 1 || mx <= 225) return k;
        double s = Math.min(1, (mx - 225) / 25);
        return k * (1 - s) + s;
    }

    /** removes the vignetting (vigA / vigB) from the low-res colours of one frame */
    private void devig(Fr f) {
        if (vigA == 0 && vigB == 0) return;
        for (int k = 0; k < f.lsc.length; k++) {
            if (f.lsc[k] < 0) continue;
            double kk = protect(1 / vig(f.lr2[k]), mx3(f.lcol, k));
            for (int c = 0; c < 3; c++) f.lcol[k * 3 + c] = (byte) Math.min(255, Math.round((f.lcol[k * 3 + c] & 255) * kk));
        }
    }

    private interface OverlapVisitor { void on(int a, int ka, int b, int kb); }

    /** every overlapping low-res sample of every frame pair (a < b), sub-sampled by 2 */
    private void overlaps(Fr[] F, int Ws, OverlapVisitor v) {
        for (int i = 0; i < n; i++) {
            Fr a = F[i];
            for (int j = i + 1; j < n; j++) {
                Fr b = F[j];
                for (int yy = 0; yy < a.lh; yy += 2) {
                    int y = a.ly0 + yy;
                    if (y < b.ly0 || y >= b.ly0 + b.lh) continue;
                    for (int xx = 0; xx < a.lw; xx += 2) {
                        int ka = yy * a.lw + xx;
                        if (a.lsc[ka] < 0) continue;
                        int kb = at(b, (a.lx0 + xx) % Ws, y, Ws);
                        if (kb >= 0) v.on(i, ka, j, kb);
                    }
                }
            }
        }
    }

    private static double lum(byte[] c, int k) { return .114 * (c[k * 3] & 255) + .587 * (c[k * 3 + 1] & 255) + .299 * (c[k * 3 + 2] & 255); }

    private static int mx3(byte[] c, int k) { return Math.max(c[k * 3] & 255, Math.max(c[k * 3 + 1] & 255, c[k * 3 + 2] & 255)); }

    private void gains(final Fr[] F, int Ws, Stats st) {
        // 1. vignetting + luminance gains: unknowns [l_0 .. l_n-1, a, b]; row: l_a - l_b + a (ra2 - rb2) + b (ra4 - rb4) = ln Ia - ln Ib
        final int np = n + 2;
        final double[] M = new double[np * np], g = new double[np];
        final double[] cnt = new double[n];
        final double[] row = new double[np];
        overlaps(F, Ws, new OverlapVisitor() {
            public void on(int a, int ka, int b, int kb) {
                Fr fa = F[a], fb = F[b];
                int ma = mx3(fa.lcol, ka), mb = mx3(fb.lcol, kb);
                if (ma > 245 || mb > 245 || ma < 12 || mb < 12) return; // clipped / too dark
                double d = Math.log(lum(fa.lcol, ka) + .5) - Math.log(lum(fb.lcol, kb) + .5);
                if (Math.abs(d) > .7) return; // misaligned / moving content
                double ra = fa.lr2[ka], rb = fb.lr2[kb];
                java.util.Arrays.fill(row, 0);
                row[a] = 1; row[b] = -1; row[n] = ra - rb; row[n + 1] = ra * ra - rb * rb;
                for (int p = 0; p < np; p++) {
                    if (row[p] == 0) continue;
                    g[p] += row[p] * d;
                    for (int q = 0; q < np; q++) M[p * np + q] += row[p] * row[q];
                }
                cnt[a]++; cnt[b]++;
            }
        });
        double tot = 0;
        for (double c : cnt) tot += c;
        double ridge = Math.max(1, .02 * tot / n);
        for (int i = 0; i < n; i++) M[i * np + i] += ridge;
        M[n * np + n] += 1; M[(n + 1) * np + n + 1] += 1;
        vigA = 0; vigB = 0;
        if (tot > 200 && cholSolve(M, g, np)) {
            vigA = g[n]; vigB = g[n + 1];
            // only darkening towards the border, and not more than to .35
            boolean ok = !Double.isNaN(vigA) && !Double.isNaN(vigB);
            for (int s = 1; s <= 10 && ok; s++) { double r2 = s / 10.0, v = vig(r2); if (v > 1.0001 || v < .35) ok = false; }
            if (!ok) { // retry with r^2 only
                vigB = 0;
                vigA = Math.max(Math.log(.35), Math.min(0, vigA));
            }
        }
        st.vigA = vigA; st.vigB = vigB;
        log("vignetting: a " + r3(vigA) + " b " + r3(vigB) + " V(edge) " + r3(vig(1)) + " samples " + (long) (tot / 2));
        // correct the low-res colours (gains / seams then work on vignetting-free values)
        for (Fr f : F) devig(f);
        // 2. per channel gains (log domain): l_a - l_b = ln Ia - ln Ib, ridge towards 0, then geometric mean 1
        for (int ch = 0; ch < 3; ch++) {
            final int c = ch;
            final double[] A = new double[n * n], b = new double[n];
            overlaps(F, Ws, new OverlapVisitor() {
                public void on(int a, int ka, int bb, int kb) {
                    Fr fa = F[a], fb = F[bb];
                    int ma = mx3(fa.lcol, ka), mb = mx3(fb.lcol, kb);
                    if (ma > 245 || mb > 245 || ma < 12 || mb < 12) return;
                    double d = Math.log((fa.lcol[ka * 3 + c] & 255) + .5) - Math.log((fb.lcol[kb * 3 + c] & 255) + .5);
                    if (Math.abs(d) > .7) return;
                    A[a * n + a] += 1; A[bb * n + bb] += 1; A[a * n + bb] -= 1; A[bb * n + a] -= 1;
                    b[a] += d; b[bb] -= d;
                }
            });
            for (int i = 0; i < n; i++) A[i * n + i] += ridge;
            // the solution x is the log of 1/gain (frame a brighter than b -> l_a > 0 -> gain < 1)
            if (!cholSolve(A, b, n)) continue;
            double mean = 0;
            for (int i = 0; i < n; i++) mean += b[i];
            mean /= n;
            for (int i = 0; i < n; i++) F[i].gain[ch] = Math.exp(-(b[i] - mean));
        }
        // colour: a frame's channel gains stay within +-8% of its luminance gain (a dark, lamp-exposed frame gave B/G/R 1.3/2.0/2.0 = green)
        // a frame with few usable overlap samples (zenith frame around a lamp: 698 vs ~5000) gets a neutral gain (no colour change)
        double[] sc = cnt.clone();
        java.util.Arrays.sort(sc);
        double med = sc[n / 2];
        for (int i = 0; i < n; i++) {
            Fr f = F[i];
            double g0 = Math.cbrt(f.gain[0] * f.gain[1] * f.gain[2]), gl = Math.max(.5, Math.min(2.5, g0));
            boolean few = cnt[i] < .25 * med;
            for (int c = 0; c < 3; c++) f.gain[c] = few ? gl : gl * Math.max(.92, Math.min(1.08, f.gain[c] / g0));
        }
    }

    static String r3(double v) { return String.valueOf(Math.round(v * 1000) / 1000.0); }

    private int[] labels(Fr[] F, int Ws, int Hs) {
        int[] lab = new int[Ws * Hs];
        float[] best = new float[Ws * Hs];
        java.util.Arrays.fill(lab, -1);
        for (int i = 0; i < n; i++) {
            Fr f = F[i];
            for (int yy = 0; yy < f.lh; yy++) for (int xx = 0; xx < f.lw; xx++) {
                float s = f.lsc[yy * f.lw + xx];
                if (s < 0) continue;
                // the nadir frame owns the area below NADIR_LAT that it covers
                if (f.nadir && (.5 - (f.ly0 + yy + .5) / Hs) * 180 < NADIR_LAT) s += 1000;
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

    /** seam cost of one canvas pixel: colour difference (+ smart seams: EDGE_W x the stronger gradient of the two frames, so the seam
     *  avoids crossing edges / objects that are present in either frame) */
    private double seamCost(Fr a, Fr b, int x, int y, int Ws) {
        double c = diff(a, b, x, y, Ws);
        if (!o.smartSeams || a.lgr == null || b.lgr == null) return c;
        int ka = at(a, x, y, Ws), kb = at(b, x, y, Ws);
        if (ka < 0 || kb < 0) return c;
        return c + EDGE_W * Math.max(a.lgr[ka], b.lgr[kb]);
    }

    /** minimal-cost seams: for every pair of neighbouring labels, a graph cut (Options.graphCut) or a DP path inside a band around
     *  the Voronoi border */
    private void seams(Fr[] F, int[] lab, int Ws, int Hs, Stats st) {
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
        int band = Math.max(3, Ws * (o.smartSeams ? SEAM_BAND_DEG : 6) / 360);
        List<Integer> keys = new ArrayList<>(adj.keySet());
        java.util.Collections.sort(keys);
        int[] node = null;
        MaxFlow mf = null;
        if (o.graphCut) {
            node = new int[Ws * Hs];
            java.util.Arrays.fill(node, -1);
            mf = new MaxFlow();
        }
        long tg = System.currentTimeMillis();
        for (int key : keys) {
            if (adj.get(key)[0] < 3) continue;
            chk();
            int a = key / n, b = key % n;
            if (cnt[a] == 0 || cnt[b] == 0) continue;
            if (F[a].nadir || F[b].nadir) continue; // the nadir border stays at NADIR_LAT
            if (o.graphCut && System.currentTimeMillis() - tg < o.seamMs && seamPairGC(F, lab, Ws, Hs, a, b, band, node, mf, st)) { st.gcPairs++; continue; }
            st.dpPairs++;
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
        if (o.graphCut) log("seams: graph cut " + st.gcPairs + " pairs (largest " + st.gcNodes + " px), DP " + st.dpPairs + " pairs, " + (System.currentTimeMillis() - tg) + " ms");
    }

    private static final int GC_MAX_NODES = 300000;
    /** graph cut: extra cost of a pixel inside a region where the two frames disagree (an object seen at two places: parallax) */
    private static final double GC_GHOST_W = 60, GC_GHOST_CLOSE_DEG = 4, GC_GHOST_GROW_DEG = 1;

    /** where frames a and b disagree in structure (as in deghost: difference after gains minus its smooth part > GHOST_T), closed
     *  (~GC_GHOST_CLOSE_DEG: the edges of one object become one region, its flat inside too) and grown by GC_GHOST_GROW_DEG; on the
     *  low-res grid of frame a (index = at(a, ..)), 0 / 255 */
    private byte[] disagreement(Fr fa, Fr fb, int Ws) {
        int w = fa.lw, h = fa.lh;
        float[] df = new float[w * h];
        byte[] both = new byte[w * h];
        for (int yy = 0; yy < h; yy++) for (int xx = 0; xx < w; xx++) {
            int k = yy * w + xx;
            if (fa.lsc[k] < 0) continue;
            int kb = at(fb, (fa.lx0 + xx) % Ws, fa.ly0 + yy, Ws);
            if (kb < 0) continue;
            df[k] = (float) (lumG(fa, k) - lumG(fb, kb));
            both[k] = (byte) 255;
        }
        double sig = Math.max(2, Ws * 3.0 / 360);
        int ck = 2 * Math.max(2, (int) Math.round(Ws * GC_GHOST_CLOSE_DEG / 360 / 2)) + 1, gk = 2 * Math.max(1, (int) Math.round(Ws * GC_GHOST_GROW_DEG / 360)) + 1;
        Mat D1 = new Mat(h, w, CvType.CV_32FC1), DL = new Mat(), Bm = new Mat(h, w, CvType.CV_8UC1), mask = new Mat();
        Mat kc = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, new Size(ck, ck)), kg = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, new Size(gk, gk));
        try {
            D1.put(0, 0, df); Bm.put(0, 0, both);
            Imgproc.GaussianBlur(D1, DL, new Size(0, 0), sig);
            Imgproc.GaussianBlur(D1, D1, new Size(0, 0), 1);
            Core.subtract(D1, DL, D1);
            Core.absdiff(D1, new Scalar(0), D1);
            Imgproc.threshold(D1, D1, GHOST_T, 255, Imgproc.THRESH_BINARY);
            D1.convertTo(mask, CvType.CV_8U);
            Core.bitwise_and(mask, Bm, mask);
            Imgproc.morphologyEx(mask, mask, Imgproc.MORPH_CLOSE, kc);
            Imgproc.dilate(mask, mask, kg);
            byte[] mb = new byte[w * h];
            mask.get(0, 0, mb);
            return mb;
        } finally { D1.release(); DL.release(); Bm.release(); mask.release(); kc.release(); kg.release(); }
    }

    /** graph-cut seam of the neighbouring labels a | b: the pixels of a or b covered by both frames within 'band' (8-connected steps)
     *  of their current border are the nodes; every 4-neighbour edge p-q costs 1 + seamCost(p) + seamCost(q) (colour difference
     *  + smart-seam gradient term: the cut avoids objects / edges, as the DP did); a node next to a fixed pixel of a (b) is tied to the
     *  source (sink) by that same edge cost (a fixed pixel of a that b does not cover costs 300: the cut never leaves b's frame).
     *  Minimum cut (max-flow, Boykov-Kolmogorov) -> source side a, sink side b, unreached pixels keep their label.
     *  Returns false (caller falls back to DP) when the band has more than GC_MAX_NODES pixels */
    private boolean seamPairGC(Fr[] F, int[] lab, int Ws, int Hs, int a, int b, int band, int[] node, MaxFlow mf, Stats st) {
        Fr fa = F[a], fb = F[b];
        int r0 = Math.max(fa.ly0, fb.ly0), r1 = Math.min(fa.ly0 + fa.lh, fb.ly0 + fb.lh);
        if (r1 <= r0) return true;
        int[] pix = new int[1024], dep = new int[1024];
        int cnt = 0;
        boolean ok = true;
        try {
            // 1. seeds: pixels on the a | b border covered by both frames
            for (int y = r0; y < r1 && ok; y++) for (int x = 0; x < Ws; x++) {
                int p = y * Ws + x, lp = lab[p];
                if (lp != a && lp != b) continue;
                int other = lp == a ? b : a;
                int qr = y * Ws + (x + 1) % Ws, qd = y + 1 < Hs ? p + Ws : -1;
                for (int q : new int[]{qr, qd}) {
                    if (q < 0 || lab[q] != other) continue;
                    for (int u : new int[]{p, q}) {
                        if (node[u] >= 0 || at(fa, u % Ws, u / Ws, Ws) < 0 || at(fb, u % Ws, u / Ws, Ws) < 0) continue;
                        if (cnt == pix.length) { pix = java.util.Arrays.copyOf(pix, cnt * 2); dep = java.util.Arrays.copyOf(dep, cnt * 2); }
                        node[u] = cnt; pix[cnt] = u; dep[cnt] = 0; cnt++;
                    }
                }
            }
            if (cnt == 0) return true;
            // 2. band: breadth-first, 8-connected, through pixels of a or b covered by both frames
            for (int k = 0; k < cnt; k++) {
                if (dep[k] >= band) continue;
                int p = pix[k], x = p % Ws, y = p / Ws;
                for (int dy = -1; dy <= 1; dy++) {
                    int yy = y + dy;
                    if (yy < 0 || yy >= Hs) continue;
                    for (int dx = -1; dx <= 1; dx++) {
                        if (dx == 0 && dy == 0) continue;
                        int xx = fm(x + dx, Ws), q = yy * Ws + xx;
                        if (node[q] >= 0 || (lab[q] != a && lab[q] != b) || at(fa, xx, yy, Ws) < 0 || at(fb, xx, yy, Ws) < 0) continue;
                        if (cnt == pix.length) { pix = java.util.Arrays.copyOf(pix, cnt * 2); dep = java.util.Arrays.copyOf(dep, cnt * 2); }
                        node[q] = cnt; pix[cnt] = q; dep[cnt] = dep[k] + 1; cnt++;
                    }
                }
                if (cnt > GC_MAX_NODES) { ok = false; break; }
            }
            if (!ok) { log("seam " + a + "|" + b + ": band " + cnt + "+ px > " + GC_MAX_NODES + " -> DP"); return false; }
            st.gcNodes = Math.max(st.gcNodes, cnt);
            // 3. graph
            double[] c = new double[cnt], src = new double[cnt], snk = new double[cnt];
            byte[] dm = o.smartSeams ? disagreement(fa, fb, Ws) : null;
            for (int k = 0; k < cnt; k++) {
                int x = pix[k] % Ws, y = pix[k] / Ws;
                c[k] = seamCost(fa, fb, x, y, Ws);
                if (dm != null && dm[at(fa, x, y, Ws)] != 0) c[k] += GC_GHOST_W;
            }
            mf.reset(cnt, 4 * cnt);
            for (int k = 0; k < cnt; k++) {
                int p = pix[k], x = p % Ws, y = p / Ws;
                for (int d = 0; d < 4; d++) {
                    int xx = x, yy = y;
                    if (d == 0) xx = (x + 1) % Ws; else if (d == 1) yy = y + 1; else if (d == 2) xx = fm(x - 1, Ws); else yy = y - 1;
                    if (yy < 0 || yy >= Hs) continue;
                    int q = yy * Ws + xx, nq = node[q];
                    if (nq >= 0) {
                        if (d < 2) { double w = 1 + c[k] + c[nq]; mf.addEdge(k, nq, w, w); }
                        continue;
                    }
                    int lq = lab[q];
                    if (lq != a && lq != b) continue;
                    double w = 1 + c[k] + seamCost(fa, fb, xx, yy, Ws);
                    if (lq == a) src[k] += w; else snk[k] += w;
                }
            }
            for (int k = 0; k < cnt; k++) mf.setT(k, src[k], snk[k]);
            mf.maxflow();
            for (int k = 0; k < cnt; k++) {
                int sg = mf.segment(k);
                if (sg == 1) lab[pix[k]] = a; else if (sg == 2) lab[pix[k]] = b;
            }
            return true;
        } finally {
            for (int k = 0; k < cnt; k++) node[pix[k]] = -1;
        }
    }

    /** max-flow / min-cut on a sparse graph (Boykov-Kolmogorov 2004: two search trees, augment, adopt orphans), double capacities.
     *  Nodes 0..N-1; setT(i, source, sink) = terminal capacities; segment(i): 1 = source side, 2 = sink side, 0 = reached by neither */
    static final class MaxFlow {
        private static final int NONE = -1, TERMINAL = -2, ORPHAN = -3;
        private static final double EPS = 1e-9;
        private int N, nA;
        private int[] first = new int[0], parent, ts, dist, act, orph, head = new int[0], next;
        private byte[] tree, inAct;
        private double[] tr, rc;
        private int aHead, aTail, aSize, oHead, oSize, time;

        void reset(int nodes, int arcs) {
            N = nodes; nA = 0;
            if (first.length < nodes) {
                int c = Math.max(nodes, first.length * 2);
                first = new int[c]; parent = new int[c]; ts = new int[c]; dist = new int[c]; act = new int[c + 1]; orph = new int[c + 1];
                tree = new byte[c]; inAct = new byte[c]; tr = new double[c];
            }
            java.util.Arrays.fill(first, 0, nodes, -1);
            java.util.Arrays.fill(tr, 0, nodes, 0);
            if (head.length < 2 * arcs) { int c = Math.max(2 * arcs, head.length * 2); head = new int[c]; next = new int[c]; rc = new double[c]; }
        }

        void addEdge(int i, int j, double cap, double rev) {
            if (nA + 2 > head.length) {
                int c = head.length * 2 + 2;
                head = java.util.Arrays.copyOf(head, c); next = java.util.Arrays.copyOf(next, c); rc = java.util.Arrays.copyOf(rc, c);
            }
            int a = nA;
            head[a] = j; next[a] = first[i]; first[i] = a; rc[a] = cap;
            head[a + 1] = i; next[a + 1] = first[j]; first[j] = a + 1; rc[a + 1] = rev;
            nA += 2;
        }

        void setT(int i, double source, double sink) { tr[i] = source - sink; }

        int segment(int i) { return parent[i] == NONE ? 0 : tree[i]; }

        private void activate(int i) {
            if (inAct[i] != 0) return;
            inAct[i] = 1;
            act[aTail] = i; aTail = (aTail + 1) % (N + 1); aSize++;
        }

        private void orphan(int i) {
            parent[i] = ORPHAN;
            orph[(oHead + oSize) % (N + 1)] = i; oSize++;
        }

        void maxflow() {
            aHead = 0; aTail = 0; aSize = 0; oHead = 0; oSize = 0; time = 0;
            for (int i = 0; i < N; i++) {
                inAct[i] = 0; ts[i] = 0; dist[i] = 0;
                if (tr[i] > EPS) { tree[i] = 1; parent[i] = TERMINAL; dist[i] = 1; activate(i); }
                else if (tr[i] < -EPS) { tree[i] = 2; parent[i] = TERMINAL; dist[i] = 1; activate(i); }
                else { tree[i] = 0; parent[i] = NONE; }
            }
            int cur = -1;
            while (true) {
                int i = cur;
                cur = -1;
                if (i < 0 || parent[i] == NONE) {
                    i = -1;
                    while (aSize > 0) {
                        int k = act[aHead]; aHead = (aHead + 1) % (N + 1); aSize--; inAct[k] = 0;
                        if (parent[k] != NONE) { i = k; break; }
                    }
                    if (i < 0) break;
                }
                // growth
                int mid = -1;
                boolean S = tree[i] == 1;
                for (int a = first[i]; a != -1; a = next[a]) {
                    if ((S ? rc[a] : rc[a ^ 1]) <= EPS) continue;
                    int j = head[a];
                    if (parent[j] == NONE) {
                        tree[j] = tree[i]; parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1;
                        activate(j);
                    } else if (tree[j] != tree[i]) {
                        mid = S ? a : a ^ 1;
                        break;
                    } else if (ts[j] <= ts[i] && dist[j] > dist[i]) {
                        parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1;
                    }
                }
                time++;
                if (mid < 0) continue;
                cur = i; // may still grow
                augment(mid);
                adopt();
            }
        }

        private void augment(int mid) {
            double d = rc[mid];
            int i;
            for (i = head[mid ^ 1]; parent[i] != TERMINAL; i = head[parent[i]]) d = Math.min(d, rc[parent[i] ^ 1]);
            d = Math.min(d, tr[i]);
            for (i = head[mid]; parent[i] != TERMINAL; i = head[parent[i]]) d = Math.min(d, rc[parent[i]]);
            d = Math.min(d, -tr[i]);
            rc[mid] -= d; rc[mid ^ 1] += d;
            for (i = head[mid ^ 1]; ; ) {
                int a = parent[i];
                if (a == TERMINAL) { tr[i] -= d; if (tr[i] <= EPS) orphan(i); break; }
                rc[a] += d; rc[a ^ 1] -= d;
                if (rc[a ^ 1] <= EPS) orphan(i);
                i = head[a];
            }
            for (i = head[mid]; ; ) {
                int a = parent[i];
                if (a == TERMINAL) { tr[i] += d; if (tr[i] >= -EPS) orphan(i); break; }
                rc[a ^ 1] += d; rc[a] -= d;
                if (rc[a] <= EPS) orphan(i);
                i = head[a];
            }
        }

        private void adopt() {
            while (oSize > 0) {
                int i = orph[oHead]; oHead = (oHead + 1) % (N + 1); oSize--;
                byte t = tree[i];
                boolean S = t == 1;
                int best = -1, dmin = Integer.MAX_VALUE;
                for (int a0 = first[i]; a0 != -1; a0 = next[a0]) {
                    if ((S ? rc[a0 ^ 1] : rc[a0]) <= EPS) continue;
                    int j = head[a0];
                    if (tree[j] != t || parent[j] == NONE) continue;
                    // origin of j: the terminal (valid) or an orphan (invalid)
                    int d = 0, k = j;
                    while (true) {
                        if (ts[k] == time) { d += dist[k]; break; }
                        int a = parent[k];
                        d++;
                        if (a == TERMINAL) { ts[k] = time; dist[k] = 1; break; }
                        if (a == ORPHAN) { d = Integer.MAX_VALUE; break; }
                        k = head[a];
                    }
                    if (d == Integer.MAX_VALUE) continue;
                    if (d < dmin) { best = a0; dmin = d; }
                    for (k = j; ts[k] != time; k = head[parent[k]]) { ts[k] = time; dist[k] = d; d--; }
                }
                if (best >= 0) { parent[i] = best; ts[i] = time; dist[i] = dmin + 1; continue; }
                // no valid parent: i becomes free; its children become orphans, possible parents become active
                for (int a0 = first[i]; a0 != -1; a0 = next[a0]) {
                    int j = head[a0];
                    if (tree[j] != t || parent[j] == NONE) continue;
                    if ((S ? rc[a0 ^ 1] : rc[a0]) > EPS) activate(j);
                    int pj = parent[j];
                    if (pj != TERMINAL && pj != ORPHAN && head[pj] == i) orphan(j);
                }
                tree[i] = 0; parent[i] = NONE;
            }
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
                    if (s - 1 >= 0) { int q = pix(vertical, rev, xc, k, s - 1, nPos, Ws, Hs); c += seamCost(fa, fb, q % Ws, q / Ws, Ws); }
                    if (s < nPos) { int q = pix(vertical, rev, xc, k, s, nPos, Ws, Hs); c += seamCost(fa, fb, q % Ws, q / Ws, Ws); }
                    double bestE = 0;
                    int arg = -1;
                    if (k > s0) {
                        bestE = Double.MAX_VALUE;
                        // smart seams: steps of at most 2 per line (a long jump would be an unpriced seam along the line)
                        int q0 = lo[k - 1], q1 = hi[k - 1];
                        if (o.smartSeams) { q0 = Math.max(q0, s - 2); q1 = Math.min(q1, s + 2); if (q0 > q1) { q0 = lo[k - 1]; q1 = hi[k - 1]; } }
                        for (int s2 = q0; s2 <= q1; s2++) {
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

    /* ------------------------------------------------------------------ stage 21e: parallax (mesh warp, ghosts, nadir) ------------------------------------------------------------------ */

    private static final double NADIR_LAT = -65;      // the nadir frame owns the area below this latitude (degrees) that it covers
    private static final double NADIR_GATE = 12, NADIR_MAX_DEG = 15, NADIR_RES_DEG = 2.5, NADIR_RANSAC_DEG = 4;
    private static final int NADIR_MIN = 12;
    private static final int SEAM_BAND_DEG = 10;       // smart seams: half width of the band around the Voronoi border
    private static final double EDGE_W = 3;            // smart seams: cost of a gradient of 1 grey level per canvas pixel
    private static final int WF_W = 128, WF_H = 64;    // mesh warp field grid (whole sphere, 2.8 degrees per cell)
    private static final double WARP_SIG_DEG = 8, WARP_MAX_DEG = 3, WARP_LAT = 70, WARP_W0 = .25, WARP_ZNCC = .8;
    private static final double GHOST_T = 14;          // ghost: structure difference (grey levels, after gains) between two frames
    private static final double LOCK_RAMP_DEG = 1.5, LOCK_MARGIN_DEG = 1, GHOST_NEAR_DEG = 10, GHOST_CLOSE_DEG = 4, GHOST_CENTRE_DEG = 6;

    /** rotation of nadir frame k refined against the (fixed) lower frames: matches -> world bearings -> robust Kabsch. Kept at the
     *  current pose (sensor + camera offset) when there are too few matches, the residual is large or the change is > NADIR_MAX_DEG
     *  (the user stepped aside: the floor shows parallax, so only a rotation that fits the bulk of the matches is accepted) */
    private void refineNadir(Fr[] F, int k, boolean sift, Stats st) {
        double t = Math.tan((st.optimized ? st.fovL : o.fovL) * D / 2);
        for (Fr f : F) f.Rg = f.R;
        List<double[]> Wd = new ArrayList<>(), Cd = new ArrayList<>();
        int np = 0;
        for (int j = 0; j < n; j++) {
            if (j == k || F[j].nadir || F[j].nk < MIN_IN) continue;
            if (Math.asin(Math.max(-1, Math.min(1, -F[j].R[8]))) / D > -20) continue; // lower frames only
            if (overlapFrac(F[k], F[j], t) < .03 && overlapFrac(F[j], F[k], t) < .03) continue;
            ransacDeg = NADIR_RANSAC_DEG;
            Pair p;
            try { p = matchPair(F, j, k, new double[]{t}, sift, NADIR_GATE); } finally { ransacDeg = RANSAC_DEG; }
            if (p == null) continue;
            np++;
            for (int q = 0; q < p.m; q++) {
                double[] d = new double[3], w = new double[3], c = new double[3];
                camDir(p.ai[q], p.bi[q], t, d); rot(F[j].R, d, w); Wd.add(w);
                camDir(p.aj[q], p.bj[q], t, c); Cd.add(c);
            }
        }
        int m = Wd.size();
        if (m < NADIR_MIN) { log("nadir frame " + k + ": " + m + " matches in " + np + " pairs -> sensor pose"); return; }
        boolean[] in = new boolean[m];
        java.util.Arrays.fill(in, true);
        double[] R = null, res = new double[m], w = new double[3];
        double med = 0;
        int ni = m;
        for (int rep = 0; rep < 4; rep++) {
            R = kabsch(Wd, Cd, in);
            if (R == null) break;
            for (int q = 0; q < m; q++) { rot(R, Cd.get(q), w); double[] a = Wd.get(q); res[q] = Math.acos(Math.min(1, a[0] * w[0] + a[1] * w[1] + a[2] * w[2])) / D; }
            double[] so = res.clone();
            java.util.Arrays.sort(so);
            med = so[m / 2];
            double lim = Math.max(1, 3 * med);
            ni = 0;
            for (int q = 0; q < m; q++) { in[q] = res[q] <= lim; if (in[q]) ni++; }
            if (ni < NADIR_MIN) break;
        }
        if (R == null || ni < NADIR_MIN) { log("nadir frame " + k + ": no consistent rotation -> sensor pose"); return; }
        double mi = 0;
        int c = 0;
        double[] ri = new double[ni];
        for (int q = 0; q < m; q++) if (in[q]) ri[c++] = res[q];
        java.util.Arrays.sort(ri);
        mi = ri[ni / 2];
        double ang = angDeg(R, F[k].R);
        if (ang > NADIR_MAX_DEG || mi > NADIR_RES_DEG) { log("nadir frame " + k + ": rotation change " + r1(ang) + " deg, median residual " + r1(mi) + " -> sensor pose"); return; }
        log("nadir frame " + k + ": registered on " + ni + "/" + m + " matches (" + np + " pairs), change " + r1(ang) + " deg, median residual " + r3(mi) + " deg");
        F[k].R = R;
        if (!st.nadirRegistered) { st.nadirRegistered = true; st.nadirCorrDeg = ang; }
    }

    /** luminance of low-res sample k of f with its gains */
    private static double lumG(Fr f, int k) {
        return .114 * (f.lcol[k * 3] & 255) * f.gain[0] + .587 * (f.lcol[k * 3 + 1] & 255) * f.gain[1] + .299 * (f.lcol[k * 3 + 2] & 255) * f.gain[2];
    }

    /** gradient magnitude of the luminance on the seam canvas (central differences inside the frame, 0 at its border) */
    private static void edges(Fr f) {
        int w = f.lw, h = f.lh;
        float[] L = new float[w * h];
        for (int k = 0; k < w * h; k++) L[k] = f.lsc[k] < 0 ? -1 : (float) lum(f.lcol, k);
        f.lgr = new float[w * h];
        for (int y = 1; y < h - 1; y++) for (int x = 1; x < w - 1; x++) {
            int k = y * w + x;
            if (L[k] < 0 || L[k - 1] < 0 || L[k + 1] < 0 || L[k - w] < 0 || L[k + w] < 0) continue;
            double gx = (L[k + 1] - L[k - 1]) / 2, gy = (L[k + w] - L[k - w]) / 2;
            f.lgr[k] = (float) Math.sqrt(gx * gx + gy * gy);
        }
    }

    private static final class Meas { int a, b; double x, y, dx, dy, w; }

    /** residual displacement of every overlapping pair of normal frames on the seam canvas, by patch matching (ZNCC, coarse-to-fine,
     *  sub-pixel): b(p + (dx,dy)) ~ a(p). out (optional) <- the accepted measurements. Returns {median, p90} of |displacement| (deg) */
    private double[] residuals(Fr[] F, int Ws, int Hs, List<Meas> out) {
        int R = Math.max(3, (int) Math.round(Ws * 2.1 / 360)), S = Math.max(4, (int) Math.round(Ws * 2 * WARP_MAX_DEG / 360)), STEP = Math.max(3, (int) Math.round(Ws * 2.0 / 360));
        int P = 2 * R + 1, Q = 2 * (R + S) + 1, N = P * P;
        float[][] G = new float[n][];
        for (int i = 0; i < n; i++) {
            Fr f = F[i];
            G[i] = new float[f.lw * f.lh];
            for (int k = 0; k < G[i].length; k++) G[i][k] = f.lsc[k] < 0 ? -1 : (float) lumG(f, k);
        }
        double[] pa = new double[N], pb = new double[Q * Q];
        double[] zz = new double[(2 * S + 1) * (2 * S + 1)];
        List<Double> mags = new ArrayList<>();
        for (int a = 0; a < n; a++) {
            Fr fa = F[a];
            if (fa.nadir) continue;
            for (int b = a + 1; b < n; b++) {
                Fr fb = F[b];
                if (fb.nadir) continue;
                if (fb.ly0 >= fa.ly0 + fa.lh || fa.ly0 >= fb.ly0 + fb.lh) continue;
                chk();
                List<Meas> pm = new ArrayList<>();
                for (int yy = R; yy < fa.lh - R; yy += STEP) {
                    int y = fa.ly0 + yy;
                    double lat = (.5 - (y + .5) / Hs) * 180;
                    if (Math.abs(lat) > WARP_LAT || y - R - S < 0 || y + R + S >= Hs) continue;
                    for (int xx = R; xx < fa.lw - R; xx += STEP) {
                        int x = (fa.lx0 + xx) % Ws;
                        if (at(fb, x, y, Ws) < 0) continue;
                        // patch of a
                        double sa = 0, sa2 = 0;
                        boolean ok = true;
                        for (int v = -R; v <= R && ok; v++) for (int u = -R; u <= R; u++) {
                            int k = at(fa, fm(x + u, Ws), y + v, Ws);
                            if (k < 0) { ok = false; break; }
                            double g = G[a][k];
                            pa[(v + R) * P + u + R] = g; sa += g; sa2 += g * g;
                        }
                        if (!ok) continue;
                        double ma = sa / N, va = sa2 / N - ma * ma;
                        if (va < 9) continue; // flat: nothing to measure
                        // window of b
                        int RS = R + S;
                        for (int v = -RS; v <= RS && ok; v++) for (int u = -RS; u <= RS; u++) {
                            int k = at(fb, fm(x + u, Ws), y + v, Ws);
                            if (k < 0) { ok = false; break; }
                            pb[(v + RS) * Q + u + RS] = G[b][k];
                        }
                        if (!ok) continue;
                        for (int k = 0; k < N; k++) pa[k] -= ma;
                        double na = Math.sqrt(va * N);
                        java.util.Arrays.fill(zz, -2);
                        int bx = 0, by = 0;
                        double best = -2;
                        for (int pass = 0; pass < 2; pass++) { // coarse (step 2) then fine around the best
                            int x0 = pass == 0 ? -S : Math.max(-S, bx - 1), x1 = pass == 0 ? S : Math.min(S, bx + 1);
                            int y0 = pass == 0 ? -S : Math.max(-S, by - 1), y1 = pass == 0 ? S : Math.min(S, by + 1), st = pass == 0 ? 2 : 1;
                            for (int sy = y0; sy <= y1; sy += st) for (int sx = x0; sx <= x1; sx += st) {
                                int zi = (sy + S) * (2 * S + 1) + sx + S;
                                if (zz[zi] > -2) continue;
                                double sb = 0, sb2 = 0, sab = 0;
                                for (int v = 0; v < P; v++) {
                                    int ob = (v + S + sy) * Q + S + sx, oa = v * P;
                                    for (int u = 0; u < P; u++) { double g = pb[ob + u]; sb += g; sb2 += g * g; sab += pa[oa + u] * g; }
                                }
                                double vb = sb2 - sb * sb / N;
                                double z = vb < 1e-6 ? 0 : sab / (na * Math.sqrt(vb));
                                zz[zi] = z;
                                if (z > best) { best = z; bx = sx; by = sy; }
                            }
                        }
                        if (best < WARP_ZNCC || Math.abs(bx) >= S || Math.abs(by) >= S) continue;
                        // distinct peak (no aperture problem along an edge): the best value 3+ pixels away must be clearly lower
                        double far = -2;
                        for (int sy = -S; sy <= S; sy++) for (int sx = -S; sx <= S; sx++) {
                            if (Math.max(Math.abs(sx - bx), Math.abs(sy - by)) < 3) continue;
                            double z = zz[(sy + S) * (2 * S + 1) + sx + S];
                            if (z > far) far = z;
                        }
                        if (far > best - .08) continue;
                        // sub-pixel (parabola) where the neighbours were evaluated
                        double fx = 0, fy = 0;
                        double zl = zz[(by + S) * (2 * S + 1) + bx - 1 + S], zr = zz[(by + S) * (2 * S + 1) + bx + 1 + S];
                        double zu = zz[(by - 1 + S) * (2 * S + 1) + bx + S], zd = zz[(by + 1 + S) * (2 * S + 1) + bx + S];
                        if (zl > -2 && zr > -2) { double den = zl - 2 * best + zr; if (den < -1e-9) fx = Math.max(-.5, Math.min(.5, (zl - zr) / (2 * den))); }
                        if (zu > -2 && zd > -2) { double den = zu - 2 * best + zd; if (den < -1e-9) fy = Math.max(-.5, Math.min(.5, (zu - zd) / (2 * den))); }
                        Meas me = new Meas();
                        me.a = a; me.b = b; me.x = x; me.y = y; me.dx = bx + fx; me.dy = by + fy;
                        me.w = Math.min(1, (best - .7) / .3) * Math.min(1, Math.sqrt(va) / 10);
                        pm.add(me);
                    }
                }
                // local consistency inside the pair (a wrong peak on repeated texture disagrees with its neighbours)
                double nr2 = (2.5 * STEP) * (2.5 * STEP);
                for (Meas me : pm) {
                    List<Double> lx = new ArrayList<>(), ly = new ArrayList<>();
                    for (Meas o2 : pm) {
                        if (o2 == me) continue;
                        double ddx = Math.IEEEremainder(o2.x - me.x, Ws), ddy = o2.y - me.y;
                        if (ddx * ddx + ddy * ddy <= nr2) { lx.add(o2.dx); ly.add(o2.dy); }
                    }
                    if (lx.size() >= 3) {
                        java.util.Collections.sort(lx); java.util.Collections.sort(ly);
                        if (Math.abs(me.dx - lx.get(lx.size() / 2)) > 2 || Math.abs(me.dy - ly.get(ly.size() / 2)) > 2) continue;
                    }
                    if (out != null) out.add(me);
                    double cl = Math.cos((.5 - (me.y + .5) / Hs) * Math.PI);
                    mags.add(Math.hypot(me.dx * cl, me.dy) * 360.0 / Ws);
                }
            }
        }
        if (mags.isEmpty()) return new double[]{0, 0};
        java.util.Collections.sort(mags);
        return new double[]{mags.get(mags.size() / 2), mags.get(Math.min(mags.size() - 1, (int) (mags.size() * .9)))};
    }

    /** local mesh warp: every measured displacement is split half / half between the two frames and spread by a Gaussian of radius
     *  WARP_SIG_DEG (decaying to 0 away from the measurements), at most WARP_MAX_DEG, faded out towards the poles. Returns true if
     *  any frame got a field. A field this smooth (gradient ~ max / sigma < 0.4) cannot fold the image. */
    private boolean meshWarp(Fr[] F, int Ws, int Hs, Stats st) {
        List<Meas> M = new ArrayList<>();
        double[] r = residuals(F, Ws, Hs, M);
        st.warpPts = M.size(); st.warpMedDeg = r[0]; st.warpP90Deg = r[1];
        if (M.size() < 3) { log("mesh warp: " + M.size() + " points - off"); return false; }
        List<List<double[]>> C = new ArrayList<>();
        for (int i = 0; i < n; i++) C.add(new ArrayList<>());
        double pr = 2 * Math.PI / Ws;
        for (Meas m : M) {
            double qx = m.x + m.dx / 2, qy = m.y + m.dy / 2;
            double lat = (.5 - (qy + .5) / Hs) * Math.PI;
            double sE = m.dx * pr * Math.cos(lat), sN = -m.dy * pr;
            double[] d = eqDir(qx, qy, Ws, Hs, o.yawRef);
            C.get(m.a).add(new double[]{d[0], d[1], d[2], -sE / 2, -sN / 2, m.w});
            C.get(m.b).add(new double[]{d[0], d[1], d[2], sE / 2, sN / 2, m.w});
        }
        double s2 = 2 * (WARP_SIG_DEG * D) * (WARP_SIG_DEG * D), cut = Math.cos(3 * WARP_SIG_DEG * D), mx = WARP_MAX_DEG * D;
        boolean any = false;
        for (int i = 0; i < n; i++) {
            List<double[]> L = C.get(i);
            if (L.isEmpty()) continue;
            chk();
            float[] fe = new float[WF_W * WF_H], fn = new float[WF_W * WF_H];
            for (int gy = 0; gy < WF_H; gy++) {
                double latd = (.5 - (gy + .5) / WF_H) * 180, fade = Math.max(0, Math.min(1, (WARP_LAT + 2 - Math.abs(latd)) / 10));
                if (fade <= 0) continue;
                for (int gx = 0; gx < WF_W; gx++) {
                    double[] d = eqDir(gx, gy, WF_W, WF_H, o.yawRef);
                    double se = 0, sn = 0, sw = WARP_W0;
                    for (double[] c : L) {
                        double dot = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
                        if (dot < cut) continue;
                        double g = c[5] * Math.exp(-2 * (1 - dot) / s2);
                        se += g * c[3]; sn += g * c[4]; sw += g;
                    }
                    double e = se / sw, nn = sn / sw, mg = Math.hypot(e, nn);
                    if (mg > mx) { e *= mx / mg; nn *= mx / mg; }
                    fe[gy * WF_W + gx] = (float) (e * fade); fn[gy * WF_W + gx] = (float) (nn * fade);
                }
            }
            double ml = 0, mt = 0;
            for (int gy = 0; gy < WF_H; gy++) {
                double cl = Math.cos((.5 - (gy + .5) / WF_H) * Math.PI);
                for (int gx = 0; gx < WF_W; gx++) {
                    int k = gy * WF_W + gx;
                    ml = Math.max(ml, Math.abs(fe[k]) / Math.max(.05, cl)); mt = Math.max(mt, Math.abs(fn[k]));
                }
            }
            F[i].wE = fe; F[i].wN = fn; F[i].wLon = ml / D; F[i].wLat = mt / D;
            any = true;
        }
        return any;
    }

    /** d (unit world direction of canvas pixel (x, y) of a Wc x Hc canvas) <- the direction frame f samples there (mesh warp) */
    private static void displace(Fr f, double x, double y, int Wc, int Hc, double[] d) {
        double gx = (x + .5) / Wc * WF_W - .5, gy = Math.max(0, Math.min(WF_H - 1.001, (y + .5) / Hc * WF_H - .5));
        int ix = (int) Math.floor(gx), iy = (int) Math.floor(gy);
        double ax = gx - ix, ay = gy - iy;
        int x0 = fm(ix, WF_W), x1 = fm(ix + 1, WF_W), y0 = iy, y1 = Math.min(WF_H - 1, iy + 1);
        double e = (f.wE[y0 * WF_W + x0] * (1 - ax) + f.wE[y0 * WF_W + x1] * ax) * (1 - ay) + (f.wE[y1 * WF_W + x0] * (1 - ax) + f.wE[y1 * WF_W + x1] * ax) * ay;
        double nn = (f.wN[y0 * WF_W + x0] * (1 - ax) + f.wN[y0 * WF_W + x1] * ax) * (1 - ay) + (f.wN[y1 * WF_W + x0] * (1 - ax) + f.wN[y1 * WF_W + x1] * ax) * ay;
        if (e == 0 && nn == 0) return;
        double cl = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
        if (cl < 1e-6) return;
        // east = (cos lon, -sin lon, 0), north = (-sin lat sin lon, -sin lat cos lon, cos lat) (tangent offsets e, nn in radians)
        double sl = d[2], sLo = d[0] / cl, cLo = d[1] / cl;
        d[0] += e * cLo - nn * sl * sLo;
        d[1] += -e * sLo - nn * sl * cLo;
        d[2] += nn * cl;
    }

    /** footprint of f on a Wc x Hc canvas, widened when f has a mesh warp field (the field moves the content by up to WARP_MAX_DEG) */
    private int[] roiOfF(Fr f, double t, int Wc, int Hc) {
        int[] r = roiOf(f.R, t, f.w, f.h, Wc, Hc, o.yawRef);
        if (f.wE == null) return r;
        // a canvas pixel at most max|shift| outside the footprint can sample inside the frame
        int mx = (int) Math.ceil(Wc * (Math.min(20, f.wLon) + .5) / 360), my = (int) Math.ceil(Hc * (f.wLat + .5) / 180);
        int y0 = Math.max(0, r[2] - my), y1 = Math.min(Hc, r[3] + my);
        if (r[4] == 1) return new int[]{0, Wc, y0, y1, 1};
        int wd = r[1] - r[0] + 2 * mx;
        if (wd >= Wc - 4) return new int[]{0, Wc, y0, y1, 1};
        int x0 = fm(r[0] - mx, Wc);
        return new int[]{x0, x0 + wd, y0, y1, 0};
    }

    /** the nadir frame owns (exclusively) the part of its label region that lies LOCK_MARGIN_DEG inside its frame */
    private void lockNadir(Fr[] F, int[] lab, int[] lock, int Ws, int Hs) {
        for (int y = 0; y < Hs; y++) for (int x = 0; x < Ws; x++) {
            int p = y * Ws + x, a = lab[p];
            if (a < 0 || !F[a].nadir) continue;
            int k = at(F[a], x, y, Ws);
            if (k >= 0 && F[a].lsc[k] >= LOCK_MARGIN_DEG) lock[p] = a;
        }
    }

    /** ghost removal: for every pair of neighbouring labels, the places where the two frames disagree in structure (difference after
     *  gains minus its smooth part > GHOST_T) near their border are collected on one canvas mask; the mask is closed (~GHOST_CLOSE_DEG,
     *  so the edges / copies of one object become one region) and every region is given whole to ONE frame - the one that covers most
     *  of it, where it lies furthest from the frame border and which is sharpest there - relabelled and locked (the other frames are excluded
     *  there at every pyramid level, see allowed()) */
    private void deghost(Fr[] F, int[] lab, int[] lock, int Ws, int Hs, Stats st) {
        java.util.TreeMap<Integer, int[]> adj = new java.util.TreeMap<>();
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
        int near = Math.max(3, (int) Math.round(Ws * GHOST_NEAR_DEG / 360)), minA = Math.max(6, (int) Math.round(2 * (Ws / 360.0) * (Ws / 360.0)));
        double sig = Math.max(2, Ws * 3.0 / 360);
        byte[] G = new byte[Ws * Hs];
        // 1. disagreement of every neighbouring pair (in the region of frame a) -> canvas mask G
        for (java.util.Map.Entry<Integer, int[]> en : adj.entrySet()) {
            if (en.getValue()[0] < 3) continue;
            int a = en.getKey() / n, b = en.getKey() % n;
            Fr fa = F[a], fb = F[b];
            if (fa.nadir || fb.nadir) continue;
            chk();
            int w = fa.lw, h = fa.lh, nb = 0;
            float[] df = new float[w * h];
            byte[] both = new byte[w * h], la = new byte[w * h], lb = new byte[w * h];
            for (int yy = 0; yy < h; yy++) for (int xx = 0; xx < w; xx++) {
                int k = yy * w + xx;
                if (fa.lsc[k] < 0) continue;
                int x = (fa.lx0 + xx) % Ws, y = fa.ly0 + yy, kb = at(fb, x, y, Ws);
                int L = lab[y * Ws + x];
                la[k] = (byte) (L == a ? 255 : 0); lb[k] = (byte) (L == b ? 255 : 0);
                if (kb < 0) continue;
                df[k] = (float) (lumG(fa, k) - lumG(fb, kb));
                both[k] = (byte) 255; nb++;
            }
            if (nb < minA) continue;
            Mat D1 = new Mat(h, w, CvType.CV_32FC1), DL = new Mat(), Bm = new Mat(h, w, CvType.CV_8UC1), Am = new Mat(h, w, CvType.CV_8UC1), Lb = new Mat(h, w, CvType.CV_8UC1);
            Mat mask = new Mat(), nearM = new Mat(), tmp = new Mat(), k2 = null;
            try {
                D1.put(0, 0, df); Bm.put(0, 0, both); Am.put(0, 0, la); Lb.put(0, 0, lb);
                Imgproc.GaussianBlur(D1, DL, new Size(0, 0), sig);
                Imgproc.GaussianBlur(D1, D1, new Size(0, 0), 1);
                Core.subtract(D1, DL, D1);
                Core.absdiff(D1, new Scalar(0), D1);
                Imgproc.threshold(D1, D1, GHOST_T, 255, Imgproc.THRESH_BINARY);
                D1.convertTo(mask, CvType.CV_8U);
                Core.bitwise_and(mask, Bm, mask);
                k2 = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new Size(2 * near + 1, 2 * near + 1));
                Imgproc.dilate(Am, nearM, k2);
                Imgproc.dilate(Lb, tmp, k2);
                Core.bitwise_and(nearM, tmp, nearM);
                Core.bitwise_and(mask, nearM, mask);
                byte[] mb = new byte[w * h];
                mask.get(0, 0, mb);
                for (int k = 0; k < w * h; k++) if (mb[k] != 0) G[(fa.ly0 + k / w) * Ws + (fa.lx0 + k % w) % Ws] = (byte) 255;
            } finally {
                D1.release(); DL.release(); Bm.release(); Am.release(); Lb.release(); mask.release(); nearM.release(); tmp.release();
                if (k2 != null) k2.release();
            }
        }
        // 2. regions: closing (periodic in x), small dilation, components
        int ck = 2 * Math.max(2, (int) Math.round(Ws * GHOST_CLOSE_DEG / 360 / 2)) + 1, pad = ck + 4;
        Mat g = new Mat(Hs, Ws, CvType.CV_8UC1), gp = new Mat(), ker = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, new Size(ck, ck));
        Mat k5 = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, new Size(5, 5)), cc = new Mat(), stats = new Mat(), cent = new Mat();
        int[] cl = new int[Ws * Hs];
        int nc;
        try {
            g.put(0, 0, G);
            Core.copyMakeBorder(g, gp, 0, 0, pad, pad, Core.BORDER_WRAP);
            Imgproc.morphologyEx(gp, gp, Imgproc.MORPH_CLOSE, ker);
            Imgproc.dilate(gp, gp, k5);
            Mat c = gp.submat(0, Hs, pad, pad + Ws);
            c.copyTo(g);
            c.release();
            nc = Imgproc.connectedComponentsWithStats(g, cc, stats, cent, 8, CvType.CV_32S);
            cc.get(0, 0, cl);
        } finally { g.release(); gp.release(); ker.release(); k5.release(); cc.release(); stats.release(); cent.release(); }
        if (nc <= 1) { st.ghostRegions = 0; log("ghost removal: no regions"); return; }
        // 3. owner per region: the frame with the best (covered fraction)^2 x mean distance from its border; the part it does not
        //    cover goes the same way to the next frame (up to 3 rounds) - one source per part, never an average of two copies
        int regions = 0;
        for (int round = 0; round < 3; round++) {
            int[] area = new int[nc];
            int[][] cov = new int[nc][n];
            double[][] sl = new double[nc][n], sg = new double[nc][n];
            for (int p = 0; p < Ws * Hs; p++) {
                int c = cl[p];
                if (c <= 0 || lock[p] >= 0) continue;
                area[c]++;
                int x = p % Ws, y = p / Ws;
                for (int i = 0; i < n; i++) {
                    if (F[i].nadir) continue;
                    int k = at(F[i], x, y, Ws);
                    if (k < 0) continue;
                    cov[c][i]++; sl[c][i] += F[i].lsc[k]; sg[c][i] += F[i].lgr[k];
                }
            }
            int[] own = new int[nc];
            boolean any = false;
            for (int c = 1; c < nc; c++) {
                own[c] = -1;
                if (area[c] < minA) continue;
                int best = -1;
                double bestS = 0;
                for (int i = 0; i < n; i++) {
                    if (cov[c][i] == 0) continue;
                    // covered fraction^2 x distance from the frame border (saturating at GHOST_CENTRE_DEG) x sharpness (mean gradient:
                    // a blurred copy - motion / focus - loses against a sharp one at the same distance)
                    double fr = cov[c][i] / (double) area[c];
                    double s = fr * fr * Math.min(GHOST_CENTRE_DEG, sl[c][i] / cov[c][i]) * (1 + sg[c][i] / cov[c][i]);
                    if (s > bestS) { bestS = s; best = i; }
                }
                own[c] = best;
                if (best < 0) continue;
                any = true;
                if (round == 0) regions++;
                if (o.log != null && area[c] >= 20 * minA) {
                    StringBuilder sb = new StringBuilder("ghost region " + c + " round " + round + ": area " + area[c] + " owner " + best + " covers:");
                    for (int i = 0; i < n; i++) if (cov[c][i] > 0) sb.append(" " + i + ":" + Math.round(100.0 * cov[c][i] / area[c]) + "%/" + r1(sl[c][i] / cov[c][i]) + "/g" + r1(sg[c][i] / cov[c][i]));
                    log(sb.toString());
                }
            }
            if (!any) break;
            for (int p = 0; p < Ws * Hs; p++) {
                int c = cl[p];
                if (c <= 0 || own[c] < 0 || lock[p] >= 0) continue;
                int k = at(F[own[c]], p % Ws, p / Ws, Ws);
                if (k < 0 || F[own[c]].lsc[k] < LOCK_MARGIN_DEG) continue;
                lock[p] = own[c]; lab[p] = own[c];
            }
        }
        st.ghostRegions = regions;
        log("ghost removal: " + regions + " regions given to one frame");
    }

    /** per frame weight factor on the seam canvas: 0 where another frame owns the pixel exclusively (lock), rising to 1 over
     *  LOCK_RAMP_DEG outside; null when the frame is nowhere excluded */
    private void allowed(Fr[] F, int[] lock, int Ws, int Hs) {
        double rpx = Math.max(1, Ws * LOCK_RAMP_DEG / 360);
        for (int i = 0; i < n; i++) {
            Fr f = F[i];
            f.lal = null;
            byte[] ex = new byte[f.lw * f.lh];
            boolean any = false;
            for (int yy = 0; yy < f.lh; yy++) for (int xx = 0; xx < f.lw; xx++) {
                int k = yy * f.lw + xx, L = lock[(f.ly0 + yy) * Ws + (f.lx0 + xx) % Ws];
                if (f.lsc[k] >= 0 && L >= 0 && L != i) any = true; else ex[k] = (byte) 255;
            }
            if (!any) continue;
            Mat m = new Mat(f.lh, f.lw, CvType.CV_8UC1), dist = new Mat();
            try {
                m.put(0, 0, ex);
                Imgproc.distanceTransform(m, dist, Imgproc.DIST_L2, 3);
                float[] dv = new float[f.lw * f.lh];
                dist.get(0, 0, dv);
                for (int k = 0; k < dv.length; k++) dv[k] = (float) Math.min(1, dv[k] / rpx);
                f.lal = dv;
            } finally { m.release(); dist.release(); }
        }
    }

    /** weight factor of frame f at seam canvas pixel (x, y): 1 outside its low-res region or without exclusions */
    private static float lalAt(Fr f, int x, int y, int Ws) {
        if (f.lal == null) return 1;
        int ly = y - f.ly0;
        if (ly < 0 || ly >= f.lh) return 1;
        int lx = x - f.lx0;
        if (lx < 0) lx += Ws;
        if (lx >= f.lw) return 1;
        return f.lal[ly * f.lw + lx];
    }

    /* ------------------------------------------------------------------ full resolution: warp + multi-band blend ------------------------------------------------------------------ */

    /** warp + multi-band blend: on the whole canvas (as before) or, when that would need more than Options.memBudgetMB (W = 8192),
     *  in horizontal strips (blendStrips) */
    private Mat blend(Fr[] F, int[] lab, double t, int W, int H, int Ws, int Hs, int B, Stats st, Progress P) {
        int A = 1 << B, levels = o.multiband ? B : 0;
        double whole = memWholeMB(F, t, W, H, levels, A);
        if (o.stripBlend == 1 || (o.stripBlend == 0 && whole > o.memBudgetMB)) return blendStrips(F, lab, t, W, H, Ws, Hs, B, whole, st, P);
        st.memEstMB = whole;
        log("blend: whole canvas " + W + "x" + H + ", memory estimate " + Math.round(whole) + " MB");
        Mat[] dst = new Mat[levels + 1], wsum = new Mat[levels + 1];
        Mat out = null, cover8 = null;
        try {
            for (int l = 0; l <= levels; l++) {
                dst[l] = Mat.zeros(H >> l, W >> l, CvType.CV_32FC3);
                wsum[l] = Mat.zeros(H >> l, W >> l, CvType.CV_32FC1);
            }
            for (int i = 0; i < n; i++) {
                chk();
                addFrame(F, i, lab, t, W, H, Ws, Hs, A, levels, levels + 1, 0, H, dst, wsum);
                P.on(.5 + .4 * (i + 1) / n);
            }
            // coverage (level 0) before normalising
            Mat cover = new Mat();
            Imgproc.threshold(wsum[0], cover, 1e-4, 255, Imgproc.THRESH_BINARY);
            cover8 = new Mat();
            cover.convertTo(cover8, CvType.CV_8U);
            cover.release();
            Mat R = normaliseCollapse(dst, wsum, levels);
            out = new Mat();
            R.convertTo(out, CvType.CV_8UC3);
            R.release();
            P.on(.94);
            finish(out, cover8, st);
            Mat r = out;
            out = null;
            return r;
        } finally {
            for (Mat m : dst) if (m != null) m.release();
            for (Mat m : wsum) if (m != null) m.release();
            if (out != null) out.release();
            if (cover8 != null) cover8.release();
        }
    }

    /** holes statistics + fill */
    private void finish(Mat out, Mat cover8, Stats st) {
        int W = out.cols(), H = out.rows();
        int holes = (int) (W * (long) H - Core.countNonZero(cover8));
        st.holesPct = 100.0 * holes / (W * (double) H);
        if (holes > 0 && o.fill) fillHoles(out, cover8);
    }

    /** normalises every level by its weight, extrapolates the top level into uncovered areas (no dark halo when collapsing near holes)
     *  and collapses the pyramid; releases dst / wsum (entries set to null). Returns the float image of level 0 */
    private static Mat normaliseCollapse(Mat[] dst, Mat[] wsum, int levels) {
        for (int l = 0; l <= levels; l++) {
            Mat w3 = new Mat(), wp = new Mat();
            Core.add(wsum[l], new Scalar(1e-6), wp);
            Imgproc.cvtColor(wp, w3, Imgproc.COLOR_GRAY2BGR);
            Core.divide(dst[l], w3, dst[l]);
            w3.release(); wp.release();
        }
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
        return R;
    }

    /* Strip blend (stage 21f, W = 8192 in bounded memory). The multi-band result is split by frequency:
     *  - the low bands (pyramid levels >= STRIP_LC) are blended on the whole canvas at 1/2^STRIP_LC resolution (each frame warped
     *    straight to that resolution: tiny), normalised, top level extrapolated, collapsed -> Rlow;
     *  - the high bands (levels 0 .. STRIP_LC-1) are blended strip by strip (STRIP_MARGIN extra rows above / below, enough for the
     *    support of 3 levels): every frame that touches the strip is warped on (its footprint) x (strip rows), its Laplacian levels are
     *    accumulated, the strip is collapsed on top of Rlow and its central rows written to the 8 bit output.
     * So only one strip of float pyramids (and one frame's working set inside it) exists at a time. The low bands come from the frame
     * warped at low resolution instead of from the pyramid of the full-resolution warp: the same up to the anti-aliasing filter. */
    private static final int STRIP_LC = 3, STRIP_MARGIN = 64, STRIP_PAD = 32;
    /** extra blur (low-res pixels) of the low-band warp: 2^STRIP_LC pyrDown steps blur by ~.57 low-res pixels, the direct warp less
     *  (measured on the synthetic scene: .5 is closest to the whole-canvas result) */
    private static final double STRIP_LOW_SIGMA = .5;
    /** bytes per pixel of one frame's working set in addFrame (float ROI 12 + weight 4 + valid 4 + exclusion 4 + pyrUp / push-pull
     *  temporary 12 + masks / next level ~4) */
    private static final double FRAME_BPP = 40;

    private Mat blendStrips(Fr[] F, int[] lab, double t, int W, int H, int Ws, int Hs, int B, double whole, Stats st, Progress P) {
        int levels = o.multiband ? B : 0;
        boolean low = levels > 0;
        int Lc = low ? Math.min(levels, STRIP_LC) : 0, LB = levels - Lc, M = STRIP_MARGIN, pad = STRIP_PAD;
        int Wl = W >> Lc, Hl = H >> Lc;
        // strip height: the largest multiple of 64 within the memory budget
        int S = Math.max(64, (H / 64) * 64);
        double est = memStripMB(F, t, W, H, low, Lc, LB, S, M, pad);
        while (S > 64 && est > o.memBudgetMB) { S -= 64; est = memStripMB(F, t, W, H, low, Lc, LB, S, M, pad); }
        int ns = (H + S - 1) / S;
        st.strips = ns; st.memEstMB = est;
        log("blend: " + ns + " strips of " + S + " rows (+" + M + " margin) on " + W + "x" + H + ", memory estimate " + Math.round(est)
                + " MB (whole canvas would be " + Math.round(whole) + " MB)");
        Mat Rlow = null, out = null, cover8 = null;
        Mat[] dl = new Mat[LB + 1], wl = new Mat[LB + 1];
        try {
            // 1. low bands on the whole canvas at low resolution
            if (low) {
                for (int l = 0; l <= LB; l++) {
                    dl[l] = Mat.zeros(Hl >> l, Wl >> l, CvType.CV_32FC3);
                    wl[l] = Mat.zeros(Hl >> l, Wl >> l, CvType.CV_32FC1);
                }
                for (int i = 0; i < n; i++) {
                    chk();
                    addFrame(F, i, lab, t, Wl, Hl, Ws, Hs, 1 << LB, LB, LB + 1, 0, Hl, dl, wl, .5 / (1 << Lc));
                    P.on(.5 + .05 * (i + 1) / n);
                }
                Rlow = normaliseCollapse(dl, wl, LB);
            }
            // 2. high bands strip by strip
            out = new Mat(H, W, CvType.CV_8UC3);
            cover8 = new Mat(H, W, CvType.CV_8UC1);
            int nAcc = low ? Lc : 1, k = 0;
            for (int y0 = 0; y0 < H; y0 += S, k++) {
                int y1 = Math.min(H, y0 + S), e0 = Math.max(0, y0 - M), e1 = Math.min(H, y1 + M), eh = e1 - e0;
                Mat[] ds = new Mat[nAcc], ws = new Mat[nAcc];
                Mat R = null;
                try {
                    for (int l = 0; l < nAcc; l++) {
                        ds[l] = Mat.zeros(eh >> l, W >> l, CvType.CV_32FC3);
                        ws[l] = Mat.zeros(eh >> l, W >> l, CvType.CV_32FC1);
                    }
                    for (int i = 0; i < n; i++) {
                        chk();
                        addFrame(F, i, lab, t, W, H, Ws, Hs, pad, Lc, nAcc, e0, e1, ds, ws);
                        P.on(.55 + .35 * (k + (i + 1) / (double) n) / ns);
                    }
                    Mat cv = new Mat(), c8 = new Mat(), wr = ws[0].submat(y0 - e0, y1 - e0, 0, W), cr = cover8.submat(y0, y1, 0, W);
                    Imgproc.threshold(wr, cv, 1e-4, 255, Imgproc.THRESH_BINARY);
                    cv.convertTo(c8, CvType.CV_8U);
                    c8.copyTo(cr);
                    cv.release(); c8.release(); wr.release(); cr.release();
                    for (int l = 0; l < nAcc; l++) {
                        Mat w3 = new Mat(), wp = new Mat();
                        Core.add(ws[l], new Scalar(1e-6), wp);
                        Imgproc.cvtColor(wp, w3, Imgproc.COLOR_GRAY2BGR);
                        Core.divide(ds[l], w3, ds[l]);
                        w3.release(); wp.release(); ws[l].release(); ws[l] = null;
                    }
                    if (low) {
                        // Rlow rows of the strip (+2 rows of context), up to level Lc-1
                        int r0 = e0 >> Lc, r1 = e1 >> Lc, q0 = Math.max(0, r0 - 2), q1 = Math.min(Hl, r1 + 2);
                        Mat sub = Rlow.submat(q0, q1, 0, Wl);
                        Mat up = pyrUpWrap(sub, W >> (Lc - 1), 2 * (q1 - q0));
                        sub.release();
                        R = up.submat(2 * (r0 - q0), 2 * (r0 - q0) + (eh >> (Lc - 1)), 0, W >> (Lc - 1)).clone();
                        up.release();
                        for (int l = Lc - 1; l >= 0; l--) {
                            Core.add(R, ds[l], R);
                            ds[l].release(); ds[l] = null;
                            if (l > 0) { Mat u = pyrUpWrap(R, W >> (l - 1), eh >> (l - 1)); R.release(); R = u; }
                        }
                    } else { R = ds[0]; ds[0] = null; }
                    Mat rr = R.submat(y0 - e0, y1 - e0, 0, W), orow = out.submat(y0, y1, 0, W);
                    rr.convertTo(orow, CvType.CV_8UC3);
                    rr.release(); orow.release();
                } finally {
                    for (Mat m : ds) if (m != null) m.release();
                    for (Mat m : ws) if (m != null) m.release();
                    if (R != null) R.release();
                }
            }
            if (Rlow != null) { Rlow.release(); Rlow = null; }
            P.on(.94);
            finish(out, cover8, st);
            Mat r = out;
            out = null;
            return r;
        } finally {
            for (Mat m : dl) if (m != null) m.release();
            for (Mat m : wl) if (m != null) m.release();
            if (Rlow != null) Rlow.release();
            if (out != null) out.release();
            if (cover8 != null) cover8.release();
        }
    }

    /** largest working area (pixels) of one frame in addFrame on a W x H canvas with alignment / padding A, rows clipped to maxRows */
    private long maxRoiPx(Fr[] F, double t, int W, int H, int A, int maxRows) {
        long mx = 0;
        for (Fr f : F) {
            int[] r = roiOfF(f, t, W, H);
            long w = r[4] == 1 ? W + 2L * A : Math.min(W + 2L * A, r[1] - r[0] + 3L * A), h = Math.min(maxRows, r[3] - r[2] + 3L * A);
            mx = Math.max(mx, w * h);
        }
        return mx;
    }

    /** decoded frame + its pre-downscaled copy (bytes) */
    private static double srcBytes(Fr[] F) {
        double mx = 0;
        for (Fr f : F) mx = Math.max(mx, f.w * (double) f.h * 3 * 2);
        return mx;
    }

    private static double pyr(int levels) { double s = 0; for (int l = 0; l <= levels; l++) s += Math.pow(.25, l); return s; }

    /** memory estimate (MB, native) of the whole-canvas blend: max(accumulators + one frame, collapse) */
    private double memWholeMB(Fr[] F, double t, int W, int H, int levels, int A) {
        double px = W * (double) H;
        double acc = px * 16 * pyr(levels) + maxRoiPx(F, t, W, H, A, H) * FRAME_BPP + srcBytes(F);
        double col = px * (12 + 12 + 3 + 1);
        return Math.max(acc, col) / (1 << 20);
    }

    /** memory estimate (MB, native) of the strip blend with strips of S rows */
    private double memStripMB(Fr[] F, double t, int W, int H, boolean low, int Lc, int LB, int S, int M, int pad) {
        double px = W * (double) H, eh = Math.min(H, S + 2.0 * M);
        double fixed = px * 4;                                              // 8 bit output + coverage
        double lowPass = 0;
        if (low) {
            double pl = px / Math.pow(4, Lc);
            lowPass = pl * 16 * pyr(LB) + maxRoiPx(F, t, W >> Lc, H >> Lc, 1 << LB, H >> Lc) * FRAME_BPP + srcBytes(F);
            fixed += pl * 12;                                               // Rlow
        }
        double accS = W * eh * 16 * (low ? pyr(Lc - 1) : 1);
        double strip = accS + maxRoiPx(F, t, W, H, pad, (int) eh) * FRAME_BPP + srcBytes(F);
        double col = accS + W * eh * 12 * 2;                                // collapse of one strip
        return (fixed + Math.max(lowPass, Math.max(strip, col))) / (1 << 20);
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

    /** warps frame i onto its footprint on a W x H canvas (rows clipped to [ry0, ry1)), builds its Laplacian pyramid (levels) one level
     *  at a time and adds levels 0 .. accLevels-1 (weighted by the Gaussian pyramid of its seam weight) to dst / wsum, whose row 0 is
     *  canvas row ry0. A: alignment of the footprint (multiple of 2^levels; ry0 too) and periodic padding of full-width footprints */
    private void addFrame(Fr[] F, int i, int[] lab, double t, int W, int H, int Ws, int Hs, int A, int levels, int accLevels, int ry0, int ry1,
                          Mat[] dst, Mat[] wsum) { addFrame(F, i, lab, t, W, H, Ws, Hs, A, levels, accLevels, ry0, ry1, dst, wsum, .5); }

    /** c: position of the sample inside its canvas pixel (.5 = centre). The low-band pass of blendStrips uses .5 / 2^STRIP_LC: a
     *  pixel of pyramid level l (OpenCV pyrDown) sits on full-resolution pixel 2^l i, not at the centre of its 2^l block */
    private void addFrame(Fr[] F, int i, int[] lab, double t, int W, int H, int Ws, int Hs, int A, int levels, int accLevels, int ry0, int ry1,
                          Mat[] dst, Mat[] wsum, double c) {
        Fr f = F[i];
        int[] r = roiOfF(f, t, W, H);
        boolean full = r[4] == 1;
        int x0, x1;
        if (full) { x0 = -A; x1 = W + A; }
        else {
            x0 = fd(r[0], A) * A - A; x1 = -fd(-r[1], A) * A + A;
            if (x1 - x0 >= W - A) { full = true; x0 = -A; x1 = W + A; }
        }
        int y0 = Math.max(ry0, fd(r[2], A) * A - A), y1 = Math.min(ry1, -fd(-r[3], A) * A + A);
        int rw = x1 - x0, rh = y1 - y0;
        if (rh <= 0) return;
        Mat img = decode(i);
        Mat src = img;
        Mat roiImg = null, roiW = null, valid = null, roiAl = null, G = null, Wr = null;
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
            roiImg = new Mat(rh, rw, CvType.CV_32FC3);
            roiW = new Mat(rh, rw, CvType.CV_32FC1);
            if (f.lal != null) roiAl = new Mat(rh, rw, CvType.CV_32FC1);
            double[] dv = new double[3];
            valid = new Mat(rh, rw, CvType.CV_32FC1);
            double[] m = f.R;
            double[] sinLo = new double[rw], cosLo = new double[rw];
            for (int xx = 0; xx < rw; xx++) {
                double lon = (((x0 + xx) + c) / W - .5) * 360 + o.yawRef;
                sinLo[xx] = Math.sin(lon * D); cosLo[xx] = Math.cos(lon * D);
            }
            double ratio = Ws / (double) W, hd2 = (sw * (double) sw + sh * (double) sh) / 4.0;
            Mat tmp = new Mat(), mx = new Mat(), my = new Mat();
            try {
                for (int ys = 0; ys < rh; ys += STRIP) {
                    int sh2 = Math.min(STRIP, rh - ys);
                    float[] ax = new float[sh2 * rw], ay = new float[sh2 * rw], vw = new float[sh2 * rw], vv = new float[sh2 * rw], r2 = new float[sh2 * rw];
                    float[] al = roiAl != null ? new float[sh2 * rw] : null;
                    if (al != null) java.util.Arrays.fill(al, 1);
                    for (int yy = 0; yy < sh2; yy++) {
                        int y = y0 + ys + yy;
                        double lat = (.5 - (y + c) / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
                        double ly = (y + c) * ratio - .5;
                        int ly0 = (int) Math.floor(ly);
                        double fy = ly - ly0;
                        int lyA = Math.max(0, Math.min(Hs - 1, ly0)), lyB = Math.max(0, Math.min(Hs - 1, ly0 + 1));
                        for (int xx = 0; xx < rw; xx++) {
                            int k = yy * rw + xx;
                            double d0 = cl * sinLo[xx], d1 = cl * cosLo[xx], d2 = sl;
                            if (f.wE != null) { dv[0] = d0; dv[1] = d1; dv[2] = d2; displace(f, x0 + xx + c - .5, y + c - .5, W, H, dv); d0 = dv[0]; d1 = dv[1]; d2 = dv[2]; }
                            double cx = m[0] * d0 + m[3] * d1 + m[6] * d2, cy = m[1] * d0 + m[4] * d1 + m[7] * d2, cz = m[2] * d0 + m[5] * d1 + m[8] * d2;
                            if (cz >= -1e-6) { ax[k] = -1e4f; ay[k] = -1e4f; continue; }
                            double u = sw / 2.0 + sfp * cx / -cz, v = sh / 2.0 - sfp * cy / -cz;
                            ax[k] = (float) (u - .5); ay[k] = (float) (v - .5);
                            if (u < 1 || v < 1 || u > sw - 1 || v > sh - 1) continue;
                            vv[k] = 1;
                            r2[k] = (float) (((u - sw / 2.0) * (u - sw / 2.0) + (v - sh / 2.0) * (v - sh / 2.0)) / hd2);
                            // seam weight: bilinear indicator of (label == i) on the low-res canvas
                            double lx = ((x0 + xx) + c) * ratio - .5;
                            int lx0 = (int) Math.floor(lx);
                            double fx = lx - lx0;
                            int xa = fm(lx0, Ws), xb = fm(lx0 + 1, Ws);
                            double ind = (lab[lyA * Ws + xa] == i ? (1 - fx) * (1 - fy) : 0) + (lab[lyA * Ws + xb] == i ? fx * (1 - fy) : 0)
                                    + (lab[lyB * Ws + xa] == i ? (1 - fx) * fy : 0) + (lab[lyB * Ws + xb] == i ? fx * fy : 0);
                            float a1 = 1;
                            if (al != null) { // ghost / nadir exclusion (bilinear on the seam canvas)
                                a1 = (float) ((lalAt(f, xa, lyA, Ws) * (1 - fx) + lalAt(f, xb, lyA, Ws) * fx) * (1 - fy) + (lalAt(f, xa, lyB, Ws) * (1 - fx) + lalAt(f, xb, lyB, Ws) * fx) * fy);
                                al[k] = a1;
                            }
                            vw[k] = ind > .5 ? a1 : 0;
                        }
                    }
                    if (full) { // periodic copy: only the central W columns count
                        for (int yy = 0; yy < sh2; yy++) for (int xx = 0; xx < rw; xx++) if (xx < A || xx >= A + W) vw[yy * rw + xx] = 0;
                    }
                    mx.create(sh2, rw, CvType.CV_32FC1); my.create(sh2, rw, CvType.CV_32FC1);
                    mx.put(0, 0, ax); my.put(0, 0, ay);
                    Imgproc.remap(src, tmp, mx, my, Imgproc.INTER_CUBIC, Core.BORDER_REPLICATE, new Scalar(0, 0, 0));
                    // gains + vignetting, per pixel (white pixels are not darkened)
                    byte[] px = new byte[sh2 * rw * 3];
                    tmp.get(0, 0, px);
                    float[] fpx = new float[px.length];
                    for (int k = 0; k < sh2 * rw; k++) {
                        int b0 = px[k * 3] & 255, b1 = px[k * 3 + 1] & 255, b2 = px[k * 3 + 2] & 255, mxv = Math.max(b0, Math.max(b1, b2));
                        double iv = vv[k] > 0 ? 1 / vig(r2[k]) : 1;
                        fpx[k * 3] = (float) (b0 * protect(f.gain[0] * iv, mxv));
                        fpx[k * 3 + 1] = (float) (b1 * protect(f.gain[1] * iv, mxv));
                        fpx[k * 3 + 2] = (float) (b2 * protect(f.gain[2] * iv, mxv));
                    }
                    roiImg.put(ys, 0, fpx);
                    Mat ws = roiW.submat(ys, ys + sh2, 0, rw); ws.put(0, 0, vw); ws.release();
                    Mat vs = valid.submat(ys, ys + sh2, 0, rw); vs.put(0, 0, vv); vs.release();
                    if (al != null) { Mat as = roiAl.submat(ys, ys + sh2, 0, rw); as.put(0, 0, al); as.release(); }
                }
            } finally { tmp.release(); mx.release(); my.release(); }
            src.release();
            src = null;
            // invalid pixels: smooth extrapolation (clean Laplacian near the frame border)
            pushPull(roiImg, valid, false);
            valid.release(); valid = null;
            if (c != .5) { // low-band pass: the blur of 2^STRIP_LC pyrDown steps that the direct low-res warp lacks
                Imgproc.GaussianBlur(roiImg, roiImg, new Size(0, 0), STRIP_LOW_SIGMA, STRIP_LOW_SIGMA, Core.BORDER_REFLECT_101);
            }
            // pyramids, one level at a time (memory): L_l = G_l - up(G_l+1), weight = Gaussian pyramid of the seam weight; excluded areas
            // stay excluded at every level (the pyramid would otherwise spread the weight of the excluded copy back in)
            G = roiImg; roiImg = null;
            Wr = roiW; roiW = null;
            for (int l = 0; l <= levels; l++) {
                Mat Gn = null, Wn = null, Wa = Wr, a = null;
                try {
                    if (l > 0 && roiAl != null) {
                        a = new Mat();
                        Imgproc.resize(roiAl, a, Wr.size(), 0, 0, Imgproc.INTER_AREA);
                        Wa = new Mat();
                        Core.multiply(Wr, a, Wa);
                    }
                    if (l < levels) {
                        Gn = new Mat(); Wn = new Mat();
                        Imgproc.pyrDown(G, Gn);
                        Imgproc.pyrDown(Wr, Wn);
                        Mat up = new Mat();
                        Imgproc.pyrUp(Gn, up, G.size());
                        Core.subtract(G, up, G);
                        up.release();
                    }
                    if (l < accLevels) accumulate(G, Wa, dst[l], wsum[l], x0 >> l, (y0 - ry0) >> l, full, A >> l, W >> l);
                } finally {
                    if (a != null) a.release();
                    if (Wa != Wr) Wa.release();
                    G.release(); Wr.release();
                    G = Gn; Wr = Wn;
                }
            }
        } finally {
            if (src != null) src.release();
            if (img != src) img.release();
            if (roiImg != null) roiImg.release();
            if (roiW != null) roiW.release();
            if (valid != null) valid.release();
            if (roiAl != null) roiAl.release();
            if (G != null) G.release();
            if (Wr != null) Wr.release();
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

    /** fills pixels with mask 0 by push-pull (pyramid) extrapolation; mask = CV_32FC1, 0 / 1 only. wrapX: periodic in x.
     *  Memory (stage 21f): level 0 is not copied (img is zeroed where mask = 0, which is what the premultiplied level 0 was), the
     *  coarser levels are released while going up, and at level 0 only the upsampled image is computed and copied into the holes */
    private static void pushPull(Mat img, Mat mask, boolean wrapX) {
        int total = img.rows() * img.cols();
        int nz = Core.countNonZero(mask);
        if (nz == total || nz == 0) return;
        List<Mat> Is = new ArrayList<>(), Ms = new ArrayList<>();
        Mat inv = new Mat(), inv8 = new Mat(), T = null;
        try {
            Imgproc.threshold(mask, inv, .5, 1, Imgproc.THRESH_BINARY_INV);
            inv.convertTo(inv8, CvType.CV_8U);
            inv.release();
            img.setTo(new Scalar(0, 0, 0), inv8);
            Is.add(img); Ms.add(mask); // level 0: not owned
            while (Is.get(Is.size() - 1).cols() > 4 && Is.get(Is.size() - 1).rows() > 4) {
                Mat a = new Mat(), b = new Mat();
                Imgproc.pyrDown(Is.get(Is.size() - 1), a);
                Imgproc.pyrDown(Ms.get(Ms.size() - 1), b);
                Is.add(a); Ms.add(b);
            }
            int top = Is.size() - 1;
            T = new Mat();
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
                if (l > 0) {
                    // T_l = I_l + (1 - M_l) * up, where M_l is normalised (<= 1) and I_l premultiplied
                    Mat mc = new Mat(), in1 = new Mat(), inv3 = new Mat(), norm = new Mat(), m3b = new Mat();
                    Core.min(Ms.get(l), new Scalar(1), mc);
                    mc.convertTo(in1, -1, -1, 1); // 1 - M
                    Imgproc.cvtColor(in1, inv3, Imgproc.COLOR_GRAY2BGR);
                    // colour where the mask is partial: I/M * M = I (premultiplied) - scaled so that full weight keeps the exact value
                    Mat w3 = new Mat(), wp = new Mat();
                    Core.add(Ms.get(l), new Scalar(1e-6), wp);
                    Imgproc.cvtColor(wp, w3, Imgproc.COLOR_GRAY2BGR);
                    Core.divide(Is.get(l), w3, norm);
                    Imgproc.cvtColor(mc, m3b, Imgproc.COLOR_GRAY2BGR);
                    Core.multiply(norm, m3b, norm);
                    Core.multiply(up, inv3, up);
                    Core.add(norm, up, up);
                    mc.release(); in1.release(); inv3.release(); norm.release(); m3b.release(); w3.release(); wp.release();
                    Is.get(l).release(); Ms.get(l).release(); // not needed any more
                }
                T = up; // level 0 (mask 0 / 1): 0 + 1 * up where the mask is 0
            }
            // keep the original pixels exactly where the mask is 1
            T.copyTo(img, inv8);
        } finally {
            for (int l = 1; l < Is.size(); l++) Is.get(l).release();
            for (int l = 1; l < Ms.size(); l++) Ms.get(l).release();
            inv.release(); inv8.release();
            if (T != null) T.release();
        }
    }

    /** uncovered areas (zenith / nadir): Photo.inpaint at low resolution (periodic in x), upsampled, feathered. Strip by strip
     *  (stage 21f: the old whole-canvas float copies were ~3 x 12 bytes per pixel), strips without holes nearby are skipped */
    private static void fillHoles(Mat pano, Mat cover8) {
        int W = pano.cols(), H = pano.rows(), w = Math.min(512, W), h = w / 2, pad = w / 16;
        Mat small = new Mat(), hs = new Mat(), sp = new Mat(), hp = new Mat(), fl = new Mat(), sm2 = new Mat(), ker = null;
        try {
            Imgproc.resize(pano, small, new Size(w, h), 0, 0, Imgproc.INTER_AREA);
            // hole at low resolution: any uncovered pixel in the area
            Imgproc.resize(cover8, hs, new Size(w, h), 0, 0, Imgproc.INTER_AREA);
            Imgproc.threshold(hs, hs, 254, 255, Imgproc.THRESH_BINARY_INV);
            Core.copyMakeBorder(small, sp, 0, 0, pad, pad, Core.BORDER_WRAP);
            Core.copyMakeBorder(hs, hp, 0, 0, pad, pad, Core.BORDER_WRAP);
            Photo.inpaint(sp, hp, fl, 6, Photo.INPAINT_TELEA);
            Mat flc = fl.submat(0, h, pad, pad + w);
            Imgproc.GaussianBlur(flc, sm2, new Size(0, 0), 2);
            flc.release();
            int r = Math.max(2, W / 512), m = 5 * r + 4, SH = 256;
            ker = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, new Size(2 * r + 1, 2 * r + 1));
            float[] mxs = new float[W];
            for (int x = 0; x < W; x++) mxs[x] = (float) ((x + .5) * w / W - .5);
            for (int y0 = 0; y0 < H; y0 += SH) {
                int y1 = Math.min(H, y0 + SH), e0 = Math.max(0, y0 - m), e1 = Math.min(H, y1 + m), sh = y1 - y0;
                Mat cs = cover8.submat(e0, e1, 0, W);
                boolean any = Core.countNonZero(cs) < (e1 - e0) * W;
                if (!any) { cs.release(); continue; }
                Mat hole = new Mat(), hf = new Mat(), dil = new Mat(), alpha = new Mat(), a3 = new Mat(), pf = new Mat(), bf = new Mat(), big = new Mat();
                Mat X = new Mat(sh, W, CvType.CV_32FC1), Y = new Mat(sh, W, CvType.CV_32FC1);
                try {
                    // alpha = max(hole, blur(dilate(hole))) on the strip + margin, central rows kept
                    Core.bitwise_not(cs, hole);
                    hole.convertTo(hf, CvType.CV_32F, 1 / 255.0);
                    Imgproc.dilate(hf, dil, ker);
                    Imgproc.GaussianBlur(dil, alpha, new Size(0, 0), r);
                    Core.max(alpha, hf, alpha);
                    Mat ac = alpha.submat(y0 - e0, y1 - e0, 0, W);
                    Imgproc.cvtColor(ac, a3, Imgproc.COLOR_GRAY2BGR);
                    ac.release();
                    // the inpainted low-res image, upsampled (bicubic) on the strip rows
                    float[] xs = new float[sh * W], ys = new float[sh * W];
                    for (int yy = 0; yy < sh; yy++) {
                        float sy = (float) ((y0 + yy + .5) * h / H - .5);
                        System.arraycopy(mxs, 0, xs, yy * W, W);
                        java.util.Arrays.fill(ys, yy * W, (yy + 1) * W, sy);
                    }
                    X.put(0, 0, xs); Y.put(0, 0, ys);
                    Imgproc.remap(sm2, big, X, Y, Imgproc.INTER_CUBIC, Core.BORDER_REPLICATE, new Scalar(0, 0, 0));
                    Mat ps = pano.submat(y0, y1, 0, W);
                    ps.convertTo(pf, CvType.CV_32FC3);
                    big.convertTo(bf, CvType.CV_32FC3);
                    Core.subtract(bf, pf, bf);
                    Core.multiply(bf, a3, bf);
                    Core.add(pf, bf, pf);
                    pf.convertTo(ps, CvType.CV_8UC3);
                    ps.release();
                } finally {
                    cs.release(); hole.release(); hf.release(); dil.release(); alpha.release(); a3.release(); pf.release(); bf.release(); big.release();
                    X.release(); Y.release();
                }
            }
        } finally {
            small.release(); hs.release(); sp.release(); hp.release(); fl.release(); sm2.release();
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
