package com.largepami.finance;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;

/**
 * POS stage, 17.11.2026: a connection to a receipt printer.
 * Pure Java (unit-tested on the desktop: tools/pos-hw-test). The Bluetooth and USB connections are in LpPosBtUsb.java.
 *
 * Kinds: "net" (TCP port 9100, Wi-Fi/LAN printers), "bt" (Bluetooth SPP), "usb" (USB OTG), "mock" (no hardware:
 * keeps the bytes, for the screens' test and the unit tests).
 */
public abstract class LpPosTransport {

    /** Bytes per write. Bluetooth printers with small buffers lose data on bigger writes. */
    protected int chunk = 4096;
    /** Pause after each chunk (ms). 0 for net/usb; a few ms helps some Bluetooth printers. */
    protected int chunkDelayMs = 0;
    /** null = not asked yet; FALSE = this connection never answers status requests (cheap printers): do not wait for it again. */
    public Boolean answers = null;

    public abstract String kind();
    public abstract void open() throws IOException;
    public abstract boolean isOpen();
    public abstract void close();
    /** Writes everything or throws. */
    protected abstract void writeRaw(byte[] b, int off, int len) throws IOException;
    /** Reads one byte within timeoutMs, or -1 when nothing came. Transports without a back channel return -1. */
    public abstract int readByte(int timeoutMs) throws IOException;

    public final void write(byte[] data) throws IOException {
        if (!isOpen()) throw new IOException("not connected");
        for (int off = 0; off < data.length; off += chunk) {
            int n = Math.min(chunk, data.length - off);
            writeRaw(data, off, n);
            if (chunkDelayMs > 0 && off + n < data.length) {
                try { Thread.sleep(chunkDelayMs); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException("interrupted"); }
            }
        }
    }

    /**
     * Asks DLE EOT 1, 2 and 4. Answers that do not come within timeoutMs count as "no answer" (-1).
     * Old bytes waiting in the input are dropped first, so an answer is never matched with the wrong request.
     */
    public final LpPosEscPos.Status queryStatus(int timeoutMs) throws IOException {
        drain();
        int[] r = new int[5];
        for (int n : new int[] { 1, 2, 4 }) {
            write(LpPosEscPos.statusRequest(n));
            r[n] = readByte(timeoutMs);
            if (n == 1 && r[1] < 0) { answers = Boolean.FALSE; return LpPosEscPos.parseStatus(-1, -1, -1); } // no back channel: do not wait 3 times
        }
        answers = Boolean.TRUE;
        return LpPosEscPos.parseStatus(r[1], r[2], r[4]);
    }

    protected void drain() throws IOException {
        for (int i = 0; i < 64 && readByte(1) >= 0; i++) { /* drop */ }
    }

    // ------------------------------------------------------------------ TCP 9100

    public static final class Tcp extends LpPosTransport {
        final String host; final int port; final int connectTimeoutMs;
        Socket s; OutputStream out; InputStream in;

        public Tcp(String host, int port, int connectTimeoutMs) {
            if (host == null || !host.matches("[A-Za-z0-9.:\\-\\[\\]]{1,253}")) throw new IllegalArgumentException("bad host");
            if (port < 1 || port > 65535) throw new IllegalArgumentException("bad port");
            this.host = host; this.port = port; this.connectTimeoutMs = connectTimeoutMs;
        }
        @Override public String kind() { return "net"; }
        @Override public void open() throws IOException {
            close();
            Socket x = new Socket();
            try {
                x.connect(new InetSocketAddress(host, port), connectTimeoutMs);
                x.setSoTimeout(5000);
                x.setTcpNoDelay(true);
                s = x; out = x.getOutputStream(); in = x.getInputStream();
            } catch (IOException e) {
                try { x.close(); } catch (IOException ignore) {}
                throw e;
            }
        }
        @Override public boolean isOpen() { return s != null && s.isConnected() && !s.isClosed(); }
        @Override public void close() {
            if (s != null) try { s.close(); } catch (IOException ignore) {}
            s = null; out = null; in = null;
        }
        @Override protected void writeRaw(byte[] b, int off, int len) throws IOException { out.write(b, off, len); out.flush(); }
        @Override public int readByte(int timeoutMs) throws IOException {
            if (!isOpen()) return -1;
            int old = s.getSoTimeout();
            try {
                s.setSoTimeout(Math.max(1, timeoutMs));
                return in.read();
            } catch (SocketTimeoutException e) {
                return -1;
            } finally {
                if (isOpen()) s.setSoTimeout(old);
            }
        }
    }

    // ------------------------------------------------------------------ mock (no hardware)

    /** Keeps everything written; can answer status requests like a real printer. Used by tests and by the "mock" printer in the screens. */
    public static final class Mock extends LpPosTransport {
        public final ByteArrayOutputStream written = new ByteArrayOutputStream();
        public int opens = 0, statusRequests = 0;
        public boolean failOpen = false;
        /** Answers to DLE EOT 1/2/4, or -1 for "does not answer". Defaults: online, paper OK, drawer pin low. */
        public int ans1 = 0x12, ans2 = 0x12, ans4 = 0x12;
        boolean open;
        private final java.util.ArrayDeque<Integer> pending = new java.util.ArrayDeque<>();

        @Override public String kind() { return "mock"; }
        @Override public void open() throws IOException {
            if (failOpen) throw new IOException("mock: cannot connect");
            open = true; opens++;
        }
        @Override public boolean isOpen() { return open; }
        @Override public void close() { open = false; }
        @Override protected void writeRaw(byte[] b, int off, int len) {
            if (len == 3 && b[off] == LpPosEscPos.DLE && b[off + 1] == LpPosEscPos.EOT) { // status request: answer, do not keep
                statusRequests++;
                int a = b[off + 2] == 1 ? ans1 : b[off + 2] == 2 ? ans2 : b[off + 2] == 4 ? ans4 : -1;
                if (a >= 0) pending.add(a);
                return;
            }
            written.write(b, off, len);
        }
        @Override public int readByte(int timeoutMs) { Integer v = pending.poll(); return v == null ? -1 : v; }
    }
}
