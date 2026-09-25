package com.soundvault.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
        name = "MusicNotification",
        permissions = {
                @Permission(
                        alias = "notifications",
                        strings = { Manifest.permission.POST_NOTIFICATIONS }
                )
        }
)
public class MusicNotificationPlugin extends Plugin {
    private static MusicNotificationPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    public static void notifyAction(String action) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("action", action);
            instance.notifyListeners("musicControlsAction", data);
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "Unknown Track");
        String artist = call.getString("artist", "poori");
        boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", true));
        String thumbnailUrl = call.getString("thumbnailUrl", "");

        Intent intent = new Intent(getContext(), MediaNotificationService.class);
        intent.setAction(MediaNotificationService.ACTION_UPDATE);
        intent.putExtra("title", title);
        intent.putExtra("artist", artist);
        intent.putExtra("isPlaying", isPlaying);
        intent.putExtra("thumbnailUrl", thumbnailUrl);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to start media notification service", e);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), MediaNotificationService.class);
            intent.setAction(MediaNotificationService.ACTION_STOP);
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to stop media notification service", e);
        }
    }
}
