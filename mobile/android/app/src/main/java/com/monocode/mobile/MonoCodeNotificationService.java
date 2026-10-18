package com.monocode.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** A started foreground receiver continues independently of the activity/WebView. */
public final class MonoCodeNotificationService extends Service {
    static final String REMOTE_CHANNEL = "monocode-remote";
    static final int REMOTE_ID = 9042;
    private static final String ACTIVE = "remote-active";
    private static final String ENDPOINT = "remote-endpoint";
    private static final String ENVIRONMENT = "remote-environment";
    private static final String ALERTS = "remote-alerts";
    private final Handler main = new Handler(Looper.getMainLooper());
    private ScheduledExecutorService executor;
    private volatile Config config;
    private volatile HttpURLConnection request;
    private int failures;
    private boolean connected;

    final class ReceiverBinder extends Binder {
        void start(Intent intent) throws Exception { configure(intent, false); }
    }
    private static final class Config {
        final String endpoint, token, environmentId, name;
        final JSONObject texts;
        final boolean alerts;
        Config(Intent intent) throws Exception {
            endpoint = intent.getStringExtra("endpoint"); token = intent.getStringExtra("token"); environmentId = intent.getStringExtra("environmentId");
            URI uri = new URI(endpoint);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !(uri.getPath().isEmpty() || "/".equals(uri.getPath())) || token == null || !token.matches("[A-Za-z0-9_-]+")
                || environmentId == null || environmentId.isEmpty())
                throw new IllegalArgumentException("Invalid notification connection");
            String host = intent.getStringExtra("name");
            name = host == null || host.isEmpty() ? uri.getHost() : host;
            texts = new JSONObject(intent.getStringExtra("texts"));
            alerts = intent.getBooleanExtra("enabled", true);
        }
    }
    private static void deactivate(Context context) {
        MobileActivityTracker.preferences(context).edit().remove(ACTIVE).remove(ENDPOINT).remove(ENVIRONMENT).commit();
    }
    static void stop(Context context) {
        // Deactivate first so a concurrent system restart cannot restore a
        // deliberately disconnected receiver. No credential is stored here.
        deactivate(context);
        context.stopService(new Intent(context, MonoCodeNotificationService.class));
        context.getSystemService(NotificationManager.class).cancel(REMOTE_ID);
    }
    static Intent restoreIntent(Context context) throws Exception {
        SharedPreferences saved = MobileActivityTracker.preferences(context);
        if (!saved.getBoolean(ACTIVE, false)) return null;
        String value = MonoCodeCredentialsPlugin.read(context, "connection");
        if (value == null) return null;
        JSONObject connection = new JSONObject(value);
        if (connection.optBoolean("disabled", false)) return null;
        if (!connection.getString("endpoint").equals(saved.getString(ENDPOINT, null))
            || !connection.getString("environmentId").equals(saved.getString(ENVIRONMENT, null))) return null;
        return new Intent(context, MonoCodeNotificationService.class)
            .putExtra("endpoint", connection.getString("endpoint")).putExtra("token", connection.getString("token"))
            .putExtra("environmentId", connection.getString("environmentId")).putExtra("name", connection.optString("name"))
            .putExtra("texts", saved.getString("texts", "{}")).putExtra("enabled", saved.getBoolean(ALERTS, true));
    }
    @Override public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.execute(this::poll);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            boolean restoring = intent == null;
            if (restoring) intent = restoreIntent(this);
            if (intent == null) { stopReceiving(); return START_NOT_STICKY; }
            configure(intent, restoring);
            return START_STICKY;
        } catch (Exception error) {
            stopReceiving();
            return START_NOT_STICKY;
        }
    }
    private void configure(Intent intent, boolean restoring) throws Exception {
        Config next = new Config(intent);
        String stored = MonoCodeCredentialsPlugin.read(this, "connection");
        if (stored == null || new JSONObject(stored).optBoolean("disabled", false))
            throw new IllegalStateException("Connection is disabled");
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled())
            throw new IllegalStateException("Notifications are disabled");
        Config previous = config;
        boolean sameConnection = previous != null && previous.endpoint.equals(next.endpoint)
            && previous.environmentId.equals(next.environmentId) && previous.token.equals(next.token);
        if (!MobileActivityTracker.preferences(this).edit().putBoolean(ACTIVE, true)
            .putString(ENDPOINT, next.endpoint).putString(ENVIRONMENT, next.environmentId)
            .putString("texts", next.texts.toString()).putBoolean(ALERTS, next.alerts).commit())
            throw new IllegalStateException("Unable to save remote connection preferences");
        config = next;
        if (!sameConnection) { failures = 0; connected = !restoring; }
        if (request != null) request.disconnect();
        remoteChannel(next);
        ServiceCompat.startForeground(this, REMOTE_ID, notification(next, connected),
            Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING : 0);
    }
    private void remoteChannel(Config current) {
        MobileActivityTracker.clearMonitoringNotification(this);
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(REMOTE_CHANNEL,
            current.texts.optString("remoteChannel", "Remote connection"), NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null); channel.enableVibration(false); channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    private Notification notification(Config current, boolean available) {
        return new NotificationCompat.Builder(this, REMOTE_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_monocode).setContentTitle(current.texts.optString("remote", "Remote"))
            .setContentText(current.texts.optString(available ? "connected" : "reconnecting",
                (available ? "Connected to " : "Reconnecting to ") + current.name))
            .setContentIntent(MobileActivityTracker.openIntent(this, current.environmentId, null, null))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setCategory(NotificationCompat.CATEGORY_SERVICE).setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true).setShowWhen(false).build();
    }
    private void setConnected(Config current, boolean available) {
        main.post(() -> {
            if (config != current || connected == available) return;
            connected = available;
            try { NotificationManagerCompat.from(this).notify(REMOTE_ID, notification(current, available)); }
            catch (SecurityException ignored) { stopReceiving(); }
        });
    }
    private void stopReceiving() {
        deactivate(this);
        config = null;
        if (request != null) request.disconnect();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }
    private void stopIfCurrent(Config current) {
        main.post(() -> { if (config == current) stopReceiving(); });
    }
    private void poll() {
        Config current = config;
        try {
            if (current == null || executor.isShutdown()) return;
            if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) { stopIfCurrent(current); return; }
            // The visible WebView already observes activity. Keep the scheduler
            // alive so background delivery resumes without a second connection.
            if (MobileActivityTracker.foreground) { failures = 0; return; }
            JSONObject activity = rpc(current);
            if (config != current) return;
            if (!current.environmentId.equals(activity.getString("environmentId"))) { stopIfCurrent(current); return; }
            setConnected(current, true);
            if (!MobileActivityTracker.foreground) {
                MobileActivityTracker.observeAssistant(this, current.environmentId, activity.optJSONObject("assistant"), current.alerts, current.texts);
                JSONObject result = MobileActivityTracker.observe(this, current.environmentId, activity.getJSONArray("sessions"), current.alerts, current.texts);
                MonoCodeNotificationsPlugin.publishUnread(result);
            }
            failures = 0;
        } catch (ConnectionRejectedException error) { stopIfCurrent(current); }
        catch (Exception ignored) {
            if (config == current && current != null) {
                failures = Math.min(failures + 1, 4);
                setConnected(current, false);
            }
        } finally {
            if (!executor.isShutdown()) executor.schedule(this::poll, failures == 0 ? 5 : Math.min(60, 5L << failures), TimeUnit.SECONDS);
        }
    }
    private static final class ConnectionRejectedException extends Exception {}
    private JSONObject rpc(Config current) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URI(current.endpoint.replaceAll("/$", "") + "/rpc").toURL().openConnection();
        request = connection;
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST"); connection.setConnectTimeout(10_000); connection.setReadTimeout(20_000); connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("Authorization", "Bearer " + current.token);
            byte[] body = new JSONObject().put("version", 1).put("environmentId", current.environmentId)
                .put("method", "sessions.activity").put("params", new JSONObject()).toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
            int status = connection.getResponseCode();
            if (status == 400 || status == 401 || status == 403) throw new ConnectionRejectedException();
            if (status != 200) throw new IllegalStateException("Notification activity unavailable");
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            try (java.io.InputStream input = connection.getInputStream()) {
                byte[] bytes = new byte[8192]; int length;
                while ((length = input.read(bytes)) != -1) {
                    if (buffer.size() + length > 8 * 1024 * 1024) throw new IllegalStateException("Activity response too large");
                    buffer.write(bytes, 0, length);
                }
            }
            return new JSONObject(buffer.toString(StandardCharsets.UTF_8.name())).getJSONObject("result");
        } finally { connection.disconnect(); if (request == connection) request = null; }
    }
    @Override public void onDestroy() {
        config = null;
        if (request != null) request.disconnect();
        if (executor != null) executor.shutdownNow();
        main.removeCallbacksAndMessages(null);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return new ReceiverBinder(); }
}
