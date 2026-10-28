package com.largepami.finance;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Live update ("עדכון חי") of the app screens (the www folder), from Firebase Hosting.
 *
 * Plain Java on purpose (no Android classes), so the same file is tested on a computer.
 * LiveUpdatePlugin connects it to Android and to Capacitor.
 *
 * Rules:
 * - Nothing from the server is used before the signature of the manifest is checked
 *   with the public key that is built into the app (ECDSA P-256, SHA-256).
 * - The signed manifest lists every file with its SHA-256 and size. The ZIP must match its
 *   signed SHA-256, and every file in it must match. A missing or extra file = rejected.
 * - Only a version newer than everything this phone already ran or tried is accepted
 *   (an attacker cannot send an old, vulnerable bundle back).
 * - A new bundle is used only from the next start, as a "trial". If it does not report
 *   "ready", the next start (or the watchdog) goes back to the previous version, or to the
 *   version built into the APK if there is no previous one.
 * - Any problem (no internet, server error, bad file) changes nothing: the app keeps
 *   starting from the last version that worked.
 */
public class LiveUpdateCore {

    /** Small key-value storage (SharedPreferences on Android, a file in the tests). */
    public interface Store {
        String get(String key);

        void put(String key, String value);
    }

    static final String K_APK = "apk";
    static final String K_ACTIVE = "active";
    static final String K_PREV = "previous";
    static final String K_PENDING = "pending";
    static final String K_TRIAL = "trial";
    static final String K_FLOOR = "floor";
    static final String K_LOG = "log";

    static final int MAX_MANIFEST = 512 * 1024;
    static final long MAX_ZIP = 150L * 1024 * 1024;
    static final long MAX_TOTAL = 300L * 1024 * 1024;
    static final int MAX_FILES = 5000;
    static final Pattern SAFE_PATH = Pattern.compile("^[A-Za-z0-9_\\-]+(\\.[A-Za-z0-9_\\-]+)*(/[A-Za-z0-9_\\-]+(\\.[A-Za-z0-9_\\-]+)*)*$");
    static final Pattern HEX64 = Pattern.compile("^[0-9a-f]{64}$");
    static final Pattern BUNDLE = Pattern.compile("^bundles/[0-9]{1,12}\\.zip$");

    /** Thrown when a manifest or a bundle must be rejected. */
    public static class Reject extends Exception {
        public Reject(String m) {
            super(m);
        }
    }

    /** The signed content of manifest.json. */
    public static class Manifest {
        public long version;
        public String nativeId;
        public String bundle;
        public String zipSha;
        public long zipSize;
        public final Map<String, String[]> files = new LinkedHashMap<String, String[]>();
    }

    private final File base;
    private final Store st;
    private final byte[] publicKey;
    private final String nativeId;
    private final long apkVersion;
    private final String manifestUrl;
    private final AtomicBoolean busy = new AtomicBoolean(false);

    /**
     * @param base        folder for the bundles (inside the app's private files)
     * @param publicKey   the built-in public key (DER, SubjectPublicKeyInfo), or null = live update off
     * @param nativeId    fingerprint of the native code of this APK (bundles for other native code are skipped)
     * @param apkVersion  versionCode of the installed APK (= the version of the built-in screens)
     * @param manifestUrl https address of app-updates/manifest.json, or "" = live update off
     */
    public LiveUpdateCore(File base, Store st, byte[] publicKey, String nativeId, long apkVersion, String manifestUrl) {
        this.base = base;
        this.st = st;
        this.publicKey = publicKey;
        this.nativeId = nativeId == null ? "" : nativeId;
        this.apkVersion = apkVersion;
        this.manifestUrl = manifestUrl == null ? "" : manifestUrl;
    }

    public boolean enabled() {
        return publicKey != null && publicKey.length > 0 && manifestUrl.length() > 0 && nativeId.length() > 0;
    }

    // ---------------------------------------------------------------- state

    private long num(String k) {
        try {
            String v = st.get(k);
            return v == null || v.length() == 0 ? 0 : Long.parseLong(v);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private void set(String k, long v) {
        st.put(k, Long.toString(v));
    }

    private void log(String m) {
        st.put(K_LOG, System.currentTimeMillis() + " " + m);
    }

    File dir(long v) {
        return new File(base, "b" + v);
    }

    private boolean usable(long v) {
        return v > 0 && new File(dir(v), ".verified").isFile() && new File(dir(v), "index.html").isFile();
    }

    /**
     * Once per app start, before the screens load. Returns the folder to show the screens from,
     * or "" for the version built into the APK.
     */
    public synchronized String boot() {
        if (num(K_APK) != apkVersion) {
            // A new APK was installed. Capacitor also goes back to the built-in screens in this case.
            set(K_APK, apkVersion);
            set(K_ACTIVE, 0);
            set(K_PREV, 0);
            set(K_PENDING, 0);
            set(K_TRIAL, 0);
            set(K_FLOOR, Math.max(num(K_FLOOR), apkVersion));
            log("app version " + apkVersion + ": built-in screens");
        }
        if (num(K_TRIAL) != 0) {
            // The previous start was the first start of a new bundle, and it never said "ready".
            rollback("bundle " + num(K_TRIAL) + " did not start");
        } else {
            long pending = num(K_PENDING);
            if (pending != 0) {
                set(K_PENDING, 0);
                if (pending > num(K_ACTIVE) && pending > apkVersion && usable(pending)) {
                    set(K_PREV, num(K_ACTIVE));
                    set(K_ACTIVE, pending);
                    set(K_TRIAL, pending);
                    set(K_FLOOR, Math.max(num(K_FLOOR), pending));
                    log("bundle " + pending + ": first start (trial)");
                }
            }
        }
        long active = num(K_ACTIVE);
        if (active != 0 && !usable(active)) {
            log("bundle " + active + " is missing: built-in screens");
            set(K_ACTIVE, 0);
            set(K_TRIAL, 0);
            active = 0;
        }
        cleanup();
        return active == 0 ? "" : dir(active).getAbsolutePath();
    }

    private void rollback(String why) {
        long trial = num(K_TRIAL);
        long prev = num(K_PREV);
        long to = prev != trial && usable(prev) ? prev : 0;
        set(K_TRIAL, 0);
        set(K_ACTIVE, to);
        set(K_PREV, 0);
        log("rollback: " + why + " -> " + (to == 0 ? "built-in screens" : "bundle " + to));
    }

    /** The screens report "I started OK". Only the version that is on trial is confirmed. */
    public synchronized boolean ready(long version) {
        long trial = num(K_TRIAL);
        if (trial != 0 && trial == version && num(K_ACTIVE) == trial) {
            set(K_TRIAL, 0);
            log("bundle " + trial + " started OK");
            return true;
        }
        return false;
    }

    public synchronized boolean inTrial() {
        return num(K_TRIAL) != 0;
    }

    /**
     * Watchdog: if the bundle on trial still did not say "ready", go back now.
     * Returns the folder to show now ("" = built-in), or null if nothing changed.
     */
    public synchronized String rollbackIfStillTrial(String why) {
        if (num(K_TRIAL) == 0) return null;
        rollback(why);
        long a = num(K_ACTIVE);
        return a == 0 ? "" : dir(a).getAbsolutePath();
    }

    public synchronized Map<String, String> status() {
        Map<String, String> m = new LinkedHashMap<String, String>();
        m.put("enabled", Boolean.toString(enabled()));
        m.put("builtin", Long.toString(apkVersion));
        m.put("active", Long.toString(num(K_ACTIVE)));
        m.put("previous", Long.toString(num(K_PREV)));
        m.put("pending", Long.toString(num(K_PENDING)));
        m.put("trial", Long.toString(num(K_TRIAL)));
        m.put("floor", Long.toString(num(K_FLOOR)));
        String l = st.get(K_LOG);
        m.put("log", l == null ? "" : l);
        return m;
    }

    /** Deletes bundle folders that are not active, previous or pending, and leftovers of downloads. */
    private void cleanup() {
        File[] list = base.listFiles();
        if (list == null) return;
        long a = num(K_ACTIVE), p = num(K_PREV), n = num(K_PENDING);
        for (File f : list) {
            String name = f.getName();
            if (name.matches("^b[0-9]+$")) {
                long v = Long.parseLong(name.substring(1));
                if (v != a && v != p && v != n) deleteTree(f);
            } else if (name.endsWith(".tmp") && !busy.get()) {
                deleteTree(f);
            }
        }
    }

    // ---------------------------------------------------------------- check and download

    /**
     * Checks the manifest, and if there is a newer valid bundle, downloads and verifies it, and
     * keeps it for the next start. Runs in the background. Never throws: returns a short result.
     */
    public String check() {
        if (!enabled()) return "disabled";
        if (!busy.compareAndSet(false, true)) return "busy";
        File zip = new File(base, "download.tmp");
        File work = null;
        try {
            if (!base.isDirectory() && !base.mkdirs()) throw new IOException("cannot create " + base);
            URL mUrl = new URL(manifestUrl);
            byte[] raw = fetch(mUrl, MAX_MANIFEST);
            Manifest m = verifyManifest(raw);
            if (!nativeId.equals(m.nativeId)) {
                return "skip: bundle " + m.version + " is for different native code (needs an app update)";
            }
            long current;
            long pending;
            synchronized (this) {
                current = Math.max(Math.max(num(K_FLOOR), apkVersion), num(K_ACTIVE));
                pending = num(K_PENDING);
            }
            if (m.version < current) {
                log("rejected: bundle " + m.version + " is older than " + current);
                return "rejected: older bundle " + m.version + " (current " + current + ")";
            }
            if (m.version == current || m.version == pending) return "up to date (" + Math.max(current, pending) + ")";
            if (pending > m.version) return "up to date (" + pending + " waiting)";

            URL zUrl = new URL(mUrl, m.bundle);
            String got = download(zUrl, zip, m.zipSize);
            if (!got.equals(m.zipSha)) throw new Reject("bundle file does not match the signed SHA-256");
            work = new File(base, "b" + m.version + ".tmp");
            deleteTree(work);
            extract(zip, work, m);
            File dest = dir(m.version);
            deleteTree(dest);
            if (!work.renameTo(dest)) throw new IOException("cannot move the bundle into place");
            work = null;
            synchronized (this) {
                long old = num(K_PENDING);
                set(K_PENDING, m.version);
                if (old != 0 && old != m.version && old != num(K_ACTIVE) && old != num(K_PREV)) deleteTree(dir(old));
                log("bundle " + m.version + " downloaded and verified; used from the next start");
            }
            return "ready: bundle " + m.version + " from the next start";
        } catch (Reject r) {
            log("rejected: " + r.getMessage());
            return "rejected: " + r.getMessage();
        } catch (Exception e) {
            // No internet, server error, full storage... The app keeps the last version that worked.
            return "failed quietly: " + e.getClass().getSimpleName() + ": " + e.getMessage();
        } finally {
            zip.delete();
            if (work != null) deleteTree(work);
            busy.set(false);
        }
    }

    /** Checks the signature first; only then reads the content. */
    public Manifest verifyManifest(byte[] raw) throws Reject {
        String json = new String(raw, StandardCharsets.UTF_8);
        String payloadHex = field(json, "payload");
        String sigHex = field(json, "sig");
        if (payloadHex == null || sigHex == null) throw new Reject("manifest without payload or signature");
        byte[] payload = hex(payloadHex);
        byte[] sig = hex(sigHex);
        if (payload.length == 0 || sig.length == 0) throw new Reject("manifest with an empty payload or signature");
        try {
            PublicKey key = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(publicKey));
            Signature v = Signature.getInstance("SHA256withECDSA");
            v.initVerify(key);
            v.update(payload);
            if (!v.verify(sig)) throw new Reject("wrong signature");
        } catch (Reject r) {
            throw r;
        } catch (Exception e) {
            throw new Reject("wrong signature (" + e.getClass().getSimpleName() + ")");
        }
        return parsePayload(new String(payload, StandardCharsets.UTF_8));
    }

    static Manifest parsePayload(String text) throws Reject {
        String[] lines = text.split("\n", -1);
        if (lines.length < 6 || !"LPLU1".equals(lines[0])) throw new Reject("unknown manifest format");
        Manifest m = new Manifest();
        long total = 0;
        boolean v = false, n = false, b = false, z = false;
        for (int i = 1; i < lines.length; i++) {
            String l = lines[i];
            if (l.length() == 0) continue;
            String[] p = l.split(" ", -1);
            try {
                if (p[0].equals("version") && p.length == 2 && !v) {
                    m.version = Long.parseLong(p[1]);
                    v = true;
                } else if (p[0].equals("native") && p.length == 2 && !n && HEX64.matcher(p[1]).matches()) {
                    m.nativeId = p[1];
                    n = true;
                } else if (p[0].equals("bundle") && p.length == 2 && !b && BUNDLE.matcher(p[1]).matches()) {
                    m.bundle = p[1];
                    b = true;
                } else if (p[0].equals("zip") && p.length == 3 && !z && HEX64.matcher(p[1]).matches()) {
                    m.zipSha = p[1];
                    m.zipSize = Long.parseLong(p[2]);
                    z = true;
                } else if (p[0].equals("file") && p.length == 4 && HEX64.matcher(p[1]).matches() && SAFE_PATH.matcher(p[3]).matches()) {
                    long size = Long.parseLong(p[2]);
                    if (size < 0 || m.files.containsKey(p[3])) throw new Reject("bad file line " + i);
                    total += size;
                    m.files.put(p[3], new String[] {p[1], p[2]});
                } else {
                    throw new Reject("bad manifest line " + i);
                }
            } catch (NumberFormatException e) {
                throw new Reject("bad number in manifest line " + i);
            }
        }
        if (!v || !n || !b || !z) throw new Reject("manifest is missing a field");
        if (m.version <= 0 || !m.bundle.equals("bundles/" + m.version + ".zip")) throw new Reject("version and bundle name do not match");
        if (m.zipSize <= 0 || m.zipSize > MAX_ZIP) throw new Reject("bundle too large");
        if (m.files.isEmpty() || m.files.size() > MAX_FILES || total > MAX_TOTAL) throw new Reject("bad file list");
        if (!m.files.containsKey("index.html")) throw new Reject("index.html is missing from the list");
        return m;
    }

    /** Extracts only the listed files, and checks each one. Any missing, extra or changed file = rejected. */
    void extract(File zip, File dest, Manifest m) throws IOException, Reject {
        Map<String, Boolean> seen = new LinkedHashMap<String, Boolean>();
        ZipInputStream in = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)));
        try {
            ZipEntry e;
            byte[] buf = new byte[65536];
            while ((e = in.getNextEntry()) != null) {
                String name = e.getName();
                if (e.isDirectory()) continue;
                String[] want = m.files.get(name);
                if (want == null) throw new Reject("extra file in bundle: " + name);
                if (seen.containsKey(name)) throw new Reject("file twice in bundle: " + name);
                seen.put(name, Boolean.TRUE);
                File out = new File(dest, name);
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("cannot create " + parent);
                long limit = Long.parseLong(want[1]);
                MessageDigest md = sha256();
                OutputStream os = new FileOutputStream(out);
                long size = 0;
                try {
                    int r;
                    while ((r = in.read(buf)) > 0) {
                        size += r;
                        if (size > limit) throw new Reject("file larger than listed: " + name);
                        md.update(buf, 0, r);
                        os.write(buf, 0, r);
                    }
                } finally {
                    os.close();
                }
                if (size != limit || !hexOf(md.digest()).equals(want[0])) throw new Reject("file does not match its SHA-256: " + name);
            }
        } finally {
            in.close();
        }
        for (String name : m.files.keySet()) {
            if (!seen.containsKey(name)) throw new Reject("missing file in bundle: " + name);
        }
        FileOutputStream ok = new FileOutputStream(new File(dest, ".verified"));
        ok.write(Long.toString(m.version).getBytes(StandardCharsets.UTF_8));
        ok.close();
    }

    // ---------------------------------------------------------------- network

    private static HttpURLConnection open(URL u) throws IOException {
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        c.connect();
        if (c.getResponseCode() != 200) {
            int code = c.getResponseCode();
            c.disconnect();
            throw new IOException("http " + code);
        }
        return c;
    }

    static byte[] fetch(URL u, int max) throws IOException, Reject {
        HttpURLConnection c = open(u);
        try {
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int r;
            while ((r = in.read(buf)) > 0) {
                out.write(buf, 0, r);
                if (out.size() > max) throw new Reject("manifest too large");
            }
            in.close();
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    /** Downloads to a file, with a size limit, and returns the SHA-256 of what was written. */
    static String download(URL u, File to, long expected) throws IOException, Reject {
        HttpURLConnection c = open(u);
        try {
            InputStream in = c.getInputStream();
            OutputStream out = new FileOutputStream(to);
            MessageDigest md = sha256();
            long size = 0;
            try {
                byte[] buf = new byte[65536];
                int r;
                while ((r = in.read(buf)) > 0) {
                    size += r;
                    if (size > expected) throw new Reject("bundle file larger than signed");
                    md.update(buf, 0, r);
                    out.write(buf, 0, r);
                }
            } finally {
                out.close();
                in.close();
            }
            if (size != expected) throw new Reject("bundle file size does not match the signed size");
            return hexOf(md.digest());
        } finally {
            c.disconnect();
        }
    }

    // ---------------------------------------------------------------- helpers

    static String field(String json, String name) {
        Matcher m = Pattern.compile("\"" + name + "\"\\s*:\\s*\"([0-9a-fA-F]*)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static byte[] hex(String s) {
        if (s == null) return new byte[0];
        s = s.trim();
        if (s.length() % 2 != 0) return new byte[0];
        byte[] b = new byte[s.length() / 2];
        for (int i = 0; i < b.length; i++) {
            int hi = Character.digit(s.charAt(2 * i), 16), lo = Character.digit(s.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0) return new byte[0];
            b[i] = (byte) ((hi << 4) | lo);
        }
        return b;
    }

    static String hexOf(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
        return sb.toString();
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
