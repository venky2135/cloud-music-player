package com.soundvault.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MusicNotificationPlugin.class);
        super.onCreate(savedInstanceState);

        // Allow media playback without requiring a direct user touch gesture inside WebView
        if (bridge != null && bridge.getWebView() != null) {
            WebSettings settings = bridge.getWebView().getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Prevent Chromium WebView from freezing audio playback when minimized
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().onResume();
        }
    }
}
