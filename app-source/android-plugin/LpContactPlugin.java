package com.largepami.finance;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Contacts for group chats (25.11.2026, www/groups.js).
 * pick(): opens the phone's own contact picker (phone numbers only) and returns {name, phone}.
 *   No READ_CONTACTS permission: the picker grants read access to the one chosen row only.
 * save({name, phone}): opens the phone's "new contact" screen filled in; the user taps save there.
 * Older APKs without this plugin: the JS falls back to typing a name and number by hand.
 */
@CapacitorPlugin(name = "LpContact")
public class LpContactPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
            startActivityForResult(call, intent, "pickResult");
        } catch (Exception e) {
            call.reject("no_picker");
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        String[] cols = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };
        try (Cursor c = getContext().getContentResolver().query(uri, cols, null, null, null)) {
            if (c == null || !c.moveToFirst()) {
                call.reject("not_found");
                return;
            }
            String name = c.getString(0);
            String phone = c.getString(1);
            JSObject r = new JSObject();
            r.put("name", name == null ? "" : name);
            r.put("phone", phone == null ? "" : phone);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("read_failed");
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "");
        String phone = call.getString("phone", "");
        try {
            Intent intent = new Intent(ContactsContract.Intents.Insert.ACTION);
            intent.setType(ContactsContract.RawContacts.CONTENT_TYPE);
            intent.putExtra(ContactsContract.Intents.Insert.NAME, name);
            intent.putExtra(ContactsContract.Intents.Insert.PHONE, phone);
            intent.putExtra("finishActivityOnSaveCompleted", true);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("no_contacts_app");
        }
    }
}
