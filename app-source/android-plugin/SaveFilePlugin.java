package com.largepami.finance;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.OutputStream;

/**
 * save: opens the Android "Save as" picker (Storage Access Framework) and writes the given bytes to the chosen location.
 * gallery (19.11.2026): saves an image or a video straight into the phone's gallery (Pictures/LargePami or Movies/LargePami)
 * through MediaStore. Android 10+ only (no storage permission needed); on older Android it rejects with "old_android"
 * and the app falls back to save().
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("filename", "backup.json");
        String mime = call.getString("mime", "application/octet-stream");
        String data = call.getString("data");
        if (data == null) {
            call.reject("no data");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        try {
            Uri uri = result.getData().getData();
            byte[] bytes = Base64.decode(call.getString("data"), Base64.DEFAULT);
            OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (os == null) {
                call.reject("could not open destination");
                return;
            }
            os.write(bytes);
            os.flush();
            os.close();
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            r.put("bytes", bytes.length);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void gallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("old_android");
            return;
        }
        String mime = call.getString("mime", "");
        String data = call.getString("data");
        String name = call.getString("filename", "LargePami");
        boolean video = mime != null && mime.startsWith("video/");
        if (data == null || mime == null || !(video || mime.startsWith("image/"))) {
            call.reject("bad data");
            return;
        }
        name = name.replaceAll("[\\\\/:*?\"<>|]", "-");
        ContentResolver cr = getContext().getContentResolver();
        Uri coll = video
            ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/LargePami");
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = null;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            uri = cr.insert(coll, v);
            if (uri == null) {
                call.reject("could not create the gallery item");
                return;
            }
            OutputStream os = cr.openOutputStream(uri, "w");
            if (os == null) {
                cr.delete(uri, null, null);
                call.reject("could not open destination");
                return;
            }
            try {
                os.write(bytes);
                os.flush();
            } finally {
                os.close();
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, done, null, null);
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            r.put("bytes", bytes.length);
            call.resolve(r);
        } catch (Exception e) {
            if (uri != null) {
                try { cr.delete(uri, null, null); } catch (Exception ignored) { }
            }
            call.reject("write failed: " + e.getMessage());
        }
    }

    /**
     * open (27.11.2026): opens a file that the app already wrote to its cache folder in the app that handles its type
     * (Excel, a PDF reader...), through the system "Open with" chooser. Only files inside the app's cache folder are allowed.
     * Rejects with "no_app" only if the system cannot show the chooser.
     */
    @PluginMethod
    public void open(PluginCall call) {
        String u = call.getString("uri");
        String mime = call.getString("mime", "application/octet-stream");
        if (u == null) {
            call.reject("no uri");
            return;
        }
        try {
            String path = Uri.parse(u).getPath();
            File f = path == null ? null : new File(path).getCanonicalFile();
            File cache = getContext().getCacheDir().getCanonicalFile();
            if (f == null || !f.isFile() || !f.getPath().startsWith(cache.getPath() + File.separator)) {
                call.reject("bad path");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // no resolveActivity() check: on Android 11+ it returns null without a <queries> entry; the chooser itself says when no app fits
            Intent ch = Intent.createChooser(i, "\u05e4\u05ea\u05d9\u05d7\u05d4 \u05d1\u05d0\u05de\u05e6\u05e2\u05d5\u05ea");
            ch.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(ch);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("no_app");
        } catch (Exception e) {
            call.reject("open failed: " + e.getMessage());
        }
    }
}
