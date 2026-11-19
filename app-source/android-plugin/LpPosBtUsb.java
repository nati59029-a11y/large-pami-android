package com.largepami.finance;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/**
 * POS stage, 17.11.2026: Bluetooth (classic SPP) and USB (OTG) connections to a receipt printer.
 * Only devices that are already paired in the phone's Bluetooth settings are used: no scanning, so no location /
 * BLUETOOTH_SCAN permission. USB needs no manifest permission; Android asks the user once per device.
 */
final class LpPosBtUsb {
    private LpPosBtUsb() {}

    static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    static BluetoothAdapter adapter(Context ctx) {
        BluetoothManager bm = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        return bm == null ? null : bm.getAdapter();
    }

    /** True for a USB device that looks like a printer: interface class 7, or (cheap printers report class 255) a bulk OUT endpoint. */
    static boolean looksLikePrinter(UsbDevice d) {
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            if (d.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return true;
        }
        return false;
    }

    static UsbInterface pickInterface(UsbDevice d) {
        UsbInterface any = null;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface f = d.getInterface(i);
            if (bulk(f, UsbConstants.USB_DIR_OUT) == null) continue;
            if (f.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return f;
            if (any == null) any = f;
        }
        return any;
    }

    static UsbEndpoint bulk(UsbInterface f, int dir) {
        for (int i = 0; i < f.getEndpointCount(); i++) {
            UsbEndpoint e = f.getEndpoint(i);
            if (e.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && e.getDirection() == dir) return e;
        }
        return null;
    }

    // ------------------------------------------------------------------ Bluetooth

    static final class Bt extends LpPosTransport {
        final Context ctx; final String address;
        BluetoothSocket sock; OutputStream out; InputStream in;

        Bt(Context ctx, String address, int chunkDelayMs) {
            if (address == null || !BluetoothAdapter.checkBluetoothAddress(address.toUpperCase())) throw new IllegalArgumentException("bad bluetooth address");
            this.ctx = ctx; this.address = address.toUpperCase();
            this.chunk = 512; this.chunkDelayMs = Math.max(0, chunkDelayMs);
        }
        @Override public String kind() { return "bt"; }

        @SuppressLint("MissingPermission") // checked by LpPosPlugin before any Bluetooth call
        @Override public void open() throws IOException {
            close();
            BluetoothAdapter a = adapter(ctx);
            if (a == null) throw new IOException("no bluetooth on this phone");
            if (!a.isEnabled()) throw new IOException("bluetooth is off");
            BluetoothDevice d = a.getRemoteDevice(address);
            IOException last = null;
            for (int attempt = 0; attempt < 2; attempt++) {
                BluetoothSocket s = null;
                try {
                    s = attempt == 0 ? d.createRfcommSocketToServiceRecord(SPP) : d.createInsecureRfcommSocketToServiceRecord(SPP);
                    s.connect();
                    sock = s; out = s.getOutputStream(); in = s.getInputStream();
                    return;
                } catch (IOException e) {
                    last = e;
                    if (s != null) try { s.close(); } catch (IOException ignore) {}
                }
            }
            throw last != null ? last : new IOException("bluetooth connect failed");
        }
        @Override public boolean isOpen() { return sock != null && sock.isConnected(); }
        @Override public void close() {
            if (sock != null) try { sock.close(); } catch (IOException ignore) {}
            sock = null; out = null; in = null;
        }
        @Override protected void writeRaw(byte[] b, int off, int len) throws IOException { out.write(b, off, len); out.flush(); }
        @Override public int readByte(int timeoutMs) throws IOException {
            // Bluetooth streams have no read timeout: poll available() until the time is up.
            if (in == null) return -1;
            long end = System.currentTimeMillis() + Math.max(1, timeoutMs);
            while (System.currentTimeMillis() < end) {
                if (in.available() > 0) return in.read();
                try { Thread.sleep(10); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return -1; }
            }
            return -1;
        }
    }

    // ------------------------------------------------------------------ USB

    static final class Usb extends LpPosTransport {
        final UsbManager um; final UsbDevice dev;
        UsbDeviceConnection conn; UsbInterface intf; UsbEndpoint outEp, inEp;

        Usb(UsbManager um, UsbDevice dev) { this.um = um; this.dev = dev; this.chunk = 16384; }
        @Override public String kind() { return "usb"; }
        @Override public void open() throws IOException {
            close();
            if (!um.hasPermission(dev)) throw new IOException("usb permission not granted");
            UsbInterface f = pickInterface(dev);
            if (f == null) throw new IOException("usb device has no printer output");
            UsbDeviceConnection c = um.openDevice(dev);
            if (c == null) throw new IOException("usb open failed");
            if (!c.claimInterface(f, true)) { c.close(); throw new IOException("usb claim failed"); }
            conn = c; intf = f; outEp = bulk(f, UsbConstants.USB_DIR_OUT); inEp = bulk(f, UsbConstants.USB_DIR_IN);
        }
        @Override public boolean isOpen() { return conn != null; }
        @Override public void close() {
            if (conn != null) {
                try { if (intf != null) conn.releaseInterface(intf); } catch (Exception ignore) {}
                conn.close();
            }
            conn = null; intf = null; outEp = null; inEp = null;
        }
        @Override protected void writeRaw(byte[] b, int off, int len) throws IOException {
            int done = 0;
            while (done < len) {
                int n = conn.bulkTransfer(outEp, b, off + done, len - done, 5000);
                if (n <= 0) throw new IOException("usb write failed (unplugged?)");
                done += n;
            }
        }
        @Override public int readByte(int timeoutMs) {
            if (conn == null || inEp == null) return -1;
            byte[] buf = new byte[Math.max(1, inEp.getMaxPacketSize())];
            int n = conn.bulkTransfer(inEp, buf, buf.length, Math.max(1, timeoutMs));
            return n > 0 ? (buf[0] & 0xFF) : -1;
        }
        @Override protected void drain() { /* USB answers come per request; nothing old to drop */ }
    }
}
