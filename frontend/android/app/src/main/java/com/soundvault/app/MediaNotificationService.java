package com.soundvault.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaNotificationService extends Service {
    public static final String ACTION_UPDATE = "com.soundvault.app.ACTION_UPDATE";
    public static final String ACTION_PLAY = "com.soundvault.app.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.soundvault.app.ACTION_PAUSE";
    public static final String ACTION_PREV = "com.soundvault.app.ACTION_PREV";
    public static final String ACTION_NEXT = "com.soundvault.app.ACTION_NEXT";
    public static final String ACTION_STOP = "com.soundvault.app.ACTION_STOP";

    private static final String CHANNEL_ID = "poori_playback_channel";
    private static final int NOTIFICATION_ID = 1001;

    private MediaSessionCompat mediaSession;
    private final ExecutorService imageExecutor = Executors.newSingleThreadExecutor();
    private String currentTitle = "";
    private String currentArtist = "";
    private String currentThumbnailUrl = "";
    private boolean currentIsPlaying = false;
    private Bitmap cachedArtwork = null;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        initMediaSession();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Music Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows media playback controls for poori");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "PooriMediaSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                MusicNotificationPlugin.notifyAction("play");
            }

            @Override
            public void onPause() {
                MusicNotificationPlugin.notifyAction("pause");
            }

            @Override
            public void onSkipToNext() {
                MusicNotificationPlugin.notifyAction("next");
            }

            @Override
            public void onSkipToPrevious() {
                MusicNotificationPlugin.notifyAction("previous");
            }

            @Override
            public void onStop() {
                MusicNotificationPlugin.notifyAction("pause");
                stopNotification();
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_NOT_STICKY;
        }

        String action = intent.getAction();

        switch (action) {
            case ACTION_UPDATE:
                String title = intent.getStringExtra("title");
                String artist = intent.getStringExtra("artist");
                boolean isPlaying = intent.getBooleanExtra("isPlaying", false);
                String thumbnailUrl = intent.getStringExtra("thumbnailUrl");

                currentTitle = (title != null && !title.isEmpty()) ? title : "Unknown Track";
                currentArtist = (artist != null && !artist.isEmpty()) ? artist : "poori";
                currentIsPlaying = isPlaying;

                if (thumbnailUrl != null && !thumbnailUrl.equals(currentThumbnailUrl)) {
                    currentThumbnailUrl = thumbnailUrl;
                    cachedArtwork = null;
                    fetchArtworkAndNotify(thumbnailUrl);
                } else {
                    buildAndPostNotification(cachedArtwork);
                }
                break;

            case ACTION_PLAY:
                MusicNotificationPlugin.notifyAction("play");
                break;

            case ACTION_PAUSE:
                MusicNotificationPlugin.notifyAction("pause");
                break;

            case ACTION_PREV:
                MusicNotificationPlugin.notifyAction("previous");
                break;

            case ACTION_NEXT:
                MusicNotificationPlugin.notifyAction("next");
                break;

            case ACTION_STOP:
                stopNotification();
                break;
        }

        return START_NOT_STICKY;
    }

    private void fetchArtworkAndNotify(String urlString) {
        if (urlString == null || urlString.isEmpty() || !urlString.startsWith("http")) {
            buildAndPostNotification(null);
            return;
        }

        final String requestedUrl = urlString;
        imageExecutor.execute(() -> {
            Bitmap bitmap = null;
            try {
                URL url = new URL(requestedUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setDoInput(true);
                conn.connect();
                InputStream input = conn.getInputStream();
                bitmap = BitmapFactory.decodeStream(input);
                if (bitmap != null) {
                    bitmap = Bitmap.createScaledBitmap(bitmap, 512, 512, true);
                }
            } catch (Exception ignored) {
            }

            if (requestedUrl.equals(currentThumbnailUrl)) {
                cachedArtwork = bitmap;
                buildAndPostNotification(cachedArtwork);
            }
        });

        // Immediately show notification with current or fallback artwork
        buildAndPostNotification(cachedArtwork);
    }

    private void buildAndPostNotification(@Nullable Bitmap artwork) {
        if (mediaSession == null) return;

        // Update MediaSession state
        long actions = PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                PlaybackStateCompat.ACTION_STOP;

        int state = currentIsPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1.0f)
                .build();
        mediaSession.setPlaybackState(playbackState);

        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist);
        if (artwork != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        }
        mediaSession.setMetadata(metaBuilder.build());

        // Notification Click Intent -> Return to MainActivity
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingContent = PendingIntent.getActivity(
                this,
                0,
                contentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent prevIntent = getServicePendingIntent(ACTION_PREV, 10);
        PendingIntent playPauseIntent = getServicePendingIntent(currentIsPlaying ? ACTION_PAUSE : ACTION_PLAY, 11);
        PendingIntent nextIntent = getServicePendingIntent(ACTION_NEXT, 12);

        int playPauseIcon = currentIsPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String playPauseTitle = currentIsPlaying ? "Pause" : "Play";

        androidx.media.app.NotificationCompat.MediaStyle mediaStyle = new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setContentIntent(pendingContent)
                .setStyle(mediaStyle)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(currentIsPlaying)
                .addAction(android.R.drawable.ic_media_previous, "Previous", prevIntent)
                .addAction(playPauseIcon, playPauseTitle, playPauseIntent)
                .addAction(android.R.drawable.ic_media_next, "Next", nextIntent);

        if (artwork != null) {
            builder.setLargeIcon(artwork);
        }

        Notification notification = builder.build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }

            if (!currentIsPlaying) {
                // Allows dismissing if paused
                stopForeground(false);
            }
        } catch (Exception e) {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, notification);
            }
        }
    }

    private PendingIntent getServicePendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MediaNotificationService.class);
        intent.setAction(action);
        return PendingIntent.getService(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void stopNotification() {
        try {
            stopForeground(true);
        } catch (Exception ignored) {
        }
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID);
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        imageExecutor.shutdown();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
