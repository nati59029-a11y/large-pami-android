package com.largepami.finance;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * "Share" menu of Android: receives files of any type and shared text (ACTION_SEND / ACTION_SEND_MULTIPLE).
 *
 * Every shared file is copied into the app's own cache folder (cache/sharein), under a random name.
 * The name the other app gave is only used as a label (it never becomes a path).
 * kind "doc": image or PDF up to 15MB - the real type is checked from the first bytes (JPEG / PNG / WEBP / GIF / PDF),
 *   not from what the other app claims (these can go to the scan queue).
 * kind "file" (26.11.2026): anything else up to 25MB, with the type the sending app declared (cleaned; default
 *   application/octet-stream). "why" = why it cannot go to the scan queue (type / heic / big). For groups only.
 * kind "text": EXTRA_TEXT of a share without files (no temporary file; the text is in the item).
 *
 * JS side:
 *   getPending()  -> { items: [{id, kind, name, mime, size, why?, text?}], over: N, rejected: [{name, why}] }  and clears the list
 *   read({id})    -> { id, mime, size, dataURL }  and deletes the temporary file
 *   discard({id}) -> deletes the temporary file without reading it
 *   event "shareIn" ({n}) when new files arrived while the app is running (then JS calls getPending()).
 * No storage permission is needed: the sending app grants read access to these files only.
 */
@CapacitorPlugin(name = "ShareIn")
public class ShareInPlugin extends Plugin {

    static final int MAX_FILES = 20;
    static final long MAX_BYTES = 15L * 1024 * 1024;
    /** Any other file (for groups): up to 25MB */
    static final long MAX_ANY = 25L * 1024 * 1024;
    static final int MAX_TEXT = 10000;
    private static final Pattern MIME_OK = Pattern.compile("^[a-z0-9][a-z0-9.+_-]{0,80}/[a-z0-9][a-z0-9.+_-]{0,80}$");
    private static final String DONE = "com.largepami.finance.sharein.done";
    private static final Pattern ID_OK = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    /** One thread: intake and getPending run in order, and the UI thread is never blocked by copying. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Object lock = new Object();
    private final List<JSObject> pending = new ArrayList<>();
    private final List<JSObject> rejected = new ArrayList<>();
    private int over = 0;
    /**
     * true when MainActivity is re-created (savedInstanceState != null: rotation without configChanges,
     * "don't keep activities", process restored). Android then hands over the SAME launch intent again,
     * so it is not taken a second time. Set by MainActivity before super.onCreate().
     */
    static volatile boolean recreated = false;
    /** id -> temporary file. Only ids created here can be read; a path never comes from JS. */
    private final Map<String, Entry> files = new LinkedHashMap<>();

    /** A temporary file and what it is. doc = image/PDF checked from the bytes; otherwise mime is the cleaned declared type. */
    static final class Entry {
        final File f;
        final String mime;
        final boolean doc;

        Entry(File f, String mime, boolean doc) {
            this.f = f;
            this.mime = mime;
            this.doc = doc;
        }
    }

    @Override
    public void load() {
        final File dir = shareDir();
        final Intent first = getActivity() != null && !recreated ? getActivity().getIntent() : null;
        worker.execute(() -> {
            // Left-overs from an earlier run (the app was closed before the screens read them)
            File[] old = dir.listFiles();
            if (old != null) {
                for (File f : old) {
                    // noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
            intake(first, false);
        });
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        worker.execute(() -> intake(intent, true));
    }

    private File shareDir() {
        File d = new File(getContext().getCacheDir(), "sharein");
        if (!d.isDirectory()) {
            // noinspection ResultOfMethodCallIgnored
            d.mkdirs();
        }
        return d;
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> urisOf(Intent intent) {
        List<Uri> out = new ArrayList<>();
        String a = intent.getAction();
        if (Intent.ACTION_SEND.equals(a)) {
            Object u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u instanceof Uri) {
                out.add((Uri) u);
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            ArrayList<Uri> l = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) {
                for (Uri u : l) {
                    if (u != null) {
                        out.add(u);
                    }
                }
            }
        }
        if (out.isEmpty()) {
            ClipData cd = intent.getClipData();
            if (cd != null) {
                for (int i = 0; i < cd.getItemCount(); i++) {
                    Uri u = cd.getItemAt(i).getUri();
                    if (u != null) {
                        out.add(u);
                    }
                }
            }
        }
        // Only content:// (another app's provider). file:// could point at our own private files.
        List<Uri> ok = new ArrayList<>();
        for (Uri u : out) {
            if (ContentResolver.SCHEME_CONTENT.equals(u.getScheme()) && !ok.contains(u)) {
                ok.add(u);
            }
        }
        return ok;
    }

    private void intake(Intent intent, boolean running) {
        if (intent == null) {
            return;
        }
        String a = intent.getAction();
        if (!Intent.ACTION_SEND.equals(a) && !Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            return;
        }
        // Same intent again (activity re-created, or opened from "recent apps"): already handled
        if (intent.getBooleanExtra(DONE, false) || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            return;
        }
        intent.putExtra(DONE, true);
        List<Uri> uris = urisOf(intent);
        if (uris.isEmpty()) {
            // Shared text (a message, a link) - only when no file was shared, so a caption never blocks the scan of an image
            JSObject t = textItem(intent);
            if (t == null) {
                return;
            }
            synchronized (lock) {
                pending.add(t);
            }
            JSObject ev = new JSObject();
            ev.put("n", 1);
            notifyListeners("shareIn", ev, true);
            return;
        }
        int extra = Math.max(0, uris.size() - MAX_FILES);
        if (extra > 0) {
            uris = uris.subList(0, MAX_FILES);
        }
        List<JSObject> got = new ArrayList<>();
        List<JSObject> bad = new ArrayList<>();
        File dir = shareDir();
        String own = getContext().getPackageName();
        for (Uri u : uris) {
            String au = u.getAuthority();
            if (au == null || au.indexOf('@') >= 0 || au.startsWith(own) || ownProvider(au, own)) {
                // Our own FileProvider (cache + external storage): another app must not make us import our own files
                JSObject b = new JSObject();
                b.put("name", cleanName(u.getLastPathSegment()));
                b.put("why", "own");
                bad.add(b);
                continue;
            }
            String name = displayName(u);
            try {
                JSObject it = copyOne(u, name, dir, intent);
                got.add(it);
            } catch (Reject r) {
                JSObject b = new JSObject();
                b.put("name", name);
                b.put("why", r.getMessage());
                bad.add(b);
            } catch (Exception e) {
                JSObject b = new JSObject();
                b.put("name", name);
                b.put("why", "read");
                bad.add(b);
            }
        }
        synchronized (lock) {
            pending.addAll(got);
            rejected.addAll(bad);
            over += extra;
        }
        JSObject ev = new JSObject();
        ev.put("n", got.size());
        // retainUntilConsumed: if the screens did not register yet, the event waits for them
        notifyListeners("shareIn", ev, true);
    }

    /**
     * true when the provider behind this authority belongs to this app (any of its names).
     * "user@authority" (e.g. 0@...) is rejected before this: ContentResolver strips the user part and would open our own provider.
     */
    private boolean ownProvider(String au, String own) {
        try {
            android.content.pm.ProviderInfo pi = getContext().getPackageManager().resolveContentProvider(au, 0);
            return pi != null && own.equals(pi.packageName);
        } catch (Exception e) {
            return true;
        }
    }

    /** A label only: no folders, no control characters, max 80 characters. */
    static String cleanName(String n) {
        if (n == null) {
            return "file";
        }
        String s = n.replace('\\', '/');
        int k = s.lastIndexOf('/');
        if (k >= 0) {
            s = s.substring(k + 1);
        }
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length() && b.length() < 80; i++) {
            char c = s.charAt(i);
            if (c >= 0x20 && c != 0x7f && c != 0x202e && c != 0x202d) {
                b.append(c);
            }
        }
        String r = b.toString().trim();
        if (r.isEmpty() || r.equals(".") || r.equals("..")) {
            return "file";
        }
        return r;
    }

    /** Shared text: no control characters except new line and tab, no direction overrides, max MAX_TEXT characters. */
    static String cleanText(CharSequence cs) {
        if (cs == null) {
            return "";
        }
        String s = cs.toString();
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length() && b.length() < MAX_TEXT; i++) {
            char c = s.charAt(i);
            if ((c >= 0x20 || c == '\n' || c == '\t') && c != 0x7f && c != 0x202e && c != 0x202d) {
                b.append(c);
            }
        }
        return b.toString().trim();
    }

    private static JSObject textItem(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction())) {
            return null;
        }
        String t;
        try {
            t = cleanText(intent.getCharSequenceExtra(Intent.EXTRA_TEXT));
        } catch (Exception e) {
            return null;
        }
        if (t.isEmpty()) {
            return null;
        }
        JSObject it = new JSObject();
        it.put("id", UUID.randomUUID().toString());
        it.put("kind", "text");
        it.put("name", "text");
        it.put("mime", "text/plain");
        it.put("size", t.length());
        it.put("text", t);
        return it;
    }

    /** The type another app declared: only a plain "type/subtype" (no wildcard, no parameters), else application/octet-stream. */
    static String cleanMime(String m) {
        if (m == null) {
            return "application/octet-stream";
        }
        String s = m.trim().toLowerCase(java.util.Locale.ROOT);
        int k = s.indexOf(';');
        if (k >= 0) {
            s = s.substring(0, k).trim();
        }
        if (s.length() > 100 || !MIME_OK.matcher(s).matches()) {
            return "application/octet-stream";
        }
        return s;
    }

    private String declaredMime(Uri u, Intent intent) {
        String m = null;
        try {
            m = getContext().getContentResolver().getType(u);
        } catch (Exception ignored) {
            // some providers do not answer; the type is only a hint for groups
        }
        if (m == null || m.contains("*")) {
            m = intent.getType();
        }
        return cleanMime(m);
    }

    private String displayName(Uri u) {
        String n = null;
        try (Cursor c = getContext().getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) {
                n = c.getString(0);
            }
        } catch (Exception ignored) {
            // some apps do not answer the query; the name is only a label
        }
        if (n == null) {
            n = u.getLastPathSegment();
        }
        return cleanName(n);
    }

    private long declaredSize(Uri u) {
        try (Cursor c = getContext().getContentResolver().query(u, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) {
                return c.getLong(0);
            }
        } catch (Exception ignored) {
            // unknown size: checked while copying
        }
        return -1;
    }

    /** Real type from the first bytes. null = not an image or PDF that the app can use. */
    static String sniff(byte[] h, int n) {
        if (n >= 5 && h[0] == '%' && h[1] == 'P' && h[2] == 'D' && h[3] == 'F' && h[4] == '-') {
            return "application/pdf";
        }
        if (n >= 3 && (h[0] & 0xff) == 0xff && (h[1] & 0xff) == 0xd8 && (h[2] & 0xff) == 0xff) {
            return "image/jpeg";
        }
        if (n >= 8 && (h[0] & 0xff) == 0x89 && h[1] == 'P' && h[2] == 'N' && h[3] == 'G') {
            return "image/png";
        }
        if (n >= 12 && h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F' && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P') {
            return "image/webp";
        }
        if (n >= 4 && h[0] == 'G' && h[1] == 'I' && h[2] == 'F' && h[3] == '8') {
            return "image/gif";
        }
        return null;
    }

    /** HEIC / HEIF (ISO-BMFF "ftyp" box): the WebView cannot show it, so it gets its own clear message. */
    static boolean isHeic(byte[] h, int n) {
        if (n < 12 || h[4] != 'f' || h[5] != 't' || h[6] != 'y' || h[7] != 'p') {
            return false;
        }
        String brand = new String(h, 8, 4, java.nio.charset.StandardCharsets.US_ASCII);
        return brand.equals("heic") || brand.equals("heix") || brand.equals("hevc") || brand.equals("hevx")
                || brand.equals("heim") || brand.equals("heis") || brand.equals("mif1") || brand.equals("msf1");
    }

    static String ext(String mime) {
        switch (mime) {
            case "application/pdf":
                return ".pdf";
            case "image/png":
                return ".png";
            case "image/webp":
                return ".webp";
            case "image/gif":
                return ".gif";
            default:
                return ".jpg";
        }
    }

    private JSObject copyOne(Uri u, String name, File dir, Intent intent) throws IOException, Reject {
        long ds = declaredSize(u);
        if (ds > MAX_ANY) {
            throw new Reject("big");
        }
        String id = UUID.randomUUID().toString();
        File tmp = new File(dir, id + ".part");
        String mime;
        boolean heic;
        long total = 0;
        try (InputStream in = getContext().getContentResolver().openInputStream(u)) {
            if (in == null) {
                throw new Reject("read");
            }
            byte[] head = new byte[16];
            int hn = 0;
            while (hn < head.length) {
                int r = in.read(head, hn, head.length - hn);
                if (r < 0) {
                    break;
                }
                hn += r;
            }
            mime = sniff(head, hn);
            heic = mime == null && isHeic(head, hn);
            try (OutputStream out = new FileOutputStream(tmp)) {
                out.write(head, 0, hn);
                total = hn;
                byte[] buf = new byte[65536];
                int r;
                while ((r = in.read(buf)) > 0) {
                    total += r;
                    if (total > MAX_ANY) {
                        throw new Reject("big");
                    }
                    out.write(buf, 0, r);
                }
            }
        } catch (Reject | IOException | RuntimeException e) {
            // noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw e;
        }
        if (total <= 0) {
            // empty file: same message as before ("only an image or PDF")
            // noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw new Reject("type");
        }
        // Image / PDF up to 15MB = "doc" (scan queue, as before). Anything else = "file" (groups only), with the reason
        boolean doc = mime != null && total <= MAX_BYTES;
        String why = doc ? null : mime != null ? "big" : heic ? "heic" : "type";
        String fm = mime != null ? mime : declaredMime(u, intent);
        File fin = new File(dir, id + (doc ? ext(mime) : ".bin"));
        if (!tmp.renameTo(fin) || !inside(dir, fin)) {
            // noinspection ResultOfMethodCallIgnored
            tmp.delete();
            // noinspection ResultOfMethodCallIgnored
            fin.delete();
            throw new Reject("read");
        }
        synchronized (lock) {
            files.put(id, new Entry(fin, fm, doc));
        }
        JSObject it = new JSObject();
        it.put("id", id);
        it.put("kind", doc ? "doc" : "file");
        it.put("name", name);
        it.put("mime", fm);
        it.put("size", total);
        if (why != null) {
            it.put("why", why);
        }
        return it;
    }

    private static boolean inside(File dir, File f) {
        try {
            return f.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator);
        } catch (IOException e) {
            return false;
        }
    }

    @PluginMethod
    public void getPending(final PluginCall call) {
        // Runs after any copy that is still in progress (same single thread)
        worker.execute(() -> {
            JSArray items = new JSArray();
            JSArray bad = new JSArray();
            int o;
            synchronized (lock) {
                for (JSObject j : pending) {
                    items.put(j);
                }
                for (JSObject j : rejected) {
                    bad.put(j);
                }
                o = over;
                pending.clear();
                rejected.clear();
                over = 0;
            }
            JSObject r = new JSObject();
            r.put("items", items);
            r.put("rejected", bad);
            r.put("over", o);
            r.put("max", MAX_FILES);
            r.put("maxBytes", MAX_BYTES);
            r.put("maxAny", MAX_ANY);
            call.resolve(r);
        });
    }

    private Entry take(PluginCall call) {
        String id = call.getString("id", "");
        if (id == null || !ID_OK.matcher(id).matches()) {
            return null;
        }
        synchronized (lock) {
            return files.remove(id);
        }
    }

    @PluginMethod
    public void read(final PluginCall call) {
        final String id = call.getString("id", "");
        final Entry e0 = take(call);
        if (e0 == null) {
            call.reject("unknown id");
            return;
        }
        final File f = e0.f;
        worker.execute(() -> {
            try {
                if (!inside(shareDir(), f) || f.length() > (e0.doc ? MAX_BYTES : MAX_ANY)) {
                    call.reject("bad file");
                    return;
                }
                byte[] b = new byte[(int) f.length()];
                try (InputStream in = new FileInputStream(f)) {
                    int off = 0;
                    while (off < b.length) {
                        int r = in.read(b, off, b.length - off);
                        if (r < 0) {
                            break;
                        }
                        off += r;
                    }
                }
                String mime = e0.doc ? sniff(b, Math.min(b.length, 16)) : e0.mime;
                if (mime == null || (!e0.doc && !MIME_OK.matcher(mime).matches())) {
                    call.reject("bad file");
                    return;
                }
                JSObject r = new JSObject();
                r.put("id", id);
                r.put("mime", mime);
                r.put("size", b.length);
                r.put("dataURL", "data:" + mime + ";base64," + Base64.encodeToString(b, Base64.NO_WRAP));
                call.resolve(r);
            } catch (OutOfMemoryError e) {
                // a 25MB file becomes ~33 million characters for the screens; a weak phone may not have the memory
                call.reject("הקובץ גדול מדי לטלפון הזה");
            } catch (Exception e) {
                call.reject("read failed");
            } finally {
                // noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        });
    }

    @PluginMethod
    public void discard(final PluginCall call) {
        Entry e = take(call);
        if (e != null) {
            // noinspection ResultOfMethodCallIgnored
            e.f.delete();
        }
        call.resolve();
    }

    static final class Reject extends Exception {
        private static final long serialVersionUID = 1L;

        Reject(String why) {
            super(why);
        }
    }
}
