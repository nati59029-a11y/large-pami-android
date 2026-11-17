package com.largepami.finance;

import android.app.Activity;
import android.app.Presentation;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * POS stage, 17.11.2026: customer-facing second screen (Android Presentation API).
 * Works with POS terminals that have a built-in second screen, and with an HDMI / USB-C monitor or a cast display.
 * The screens send ready HTML (www/pos-hw.js builds it from the cart). The second screen shows it in a WebView
 * with JavaScript, files and network OFF: it can only show what it is given.
 * All methods must run on the UI thread.
 */
final class LpPosDisplay {
    private final Activity act;
    private Presentation pres;
    private WebView web;
    private int shownOn = -1;
    String lastHtml = null;

    LpPosDisplay(Activity act) { this.act = act; }

    Display[] displays() {
        DisplayManager dm = (DisplayManager) act.getSystemService(Context.DISPLAY_SERVICE);
        return dm == null ? new Display[0] : dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
    }

    Display pick() {
        Display[] ds = displays();
        for (Display d : ds) if (d.getDisplayId() != Display.DEFAULT_DISPLAY) return d;
        return null;
    }

    boolean isShowing() { return pres != null && pres.isShowing(); }
    int shownOn() { return isShowing() ? shownOn : -1; }

    /** Shows html on the second screen. Returns false when there is no second screen. */
    boolean show(String html) {
        Display d = pick();
        if (d == null) { dismiss(); return false; }
        if (pres == null || !pres.isShowing() || pres.getDisplay().getDisplayId() != d.getDisplayId()) {
            dismiss();
            final Display target = d;
            pres = new Presentation(act, target) {
                @Override protected void onCreate(Bundle b) {
                    super.onCreate(b);
                    WebView w = new WebView(getContext());
                    WebSettings s = w.getSettings();
                    s.setJavaScriptEnabled(false);
                    s.setAllowFileAccess(false);
                    s.setAllowContentAccess(false);
                    s.setBlockNetworkLoads(true);
                    s.setBlockNetworkImage(false); // data: images still show
                    w.setBackgroundColor(0xFFFFFFFF);
                    setContentView(w);
                    web = w;
                }
            };
            try {
                pres.show();
                shownOn = d.getDisplayId();
            } catch (WindowManager.InvalidDisplayException e) {
                pres = null; web = null;
                return false;
            }
        }
        lastHtml = html;
        if (web != null) web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        return true;
    }

    void dismiss() {
        if (pres != null) {
            try { pres.dismiss(); } catch (Exception ignore) {}
        }
        if (web != null) {
            try { web.destroy(); } catch (Exception ignore) {}
        }
        pres = null; web = null; shownOn = -1;
    }
}
