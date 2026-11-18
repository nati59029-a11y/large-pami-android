package com.largepami.finance;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextDirectionHeuristic;
import android.text.TextDirectionHeuristics;
import android.text.TextPaint;
import android.util.Base64;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * POS stage, 17.11.2026: draws a receipt as ONE black-and-white picture, so Hebrew (right to left, any font the phone has)
 * prints the same on every printer. Barcode and QR are drawn with ZXing core (Apache License 2.0).
 *
 * Receipt (JSON from www/pos-hw.js):
 * { width: 384|576 (dots), lines: [ ... ], cut: true, drawer: false }
 * line kinds:
 *   {t:"text", text, align:"right"|"center"|"left", size:1..3, bold}
 *   {t:"cols", cols:[{text, w:0..1, align}], size, bold}   first column on the RIGHT (Hebrew order)
 *   {t:"line"}  dashed separator        {t:"feed", n: dots}
 *   {t:"image", data: base64 PNG/JPEG, w: 0..1 of the width, align}   (logo)
 *   {t:"qr", data, size: 0..1 of the width}
 *   {t:"barcode", data, format:"CODE128"|"EAN13"|"EAN8"|"UPCA"|"CODE39", h: dots, text: true}
 */
final class LpPosRender {
    private LpPosRender() {}

    static final int MAX_HEIGHT = 12000; // ~1.5 m of paper; protects memory
    static final float BASE_TEXT = 24f;  // dots; size 1 = 24 dots high (about 12 chars per 58mm line ... 32 per 80mm)

    interface Block { int height(); void draw(Canvas c, int y); }

    static Bitmap render(JSONObject r) throws Exception {
        int width = r.optInt("width", LpPosEscPos.W80);
        if (width < 128 || width > 1280) throw new IllegalArgumentException("bad width");
        width = width / 8 * 8;
        JSONArray lines = r.optJSONArray("lines");
        if (lines == null) lines = new JSONArray();
        List<Block> blocks = new ArrayList<>();
        for (int i = 0; i < lines.length(); i++) {
            JSONObject l = lines.optJSONObject(i);
            if (l != null) blocks.add(block(l, width));
        }
        int h = 0;
        for (Block b : blocks) h += b.height();
        h = Math.max(1, Math.min(h, MAX_HEIGHT));
        Bitmap bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        c.drawColor(Color.WHITE);
        int y = 0;
        for (Block b : blocks) {
            if (y >= h) break;
            b.draw(c, y);
            y += b.height();
        }
        return bmp;
    }

    /** Gray level per dot (0 black .. 255 white), transparent counted as white. */
    static int[] luma(Bitmap b) {
        int w = b.getWidth(), h = b.getHeight();
        int[] px = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);
        for (int i = 0; i < px.length; i++) {
            int p = px[i], a = (p >>> 24) & 0xFF;
            int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, bl = p & 0xFF;
            int v = (r * 299 + g * 587 + bl * 114) / 1000;
            px[i] = (v * a + 255 * (255 - a)) / 255;
        }
        return px;
    }

    static Block block(JSONObject l, int width) throws Exception {
        String t = l.optString("t", "text");
        switch (t) {
            case "line": return dashed(width);
            case "feed": { final int n = clamp(l.optInt("n", 16), 0, 400); return new Block() { public int height() { return n; } public void draw(Canvas c, int y) {} }; }
            case "cols": return cols(l, width);
            case "image": return image(l, width);
            case "qr": return code(l, width, true);
            case "barcode": return code(l, width, false);
            default: return text(l.optString("text", ""), l.optString("align", "right"), l.optInt("size", 1), l.optBoolean("bold", false), width, 0);
        }
    }

    static TextPaint paint(int size, boolean bold) {
        TextPaint p = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.BLACK);
        p.setTextSize(BASE_TEXT * clamp(size, 1, 3) * (size >= 2 ? 0.85f : 1f));
        p.setTypeface(Typeface.create(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL));
        return p;
    }

    /** First strong character decides the direction; no strong character (numbers only) = right to left, like the rest of the receipt. */
    static boolean isRtl(String s) {
        for (int i = 0; i < s.length(); i++) {
            byte d = Character.getDirectionality(s.charAt(i));
            if (d == Character.DIRECTIONALITY_RIGHT_TO_LEFT || d == Character.DIRECTIONALITY_RIGHT_TO_LEFT_ARABIC) return true;
            if (d == Character.DIRECTIONALITY_LEFT_TO_RIGHT) return false;
        }
        return true;
    }

    static StaticLayout layout(String s, TextPaint p, int w, String align) {
        boolean rtl = isRtl(s);
        TextDirectionHeuristic dir = rtl ? TextDirectionHeuristics.RTL : TextDirectionHeuristics.LTR;
        Layout.Alignment al;
        if ("center".equals(align)) al = Layout.Alignment.ALIGN_CENTER;
        else if ("left".equals(align)) al = rtl ? Layout.Alignment.ALIGN_OPPOSITE : Layout.Alignment.ALIGN_NORMAL;
        else al = rtl ? Layout.Alignment.ALIGN_NORMAL : Layout.Alignment.ALIGN_OPPOSITE;
        if (android.os.Build.VERSION.SDK_INT < 23) return new StaticLayout(s, p, Math.max(1, w), al, 1f, 0f, false); // Android 5.1
        return StaticLayout.Builder.obtain(s, 0, s.length(), p, Math.max(1, w))
                .setAlignment(al).setTextDirection(dir).setIncludePad(false).setMaxLines(40).build();
    }

    static Block text(String s, String align, int size, boolean bold, final int width, final int xOff) {
        final StaticLayout sl = layout(s, paint(size, bold), width, align);
        final int pad = 4;
        return new Block() {
            public int height() { return sl.getHeight() + pad; }
            public void draw(Canvas c, int y) { c.save(); c.translate(xOff, y); sl.draw(c); c.restore(); }
        };
    }

    static Block cols(JSONObject l, final int width) {
        JSONArray a = l.optJSONArray("cols");
        final List<StaticLayout> ls = new ArrayList<>();
        final List<Integer> xs = new ArrayList<>();
        if (a == null || a.length() == 0) return text("", "right", 1, false, width, 0);
        int size = l.optInt("size", 1);
        boolean bold = l.optBoolean("bold", false);
        int right = width, h = 0;
        for (int i = 0; i < a.length(); i++) {
            JSONObject col = a.optJSONObject(i);
            if (col == null) continue;
            int w = i == a.length() - 1 ? right : Math.max(8, Math.round((float) (width * col.optDouble("w", 1.0 / a.length()))));
            w = Math.min(w, right);
            if (w <= 0) break;
            int gap = i == a.length() - 1 ? 0 : 6;
            StaticLayout sl = layout(col.optString("text", ""), paint(col.optInt("size", size), col.optBoolean("bold", bold)), Math.max(1, w - gap), col.optString("align", "right"));
            ls.add(sl);
            xs.add(right - w + (i == a.length() - 1 ? 0 : gap));
            h = Math.max(h, sl.getHeight());
            right -= w;
        }
        final int hh = h + 4;
        return new Block() {
            public int height() { return hh; }
            public void draw(Canvas c, int y) {
                for (int i = 0; i < ls.size(); i++) { c.save(); c.translate(xs.get(i), y); ls.get(i).draw(c); c.restore(); }
            }
        };
    }

    static Block dashed(final int width) {
        return new Block() {
            public int height() { return 14; }
            public void draw(Canvas c, int y) {
                Paint p = new Paint();
                p.setColor(Color.BLACK); p.setStrokeWidth(2); p.setStyle(Paint.Style.STROKE);
                p.setPathEffect(new DashPathEffect(new float[] { 8, 6 }, 0));
                c.drawLine(0, y + 7, width, y + 7, p);
            }
        };
    }

    static Block image(JSONObject l, final int width) {
        String b64 = l.optString("data", "");
        int comma = b64.indexOf(',');
        if (b64.startsWith("data:") && comma > 0) b64 = b64.substring(comma + 1);
        byte[] raw;
        try { raw = Base64.decode(b64, Base64.DEFAULT); } catch (IllegalArgumentException e) { raw = new byte[0]; }
        if (raw.length > 4 * 1024 * 1024) raw = new byte[0];
        final Bitmap src = raw.length == 0 ? null : BitmapFactory.decodeByteArray(raw, 0, raw.length);
        if (src == null) return text("[logo?]", "center", 1, false, width, 0);
        double f = l.optDouble("w", 0.5);
        final int w = clamp((int) Math.round(width * (f > 0 && f <= 1 ? f : 0.5)), 16, width);
        final int h = Math.max(1, Math.min(2000, Math.round((float) src.getHeight() * w / Math.max(1, src.getWidth()))));
        String align = l.optString("align", "center");
        final int x = "left".equals(align) ? 0 : "right".equals(align) ? width - w : (width - w) / 2;
        return new Block() {
            public int height() { return h + 6; }
            public void draw(Canvas c, int y) {
                Paint p = new Paint(Paint.FILTER_BITMAP_FLAG);
                c.drawBitmap(src, null, new Rect(x, y, x + w, y + h), p);
            }
        };
    }

    static Block code(JSONObject l, final int width, boolean qr) throws Exception {
        String data = l.optString("data", "");
        if (data.isEmpty() || data.length() > 1000) return text("", "center", 1, false, width, 0);
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.MARGIN, qr ? 1 : 0);
        hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
        final BitMatrix m;
        final int w, h;
        if (qr) {
            hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
            double f = l.optDouble("size", 0.45);
            int side = clamp((int) Math.round(width * (f > 0 && f <= 1 ? f : 0.45)), 64, width);
            BitMatrix q = new MultiFormatWriter().encode(data, BarcodeFormat.QR_CODE, 0, 0, hints);
            int mod = Math.max(1, side / q.getWidth()); // whole dots per module: sharp squares, scans well
            m = q; w = q.getWidth() * mod; h = q.getHeight() * mod;
        } else {
            BarcodeFormat fmt = format(l.optString("format", "CODE128"));
            BitMatrix q = new MultiFormatWriter().encode(data, fmt, 0, 1, hints);
            int mod = Math.max(1, Math.min(4, width / Math.max(1, q.getWidth()))); // narrow bar = 1..4 dots
            if (q.getWidth() * mod > width) throw new IllegalArgumentException("barcode too long for the paper");
            m = q; w = q.getWidth() * mod; h = clamp(l.optInt("h", 80), 24, 300);
        }
        final int x0 = (width - w) / 2;
        final Block caption = (!qr && l.optBoolean("text", true)) ? text(data, "center", 1, false, width, 0) : null;
        final int mw = m.getWidth(), mh = m.getHeight();
        return new Block() {
            public int height() { return h + 8 + (caption == null ? 0 : caption.height()); }
            public void draw(Canvas c, int y) {
                Paint p = new Paint(); p.setColor(Color.BLACK); p.setStyle(Paint.Style.FILL);
                float sx = (float) w / mw, sy = (float) h / mh;
                for (int my = 0; my < mh; my++) {
                    for (int mx = 0; mx < mw; mx++) {
                        if (m.get(mx, my)) c.drawRect(x0 + mx * sx, y + 4 + my * sy, x0 + (mx + 1) * sx, y + 4 + (my + 1) * sy, p);
                    }
                }
                if (caption != null) caption.draw(c, y + 4 + h + 4);
            }
        };
    }

    static BarcodeFormat format(String f) {
        switch (f == null ? "" : f.toUpperCase()) {
            case "EAN13": return BarcodeFormat.EAN_13;
            case "EAN8": return BarcodeFormat.EAN_8;
            case "UPCA": return BarcodeFormat.UPC_A;
            case "CODE39": return BarcodeFormat.CODE_39;
            default: return BarcodeFormat.CODE_128;
        }
    }

    static int clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
}
