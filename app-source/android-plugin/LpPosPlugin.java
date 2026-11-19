package com.largepami.finance;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.hardware.display.DisplayManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.view.Display;
import android.view.InputDevice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * POS (cash register) hardware, 17.11.2026 - ONE plugin for the shop's register hardware:
 *  - receipt printer, ESC/POS, over USB (OTG), Bluetooth (paired, SPP) or network (TCP 9100). Hebrew printed as a picture.
 *  - cash drawer: opened by the printer (drawer cable in the printer's DK port).
 *  - customer display: a second screen through Android's Presentation API.
 *  - status of each part + the data the screens need for "equipment check".
 *  - P1-P9 of the POS spec (part D 6.1): USB first with reconnect by vendor/product id, cut, explicit PAPER_OUT / OFFLINE codes,
 *    no drawer sensor needed, attach/detach events, Android 7.1 (API 25) safe, room for a Sunmi adapter, showCustomer, vibrate.
 * The barcode scanner (keyboard mode) is handled in www/pos-hw.js; this plugin only lists external keyboards.
 *
 * Not here on purpose: card payments. No card number, track or PIN passes through this plugin.
 * Permissions: BLUETOOTH_CONNECT (Android 12+, asked only when the user picks a Bluetooth printer), BLUETOOTH (Android 11 and
 * lower, no prompt). USB: Android asks per device. Network printers: INTERNET (already in the app). No location, no scanning.
 */
@CapacitorPlugin(name = "LpPos", permissions = { @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bt") })
public class LpPosPlugin extends Plugin {
    static final String USB_PERM = "com.largepami.finance.LP_POS_USB_PERMISSION";

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private LpPosTransport conn;        // cached printer connection (used only on the io thread)
    private String connKey;
    private final LpPosTransport.Mock mock = new LpPosTransport.Mock();
    private LpPosDisplay display;
    private DisplayManager.DisplayListener displayListener;
    private BroadcastReceiver usbReceiver;
    private final HashMap<String, PluginCall> usbWaiting = new HashMap<>();

    @Override
    public void load() {
        display = new LpPosDisplay(getActivity());
        DisplayManager dm = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        if (dm != null) {
            displayListener = new DisplayManager.DisplayListener() {
                @Override public void onDisplayAdded(int id) { sendDisplayEvent(); }
                @Override public void onDisplayRemoved(int id) { if (display.shownOn() == id) display.dismiss(); sendDisplayEvent(); }
                @Override public void onDisplayChanged(int id) {}
            };
            dm.registerDisplayListener(displayListener, main);
        }
        usbReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                UsbDevice d = i.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (USB_PERM.equals(i.getAction())) {
                    boolean ok = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                    PluginCall call = d == null ? null : usbWaiting.remove(d.getDeviceName());
                    if (call != null) { JSObject r = new JSObject(); r.put("granted", ok); call.resolve(r); }
                } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(i.getAction()) || UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(i.getAction())) {
                    JSObject r = new JSObject();
                    r.put("attached", UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(i.getAction()));
                    r.put("deviceName", d == null ? "" : d.getDeviceName());
                    if (d != null) {
                        // P1: the printer is known by vendor/product id (the device name changes on every plug-in), so the screens reconnect by id
                        r.put("vendorId", d.getVendorId());
                        r.put("productId", d.getProductId());
                        UsbManager um = (UsbManager) c.getSystemService(Context.USB_SERVICE);
                        r.put("hasPermission", um != null && um.hasPermission(d));
                        r.put("canPrint", LpPosBtUsb.pickInterface(d) != null);
                    }
                    if (!r.getBool("attached")) io.execute(() -> { if (conn != null && "usb".equals(conn.kind())) dropConn(); });
                    notifyListeners("usb", r);
                }
            }
        };
        IntentFilter f = new IntentFilter(USB_PERM);
        f.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        f.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(usbReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(usbReceiver, f);
    }

    @Override
    protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(usbReceiver); } catch (Exception ignore) {}
        DisplayManager dm = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        if (dm != null && displayListener != null) dm.unregisterDisplayListener(displayListener);
        if (display != null) display.dismiss();
        io.execute(this::dropConn);
        io.shutdown();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("version", 1);
        call.resolve(r);
    }

    // ================================================================== devices

    @PluginMethod
    public void listDevices(PluginCall call) {
        JSObject r = new JSObject();
        r.put("usb", usbList());
        r.put("bt", btInfo());
        r.put("displays", displayList());
        r.put("keyboards", keyboards());
        call.resolve(r);
    }

    private JSArray usbList() {
        JSArray a = new JSArray();
        UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (um == null) return a;
        for (UsbDevice d : um.getDeviceList().values()) {
            JSObject o = new JSObject();
            o.put("deviceName", d.getDeviceName());
            o.put("vendorId", d.getVendorId());
            o.put("productId", d.getProductId());
            String name = null;
            try { name = d.getProductName(); } catch (SecurityException ignore) {}
            o.put("name", name == null ? ("USB " + hex4(d.getVendorId()) + ":" + hex4(d.getProductId())) : name);
            o.put("isPrinter", LpPosBtUsb.looksLikePrinter(d));
            o.put("canPrint", LpPosBtUsb.pickInterface(d) != null);
            o.put("hasPermission", um.hasPermission(d));
            a.put(o);
        }
        return a;
    }

    private boolean btAllowed() {
        return Build.VERSION.SDK_INT < 31 || getPermissionState("bt") == PermissionState.GRANTED;
    }

    @SuppressLint("MissingPermission") // btAllowed() is checked first
    private JSObject btInfo() {
        JSObject r = new JSObject();
        JSArray list = new JSArray();
        BluetoothAdapter a = LpPosBtUsb.adapter(getContext());
        if (a == null) r.put("state", "none");
        else if (!btAllowed()) r.put("state", Build.VERSION.SDK_INT >= 31 ? String.valueOf(getPermissionState("bt")).toLowerCase() : "denied");
        else if (!a.isEnabled()) r.put("state", "off");
        else {
            r.put("state", "ok");
            try {
                for (BluetoothDevice d : a.getBondedDevices()) {
                    JSObject o = new JSObject();
                    String n = d.getName();
                    o.put("name", n == null ? d.getAddress() : n);
                    o.put("address", d.getAddress());
                    int major = d.getBluetoothClass() == null ? -1 : d.getBluetoothClass().getMajorDeviceClass();
                    // Printers report "imaging" (0x600) or "uncategorized" (0x1F00); phones/headsets are listed last by the screens.
                    o.put("maybePrinter", major == 0x0600 || major == 0x1F00 || (n != null && n.matches("(?i).*(print|pos|pt-|rpp|mtp|xp-|tm-|58|80).*")));
                    list.put(o);
                }
            } catch (SecurityException e) { r.put("state", "denied"); }
        }
        r.put("devices", list);
        return r;
    }

    private JSArray displayList() {
        JSArray a = new JSArray();
        if (display == null) return a;
        for (Display d : display.displays()) {
            if (d.getDisplayId() == Display.DEFAULT_DISPLAY) continue;
            JSObject o = new JSObject();
            o.put("id", d.getDisplayId());
            o.put("name", d.getName());
            a.put(o);
        }
        return a;
    }

    /** External keyboards (a barcode scanner in keyboard mode shows up as one). Android 10+ can tell external from built-in. */
    private JSArray keyboards() {
        JSArray a = new JSArray();
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice d = InputDevice.getDevice(id);
            if (d == null || d.isVirtual()) continue;
            if ((d.getSources() & InputDevice.SOURCE_KEYBOARD) != InputDevice.SOURCE_KEYBOARD) continue;
            Boolean ext = Build.VERSION.SDK_INT >= 29 ? d.isExternal() : null;
            if (Boolean.FALSE.equals(ext)) continue;
            if (ext == null && d.getKeyboardType() != InputDevice.KEYBOARD_TYPE_ALPHABETIC) continue;
            JSObject o = new JSObject();
            o.put("name", d.getName());
            o.put("vendorId", d.getVendorId());
            o.put("productId", d.getProductId());
            o.put("external", ext == null ? JSObject.NULL : ext);
            a.put(o);
        }
        return a;
    }

    @PluginMethod
    public void requestBtPermission(PluginCall call) {
        if (btAllowed()) { JSObject r = new JSObject(); r.put("state", "granted"); call.resolve(r); return; }
        requestPermissionForAlias("bt", call, "btPermDone");
    }

    @PermissionCallback
    private void btPermDone(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", btAllowed() ? "granted" : "denied");
        call.resolve(r);
    }

    @PluginMethod
    public void requestUsbPermission(PluginCall call) {
        UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        UsbDevice d = findUsb(um, call.getString("deviceName"), call.getInt("vendorId", -1), call.getInt("productId", -1));
        if (d == null) { call.reject("usb device not found", "NOT_FOUND"); return; }
        if (um.hasPermission(d)) { JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return; }
        PluginCall old = usbWaiting.put(d.getDeviceName(), call);
        if (old != null) old.reject("replaced", "REPLACED");
        Intent i = new Intent(USB_PERM).setPackage(getContext().getPackageName());
        int fl = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0; // Android adds the result extras
        um.requestPermission(d, PendingIntent.getBroadcast(getContext(), 0, i, fl));
    }

    static UsbDevice findUsb(UsbManager um, String deviceName, int vid, int pid) {
        if (um == null) return null;
        UsbDevice byId = null;
        for (UsbDevice d : um.getDeviceList().values()) {
            if (deviceName != null && deviceName.equals(d.getDeviceName())) return d;
            if (byId == null && vid >= 0 && d.getVendorId() == vid && (pid < 0 || d.getProductId() == pid)) byId = d;
        }
        if (byId != null) return byId;
        // no name/ids given: the only printer-like device
        if (deviceName == null && vid < 0) {
            for (UsbDevice d : um.getDeviceList().values()) if (LpPosBtUsb.pickInterface(d) != null) return d;
        }
        return null;
    }

    // ================================================================== printer

    /** Opens (or reuses) the connection for the printer settings. Runs on the io thread. */
    private LpPosTransport connect(JSObject p, boolean[] reused) throws IOException {
        if (p == null) throw new PosErr("NO_PRINTER", "no printer chosen");
        String type = p.getString("type", "");
        String key;
        switch (type) {
            case "net": key = "net:" + p.getString("host", "") + ":" + p.getInteger("port", 9100); break;
            case "bt": key = "bt:" + p.getString("address", "").toUpperCase(); break;
            case "usb": key = "usb:" + p.getInteger("vendorId", -1) + ":" + p.getInteger("productId", -1) + ":" + p.getString("deviceName", ""); break;
            case "mock": key = "mock"; break;
            // P7: "sunmi" (built-in printer of some POS terminals) has a place here but is not built yet
            case "sunmi": throw new PosErr("ERROR", "built-in (Sunmi) printer is not supported yet");
            default: throw new PosErr("ERROR", "unknown printer type: " + type);
        }
        if (conn != null && key.equals(connKey) && conn.isOpen()) { reused[0] = true; return conn; }
        dropConn();
        reused[0] = false;
        LpPosTransport t;
        switch (type) {
            case "net": t = new LpPosTransport.Tcp(p.getString("host", ""), p.getInteger("port", 9100), 4000); break;
            case "bt":
                if (!btAllowed()) throw new IOException("bluetooth permission not granted");
                t = new LpPosBtUsb.Bt(getContext(), p.getString("address", ""), p.getInteger("chunkDelayMs", 15));
                break;
            case "usb": {
                UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
                String dn = p.getString("deviceName", null);
                UsbDevice d = findUsb(um, dn == null || dn.isEmpty() ? null : dn, p.getInteger("vendorId", -1), p.getInteger("productId", -1));
                if (d == null) throw new IOException("usb printer not connected");
                t = new LpPosBtUsb.Usb(um, d);
                break;
            }
            default: t = mock;
        }
        t.open();
        conn = t; connKey = key;
        return t;
    }

    private void dropConn() {
        if (conn != null) conn.close();
        conn = null; connKey = null;
    }

    /** Sends bytes; a reused connection that went stale (printer turned off and on) gets one fresh try. */
    private LpPosTransport send(JSObject p, byte[] data) throws IOException {
        boolean[] reused = { false };
        LpPosTransport t = connect(p, reused);
        try {
            t.write(data);
            return t;
        } catch (IOException e) {
            dropConn();
            if (!reused[0]) throw e;
            t = connect(p, reused);
            t.write(data);
            return t;
        }
    }

    private interface Job { void run() throws Exception; }

    /**
     * P3 (spec part D 6.1): print never reports a "blind" success. Error codes for the screens:
     * PAPER_OUT (paper ended / cover open: the sale is kept, the receipt waits for "print again"), OFFLINE (cannot reach the printer),
     * NO_PRINTER (none chosen), ERROR (anything else).
     */
    static final class PosErr extends IOException {
        final String code;
        PosErr(String code, String msg) { super(msg); this.code = code; }
    }

    private void onIo(final PluginCall call, final Job job) {
        io.execute(() -> {
            try { job.run(); }
            catch (PosErr e) { call.reject(e.getMessage(), e.code); }
            catch (IOException e) {
                dropConn();
                String m = e.getMessage();
                call.reject(m == null ? "printer not reachable" : m, "OFFLINE");
            }
            catch (Throwable e) {
                String m = e.getMessage();
                call.reject(m == null ? e.getClass().getSimpleName() : m, "ERROR");
            }
        });
    }

    /** print({printer, receipt, preview}) : draws the receipt, sends it, optionally returns the picture (PNG base64) for the screen. */
    @PluginMethod
    public void print(final PluginCall call) {
        final JSObject p = call.getObject("printer");
        final JSObject rc = call.getObject("receipt");
        final boolean preview = call.getBoolean("preview", false);
        if (rc == null) { call.reject("no receipt"); return; }
        onIo(call, () -> {
            long t0 = System.currentTimeMillis();
            if (p != null && !rc.has("width") && p.has("width")) rc.put("width", p.getInteger("width"));
            Bitmap bmp = LpPosRender.render(rc);
            int[] lum = LpPosRender.luma(bmp);
            boolean dither = rc.optBoolean("dither", false);
            int pin = p == null ? 2 : p.getInteger("drawerPin", 2);
            byte[] data = LpPosEscPos.job(lum, bmp.getWidth(), bmp.getHeight(), dither, rc.optBoolean("cut", true), rc.optBoolean("drawer", false), pin);
            JSObject r = new JSObject();
            if (preview) r.put("preview", png(bmp));
            r.put("width", bmp.getWidth());
            r.put("height", bmp.getHeight());
            r.put("bytes", data.length);
            if (p != null && !"none".equals(p.getString("type", ""))) {
                boolean[] reused = { false };
                LpPosTransport pre = connect(p, reused);
                paperCheck(pre); // before: no paper = do not even start (the receipt goes to the "waiting to print" queue)
                LpPosTransport t = send(p, data);
                LpPosEscPos.Status after = paperCheck(t); // after: paper ended in the middle = the receipt is not trusted
                r.put("printed", true);
                r.put("via", t.kind());
                r.put("paperLow", nul(after == null ? null : after.paperLow));
            } else r.put("printed", false);
            bmp.recycle();
            r.put("ms", System.currentTimeMillis() - t0);
            call.resolve(r);
        });
    }

    /** Status check around a print job. Printers that never answer are asked once per connection, then skipped. */
    private LpPosEscPos.Status paperCheck(LpPosTransport t) throws IOException {
        if (t == null || Boolean.FALSE.equals(t.answers)) return null;
        LpPosEscPos.Status s = t.queryStatus(350);
        if (Boolean.TRUE.equals(s.paperOut)) throw new PosErr("PAPER_OUT", "paper ended");
        if (Boolean.TRUE.equals(s.coverOpen)) throw new PosErr("PAPER_OUT", "printer cover is open");
        if (Boolean.FALSE.equals(s.online)) throw new PosErr("OFFLINE", "printer is not ready");
        return s;
    }

    /** printRaw({printer, data}) : ready ESC/POS bytes (base64), for special printers. */
    @PluginMethod
    public void printRaw(final PluginCall call) {
        final JSObject p = call.getObject("printer");
        final String b64 = call.getString("data", "");
        onIo(call, () -> {
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            if (data.length == 0 || data.length > 2 * 1024 * 1024) throw new IOException("bad data size");
            send(p, data);
            JSObject r = new JSObject(); r.put("bytes", data.length); call.resolve(r);
        });
    }

    /** openDrawer({printer, pin}) : pulse to the drawer through the printer. */
    @PluginMethod
    public void openDrawer(final PluginCall call) {
        final JSObject p = call.getObject("printer");
        final int pin = call.getInt("pin", p == null ? 2 : p.getInteger("drawerPin", 2));
        onIo(call, () -> {
            send(p, LpPosEscPos.drawer(pin, 100, 200));
            JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
        });
    }

    /**
     * printerStatus({printer, timeoutMs}) : connects and asks the printer for its status.
     * {connected:false, error} when it cannot connect. Fields online/paperOut/paperLow/coverOpen/drawerOpen are null when the
     * printer does not answer status requests (common with Bluetooth printers) - "connected" is still a useful answer.
     */
    @PluginMethod
    public void printerStatus(final PluginCall call) {
        final JSObject p = call.getObject("printer");
        final int to = Math.max(100, Math.min(3000, call.getInt("timeoutMs", 700)));
        io.execute(() -> {
            JSObject r = new JSObject();
            try {
                boolean[] reused = { false };
                LpPosTransport t;
                try { t = connect(p, reused); }
                catch (IOException e) { dropConn(); if (!reused[0]) throw e; t = connect(p, reused); }
                LpPosEscPos.Status s;
                try { s = t.queryStatus(to); }
                catch (IOException e) { dropConn(); t = connect(p, reused); s = t.queryStatus(to); }
                r.put("connected", true);
                r.put("via", t.kind());
                r.put("answered", s.online != null);
                r.put("online", nul(s.online));
                r.put("paperOut", nul(s.paperOut));
                r.put("paperLow", nul(s.paperLow));
                r.put("coverOpen", nul(s.coverOpen));
                r.put("drawerOpen", nul(s.drawerOpen));
                r.put("error", nul(s.error));
            } catch (Throwable e) {
                dropConn();
                r.put("connected", false);
                r.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            }
            call.resolve(r);
        });
    }

    @PluginMethod
    public void disconnect(final PluginCall call) {
        io.execute(() -> { dropConn(); call.resolve(); });
    }

    /** For the screens' "mock printer": the bytes it got since the last call (base64), then cleared. */
    @PluginMethod
    public void mockTake(final PluginCall call) {
        io.execute(() -> {
            JSObject r = new JSObject();
            byte[] b = mock.written.toByteArray();
            mock.written.reset();
            r.put("data", Base64.encodeToString(b, Base64.NO_WRAP));
            r.put("bytes", b.length);
            call.resolve(r);
        });
    }

    // ================================================================== customer display

    @PluginMethod
    public void displayInfo(final PluginCall call) {
        main.post(() -> {
            JSObject r = new JSObject();
            JSArray a = displayList();
            r.put("available", a.length() > 0);
            r.put("displays", a);
            r.put("showing", display.isShowing());
            call.resolve(r);
        });
    }

    /** displayShow({html}) : shows the HTML on the second screen. {shown:false} when there is no second screen. */
    @PluginMethod
    public void displayShow(final PluginCall call) {
        final String html = call.getString("html", "");
        if (html.length() > 512 * 1024) { call.reject("html too big"); return; }
        main.post(() -> {
            JSObject r = new JSObject();
            r.put("shown", display.show(html));
            call.resolve(r);
        });
    }

    @PluginMethod
    public void displayClear(final PluginCall call) {
        main.post(() -> { display.dismiss(); call.resolve(); });
    }

    private void sendDisplayEvent() {
        JSObject r = new JSObject();
        JSArray a = displayList();
        r.put("available", a.length() > 0);
        r.put("displays", a);
        r.put("showing", display.isShowing());
        notifyListeners("display", r);
    }

    /** P8: the customer display under the name the spec uses (same as displayShow). */
    @PluginMethod
    public void showCustomer(final PluginCall call) { displayShow(call); }

    /** P9: vibration (navigator.vibrate does not work in every WebView). VIBRATE is a normal permission: no prompt. */
    @PluginMethod
    public void vibrate(final PluginCall call) {
        final int ms = Math.max(10, Math.min(1000, call.getInt("ms", 40)));
        try {
            Vibrator v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) { JSObject r = new JSObject(); r.put("ok", false); call.resolve(r); return; }
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(ms);
            JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
        } catch (Exception e) { JSObject r = new JSObject(); r.put("ok", false); call.resolve(r); }
    }

    // ================================================================== helpers

    static Object nul(Boolean b) { return b == null ? JSObject.NULL : b; }

    static String hex4(int v) { return String.format("%04x", v & 0xFFFF); }

    static String png(Bitmap b) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, o);
        return Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP);
    }
}
