package com.largepami.finance;

import java.io.ByteArrayOutputStream;

/**
 * POS (cash register) stage, 17.11.2026: ESC/POS byte builder for receipt printers.
 * Pure Java (no Android classes) so it is unit-tested on the desktop: tools/pos-hw-test (mvn -q test).
 *
 * Hebrew is NOT sent as text (printer code pages for Hebrew differ from model to model and print reversed).
 * The receipt is drawn as a picture on the phone (LpPosRender) and sent here as gray levels; this class turns it
 * into black dots (threshold or Floyd-Steinberg dithering) and into "GS v 0" raster bands.
 *
 * No card data passes through this class or the plugin: it only prints what the screens send.
 */
public final class LpPosEscPos {
    private LpPosEscPos() {}

    public static final byte ESC = 0x1B, GS = 0x1D, DLE = 0x10, EOT = 0x04;

    /** Common paper widths in dots (203 dpi heads): 58 mm paper = 384 dots, 80 mm paper = 576 dots. */
    public static final int W58 = 384, W80 = 576;

    /** Rows per GS v 0 band. Small bands keep cheap printers (small buffers, Bluetooth) from dropping data. */
    public static final int BAND_ROWS = 128;

    /** ESC @ : reset the printer to its defaults. */
    public static byte[] init() { return new byte[] { ESC, '@' }; }

    /** ESC d n : print and feed n lines (0..255). */
    public static byte[] feed(int lines) { return new byte[] { ESC, 'd', (byte) clamp(lines, 0, 255) }; }

    /** GS V 66 n : feed n dots and cut (partial cut where the printer has only one). Printers without a cutter ignore it. */
    public static byte[] cut(int feedDots) { return new byte[] { GS, 'V', 66, (byte) clamp(feedDots, 0, 255) }; }

    /**
     * ESC p m t1 t2 : pulse to the cash drawer connected to the printer (RJ11/RJ12 "DK" port).
     * pin 2 (m=0) is the usual one; pin 5 (m=1) for a second drawer. t1/t2 in units of 2 ms (on / off time).
     */
    public static byte[] drawer(int pin, int onMs, int offMs) {
        int m = pin == 5 ? 1 : 0;
        int t1 = clamp(onMs / 2, 1, 255), t2 = clamp(offMs / 2, 1, 255);
        if (t2 < t1) t2 = t1; // some printers ignore the pulse when t2 < t1
        return new byte[] { ESC, 'p', (byte) m, (byte) t1, (byte) t2 };
    }

    /** DLE EOT n : real-time status request. n=1 printer, n=2 offline cause, n=3 error, n=4 paper sensor. */
    public static byte[] statusRequest(int n) { return new byte[] { DLE, EOT, (byte) clamp(n, 1, 4) }; }

    /** Width in bytes of one raster row. */
    public static int rowBytes(int width) { return (width + 7) / 8; }

    /**
     * Gray levels (0 = black .. 255 = white, row by row) -> 1 bit per dot (1 = print), packed MSB first,
     * each row padded to whole bytes.
     * @param dither true = Floyd-Steinberg (logos, photos); false = plain threshold (sharp text, barcodes)
     */
    public static byte[] toBits(int[] luma, int width, int height, boolean dither, int threshold) {
        if (width <= 0 || height <= 0 || luma == null || luma.length < width * height)
            throw new IllegalArgumentException("bad image size");
        int rb = rowBytes(width);
        byte[] out = new byte[rb * height];
        if (!dither) {
            for (int y = 0; y < height; y++) {
                int o = y * rb, i = y * width;
                for (int x = 0; x < width; x++) {
                    if (luma[i + x] < threshold) out[o + (x >> 3)] |= (byte) (0x80 >>> (x & 7));
                }
            }
            return out;
        }
        // Floyd-Steinberg on two rows of errors (memory stays small for long receipts)
        int[] cur = new int[width + 2], nxt = new int[width + 2];
        for (int y = 0; y < height; y++) {
            int o = y * rb, i = y * width;
            for (int x = 0; x < width; x++) {
                int v = clamp(luma[i + x], 0, 255) + cur[x + 1];
                int nv = v < threshold ? 0 : 255;
                if (nv == 0) out[o + (x >> 3)] |= (byte) (0x80 >>> (x & 7));
                int e = v - nv;
                cur[x + 2] += e * 7 / 16;
                nxt[x] += e * 3 / 16;
                nxt[x + 1] += e * 5 / 16;
                nxt[x + 2] += e / 16;
            }
            int[] t = cur; cur = nxt; nxt = t;
            java.util.Arrays.fill(nxt, 0);
        }
        return out;
    }

    /**
     * Packed bits -> GS v 0 raster commands, split into bands of at most bandRows rows.
     * GS v 0 m xL xH yL yH d1..dk (m=0 normal size).
     */
    public static byte[] raster(byte[] bits, int width, int height, int bandRows) {
        int rb = rowBytes(width);
        if (bits.length < rb * height) throw new IllegalArgumentException("bits too short");
        if (bandRows <= 0) bandRows = BAND_ROWS;
        ByteArrayOutputStream o = new ByteArrayOutputStream(bits.length + 8 * (height / bandRows + 1));
        for (int y = 0; y < height; y += bandRows) {
            int h = Math.min(bandRows, height - y);
            o.write(GS); o.write('v'); o.write('0'); o.write(0);
            o.write(rb & 0xFF); o.write((rb >> 8) & 0xFF);
            o.write(h & 0xFF); o.write((h >> 8) & 0xFF);
            o.write(bits, y * rb, h * rb);
        }
        return o.toByteArray();
    }

    /** A whole job: init, picture, feed, optional cut, optional drawer pulse (after printing, so the drawer opens at the end). */
    public static byte[] job(int[] luma, int width, int height, boolean dither, boolean cut, boolean drawer, int drawerPin) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        write(o, init());
        if (luma != null && height > 0) write(o, raster(toBits(luma, width, height, dither, 128), width, height, BAND_ROWS));
        write(o, feed(cut ? 3 : 4));
        if (cut) write(o, cut(0));
        if (drawer) write(o, drawer(drawerPin, 100, 200));
        return o.toByteArray();
    }

    // ---- status answers (DLE EOT) ----

    /** What a status answer says. null fields = the printer did not answer (many cheap printers never do). */
    public static final class Status {
        public Boolean online, paperOut, paperLow, coverOpen, drawerOpen, error;
    }

    /**
     * Parses answers to DLE EOT 1 (printer), DLE EOT 2 (offline cause) and DLE EOT 4 (paper).
     * Pass -1 for a request that got no answer. A valid answer always has bits 1 and 4 set and bits 0 and 7 clear.
     * Drawer: bit 2 of n=1 is the level of drawer pin 3. Its meaning (open/closed) depends on the drawer,
     * so it is reported as is and the screen lets the owner flip it.
     */
    public static Status parseStatus(int s1, int s2, int s4) {
        Status st = new Status();
        if (valid(s1)) {
            st.online = (s1 & 0x08) == 0;
            st.drawerOpen = (s1 & 0x04) != 0;
        }
        if (valid(s2)) {
            st.coverOpen = (s2 & 0x04) != 0;
            st.error = (s2 & 0x40) != 0;
            if ((s2 & 0x20) != 0) st.paperOut = Boolean.TRUE;
        }
        if (valid(s4)) {
            st.paperLow = (s4 & 0x0C) != 0;
            st.paperOut = (s4 & 0x60) != 0 || Boolean.TRUE.equals(st.paperOut);
        }
        return st;
    }

    static boolean valid(int b) { return b >= 0 && b <= 255 && (b & 0x93) == 0x12; }

    static int clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

    static void write(ByteArrayOutputStream o, byte[] b) { o.write(b, 0, b.length); }
}
