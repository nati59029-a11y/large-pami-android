import com.largepami.finance.PanoStitchCore;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.MatOfByte;
import org.opencv.core.MatOfInt;
import org.opencv.core.Point;
import org.opencv.core.Scalar;
import org.opencv.core.Size;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Synthetic test of PanoStitchCore (stage 21c). No external images: a procedural ground-truth equirect is rendered into frames
 * at the targets of store3d-pano-cap.js pickTargets (fovL 62, 1600x1200), with exposure gains, noise and JPEG. The stitcher gets
 * sensor poses perturbed by up to 4 degrees and a FOV that is 3 degrees wrong.
 * Output images go to target/out/ (for a look by eye).
 */
public class PanoStitchCoreTest {
    static final double D = Math.PI / 180;
    static final int GW = 8192, GH = 4096, FW = 1600, FH = 1200;
    static final double FOV_TRUE = 62, FOV_GIVEN = 65;
    static Mat gt, gt4096;
    static final File OUT = new File("target/out");

    @BeforeAll
    static void init() {
        nu.pattern.OpenCV.loadLocally();
        OUT.mkdirs();
        long t = System.currentTimeMillis();
        gt = groundTruth(GW, GH, 7);
        gt4096 = new Mat();
        Imgproc.resize(gt, gt4096, new Size(4096, 2048), 0, 0, Imgproc.INTER_AREA);
        Imgcodecs.imwrite(new File(OUT, "gt-4096.jpg").getPath(), gt4096);
        System.out.println("ground truth " + GW + "x" + GH + ": " + (System.currentTimeMillis() - t) + " ms");
    }

    /* ---------------------------------------------------------------- scene ---------------------------------------------------------------- */

    static Mat groundTruth(int W, int H, long seed) {
        Random r = new Random(seed);
        byte[] px = new byte[W * H * 3];
        for (int y = 0; y < H; y++) {
            double lat = (.5 - (y + .5) / H) * Math.PI;
            for (int x = 0; x < W; x++) {
                double lon = ((x + .5) / W - .5) * 2 * Math.PI;
                int k = (y * W + x) * 3;
                px[k] = (byte) (95 + 45 * Math.sin(lon + .3) + 20 * Math.cos(3 * lat));
                px[k + 1] = (byte) (110 + 35 * Math.cos(2 * lat) + 15 * Math.sin(2 * lon));
                px[k + 2] = (byte) (105 + 40 * Math.sin(lon * 3 + lat));
            }
        }
        Mat m = new Mat(H, W, CvType.CV_8UC3);
        m.put(0, 0, px);
        // shelves: horizontal bands with boxes, labels and "text"
        String al = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
        for (int s = 0; s < 14; s++) {
            int y = (int) (H * (.18 + .64 * s / 13.0));
            Imgproc.line(m, new Point(0, y), new Point(W, y), col(r, 40, 80), 5 + r.nextInt(5));
        }
        for (int b = 0; b < 2600; b++) {
            int y = (int) (H * (.04 + .92 * r.nextDouble())), x = r.nextInt(W);
            int bw = 20 + r.nextInt(220), bh = 15 + r.nextInt(160);
            Scalar c = col(r, 50, 205);
            Imgproc.rectangle(m, new Point(x, y), new Point(x + bw, y + bh), c, -1);
            Imgproc.rectangle(m, new Point(x, y), new Point(x + bw, y + bh), col(r, 30, 90), 2 + r.nextInt(3));
            if (r.nextDouble() < .6) {
                StringBuilder sb = new StringBuilder();
                for (int q = 0, L = 2 + r.nextInt(7); q < L; q++) sb.append(al.charAt(r.nextInt(al.length())));
                Imgproc.putText(m, sb.toString(), new Point(x + 3, y + bh * .6), Imgproc.FONT_HERSHEY_SIMPLEX, .4 + r.nextDouble() * 1.4, col(r, 20, 230), 1 + r.nextInt(3));
            }
            if (r.nextDouble() < .3) Imgproc.circle(m, new Point(x + bw / 2.0, y + bh / 2.0), 4 + r.nextInt(30), col(r, 40, 210), -1);
        }
        // floor and ceiling patterns (zenith / nadir caps)
        for (int b = 0; b < 900; b++) {
            boolean top = r.nextBoolean();
            int y = top ? r.nextInt((int) (H * .12)) : H - 1 - r.nextInt((int) (H * .12)), x = r.nextInt(W);
            Imgproc.rectangle(m, new Point(x, y), new Point(x + 40 + r.nextInt(400), y + 5 + r.nextInt(40)), col(r, 50, 205), -1);
        }
        return m;
    }

    static Scalar col(Random r, int lo, int hi) { return new Scalar(lo + r.nextInt(hi - lo), lo + r.nextInt(hi - lo), lo + r.nextInt(hi - lo)); }

    /* ---------------------------------------------------------------- camera ---------------------------------------------------------------- */

    /** pickTargets of store3d-pano-cap.js (overlap .3) */
    static List<double[]> pickTargets(double fw, double fh) {
        double ov = .3, hs = Math.max(5, fw * (1 - ov)), vs = Math.max(5, fh * (1 - ov));
        int k = (int) Math.max(1, Math.ceil((90 - .15 * fh) / vs));
        List<Double> rows = new ArrayList<>();
        rows.add(0.0);
        for (int i = 1; i < k; i++) { rows.add(i * 90.0 / k); rows.add(-i * 90.0 / k); }
        rows.add(90.0); rows.add(-90.0);
        List<double[]> out = new ArrayList<>();
        for (int ri = 0; ri < rows.size(); ri++) {
            double p = rows.get(ri);
            int nn = Math.abs(p) > 89.9 ? 1 : (int) Math.max(3, Math.ceil(360 * Math.cos(p * D) / hs));
            double off = ri % 2 == 1 && nn > 1 ? 180.0 / nn : 0;
            for (int j = 0; j < nn; j++) out.add(new double[]{wrap180(off + j * 360.0 / nn), p});
        }
        return out;
    }

    static double wrap180(double a) { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; }

    /** camera -> world (row-major) looking at yaw/pitch, rolled by roll degrees around the view axis */
    static double[] camMat(double yaw, double pitch, double roll) {
        double cy = Math.cos(yaw * D), sy = Math.sin(yaw * D), cp = Math.cos(pitch * D), sp = Math.sin(pitch * D);
        double[] fwd = {cp * sy, cp * cy, sp}, right = {cy, -sy, 0};
        double[] up = {right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]};
        double[] m = {right[0], up[0], -fwd[0], right[1], up[1], -fwd[1], right[2], up[2], -fwd[2]};
        return mul(m, rz(roll * D));
    }

    static double[] rz(double a) { double c = Math.cos(a), s = Math.sin(a); return new double[]{c, -s, 0, s, c, 0, 0, 0, 1}; }

    static double[] mul(double[] a, double[] b) {
        double[] c = new double[9];
        for (int r = 0; r < 3; r++) for (int k = 0; k < 3; k++) c[r * 3 + k] = a[r * 3] * b[k] + a[r * 3 + 1] * b[3 + k] + a[r * 3 + 2] * b[6 + k];
        return c;
    }

    static double[] tr(double[] a) { return new double[]{a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]}; }

    static double[] rotVec(double[] v) {
        double th = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (th < 1e-12) return new double[]{1, 0, 0, 0, 1, 0, 0, 0, 1};
        double x = v[0] / th, y = v[1] / th, z = v[2] / th, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
        return new double[]{c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C};
    }

    /** world direction of continuous frame pixel (u,v) (the renderer's own camera model) */
    static double[] pixDir(double[] m, double u, double v, double f, int w, int h) {
        double x = (u - w / 2.0) / f, y = -(v - h / 2.0) / f, z = -1, k = 1 / Math.sqrt(x * x + y * y + 1);
        x *= k; y *= k; z *= k;
        return new double[]{m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z};
    }

    static Mat render(double[] m, double fovL, int w, int h) {
        double f = (Math.max(w, h) / 2.0) / Math.tan(fovL * D / 2);
        float[] mx = new float[w * h], my = new float[w * h];
        for (int v = 0; v < h; v++) for (int u = 0; u < w; u++) {
            double[] d = pixDir(m, u + .5, v + .5, f, w, h);
            double lon = Math.atan2(d[0], d[1]) / D, lat = Math.asin(Math.max(-1, Math.min(1, d[2]))) / D;
            mx[v * w + u] = (float) ((lon / 360 + .5) * GW - .5);
            my[v * w + u] = (float) ((.5 - lat / 180) * GH - .5);
        }
        Mat X = new Mat(h, w, CvType.CV_32FC1), Y = new Mat(h, w, CvType.CV_32FC1), out = new Mat();
        X.put(0, 0, mx); Y.put(0, 0, my);
        Imgproc.remap(gt, out, X, Y, Imgproc.INTER_LINEAR, Core.BORDER_WRAP);
        X.release(); Y.release();
        return out;
    }

    static byte[] jpg(Mat m, int q) {
        MatOfByte b = new MatOfByte();
        Imgcodecs.imencode(".jpg", m, b, new MatOfInt(Imgcodecs.IMWRITE_JPEG_QUALITY, q));
        return b.toArray();
    }

    /* ---------------------------------------------------------------- scenario ---------------------------------------------------------------- */

    static final class Scene {
        int n;
        double[][] Rt, Rs;
        double[][] gain; // applied [frame][B,G,R]
        byte[][] jpeg;
        double yawRef;
        double sensErrMean;
        boolean[] blank;
    }

    static Scene scene(long seed, double yaw0, double perturbDeg, int[] blankIdx) { return scene(seed, yaw0, perturbDeg, blankIdx, 0); }

    /** vig > 0: lens vignetting 1 - vig * r^2 (r = distance from the centre / half diagonal) applied to every frame */
    static Scene scene(long seed, double yaw0, double perturbDeg, int[] blankIdx, double vig) {
        Random r = new Random(seed);
        double f = (Math.max(FW, FH) / 2.0) / Math.tan(FOV_TRUE * D / 2), fw = 2 * Math.atan(FW / 2.0 / f) / D, fh = 2 * Math.atan(FH / 2.0 / f) / D;
        List<double[]> T = pickTargets(fw, fh);
        Scene s = new Scene();
        s.n = T.size();
        s.Rt = new double[s.n][]; s.Rs = new double[s.n][]; s.gain = new double[s.n][]; s.jpeg = new byte[s.n][]; s.blank = new boolean[s.n];
        if (blankIdx != null) for (int b : blankIdx) s.blank[b] = true;
        double es = 0;
        for (int i = 0; i < s.n; i++) {
            double[] t = T.get(i);
            // the person does not aim perfectly: +-2 degrees, roll +-3
            s.Rt[i] = camMat(t[0] + yaw0 + (r.nextDouble() * 4 - 2), Math.max(-90, Math.min(90, t[1] + (r.nextDouble() * 4 - 2))), r.nextDouble() * 6 - 3);
            if (perturbDeg > 0) {
                double ang = (perturbDeg * (.4 + .6 * r.nextDouble())) * D, ax = r.nextGaussian(), ay = r.nextGaussian(), az = r.nextGaussian(), nn = Math.sqrt(ax * ax + ay * ay + az * az);
                s.Rs[i] = mul(rotVec(new double[]{ax / nn * ang, ay / nn * ang, az / nn * ang}), s.Rt[i]);
            } else s.Rs[i] = s.Rt[i].clone();
            es += PanoStitchCore.angDeg(s.Rs[i], s.Rt[i]);
            double g = .8 + .4 * r.nextDouble();
            s.gain[i] = new double[]{g * (.98 + .04 * r.nextDouble()), g * (.98 + .04 * r.nextDouble()), g * (.98 + .04 * r.nextDouble())};
            Mat img;
            if (s.blank[i]) {
                img = new Mat(FH, FW, CvType.CV_8UC3, new Scalar(150, 148, 140));
                Mat grad = new Mat(FH, FW, CvType.CV_8UC3);
                Core.randn(grad, 0, 1.5);
                Core.add(img, grad, img);
                grad.release();
            } else img = render(s.Rt[i], FOV_TRUE, FW, FH);
            Mat fl = new Mat(), noise = new Mat(FH, FW, CvType.CV_32FC3);
            img.convertTo(fl, CvType.CV_32FC3);
            Core.multiply(fl, new Scalar(s.gain[i][0], s.gain[i][1], s.gain[i][2]), fl);
            if (vig > 0) {
                float[] vm = new float[FW * FH];
                double hd2 = (FW * (double) FW + FH * (double) FH) / 4;
                for (int v = 0; v < FH; v++) for (int u = 0; u < FW; u++) {
                    double du = u + .5 - FW / 2.0, dv = v + .5 - FH / 2.0;
                    vm[v * FW + u] = (float) (1 - vig * (du * du + dv * dv) / hd2);
                }
                Mat V = new Mat(FH, FW, CvType.CV_32FC1), V3 = new Mat();
                V.put(0, 0, vm);
                Imgproc.cvtColor(V, V3, Imgproc.COLOR_GRAY2BGR);
                Core.multiply(fl, V3, fl);
                V.release(); V3.release();
            }
            Core.randn(noise, 0, 2.5);
            Core.add(fl, noise, fl);
            fl.convertTo(img, CvType.CV_8UC3);
            s.jpeg[i] = jpg(img, 92);
            img.release(); fl.release(); noise.release();
        }
        s.sensErrMean = es / s.n;
        s.yawRef = Math.atan2(-s.Rs[0][2], -s.Rs[0][5]) / D; // like JS: frames[0].yaw from the sensor
        return s;
    }

    static double[] q(double[] m) { return PanoStitchCore.matToQ(m); }

    static PanoStitchCore.Result stitch(Scene s, int W, double fov, boolean optimize) {
        PanoStitchCore.Options o = new PanoStitchCore.Options();
        o.W = W; o.fovL = fov; o.yawRef = s.yawRef; o.optimize = optimize;
        PanoStitchCore c = new PanoStitchCore(s.n, o);
        for (int i = 0; i < s.n; i++) c.setFrame(i, s.jpeg[i], q(s.Rs[i]));
        final double[] last = {0};
        PanoStitchCore.Result r = c.run(p -> { assertTrue(p >= last[0] - 1e-9, "progress goes forward"); last[0] = p; });
        assertEquals(1.0, last[0], 1e-9);
        return r;
    }

    /** best global rotation G with G * Rest_i ~ Rtrue_i (gauge: the whole result may be rotated a bit) */
    static double[] gauge(double[][] Rest, double[][] Rt, boolean[] skip) {
        Mat M = Mat.zeros(3, 3, CvType.CV_64F);
        double[] acc = new double[9];
        for (int i = 0; i < Rt.length; i++) {
            if (skip != null && skip[i]) continue;
            double[] a = mul(Rt[i], tr(Rest[i]));
            for (int k = 0; k < 9; k++) acc[k] += a[k];
        }
        M.put(0, 0, acc);
        Mat w = new Mat(), u = new Mat(), vt = new Mat();
        Core.SVDecomp(M, w, u, vt);
        Mat G = new Mat();
        Core.gemm(u, vt, 1, new Mat(), 0, G);
        if (Core.determinant(G) < 0) { // reflection fix
            Mat d = Mat.eye(3, 3, CvType.CV_64F);
            d.put(2, 2, -1);
            Mat t = new Mat();
            Core.gemm(u, d, 1, new Mat(), 0, t);
            Core.gemm(t, vt, 1, new Mat(), 0, G);
        }
        double[] g = new double[9];
        G.get(0, 0, g);
        return g;
    }

    static double[][] mats(PanoStitchCore.Result r) {
        double[][] m = new double[r.quats.length][];
        for (int i = 0; i < m.length; i++) m[i] = PanoStitchCore.qToMat(r.quats[i]);
        return m;
    }

    static double meanErr(double[][] Rest, double[][] Rt, double[] G, boolean[] only, boolean want) {
        double s = 0; int c = 0;
        for (int i = 0; i < Rt.length; i++) {
            if (only != null && only[i] != want) continue;
            s += PanoStitchCore.angDeg(G == null ? Rest[i] : mul(G, Rest[i]), Rt[i]);
            c++;
        }
        return c == 0 ? 0 : s / c;
    }

    /** PSNR of pano vs the ground truth seen through gauge G (world_true = G * world_est), rows |lat| < 70, after a global per-channel brightness fit */
    static double psnr(Mat pano, double yawRef, double[] G) {
        int W = pano.cols(), H = pano.rows();
        Mat ref = gt4096;
        if (ref.cols() != W) { ref = new Mat(); Imgproc.resize(gt, ref, new Size(W, H), 0, 0, Imgproc.INTER_AREA); }
        float[] mx = new float[W * H], my = new float[W * H];
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
            double[] d = PanoStitchCore.eqDir(x, y, W, H, yawRef);
            double a = G[0] * d[0] + G[1] * d[1] + G[2] * d[2], b = G[3] * d[0] + G[4] * d[1] + G[5] * d[2], c = G[6] * d[0] + G[7] * d[1] + G[8] * d[2];
            double lon = Math.atan2(a, b) / D, lat = Math.asin(Math.max(-1, Math.min(1, c))) / D;
            mx[y * W + x] = (float) ((lon / 360 + .5) * W - .5);
            my[y * W + x] = (float) ((.5 - lat / 180) * H - .5);
        }
        Mat X = new Mat(H, W, CvType.CV_32FC1), Y = new Mat(H, W, CvType.CV_32FC1), g = new Mat();
        X.put(0, 0, mx); Y.put(0, 0, my);
        Imgproc.remap(ref, g, X, Y, Imgproc.INTER_LINEAR, Core.BORDER_WRAP);
        int y0 = (int) (H * (20 / 180.0)), y1 = H - y0;
        byte[] a = new byte[W * H * 3], b = new byte[W * H * 3];
        pano.get(0, 0, a); g.get(0, 0, b);
        double[] sab = new double[3], saa = new double[3];
        for (int y = y0; y < y1; y++) for (int x = 0; x < W; x++) for (int ch = 0; ch < 3; ch++) {
            int k = (y * W + x) * 3 + ch;
            double p = a[k] & 255, t = b[k] & 255;
            sab[ch] += p * t; saa[ch] += p * p;
        }
        double se = 0; long cnt = 0;
        for (int y = y0; y < y1; y++) for (int x = 0; x < W; x++) for (int ch = 0; ch < 3; ch++) {
            int k = (y * W + x) * 3 + ch;
            double p = (a[k] & 255) * sab[ch] / saa[ch], t = b[k] & 255;
            se += (p - t) * (p - t); cnt++;
        }
        return 10 * Math.log10(255.0 * 255.0 / (se / cnt));
    }

    static String f2(double v) { return String.format(Locale.ROOT, "%.3f", v); }

    /* ---------------------------------------------------------------- tests ---------------------------------------------------------------- */

    /** Java projection == JS projection (S3PanoCap._m of app-source/www/store3d-pano-cap.js), via node */
    @Test
    void conventionMatchesJs() throws Exception {
        File js = new File("../../app-source/www/store3d-pano-cap.js").getCanonicalFile();
        assertTrue(js.isFile(), "store3d-pano-cap.js");
        Random r = new Random(3);
        StringBuilder in = new StringBuilder("[");
        List<double[]> expect = new ArrayList<>();
        int W = 4096, H = 2048;
        for (int k = 0; k < 60; k++) {
            double[] m = camMat(r.nextDouble() * 360 - 180, r.nextDouble() * 180 - 90, r.nextDouble() * 40 - 20);
            double[] qq = q(m);
            double fov = 55 + 15 * r.nextDouble(), yawRef = r.nextDouble() * 360 - 180;
            int w = r.nextBoolean() ? 1600 : 1200, h = w == 1600 ? 1200 : 1600;
            double fp = (Math.max(w, h) / 2.0) / Math.tan(fov * D / 2);
            double u = 50 + r.nextDouble() * (w - 100), v = 50 + r.nextDouble() * (h - 100);
            // renderer: frame pixel -> world -> equirect continuous position
            double[] d = pixDir(m, u, v, fp, w, h);
            double lon = wrap180(Math.atan2(d[0], d[1]) / D - yawRef), lat = Math.asin(d[2]) / D;
            double x = (lon / 360 + .5) * W - .5, y = (.5 - lat / 180) * H - .5;
            // Java core: equirect -> world -> frame pixel
            double[] p = PanoStitchCore.project(PanoStitchCore.qToMat(qq), PanoStitchCore.eqDir(x, y, W, H, yawRef), fov, w, h);
            assertTrue(Math.abs(p[0] - u) < 1e-6 && Math.abs(p[1] - v) < 1e-6, "core vs renderer");
            if (k > 0) in.append(',');
            in.append(String.format(Locale.ROOT, "[%s,%s,%s,%s,%s,%s,%d,%d,%s,%s]", qq[0], qq[1], qq[2], qq[3], fov, yawRef, w, h, x, y));
            expect.add(new double[]{u, v});
        }
        in.append(']');
        String script = "const M=require(" + jsStr(js.getPath()) + ")._m;let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const a=JSON.parse(s);"
                + "console.log(JSON.stringify(a.map(c=>{const p=M.eqToFrame(c[8],c[9],4096,2048,c[5],[c[0],c[1],c[2],c[3]],{fovL:c[4],w:c[6],h:c[7]});return p})))})";
        Process pr;
        try {
            pr = new ProcessBuilder("node", "-e", script).redirectErrorStream(true).start();
        } catch (java.io.IOException e) {
            System.out.println("node not found - JS convention check skipped");
            return;
        }
        pr.getOutputStream().write(in.toString().getBytes(StandardCharsets.UTF_8));
        pr.getOutputStream().close();
        String out = new String(pr.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        assertEquals(0, pr.waitFor(), out);
        String[] parts = out.replace("[[", "").replace("]]", "").split("\\],\\[");
        assertEquals(expect.size(), parts.length, out);
        double mx = 0;
        for (int k = 0; k < parts.length; k++) {
            String[] uv = parts[k].split(",");
            mx = Math.max(mx, Math.abs(Double.parseDouble(uv[0]) - expect.get(k)[0]));
            mx = Math.max(mx, Math.abs(Double.parseDouble(uv[1]) - expect.get(k)[1]));
        }
        System.out.println("convention: JS eqToFrame vs Java/renderer, 60 random directions, max diff px = " + mx);
        assertTrue(mx < 1e-6);
    }

    static String jsStr(String s) { return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"; }

    /** end to end: exact poses, no optimisation, yawRef != 0 -> the output must be the ground truth in the JS convention */
    @Test
    void outputConventionEndToEnd() {
        Scene s = scene(11, 37, 0, null);
        long t = System.currentTimeMillis();
        PanoStitchCore.Result r = stitch(s, 2048, FOV_TRUE, false);
        Imgcodecs.imwrite(new File(OUT, "convention-2048.jpg").getPath(), r.pano);
        double[] I = {1, 0, 0, 0, 1, 0, 0, 0, 1};
        double p = psnr(r.pano, s.yawRef, I);
        // the same image read with a mirrored or shifted convention must be clearly worse
        double pMir = psnr(r.pano, s.yawRef, new double[]{-1, 0, 0, 0, 1, 0, 0, 0, 1});
        double pShift = psnr(r.pano, s.yawRef + 5, I);
        System.out.println("convention end-to-end (yawRef=" + f2(s.yawRef) + "): PSNR " + f2(p) + " dB; mirrored " + f2(pMir) + " dB; yaw+5deg " + f2(pShift) + " dB; " + (System.currentTimeMillis() - t) + " ms");
        assertTrue(p > 27, "PSNR with exact poses");
        assertTrue(p > pMir + 6 && p > pShift + 6, "convention is distinguishable");
        r.pano.release();
    }

    @Test
    void optimisedVsSensorOnly() {
        Scene s = scene(5, 0, 4, null);
        System.out.println("scene: " + s.n + " frames " + FW + "x" + FH + ", true fovL " + FOV_TRUE + ", given " + FOV_GIVEN + ", sensor error mean " + f2(s.sensErrMean) + " deg");
        long t = System.currentTimeMillis();
        PanoStitchCore.Result r = stitch(s, 4096, FOV_GIVEN, true);
        long ms = System.currentTimeMillis() - t;
        PanoStitchCore.Stats st = r.stats;
        double[][] Re = mats(r);
        double[] G = gauge(Re, s.Rt, null);
        double errAligned = meanErr(Re, s.Rt, G, null, true), errRaw = meanErr(Re, s.Rt, null, null, true);
        double fovErr = Math.abs(r.fovL - FOV_TRUE);
        Imgcodecs.imwrite(new File(OUT, "optimised-4096.jpg").getPath(), r.pano);
        double pOpt = psnr(r.pano, s.yawRef, G);
        // gain spread: applied gain * estimated gain should be the same for all frames
        double spread = 0;
        for (int ch = 0; ch < 3; ch++) {
            double mn = 1e9, mx = -1e9, sum = 0;
            for (int i = 0; i < s.n; i++) { double v = s.gain[i][ch] * st.gains[i][ch]; mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; }
            spread = Math.max(spread, (mx - mn) / (sum / s.n));
        }
        double spread0 = 0;
        for (int ch = 0; ch < 3; ch++) {
            double mn = 1e9, mx = -1e9, sum = 0;
            for (int i = 0; i < s.n; i++) { double v = s.gain[i][ch]; mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; }
            spread0 = Math.max(spread0, (mx - mn) / (sum / s.n));
        }
        System.out.println("optimised: " + ms + " ms (features " + st.msFeat + ", match " + st.msMatch + ", LM " + st.msOpt + ", blend " + st.msBlend + "); " + st.feat
                + " pairs " + st.pairs + " / accepted " + st.inlierPairs + ", matches " + st.matches + ", rms " + f2(st.rms0Deg) + " -> " + f2(st.rmsDeg) + " deg, optimized=" + st.optimized + ", holes " + f2(st.holesPct) + "%");
        System.out.println("  rotation error: gauge-aligned mean " + f2(errAligned) + " deg (raw, frame-0 yaw anchor: " + f2(errRaw) + "; sensor " + f2(s.sensErrMean) + ")");
        System.out.println("  fovL " + f2(r.fovL) + " (true " + FOV_TRUE + ", error " + f2(fovErr) + ")");
        System.out.println("  gain spread: before " + f2(spread0 * 100) + "% -> after compensation " + f2(spread * 100) + "%");
        r.pano.release();

        t = System.currentTimeMillis();
        PanoStitchCore.Result r0 = stitch(s, 4096, FOV_GIVEN, false);
        long ms0 = System.currentTimeMillis() - t;
        double[] G0 = gauge(mats(r0), s.Rt, null);
        Imgcodecs.imwrite(new File(OUT, "sensor-only-4096.jpg").getPath(), r0.pano);
        double pSens = psnr(r0.pano, s.yawRef, G0);
        r0.pano.release();
        System.out.println("  PSNR vs ground truth: sensor-only " + f2(pSens) + " dB (" + ms0 + " ms) -> optimised " + f2(pOpt) + " dB");

        assertTrue(st.optimized, "optimisation accepted");
        assertTrue(errAligned < 0.3, "mean rotation error " + errAligned);
        assertTrue(fovErr < 0.5, "fov error " + fovErr);
        assertTrue(pOpt > pSens + 1, "PSNR optimised " + pOpt + " vs sensor-only " + pSens);
        assertTrue(spread < 0.03, "gain spread " + spread);
        assertTrue(Math.abs(Math.atan2(-Re[0][2], -Re[0][5]) / D - s.yawRef) < 1e-6, "frame 0 yaw stays yawRef");
    }

    /** 16.11 (real capture: fov 51.9 / 50.6 / 56.1 from the starts 52 / 60 / 66): the fov comes from the ring closure of the matches,
     *  so it must not depend on the first guess */
    @Test
    void fovIndependentOfStart() {
        Scene s = scene(5, 0, 4, null);
        double mn = 1e9, mx = -1e9;
        StringBuilder sb = new StringBuilder("fov from different starts (true " + FOV_TRUE + "):");
        for (double f0 : new double[]{55, 62, 70}) {
            PanoStitchCore.Result r = stitch(s, 1024, f0, true);
            sb.append(" ").append(f0).append(" -> ").append(f2(r.fovL)).append(" (pairs ").append(r.stats.inlierPairs).append(", corr ").append(f2(r.stats.meanCorrDeg)).append(")");
            assertTrue(r.stats.optimized, "optimised from " + f0);
            assertTrue(Math.abs(r.fovL - FOV_TRUE) < 0.5, "fov from start " + f0 + ": " + r.fovL);
            mn = Math.min(mn, r.fovL); mx = Math.max(mx, r.fovL);
            r.pano.release();
        }
        System.out.println(sb);
        assertTrue(mx - mn < 0.3, "spread " + (mx - mn));
    }

    @Test
    void blankWallsDoNotDiverge() {
        Scene s0 = scene(5, 0, 4, null);
        int[] blank = {3, 4, s0.n - 1}; // two horizon frames + the nadir
        Scene s = scene(5, 0, 4, blank);
        long t = System.currentTimeMillis();
        PanoStitchCore.Result r = stitch(s, 2048, FOV_GIVEN, true);
        long ms = System.currentTimeMillis() - t;
        double[][] Re = mats(r);
        double[] G = gauge(Re, s.Rt, s.blank);
        double eTex = meanErr(Re, s.Rt, G, s.blank, false);
        double maxBlankMove = 0, maxBlankErr = 0, maxBlankSens = 0;
        for (int b : blank) {
            maxBlankMove = Math.max(maxBlankMove, PanoStitchCore.angDeg(Re[b], s.Rs[b]));
            maxBlankErr = Math.max(maxBlankErr, PanoStitchCore.angDeg(mul(G, Re[b]), s.Rt[b]));
            maxBlankSens = Math.max(maxBlankSens, PanoStitchCore.angDeg(s.Rs[b], s.Rt[b]));
        }
        Imgcodecs.imwrite(new File(OUT, "blank-walls-2048.jpg").getPath(), r.pano);
        r.pano.release();
        System.out.println("blank walls (3 frames): " + ms + " ms; optimized=" + r.stats.optimized + ", accepted pairs " + r.stats.inlierPairs + ", rms " + f2(r.stats.rmsDeg)
                + " deg; textured frames error " + f2(eTex) + " deg; blank frames moved from sensor max " + f2(maxBlankMove) + " deg (error " + f2(maxBlankErr) + ", sensor error " + f2(maxBlankSens) + "); fovL " + f2(r.fovL));
        assertTrue(r.stats.optimized, "optimisation accepted");
        assertTrue(eTex < 0.4, "textured frames still registered");
        assertTrue(maxBlankMove < 2.0, "blank frames stay near the sensor pose");
        assertTrue(Math.abs(r.fovL - FOV_TRUE) < 0.7, "fov");
    }

    /** mean luminance (BT.601) of rows |lat| < 70, cos(lat) weighted; pano in the gauge of the output (no rotation needed for a mean) */
    static double meanLum(Mat pano) {
        int W = pano.cols(), H = pano.rows();
        byte[] px = new byte[W * H * 3];
        pano.get(0, 0, px);
        double s = 0, w = 0;
        for (int y = 0; y < H; y++) {
            double lat = (.5 - (y + .5) / H) * 180;
            if (Math.abs(lat) > 70) continue;
            double cw = Math.cos(lat * D);
            for (int x = 0; x < W; x++) {
                int k = (y * W + x) * 3;
                s += cw * (.114 * (px[k] & 255) + .587 * (px[k + 1] & 255) + .299 * (px[k + 2] & 255));
                w += cw;
            }
        }
        return s / w;
    }

    /** brightness (16.11, real capture was ~45% darker than its frames): with vignetting 0.35 and random exposures (mean 1) the output
     *  keeps the brightness of the scene, the vignetting is detected, and the gains have a geometric mean of 1 */
    @Test
    void brightnessKeptWithVignetting() {
        Scene s = scene(11, 0, 2, null, .35);
        PanoStitchCore.Result r = stitch(s, 2048, FOV_GIVEN, true);
        Mat gt2 = new Mat();
        Imgproc.resize(gt, gt2, new Size(2048, 1024), 0, 0, Imgproc.INTER_AREA);
        double mGt = meanLum(gt2), mOut = meanLum(r.pano);
        double gScene = 0;
        for (double[] g : s.gain) gScene += Math.log(Math.cbrt(g[0] * g[1] * g[2]));
        gScene = Math.exp(gScene / s.n); // the stitcher can only keep the mean exposure of the frames
        double lg = 0;
        for (double[] g : r.stats.gains) lg += Math.log(Math.cbrt(g[0] * g[1] * g[2]));
        lg = Math.exp(lg / s.n);
        double vEdge = Math.exp(r.stats.vigA + r.stats.vigB);
        Imgcodecs.imwrite(new File(OUT, "vignetting-2048.jpg").getPath(), r.pano);
        System.out.println("brightness: ground truth " + f2(mGt) + " x mean exposure " + f2(gScene) + " = " + f2(mGt * gScene) + ", output " + f2(mOut)
                + "; vignetting V(corner) " + f2(vEdge) + " (true .65); gains geometric mean " + f2(lg));
        gt2.release(); r.pano.release();
        assertTrue(Math.abs(mOut / (mGt * gScene) - 1) < .05, "brightness kept: " + mOut + " vs " + mGt * gScene);
        assertTrue(vEdge > .5 && vEdge < .8, "vignetting found: " + vEdge);
        assertTrue(Math.abs(lg - 1) < .02, "gains mean 1: " + lg);
    }

    /** safety guard (16.11): weak matching -> run() throws a clear exception (the JS stitching is used); guard=false still stitches */
    @Test
    void guardRefusesWeakMatching() {
        Scene s0 = scene(13, 0, 3, null);
        int[] blank = new int[s0.n - 3];
        for (int i = 3; i < s0.n; i++) blank[i - 3] = i; // only frames 0..2 have texture
        Scene s = scene(13, 0, 3, blank);
        String msg = null;
        try { stitch(s, 1024, FOV_GIVEN, true); } catch (IllegalStateException e) { msg = e.getMessage(); }
        System.out.println("guard: " + msg);
        assertTrue(msg != null && msg.startsWith("native stitch refused"), "guard throws: " + msg);
        PanoStitchCore.Options o = new PanoStitchCore.Options();
        o.W = 1024; o.fovL = FOV_GIVEN; o.yawRef = s.yawRef; o.guard = false;
        PanoStitchCore c = new PanoStitchCore(s.n, o);
        for (int i = 0; i < s.n; i++) c.setFrame(i, s.jpeg[i], q(s.Rs[i]));
        PanoStitchCore.Result r = c.run(null);
        assertEquals(512, r.pano.rows());
        r.pano.release();
        // optimisation off (sensor-only comparison mode) is never refused
        PanoStitchCore.Result r2 = stitch(s, 1024, FOV_GIVEN, false);
        r2.pano.release();
    }

    @Test
    void cancelStops() {
        Scene s = scene(9, 0, 2, null);
        PanoStitchCore.Options o = new PanoStitchCore.Options();
        o.W = 1024; o.fovL = FOV_GIVEN; o.yawRef = s.yawRef;
        PanoStitchCore c = new PanoStitchCore(s.n, o);
        for (int i = 0; i < s.n; i++) c.setFrame(i, s.jpeg[i], q(s.Rs[i]));
        boolean got = false;
        try { c.run(p -> { if (p > .1) c.cancel(); }); } catch (PanoStitchCore.Cancelled e) { got = true; }
        assertTrue(got, "cancel throws Cancelled");
    }
    /* ---------------------------------------------------------------- stage 21e: parallax + nadir frame ---------------------------------------------------------------- */

    static double[] dirOf(double yaw, double pitch) { return new double[]{Math.cos(pitch * D) * Math.sin(yaw * D), Math.cos(pitch * D) * Math.cos(yaw * D), Math.sin(pitch * D)}; }

    /** a near textured board (BW x BH, distance BD, facing the origin) in direction (yaw, 0); the background stays at infinity */
    static final class Board {
        double yaw, BD = 1.2, BW = .34, BH = .26; // about 16 x 12 degrees (smaller than the overlap + one frame)
        Mat tex;      // texture, BGR
        double[] P0, nrm, eU, eV;
        Board(double yaw, long seed) {
            this.yaw = yaw;
            double[] d = dirOf(yaw, 0);
            P0 = new double[]{d[0] * BD, d[1] * BD, d[2] * BD};
            nrm = new double[]{-d[0], -d[1], -d[2]};
            eU = new double[]{Math.cos(yaw * D), -Math.sin(yaw * D), 0};
            eV = new double[]{0, 0, 1};
            Random r = new Random(seed);
            tex = new Mat(380, 550, CvType.CV_8UC3, new Scalar(225, 225, 230));
            for (int k = 0; k < 70; k++) {
                int x = r.nextInt(550), y = r.nextInt(380);
                Imgproc.rectangle(tex, new Point(x, y), new Point(x + 15 + r.nextInt(90), y + 10 + r.nextInt(60)), col(r, 20, 200), -1);
            }
            for (int k = 0; k < 8; k++) Imgproc.line(tex, new Point(r.nextInt(550), 0), new Point(r.nextInt(550), 379), col(r, 10, 60), 4);
            Imgproc.rectangle(tex, new Point(0, 0), new Point(549, 379), new Scalar(20, 20, 20), 8);
        }
        /** BGR of the board hit by the ray c + t dd (t > 0), or null */
        double[] hit(double[] c, double[] dd, byte[] tx) {
            double den = nrm[0] * dd[0] + nrm[1] * dd[1] + nrm[2] * dd[2];
            if (den >= -1e-9) return null;
            double t = (nrm[0] * (P0[0] - c[0]) + nrm[1] * (P0[1] - c[1]) + nrm[2] * (P0[2] - c[2])) / den;
            if (t <= 0) return null;
            double hx = c[0] + t * dd[0] - P0[0], hy = c[1] + t * dd[1] - P0[1], hz = c[2] + t * dd[2] - P0[2];
            double a = eU[0] * hx + eU[1] * hy + eU[2] * hz, b = eV[0] * hx + eV[1] * hy + eV[2] * hz;
            if (Math.abs(a) > BW / 2 || Math.abs(b) > BH / 2) return null;
            int u = (int) Math.min(549, (a / BW + .5) * 550), v = (int) Math.min(379, (.5 - b / BH) * 380), k = (v * 550 + u) * 3;
            return new double[]{tx[k] & 255, tx[k + 1] & 255, tx[k + 2] & 255};
        }
    }

    /** frame seen from camera centre c (true pose m) with the board in front of the background */
    static Mat renderBoard(double[] m, double[] c, Board bd, int w, int h) {
        Mat img = render(m, FOV_TRUE, w, h);
        double f = (Math.max(w, h) / 2.0) / Math.tan(FOV_TRUE * D / 2);
        byte[] px = new byte[w * h * 3], tx = new byte[550 * 380 * 3];
        img.get(0, 0, px);
        bd.tex.get(0, 0, tx);
        for (int v = 0; v < h; v++) for (int u = 0; u < w; u++) {
            double[] col = bd.hit(c, pixDir(m, u + .5, v + .5, f, w, h), tx);
            if (col == null) continue;
            int k = (v * w + u) * 3;
            px[k] = (byte) col[0]; px[k + 1] = (byte) col[1]; px[k + 2] = (byte) col[2];
        }
        img.put(0, 0, px);
        return img;
    }

    static PanoStitchCore.Result stitchOpt(Scene s, int W, PanoStitchCore.Options o, String[] roles) {
        o.W = W; o.fovL = FOV_GIVEN; o.yawRef = s.yawRef;
        PanoStitchCore c = new PanoStitchCore(s.n, o);
        for (int i = 0; i < s.n; i++) c.setFrame(i, s.jpeg[i], q(s.Rs[i]), roles == null ? null : roles[i]);
        return c.run(null);
    }

    /** ghost metric in the board window vs the board as seen from ONE camera centre (best camera, best shift up to +-2.5 degrees):
     *  {grey level ZNCC, fraction of 'wrong' pixels (|difference| > 40 grey levels after a mean / contrast fit)}. A clean single-source
     *  result has few wrong pixels; doubled / broken edges at a seam inside the board give many */
    static double[] boardScore(Mat pano, double yawRef, double[] G, Board bd, double[][] cs, double[][] Rt) {
        int W = pano.cols(), H = pano.rows();
        // window: directions whose ray from the origin hits the board scaled by 1.25
        int x0 = W, x1 = -1, y0 = H, y1 = -1;
        byte[] tx = new byte[550 * 380 * 3];
        bd.tex.get(0, 0, tx);
        Board big = new Board(bd.yaw, 1);
        big.BW = bd.BW * 1.25; big.BH = bd.BH * 1.25;
        double[] O = {0, 0, 0};
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
            double[] d = PanoStitchCore.eqDir(x, y, W, H, yawRef);
            double[] g = {G[0] * d[0] + G[1] * d[1] + G[2] * d[2], G[3] * d[0] + G[4] * d[1] + G[5] * d[2], G[6] * d[0] + G[7] * d[1] + G[8] * d[2]};
            if (big.hit(O, g, tx) != null) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
        big.tex.release();
        int S = (int) Math.round(W * 2.5 / 360), ww = x1 - x0 + 1, hh = y1 - y0 + 1, WW = ww + 2 * S, HH = hh + 2 * S;
        byte[] pp = new byte[W * H * 3];
        pano.get(0, 0, pp);
        double[] a = new double[ww * hh];
        double ma = 0;
        for (int y = 0; y < hh; y++) for (int x = 0; x < ww; x++) {
            int k = ((y0 + y) * W + x0 + x) * 3;
            a[y * ww + x] = .114 * (pp[k] & 255) + .587 * (pp[k + 1] & 255) + .299 * (pp[k + 2] & 255);
            ma += a[y * ww + x];
        }
        a = box(a, ww, hh, 2); // edges 1 pixel off (resampling) are not 'wrong'
        ma = 0;
        for (double x : a) ma += x;
        ma /= a.length;
        double va = 0;
        for (int k = 0; k < a.length; k++) { a[k] -= ma; va += a[k] * a[k]; }
        byte[] gp = new byte[gt.cols() * gt.rows() * 3];
        gt.get(0, 0, gp);
        double best = -1, bad = 1, sa = Math.sqrt(va / a.length);
        for (int ci = 0; ci < cs.length; ci++) {
            // only cameras that see the board centre
            double[] pc = PanoStitchCore.project(Rt[ci], dirOf(bd.yaw, 0), FOV_TRUE, FW, FH);
            if (pc == null || pc[0] < 0 || pc[1] < 0 || pc[0] > FW || pc[1] > FH) continue;
            double[] v = new double[WW * HH];
            for (int y = 0; y < HH; y++) for (int x = 0; x < WW; x++) {
                double[] d = PanoStitchCore.eqDir(x0 - S + x, Math.max(0, Math.min(H - 1, y0 - S + y)), W, H, yawRef);
                double[] g = {G[0] * d[0] + G[1] * d[1] + G[2] * d[2], G[3] * d[0] + G[4] * d[1] + G[5] * d[2], G[6] * d[0] + G[7] * d[1] + G[8] * d[2]};
                double[] col = bd.hit(cs[ci], g, tx);
                if (col == null) {
                    double lon = Math.atan2(g[0], g[1]) / D, lat = Math.asin(Math.max(-1, Math.min(1, g[2]))) / D;
                    int gx = Math.floorMod((int) ((lon / 360 + .5) * gt.cols()), gt.cols()), gy = Math.max(0, Math.min(gt.rows() - 1, (int) ((.5 - lat / 180) * gt.rows())));
                    int k = (gy * gt.cols() + gx) * 3;
                    col = new double[]{gp[k] & 255, gp[k + 1] & 255, gp[k + 2] & 255};
                }
                v[y * WW + x] = .114 * col[0] + .587 * col[1] + .299 * col[2];
            }
            v = box(v, WW, HH, 2);
            for (int sy = -S; sy <= S; sy += 1) for (int sx = -S; sx <= S; sx += 1) {
                double sb = 0, sb2 = 0, sab = 0;
                for (int y = 0; y < hh; y++) for (int x = 0; x < ww; x++) {
                    double b = v[(y + S + sy) * WW + x + S + sx];
                    sb += b; sb2 += b * b; sab += a[y * ww + x] * b;
                }
                double vb = sb2 - sb * sb / a.length, z = vb <= 0 ? 0 : sab / Math.sqrt(va * vb);
                best = Math.max(best, z);
                if (z < .5) continue;
                double mb = sb / a.length, k = Math.sqrt(Math.max(1e-9, vb / a.length)) / Math.max(1e-9, sa);
                int nb = 0;
                for (int y = 0; y < hh; y++) for (int x = 0; x < ww; x++) {
                    double e = a[y * ww + x] * k + mb - v[(y + S + sy) * WW + x + S + sx];
                    if (Math.abs(e) > 40) nb++;
                }
                bad = Math.min(bad, nb / (double) a.length);
            }
        }
        return new double[]{best, bad};
    }

    /** box blur of radius r (clamped borders) */
    static double[] box(double[] a, int w, int h, int r) {
        double[] t = new double[a.length], o = new double[a.length];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            double s = 0; int c = 0;
            for (int k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += a[y * w + k]; c++; }
            t[y * w + x] = s / c;
        }
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            double s = 0; int c = 0;
            for (int k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += t[k * w + x]; c++; }
            o[y * w + x] = s / c;
        }
        return o;
    }

    /** 21e: a near board, camera centres moved by up to 4 cm per frame (parallax up to ~4 degrees between two frames at 1.2 m): with
     *  smart seams + mesh warp + ghost removal the board looks like ONE view of it (no doubled edges), clearly better than before */
    /** scene 17 with a near board between horizon frames 0 and 1 (a bit towards 1), camera centres moved by 2.5-4 cm per frame */
    static Scene boardScene(Board[] bdOut, double[][][] csOut) {
        Scene s = scene(17, 0, 2, null);
        Random r = new Random(99);
        double y0 = Math.atan2(-s.Rt[0][2], -s.Rt[0][5]) / D, y1 = Math.atan2(-s.Rt[1][2], -s.Rt[1][5]) / D;
        Board bd = new Board(y0 + wrap180(y1 - y0) * .6, 5);
        double[][] cs = new double[s.n][];
        for (int i = 0; i < s.n; i++) {
            double ax = r.nextGaussian(), ay = r.nextGaussian(), az = r.nextGaussian() * .3, nn = Math.sqrt(ax * ax + ay * ay + az * az), L = .025 + .015 * r.nextDouble();
            cs[i] = new double[]{ax / nn * L, ay / nn * L, az / nn * L};
            Mat img = renderBoard(s.Rt[i], cs[i], bd, FW, FH);
            Mat fl = new Mat();
            img.convertTo(fl, CvType.CV_32FC3);
            Core.multiply(fl, new Scalar(s.gain[i][0], s.gain[i][1], s.gain[i][2]), fl);
            fl.convertTo(img, CvType.CV_8UC3);
            s.jpeg[i] = jpg(img, 92);
            img.release(); fl.release();
        }
        bdOut[0] = bd; csOut[0] = cs;
        return s;
    }

    @Test
    void parallaxGhostsRemoved() {
        Scene s = scene(17, 0, 2, null);
        Random r = new Random(99);
        // the board sits on the border between two horizon frames (frames 0 and 1 of the horizon row), a bit towards frame 1
        double y0 = Math.atan2(-s.Rt[0][2], -s.Rt[0][5]) / D, y1 = Math.atan2(-s.Rt[1][2], -s.Rt[1][5]) / D;
        Board bd = new Board(y0 + wrap180(y1 - y0) * .6, 5);
        double[][] cs = new double[s.n][];
        for (int i = 0; i < s.n; i++) {
            double ax = r.nextGaussian(), ay = r.nextGaussian(), az = r.nextGaussian() * .3, nn = Math.sqrt(ax * ax + ay * ay + az * az), L = .025 + .015 * r.nextDouble();
            cs[i] = new double[]{ax / nn * L, ay / nn * L, az / nn * L};
            Mat img = renderBoard(s.Rt[i], cs[i], bd, FW, FH);
            Mat fl = new Mat();
            img.convertTo(fl, CvType.CV_32FC3);
            Core.multiply(fl, new Scalar(s.gain[i][0], s.gain[i][1], s.gain[i][2]), fl);
            fl.convertTo(img, CvType.CV_8UC3);
            s.jpeg[i] = jpg(img, 92);
            img.release(); fl.release();
        }
        PanoStitchCore.Options off = new PanoStitchCore.Options();
        off.smartSeams = false; off.meshWarp = false; off.deghost = false;
        off.graphCut = false; // "before" = the stage 21c seams (21f: the graph cut alone already gives 0 wrong pixels here)
        long t = System.currentTimeMillis();
        PanoStitchCore.Result r0 = stitchOpt(s, 2048, off, null);
        long ms0 = System.currentTimeMillis() - t;
        t = System.currentTimeMillis();
        PanoStitchCore.Result r1 = stitchOpt(s, 2048, new PanoStitchCore.Options(), null);
        long ms1 = System.currentTimeMillis() - t;
        double[] G0 = gauge(mats(r0), s.Rt, null), G1 = gauge(mats(r1), s.Rt, null);
        double[] b0 = boardScore(r0.pano, s.yawRef, G0, bd, cs, s.Rt), b1 = boardScore(r1.pano, s.yawRef, G1, bd, cs, s.Rt);
        double p0 = psnr(r0.pano, s.yawRef, G0), p1 = psnr(r1.pano, s.yawRef, G1);
        Imgcodecs.imwrite(new File(OUT, "parallax-before-2048.jpg").getPath(), r0.pano);
        Imgcodecs.imwrite(new File(OUT, "parallax-after-2048.jpg").getPath(), r1.pano);
        PanoStitchCore.Stats st = r1.stats;
        System.out.println("parallax: board vs one view: ZNCC " + f2(b0[0]) + " -> " + f2(b1[0]) + ", wrong pixels " + f2(100 * b0[1]) + "% -> " + f2(100 * b1[1]) + "%; PSNR (whole) " + f2(p0) + " -> " + f2(p1) + " dB; mesh warp "
                + st.warpPts + " points, residual median " + f2(st.warpMedDeg) + " -> " + f2(st.warpMedAfterDeg) + " deg (p90 " + f2(st.warpP90Deg) + " -> " + f2(st.warpP90AfterDeg)
                + "); ghost regions " + st.ghostRegions + "; " + ms0 + " -> " + ms1 + " ms (seam stage " + st.msSeam + " ms)");
        r0.pano.release(); r1.pano.release(); bd.tex.release();
        assertTrue(r1.stats.optimized, "optimised");
        assertTrue(b1[1] < .6 * b0[1] && b1[0] >= b0[0] - .01, "board looks like one view: wrong pixels " + b0[1] + " -> " + b1[1] + ", ZNCC " + b0[0] + " -> " + b1[0]);
        assertTrue(p1 > p0 - .5, "no loss elsewhere: " + p0 + " -> " + p1);
        assertTrue(st.warpMedAfterDeg <= st.warpMedDeg + 1e-9, "warp reduces the residual");
    }

    /** PSNR of the cap below latMax (degrees), vs the ground truth seen through gauge G, after a per-channel brightness fit */
    static double psnrCap(Mat pano, double yawRef, double[] G, double latMax) {
        int W = pano.cols(), H = pano.rows();
        byte[] a = new byte[W * H * 3], gp = new byte[gt.cols() * gt.rows() * 3];
        pano.get(0, 0, a);
        gt.get(0, 0, gp);
        int y0 = (int) Math.ceil((.5 - latMax / 180) * H);
        double[] sab = new double[3], saa = new double[3];
        List<double[]> px = new ArrayList<>();
        for (int y = y0; y < H; y++) for (int x = 0; x < W; x++) {
            double[] d = PanoStitchCore.eqDir(x, y, W, H, yawRef);
            double[] g = {G[0] * d[0] + G[1] * d[1] + G[2] * d[2], G[3] * d[0] + G[4] * d[1] + G[5] * d[2], G[6] * d[0] + G[7] * d[1] + G[8] * d[2]};
            double lon = Math.atan2(g[0], g[1]) / D, lat = Math.asin(Math.max(-1, Math.min(1, g[2]))) / D;
            int gx = Math.floorMod((int) ((lon / 360 + .5) * gt.cols()), gt.cols()), gy = Math.max(0, Math.min(gt.rows() - 1, (int) ((.5 - lat / 180) * gt.rows())));
            int k = (y * W + x) * 3, kg = (gy * gt.cols() + gx) * 3;
            double[] v = new double[6];
            for (int c = 0; c < 3; c++) { v[c] = a[k + c] & 255; v[3 + c] = gp[kg + c] & 255; sab[c] += v[c] * v[3 + c]; saa[c] += v[c] * v[c]; }
            px.add(v);
        }
        double se = 0;
        for (double[] v : px) for (int c = 0; c < 3; c++) { double e = v[c] * sab[c] / saa[c] - v[3 + c]; se += e * e; }
        return 10 * Math.log10(255.0 * 255.0 / (se / (3.0 * px.size())));
    }

    /** 21e: feet (a dark blob around the nadir) in the normal frames; an extra frame with role "nadir" (clean floor, sensor pose
     *  2 degrees off) replaces them. Without it the feet stay */
    @Test
    void nadirFrameReplacesFeet() {
        Scene s0 = scene(21, 0, 2, null);
        int n0 = s0.n;
        // feet: every normal frame shows a dark disc of radius 13 degrees around the nadir
        double f = (Math.max(FW, FH) / 2.0) / Math.tan(FOV_TRUE * D / 2);
        for (int i = 0; i < n0; i++) {
            Mat img = Imgcodecs.imdecode(new MatOfByte(s0.jpeg[i]), Imgcodecs.IMREAD_COLOR);
            byte[] px = new byte[FW * FH * 3];
            img.get(0, 0, px);
            boolean any = false;
            for (int v = 0; v < FH; v++) for (int u = 0; u < FW; u++) {
                double[] d = pixDir(s0.Rt[i], u + .5, v + .5, f, FW, FH);
                if (d[2] > -Math.cos(13 * D)) continue;
                int k = (v * FW + u) * 3;
                px[k] = 25; px[k + 1] = 28; px[k + 2] = (byte) (35 + (((u / 40) + (v / 40)) % 2) * 20);
                any = true;
            }
            if (any) { img.put(0, 0, px); s0.jpeg[i] = jpg(img, 92); }
            img.release();
        }
        // the extra nadir frame: true pose straight down (yaw 30, roll 5), sensor 2 degrees off, no feet
        Scene s = new Scene();
        s.n = n0 + 1; s.yawRef = s0.yawRef;
        s.Rt = java.util.Arrays.copyOf(s0.Rt, s.n); s.Rs = java.util.Arrays.copyOf(s0.Rs, s.n); s.jpeg = java.util.Arrays.copyOf(s0.jpeg, s.n);
        s.gain = java.util.Arrays.copyOf(s0.gain, s.n);
        s.Rt[n0] = camMat(30, -89, 5);
        s.Rs[n0] = mul(rotVec(new double[]{1.2 * D, -1.1 * D, .9 * D}), s.Rt[n0]);
        Mat nimg = render(s.Rt[n0], FOV_TRUE, FW, FH);
        s.jpeg[n0] = jpg(nimg, 92);
        nimg.release();
        String[] roles = new String[s.n];
        roles[n0] = "nadir";
        PanoStitchCore.Result rA = stitchOpt(s0, 2048, new PanoStitchCore.Options(), null);
        PanoStitchCore.Result rB = stitchOpt(s, 2048, new PanoStitchCore.Options(), roles);
        double[][] mB = mats(rB);
        double[] GA = gauge(mats(rA), s0.Rt, null), GB = gauge(mB, s.Rt, null);
        double pA = psnrCap(rA.pano, s.yawRef, GA, -72), pB = psnrCap(rB.pano, s.yawRef, GB, -72);
        double eN = PanoStitchCore.angDeg(mul(GB, mB[n0]), s.Rt[n0]), eS = PanoStitchCore.angDeg(s.Rs[n0], s.Rt[n0]);
        double pMain = psnr(rB.pano, s.yawRef, GB), pMainA = psnr(rA.pano, s.yawRef, GA);
        Imgcodecs.imwrite(new File(OUT, "nadir-without-2048.jpg").getPath(), rA.pano);
        Imgcodecs.imwrite(new File(OUT, "nadir-with-2048.jpg").getPath(), rB.pano);
        System.out.println("nadir frame: PSNR below -72 deg " + f2(pA) + " (feet) -> " + f2(pB) + " dB; nadir frame registered=" + rB.stats.nadirRegistered
                + " change " + f2(rB.stats.nadirCorrDeg) + " deg, pose error " + f2(eN) + " deg (sensor " + f2(eS) + "); PSNR |lat|<70 " + f2(pMainA) + " -> " + f2(pMain) + " dB");
        rA.pano.release(); rB.pano.release();
        assertEquals(1, rB.stats.nadirFrames);
        assertTrue(rB.stats.optimized, "optimised");
        assertTrue(pB > pA + 5, "feet replaced: " + pA + " -> " + pB);
        assertTrue(eN < eS, "nadir pose refined: " + eN + " vs sensor " + eS);
        assertTrue(pMain > pMainA - .5, "rest unchanged");
        // a bad role is refused
        boolean thrown = false;
        try { new PanoStitchCore(2, null).setFrame(0, s.jpeg[0], q(s.Rs[0]), "zenith"); } catch (IllegalArgumentException e) { thrown = true; }
        assertTrue(thrown, "unknown role refused");
    }

    /* ---------------------------------------------------------------- stage 21f: graph cut, HDR, 8192 ---------------------------------------------------------------- */

    /** 21f: graph-cut seams vs the DP seams on the board scene: the board is not more ghosted (wrong pixels / ZNCC), with the seams
     *  alone (warp + ghost removal off) and with everything on; PSNR elsewhere not lower */
    @Test
    void graphCutSeamsNotWorseThanDp() {
        Board[] bb = new Board[1];
        double[][][] cc = new double[1][][];
        Scene s = boardScene(bb, cc);
        Board bd = bb[0];
        double[][] cs = cc[0];
        StringBuilder sb = new StringBuilder("graph cut vs DP seams (board): ");
        for (int v = 0; v < 2; v++) {
            double[][] sc = new double[2][];
            double[] ps = new double[2];
            long[] ms = new long[2];
            for (int g = 0; g < 2; g++) {
                PanoStitchCore.Options o = new PanoStitchCore.Options();
                o.graphCut = g == 1;
                if (v == 0) { o.meshWarp = false; o.deghost = false; }
                PanoStitchCore.Result r = stitchOpt(s, 2048, o, null);
                double[] G = gauge(mats(r), s.Rt, null);
                sc[g] = boardScore(r.pano, s.yawRef, G, bd, cs, s.Rt);
                ps[g] = psnr(r.pano, s.yawRef, G);
                ms[g] = r.stats.msSeam;
                if (g == 1) assertTrue(r.stats.gcPairs > 0 && r.stats.dpPairs == 0, "graph cut used: " + r.stats.gcPairs + " / " + r.stats.dpPairs);
                Imgcodecs.imwrite(new File(OUT, "seams-" + (v == 0 ? "only" : "all") + "-" + (g == 1 ? "gc" : "dp") + "-2048.jpg").getPath(), r.pano);
                r.pano.release();
            }
            sb.append(v == 0 ? "[seams only] " : "[all on] ").append("wrong pixels ").append(f2(100 * sc[0][1])).append("% -> ").append(f2(100 * sc[1][1]))
                    .append("%, ZNCC ").append(f2(sc[0][0])).append(" -> ").append(f2(sc[1][0])).append(", PSNR ").append(f2(ps[0])).append(" -> ").append(f2(ps[1]))
                    .append(" dB, seam stage ").append(ms[0]).append(" -> ").append(ms[1]).append(" ms; ");
            assertTrue(sc[1][1] <= sc[0][1] + .01 && sc[1][0] >= sc[0][0] - .02, sb.toString());
            assertTrue(ps[1] > ps[0] - .3, sb.toString());
        }
        bd.tex.release();
        System.out.println(sb);
    }

    /** a bright lamp (radiance up to 3x white) at (yaw, 15 deg), radius 7 deg, with a texture: radiance (0..~765) of direction d or -1 */
    static double lamp(double[] d, double yaw) {
        double[] c = dirOf(yaw, 15);
        double cosA = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
        if (cosA < Math.cos(7 * D)) return -1;
        double lon = Math.atan2(d[0], d[1]), lat = Math.asin(d[2]);
        return 255 * (1.9 + 1.0 * Math.sin(lon * 90) * Math.cos(lat * 70));
    }

    /** frame with the lamp, exposure x k (radiance clipped at 255), camera m */
    static Mat renderLamp(double[] m, double yaw, double k, double[] gain, Random rnd) {
        Mat img = render(m, FOV_TRUE, FW, FH), fl = new Mat();
        img.convertTo(fl, CvType.CV_32FC3);
        img.release();
        float[] px = new float[FW * FH * 3];
        fl.get(0, 0, px);
        double f = (Math.max(FW, FH) / 2.0) / Math.tan(FOV_TRUE * D / 2);
        double[] pc = PanoStitchCore.project(m, dirOf(yaw, 15), FOV_TRUE, FW, FH);
        boolean near = pc != null && pc[0] > -FW * .3 && pc[0] < FW * 1.3 && pc[1] > -FH * .3 && pc[1] < FH * 1.3;
        for (int v = 0; v < FH; v++) for (int u = 0; u < FW; u++) {
            int q = (v * FW + u) * 3;
            double L = near ? lamp(pixDir(m, u + .5, v + .5, f, FW, FH), yaw) : -1;
            for (int c = 0; c < 3; c++) {
                double val = (L >= 0 ? L * (c == 0 ? .85 : 1) : px[q + c]) * k * gain[c] + rnd.nextGaussian() * 2;
                px[q + c] = (float) Math.max(0, Math.min(255, val));
            }
        }
        fl.put(0, 0, px);
        Mat out = new Mat();
        fl.convertTo(out, CvType.CV_8UC3);
        fl.release();
        return out;
    }

    /** {fraction of clipped pixels (max channel >= 250), std of the grey level} inside 5 deg of the lamp centre */
    static double[] lampStats(Mat pano, double yawRef, double[] G, double yaw) {
        int W = pano.cols(), H = pano.rows();
        byte[] a = new byte[W * H * 3];
        pano.get(0, 0, a);
        double[] c = dirOf(yaw, 15);
        int n = 0, cl = 0;
        double s = 0, s2 = 0;
        for (int y = 0; y < H / 2; y++) for (int x = 0; x < W; x++) {
            double[] d = PanoStitchCore.eqDir(x, y, W, H, yawRef);
            double[] g = {G[0] * d[0] + G[1] * d[1] + G[2] * d[2], G[3] * d[0] + G[4] * d[1] + G[5] * d[2], G[6] * d[0] + G[7] * d[1] + G[8] * d[2]};
            if (g[0] * c[0] + g[1] * c[1] + g[2] * c[2] < Math.cos(5 * D)) continue;
            int k = (y * W + x) * 3, b = a[k] & 255, gg = a[k + 1] & 255, r = a[k + 2] & 255;
            if (Math.max(b, Math.max(gg, r)) >= 250) cl++;
            double l = .114 * b + .587 * gg + .299 * r;
            s += l; s2 += l * l; n++;
        }
        return new double[]{cl / (double) n, Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n)))};
    }

    /** 21f HDR: every target shot at ev -1 / 0 / +1 (x 1/4, 1, 4), the brackets moved by up to 0.4 deg (the hand moves); groups are
     *  aligned + fused (Mertens): the lamp keeps its texture (much less clipping than the ev 0 frames alone), the rest stays sharp */
    @Test
    void hdrGroupsRecoverClippedLamp() {
        Scene s0 = scene(31, 0, 2, null);
        Random rnd = new Random(5);
        double yaw = Math.atan2(-s0.Rt[0][2], -s0.Rt[0][5]) / D + 8;
        int n0 = s0.n;
        // the direct alignment: a darker bracket shifted by (6.4, -3.1) px and rotated by 0.3 deg is found
        {
            Mat a = renderLamp(s0.Rt[0], yaw, 1, new double[]{1, 1, 1}, rnd), b0 = renderLamp(s0.Rt[0], yaw, .25, new double[]{1, 1, 1}, rnd), b = new Mat();
            double th = .3 * D, tx = 6.4, ty = -3.1;
            Mat M = new Mat(2, 3, CvType.CV_64F);
            M.put(0, 0, Math.cos(th), -Math.sin(th), tx, Math.sin(th), Math.cos(th), ty);
            Imgproc.warpAffine(b0, b, M, b0.size(), Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE); // b(A x) = b0(x)
            double[] w = PanoStitchCore.alignEcc(a, b);
            assertTrue(w != null, "aligned");
            // error of the found mapping at the centre and the corners (pixels)
            double eC = 0, eMax = 0;
            for (double[] pt : new double[][]{{FW / 2.0, FH / 2.0}, {0, 0}, {FW, 0}, {0, FH}, {FW, FH}}) {
                double ex = w[0] * pt[0] + w[1] * pt[1] + w[2] - (Math.cos(th) * pt[0] - Math.sin(th) * pt[1] + tx);
                double ey = w[3] * pt[0] + w[4] * pt[1] + w[5] - (Math.sin(th) * pt[0] + Math.cos(th) * pt[1] + ty);
                double e = Math.hypot(ex, ey);
                if (eC == 0) eC = Math.max(1e-9, e);
                eMax = Math.max(eMax, e);
            }
            System.out.println("hdr align: found shift " + f2(w[2]) + ", " + f2(w[5]) + " px, rotation " + f2(Math.atan2(w[3], w[0]) / D) + " deg (true " + tx + ", " + ty
                    + ", 0.3); error centre " + f2(eC) + " px, worst corner " + f2(eMax) + " px");
            // ECC on 800 px grey images (phone time): ~0.7 px at 1600 px, i.e. ~0.3 px of the 4096 output
            assertTrue(eC < 1 && eMax < 2, "alignment: centre " + eC + " corners " + eMax);
            a.release(); b0.release(); b.release(); M.release();
        }
        int nb = 3 * n0;
        byte[][] jp = new byte[nb][];
        double[][] qs = new double[nb][];
        int[] gs = new int[nb], evs = new int[nb];
        byte[][] j0 = new byte[n0][];
        for (int i = 0; i < n0; i++) {
            for (int e = -1; e <= 1; e++) {
                int k = 3 * i + e + 1;
                double[] m = s0.Rt[i];
                if (e != 0) { // the camera moved a little between the shots
                    double ang = (.15 + .25 * rnd.nextDouble()) * D, ax = rnd.nextGaussian(), ay = rnd.nextGaussian(), az = rnd.nextGaussian(), nn = Math.sqrt(ax * ax + ay * ay + az * az);
                    m = mul(rotVec(new double[]{ax / nn * ang, ay / nn * ang, az / nn * ang}), m);
                }
                Mat img = renderLamp(m, yaw, Math.pow(4, e), s0.gain[i], rnd);
                jp[k] = jpg(img, 92);
                img.release();
                qs[k] = q(s0.Rs[i]); // the sensor pose of the target (as the phone reports for the bracket)
                gs[k] = i; evs[k] = e;
                if (e == 0) j0[i] = jp[k];
            }
        }
        PanoStitchCore.Options oA = new PanoStitchCore.Options();
        oA.W = 2048; oA.fovL = FOV_GIVEN; oA.yawRef = s0.yawRef;
        PanoStitchCore cA = new PanoStitchCore(n0, oA);
        for (int i = 0; i < n0; i++) cA.setFrame(i, j0[i], q(s0.Rs[i]));
        PanoStitchCore.Result rA = cA.run(null);
        PanoStitchCore.Options oB = new PanoStitchCore.Options();
        oB.W = 2048; oB.fovL = FOV_GIVEN; oB.yawRef = s0.yawRef;
        PanoStitchCore cB = new PanoStitchCore(nb, oB);
        for (int k = 0; k < nb; k++) cB.setFrame(k, jp[k], qs[k], null, gs[k], evs[k]);
        final double[] last = {0};
        PanoStitchCore.Result rB = cB.run(p -> { assertTrue(p >= last[0] - 1e-9, "progress goes forward"); last[0] = p; });
        assertEquals(1.0, last[0], 1e-9);
        double[] GA = gauge(mats(rA), s0.Rt, null), GB = gauge(mats(rB), s0.Rt, null);
        double[] la = lampStats(rA.pano, s0.yawRef, GA, yaw), lb = lampStats(rB.pano, s0.yawRef, GB, yaw);
        double pA = psnr(rA.pano, s0.yawRef, GA), pB = psnr(rB.pano, s0.yawRef, GB);
        Imgcodecs.imwrite(new File(OUT, "hdr-ev0-2048.jpg").getPath(), rA.pano);
        Imgcodecs.imwrite(new File(OUT, "hdr-fused-2048.jpg").getPath(), rB.pano);
        PanoStitchCore.Stats st = rB.stats;
        System.out.println("hdr: " + st.inputFrames + " brackets -> " + st.frames + " frames (" + st.hdrGroups + " groups, aligned " + st.hdrAligned + ", not aligned "
                + st.hdrAlignFailed + ", " + st.msHdr + " ms); lamp clipped " + f2(100 * la[0]) + "% -> " + f2(100 * lb[0]) + "%, texture std " + f2(la[1]) + " -> " + f2(lb[1])
                + "; PSNR |lat|<70 " + f2(pA) + " -> " + f2(pB) + " dB; optimised " + rB.stats.optimized + ", frameIndex[1] " + rB.frameIndex[1]);
        rA.pano.release(); rB.pano.release();
        assertEquals(n0, st.frames);
        assertEquals(n0, st.hdrGroups);
        assertEquals(4, rB.frameIndex[1]);
        assertTrue(st.hdrAligned >= 2 * n0 * .9, "brackets aligned: " + st.hdrAligned);
        assertTrue(rB.stats.optimized, "optimised");
        assertTrue(la[0] > .5, "the ev 0 lamp is clipped: " + la[0]);
        assertTrue(lb[0] < .5 * la[0], "less clipping: " + la[0] + " -> " + lb[0]);
        assertTrue(lb[1] > la[1] * 1.5, "lamp texture recovered: std " + la[1] + " -> " + lb[1]);
        assertTrue(pB > pA - 3, "the rest stays sharp: " + pA + " -> " + pB);
    }

    /** 21f: the strip blend == the whole-canvas blend (2048, PSNR between the two outputs), and W = 8192 completes in strips within
     *  the memory estimate, with a sane PSNR vs the ground truth */
    @Test
    void stripBlendAnd8192() {
        Scene s = scene(7, 0, 2, null);
        PanoStitchCore.Options oW = new PanoStitchCore.Options(), oS = new PanoStitchCore.Options();
        oW.stripBlend = -1; oS.stripBlend = 1;
        PanoStitchCore.Result rW = stitchOpt(s, 2048, oW, null), rS = stitchOpt(s, 2048, oS, null);
        double same = Core.PSNR(rW.pano, rS.pano);
        System.out.println("strip blend vs whole canvas (2048): PSNR " + f2(same) + " dB, strips " + rS.stats.strips + ", memory estimate " + f2(rW.stats.memEstMB) + " -> " + f2(rS.stats.memEstMB) + " MB");
        Imgcodecs.imwrite(new File(OUT, "strips-2048.jpg").getPath(), rS.pano);
        assertTrue(rW.stats.strips == 0 && rS.stats.strips >= 1, "paths");
        // the low bands come from a direct low-res warp instead of the full-res pyramid: smooth differences (mean ~1.6 grey levels at
        // mid latitudes, more near the poles; 35.4 dB on this scene, 39.8 dB on the real capture raw2), no visible change
        assertTrue(same > 34, "strip blend ~ whole canvas: " + same);
        rW.pano.release(); rS.pano.release();
        long t = System.currentTimeMillis();
        PanoStitchCore.Result r = stitchOpt(s, 8192, new PanoStitchCore.Options(), null);
        long ms = System.currentTimeMillis() - t;
        double[] G = gauge(mats(r), s.Rt, null);
        double p = psnr(r.pano, s.yawRef, G);
        Mat small = new Mat();
        Imgproc.resize(r.pano, small, new Size(4096, 2048), 0, 0, Imgproc.INTER_AREA);
        Imgcodecs.imwrite(new File(OUT, "w8192-as-4096.jpg").getPath(), small);
        System.out.println("8192: " + r.pano.cols() + "x" + r.pano.rows() + " in " + ms + " ms (blend " + r.stats.msBlend + "), strips " + r.stats.strips + ", memory estimate "
                + f2(r.stats.memEstMB) + " MB, PSNR vs ground truth " + f2(p) + " dB, holes " + f2(r.stats.holesPct) + "%");
        assertEquals(8192, r.pano.cols());
        assertEquals(4096, r.pano.rows());
        assertTrue(r.stats.strips > 1 && r.stats.memEstMB <= 600, "strips within the budget: " + r.stats.memEstMB);
        assertTrue(p > 27, "sane PSNR at 8192: " + p);
        small.release(); r.pano.release();
    }
}
