package com.largepami.finance;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** POS hardware core: ESC/POS bytes, raster picture, drawer pulse, status parsing, TCP 9100 against a fake printer, mock. */
class LpPosCoreTest {

    static int[] img(int w, int h, int v) { int[] a = new int[w * h]; Arrays.fill(a, v); return a; }

    @Test void basicCommands() {
        assertArrayEquals(new byte[] { 0x1B, '@' }, LpPosEscPos.init());
        assertArrayEquals(new byte[] { 0x1B, 'd', 3 }, LpPosEscPos.feed(3));
        assertArrayEquals(new byte[] { 0x1B, 'd', (byte) 255 }, LpPosEscPos.feed(999));
        assertArrayEquals(new byte[] { 0x1D, 'V', 66, 0 }, LpPosEscPos.cut(0));
        assertArrayEquals(new byte[] { 0x10, 0x04, 1 }, LpPosEscPos.statusRequest(1));
        assertArrayEquals(new byte[] { 0x10, 0x04, 4 }, LpPosEscPos.statusRequest(9));
    }

    @Test void drawerPulse() {
        assertArrayEquals(new byte[] { 0x1B, 'p', 0, 50, 100 }, LpPosEscPos.drawer(2, 100, 200));
        assertArrayEquals(new byte[] { 0x1B, 'p', 1, 50, 100 }, LpPosEscPos.drawer(5, 100, 200));
        byte[] b = LpPosEscPos.drawer(2, 400, 10); // off time never shorter than on time
        assertEquals(b[3], b[4]);
        assertEquals((byte) 200, b[3]);
        assertArrayEquals(new byte[] { 0x1B, 'p', 0, 1, 1 }, LpPosEscPos.drawer(7, 0, 0)); // unknown pin -> pin 2, minimum pulse
    }

    @Test void thresholdBits() {
        // 10 dots wide -> 2 bytes per row; dots 0 and 9 black, rest white
        int[] l = img(10, 2, 255);
        l[0] = 0; l[9] = 0; l[10] = 0;
        byte[] b = LpPosEscPos.toBits(l, 10, 2, false, 128);
        assertEquals(4, b.length);
        assertEquals((byte) 0x80, b[0]);
        assertEquals((byte) 0x40, b[1]);
        assertEquals((byte) 0x80, b[2]);
        assertEquals(0, b[3]);
    }

    @Test void ditherKeepsGrayLevel() {
        int w = 64, h = 64;
        byte[] b = LpPosEscPos.toBits(img(w, h, 128), w, h, true, 128);
        int black = 0;
        for (byte x : b) black += Integer.bitCount(x & 0xFF);
        double ratio = black / (double) (w * h);
        assertTrue(ratio > 0.4 && ratio < 0.6, "50% gray -> about half the dots, got " + ratio);
        assertEquals(0, countBits(LpPosEscPos.toBits(img(w, h, 255), w, h, true, 128)));
        assertEquals(w * h, countBits(LpPosEscPos.toBits(img(w, h, 0), w, h, true, 128)));
    }

    static int countBits(byte[] b) { int n = 0; for (byte x : b) n += Integer.bitCount(x & 0xFF); return n; }

    @Test void rasterBands() {
        int w = 384, h = 300, rb = 48;
        byte[] bits = LpPosEscPos.toBits(img(w, h, 0), w, h, false, 128);
        byte[] r = LpPosEscPos.raster(bits, w, h, 128);
        // 3 bands: 128 + 128 + 44 rows, each with an 8-byte header
        assertEquals(3 * 8 + rb * h, r.length);
        int off = 0;
        for (int rows : new int[] { 128, 128, 44 }) {
            assertEquals(0x1D, r[off]); assertEquals('v', r[off + 1]); assertEquals('0', r[off + 2]); assertEquals(0, r[off + 3]);
            assertEquals(rb, (r[off + 4] & 0xFF) | (r[off + 5] & 0xFF) << 8);
            assertEquals(rows, (r[off + 6] & 0xFF) | (r[off + 7] & 0xFF) << 8);
            off += 8 + rb * rows;
        }
        assertEquals(r.length, off);
    }

    @Test void badSizesRejected() {
        assertThrows(IllegalArgumentException.class, () -> LpPosEscPos.toBits(new int[5], 10, 1, false, 128));
        assertThrows(IllegalArgumentException.class, () -> LpPosEscPos.toBits(new int[5], 0, 1, false, 128));
        assertThrows(IllegalArgumentException.class, () -> LpPosEscPos.raster(new byte[3], 64, 1, 128));
    }

    @Test void wholeJob() {
        byte[] j = LpPosEscPos.job(img(8, 2, 0), 8, 2, false, true, true, 5);
        byte[] expect = concat(LpPosEscPos.init(), new byte[] { 0x1D, 'v', '0', 0, 1, 0, 2, 0, (byte) 0xFF, (byte) 0xFF },
                LpPosEscPos.feed(3), LpPosEscPos.cut(0), LpPosEscPos.drawer(5, 100, 200));
        assertArrayEquals(expect, j);
        byte[] j2 = LpPosEscPos.job(null, 8, 0, false, false, false, 2);
        assertArrayEquals(concat(LpPosEscPos.init(), LpPosEscPos.feed(4)), j2);
    }

    static byte[] concat(byte[]... a) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] x : a) o.write(x, 0, x.length);
        return o.toByteArray();
    }

    @Test void statusParsing() {
        LpPosEscPos.Status s = LpPosEscPos.parseStatus(0x12, 0x12, 0x12);
        assertEquals(true, s.online); assertEquals(false, s.paperOut); assertEquals(false, s.paperLow);
        assertEquals(false, s.coverOpen); assertEquals(false, s.drawerOpen); assertEquals(false, s.error);
        s = LpPosEscPos.parseStatus(0x12 | 0x08 | 0x04, 0x12 | 0x04, 0x12 | 0x60);
        assertEquals(false, s.online); assertEquals(true, s.drawerOpen); assertEquals(true, s.coverOpen); assertEquals(true, s.paperOut);
        s = LpPosEscPos.parseStatus(0x12, 0x12, 0x12 | 0x0C);
        assertEquals(true, s.paperLow); assertEquals(false, s.paperOut);
        s = LpPosEscPos.parseStatus(0x12, 0x12 | 0x20, -1); // paper end reported only by DLE EOT 2
        assertEquals(true, s.paperOut); assertNull(s.paperLow);
        s = LpPosEscPos.parseStatus(-1, -1, -1);
        assertNull(s.online); assertNull(s.paperOut); assertNull(s.drawerOpen);
        s = LpPosEscPos.parseStatus(0xFF, 0x00, 0x41); // garbage is not a status
        assertNull(s.online); assertNull(s.coverOpen); assertNull(s.paperLow);
    }

    @Test void mockTransport() throws Exception {
        LpPosTransport.Mock m = new LpPosTransport.Mock();
        assertThrows(java.io.IOException.class, () -> m.write(new byte[] { 1 }));
        m.open();
        byte[] big = new byte[10000];
        for (int i = 0; i < big.length; i++) big[i] = (byte) i;
        m.write(big);
        assertArrayEquals(big, m.written.toByteArray());
        m.ans4 = 0x12 | 0x60;
        LpPosEscPos.Status s = m.queryStatus(10);
        assertEquals(true, s.online); assertEquals(true, s.paperOut);
        assertEquals(3, m.statusRequests);
        assertArrayEquals(big, m.written.toByteArray(), "status requests are not part of the job");
        // printer without a back channel: one request, no waiting for the others
        LpPosTransport.Mock q = new LpPosTransport.Mock();
        q.ans1 = -1; q.open();
        assertNull(q.queryStatus(10).online);
        assertEquals(1, q.statusRequests);
        LpPosTransport.Mock f = new LpPosTransport.Mock();
        f.failOpen = true;
        assertThrows(java.io.IOException.class, f::open);
    }

    @Test void tcpHostValidation() {
        assertThrows(IllegalArgumentException.class, () -> new LpPosTransport.Tcp("bad host/x", 9100, 100));
        assertThrows(IllegalArgumentException.class, () -> new LpPosTransport.Tcp("10.0.0.5", 0, 100));
        assertThrows(IllegalArgumentException.class, () -> new LpPosTransport.Tcp(null, 9100, 100));
        new LpPosTransport.Tcp("192.168.1.50", 9100, 100);
    }

    /** A fake network printer on localhost: keeps the job bytes, answers DLE EOT like a real printer. */
    @Test void tcpAgainstFakePrinter() throws Exception {
        try (ServerSocket ss = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            AtomicReference<byte[]> got = new AtomicReference<>();
            Thread srv = new Thread(() -> {
                try (Socket c = ss.accept()) {
                    InputStream in = c.getInputStream(); OutputStream out = c.getOutputStream();
                    ByteArrayOutputStream job = new ByteArrayOutputStream();
                    int b;
                    while ((b = in.read()) >= 0) {
                        if (b == 0x10) {
                            int b2 = in.read(), n = in.read();
                            if (b2 == 0x04) { out.write(n == 4 ? (0x12 | 0x0C) : 0x12); out.flush(); continue; }
                            job.write(b); job.write(b2); job.write(n);
                            continue;
                        }
                        job.write(b);
                    }
                    got.set(job.toByteArray());
                } catch (Exception e) { got.set(new byte[0]); }
            });
            srv.start();
            LpPosTransport.Tcp t = new LpPosTransport.Tcp("127.0.0.1", ss.getLocalPort(), 2000);
            t.open();
            assertTrue(t.isOpen());
            LpPosEscPos.Status s = t.queryStatus(1000);
            assertEquals(true, s.online); assertEquals(true, s.paperLow); assertEquals(false, s.paperOut);
            byte[] job = LpPosEscPos.job(img(384, 200, 0), 384, 200, false, true, true, 2);
            t.write(job);
            t.close();
            assertFalse(t.isOpen());
            srv.join(5000);
            assertArrayEquals(job, got.get());
        }
    }

    @Test void tcpNoPrinter() throws Exception {
        int port;
        try (ServerSocket ss = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) { port = ss.getLocalPort(); }
        LpPosTransport.Tcp t = new LpPosTransport.Tcp("127.0.0.1", port, 500);
        assertThrows(java.io.IOException.class, t::open);
        assertFalse(t.isOpen());
    }
}
