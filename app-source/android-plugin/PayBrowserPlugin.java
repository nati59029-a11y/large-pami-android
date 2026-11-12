package com.largepami.finance;

import android.app.Dialog;
import android.content.DialogInterface;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebViewDatabase;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * In-app browser for the business payment (clearing) site (task 2026-11-12).
 * Opens the site in a separate full screen WebView, and - when the app passes login details - fills them ONCE
 * on the login page of the same site (the same host or a sub-domain of it) and presses the login button.
 * An SMS code (if the site asks for one) is typed by the worker on the page.
 *
 * JS (window.Capacitor.Plugins.PayBrowser):
 *   open({ url, user?, pass? }) -> { closed: true, filled }   resolves when the screen is closed
 *
 * Security:
 *  - https only (the start url and every navigation; tel:, mailto:, intent: and the rest are blocked, not opened).
 *  - No JavaScript bridge (no addJavascriptInterface), no file / content access, no mixed content, no saved form data.
 *  - The login details are never logged (capacitor.config.json: loggingBehavior "none" - Capacitor would log the call data),
 *    are injected only into the matching host (checked in Java right before every try, and again inside the page:
 *    location.protocol / location.hostname), and are cleared from memory right after the injection.
 *  - The WebView is excluded from Android Autofill (no "save password" offer).
 *    On close: the WebView is destroyed and the WebView form data is cleared.
 */
@CapacitorPlugin(name = "PayBrowser")
public class PayBrowserPlugin extends Plugin {

    private static final int MAX_TRIES = 6;      // waiting for a password field (pages that build the form late)
    private static final long TRY_EVERY_MS = 500;
    private static final int GOLD = Color.rgb(212, 175, 55);
    private static final int DARK = Color.rgb(18, 18, 18);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private Dialog dialog;
    private WebView web;
    private PluginCall pending;
    private String host0;
    private String user;
    private String pass;
    private boolean done;
    private boolean filled;
    private int gen; // page generation: a retry of an older page never runs on a newer one (moved on every page start and finish)
    private boolean inflight; // one injection at a time

    @PluginMethod
    public void open(final PluginCall call) {
        final String url = call.getString("url");
        Uri u = null;
        try { u = url == null ? null : Uri.parse(url.trim()); } catch (Exception ignored) { /* invalid */ }
        if (u == null || !"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null || u.getHost().indexOf('.') < 0) {
            call.reject("bad url");
            return;
        }
        final String p = call.getString("pass");
        final String us = call.getString("user");
        try { // the call stays open until the screen closes - do not keep the details in its data
            call.getData().remove("pass");
            call.getData().remove("user");
        } catch (Exception ignored) { /* nothing to remove */ }
        final Uri start = u;
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (dialog != null) {
                    call.reject("busy");
                    return;
                }
                try {
                    show(call, start, us, p);
                } catch (Exception e) {
                    cleanup();
                    call.reject("open failed");
                }
            }
        });
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics()));
    }

    private void show(PluginCall call, Uri start, String us, String p) {
        pending = call;
        host0 = start.getHost().toLowerCase();
        boolean has = p != null && p.length() > 0;
        pass = has ? p : null;
        user = has && us != null ? us : null;
        done = !has; // no details: only open the site
        filled = false;
        inflight = false;
        gen = 0;

        final Dialog d = new Dialog(getActivity(), android.R.style.Theme_DeviceDefault_NoActionBar);
        d.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = new LinearLayout(getContext());
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(DARK);

        // top bar, right to left: "סגור" on the right, the site name next to it
        LinearLayout bar = new LinearLayout(getContext());
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(DARK);
        bar.setPadding(dp(8), dp(4), dp(8), dp(4));

        Button close = new Button(getContext());
        close.setText("סגור");
        close.setTextColor(DARK);
        close.setTypeface(Typeface.DEFAULT_BOLD);
        close.setBackgroundColor(GOLD);
        close.setMinHeight(dp(44));
        close.setMinimumHeight(dp(44));
        close.setMinWidth(dp(72));
        close.setMinimumWidth(dp(72));
        close.setAllCaps(false);
        close.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                d.dismiss();
            }
        });
        bar.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(getContext());
        title.setText(host0);
        title.setTextColor(GOLD);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        title.setSingleLine(true);
        title.setTextDirection(View.TEXT_DIRECTION_LTR);
        title.setGravity(Gravity.CENTER);
        title.setPadding(dp(12), 0, dp(12), 0);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        final WebView w = new WebView(getContext());
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSaveFormData(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false); // target=_blank opens here (and passes the https check below)
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 26) w.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        w.setWebChromeClient(new WebChromeClient()); // default alert/confirm dialogs of the site
        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isHttps(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isHttps(url == null ? null : Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                gen++; // a new page: pending tries of the old one are dropped
                inflight = false; // a result of the old page (if any) is ignored by gen
                ui.removeCallbacksAndMessages(null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                gen++;
                ui.removeCallbacksAndMessages(null);
                if (!done && view == web && hostOk(url)) tryFill(gen, 0);
            }
        });
        root.addView(w, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        d.setContentView(root);
        d.setCancelable(true);
        d.setOnKeyListener(new DialogInterface.OnKeyListener() {
            @Override
            public boolean onKey(DialogInterface di, int keyCode, KeyEvent event) {
                if (keyCode != KeyEvent.KEYCODE_BACK) return false;
                if (event.getAction() == KeyEvent.ACTION_UP) {
                    if (web != null && web.canGoBack()) web.goBack();
                    else d.dismiss();
                }
                return true;
            }
        });
        d.setOnDismissListener(new DialogInterface.OnDismissListener() {
            @Override
            public void onDismiss(DialogInterface di) {
                PluginCall c = pending;
                boolean f = filled;
                cleanup();
                if (c != null) {
                    JSObject r = new JSObject();
                    r.put("closed", true);
                    r.put("filled", f);
                    c.resolve(r);
                }
            }
        });

        Window win = d.getWindow();
        if (win != null) {
            win.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            win.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            win.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(DARK));
            // the app lock hides the app in "recent apps" (FLAG_SECURE) - the payment page too
            Window aw = getActivity().getWindow();
            if (aw != null && (aw.getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0) {
                win.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
            }
        }
        dialog = d;
        web = w;
        d.show();
        w.loadUrl(start.toString());
    }

    private static boolean isHttps(Uri u) {
        return u != null && "https".equalsIgnoreCase(u.getScheme()) && u.getHost() != null && u.getHost().length() > 0;
    }

    /** The same host as the start url, or a sub-domain of it (only https). A parent domain is NOT accepted (co.il). */
    private boolean hostOk(String url) {
        if (url == null || host0 == null) return false;
        Uri u;
        try { u = Uri.parse(url); } catch (Exception e) { return false; }
        if (!isHttps(u)) return false;
        String h = u.getHost().toLowerCase();
        return h.equals(host0) || h.endsWith("." + host0);
    }

    private void tryFill(final int g, final int attempt) {
        if (done || inflight || web == null || g != gen || pass == null) return;
        if (!hostOk(web.getUrl())) return; // the page moved on meanwhile
        inflight = true;
        String js = "(function(u,p,h0){"
                + "var h=String(location.hostname||'').toLowerCase();"
                + "if(location.protocol!=='https:'||!(h===h0||h.slice(-(h0.length+1))==='.'+h0))return 'host';"
                + "function vis(e){if(!e||e.disabled||e.readOnly)return false;var r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;"
                + "var s=window.getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none';}"
                + "var a=[].slice.call(document.querySelectorAll('input')),pi=-1,i;"
                + "for(i=0;i<a.length;i++){if((a[i].type||'').toLowerCase()==='password'&&vis(a[i])){pi=i;break;}}"
                + "if(pi<0)return 'nopass';"
                + "var pw=a[pi],us=null;"
                + "if(u){for(i=pi-1;i>=0;i--){var t=(a[i].getAttribute('type')||'text').toLowerCase();if((t==='text'||t==='email'||t==='tel')&&vis(a[i])){us=a[i];break;}}}"
                + "var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');"
                + "function set(e,v){e.focus();if(d&&d.set)d.set.call(e,v);else e.value=v;"
                + "e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}"
                + "if(us)set(us,u);set(pw,p);pw.blur();"
                + "var f=pw.form;"
                + "setTimeout(function(){try{"
                + "if(f){var b=f.querySelector('button[type=submit],input[type=submit],button:not([type])');"
                + "if(b){b.click();}else if(f.requestSubmit){f.requestSubmit();}else{var b2=f.querySelector('button');if(b2)b2.click();}}"
                + "else{var b3=document.querySelector('button[type=submit],input[type=submit]');if(b3)b3.click();}"
                + "}catch(x){}},300);"
                + "return 'ok';"
                + "})(" + JSONObject.quote(user == null ? "" : user) + "," + JSONObject.quote(pass) + "," + JSONObject.quote(host0) + ");";
        web.evaluateJavascript(js, new android.webkit.ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                inflight = false;
                if ("\"ok\"".equals(v)) { // filled - even if the page has moved on meanwhile: never again
                    done = true;
                    filled = true;
                    user = null;
                    pass = null;
                    return;
                }
                if (done || g != gen) return;
                if ("\"nopass\"".equals(v) && attempt + 1 < MAX_TRIES) {
                    ui.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            tryFill(g, attempt + 1);
                        }
                    }, TRY_EVERY_MS);
                }
                // else: give up on this page - the worker types the details by hand
            }
        });
    }

    private void cleanup() {
        ui.removeCallbacksAndMessages(null);
        user = null;
        pass = null;
        done = true;
        inflight = false;
        pending = null;
        WebView w = web;
        web = null;
        dialog = null;
        if (w != null) {
            try {
                w.stopLoading();
                ViewGroup parent = (ViewGroup) w.getParent();
                if (parent != null) parent.removeView(w);
                w.destroy();
            } catch (Exception ignored) { /* already gone */ }
        }
        try {
            WebViewDatabase.getInstance(getContext()).clearFormData();
        } catch (Exception ignored) { /* nothing saved */ }
    }

    @Override
    protected void handleOnDestroy() {
        Dialog d = dialog;
        if (d != null) {
            try { d.dismiss(); } catch (Exception ignored) { /* activity gone */ }
        }
        cleanup();
        super.handleOnDestroy();
    }
}
