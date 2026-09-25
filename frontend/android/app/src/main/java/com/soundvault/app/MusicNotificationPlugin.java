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

    public static void notifySeek(long positionMs) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("action", "seek");
            data.put("time", (double) positionMs / 1000.0);
            instance.notifyListeners("musicControlsAction", data);
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "Unknown Track");
        String artist = call.getString("artist", "poori");
        boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", true));
        String thumbnailUrl = call.getString("thumbnailUrl", "");
        Double duration = call.getDouble("duration", 0.0);
        Double position = call.getDouble("position", 0.0);

        long durationMs = (duration != null && duration > 0) ? (long) (duration * 1000) : 0;
        long positionMs = (position != null && position >= 0) ? (long) (position * 1000) : 0;

        Intent intent = new Intent(getContext(), MediaNotificationService.class);
        intent.setAction(MediaNotificationService.ACTION_UPDATE);
        intent.putExtra("title", title);
        intent.putExtra("artist", artist);
        intent.putExtra("isPlaying", isPlaying);
        intent.putExtra("thumbnailUrl", thumbnailUrl);
        intent.putExtra("durationMs", durationMs);
        intent.putExtra("positionMs", positionMs);

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
    public void setPosition(PluginCall call) {
        Double position = call.getDouble("position", 0.0);
        long positionMs = (position != null && position >= 0) ? (long) (position * 1000) : 0;
        boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", true));

        Intent intent = new Intent(getContext(), MediaNotificationService.class);
        intent.setAction(MediaNotificationService.ACTION_SET_POSITION);
        intent.putExtra("positionMs", positionMs);
        intent.putExtra("isPlaying", isPlaying);

        try {
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to set position", e);
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
