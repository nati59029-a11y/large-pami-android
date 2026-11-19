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
}
