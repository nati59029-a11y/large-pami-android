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

/** Opens the Android "Save as" picker (Storage Access Framework) and writes the given bytes to the chosen location.
 *  saveImage: writes a JPEG/PNG straight into the gallery (Pictures/LargePami, MediaStore) with no picker, so the app
 *  does not go to the background (Android 10+; older versions reject with "unsupported" and the app falls back to Share). */
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
    public void saveImage(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("unsupported");
            return;
        }
        String name = call.getString("filename", "image.jpg");
        String mime = call.getString("mime", "image/jpeg");
        String data = call.getString("data");
        if (data == null || !mime.startsWith("image/")) {
            call.reject("no data");
            return;
        }
        Uri uri = null;
        ContentResolver cr = getContext().getContentResolver();
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            if (bytes.length < 4 || ("image/jpeg".equals(mime) && ((bytes[0] & 0xFF) != 0xFF || (bytes[1] & 0xFF) != 0xD8 || (bytes[2] & 0xFF) != 0xFF))) {
                call.reject("bad image");
                return;
            }
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            v.put(MediaStore.Images.Media.MIME_TYPE, mime);
            v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/LargePami");
            v.put(MediaStore.Images.Media.IS_PENDING, 1);
            uri = cr.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
            if (uri == null) {
                call.reject("could not create the gallery file");
                return;
            }
            OutputStream os = cr.openOutputStream(uri, "w");
            if (os == null) {
                throw new Exception("could not open the gallery file");
            }
            os.write(bytes);
            os.flush();
            os.close();
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
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
