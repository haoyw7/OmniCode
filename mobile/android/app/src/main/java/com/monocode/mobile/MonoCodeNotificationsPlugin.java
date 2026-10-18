package com.monocode.mobile;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;
import org.json.JSONObject;

@CapacitorPlugin(name = "MonoCodeNotifications", permissions = {
    @Permission(alias = "display", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public final class MonoCodeNotificationsPlugin extends Plugin {
    private static WeakReference<MonoCodeNotificationsPlugin> instance = new WeakReference<>(null);
    private JSObject pendingOpen;
    private ServiceConnection receiverConnection;
    private PluginCall pendingStart;
    @Override public void load() {
        instance = new WeakReference<>(this);
        MobileActivityTracker.clearMonitoringNotification(getContext());
        captureOpen(getActivity().getIntent());
    }
    private JSObject permission() {
        JSObject result = new JSObject();
        String display = "granted";
        if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            PermissionState state = getPermissionState("display");
            display = Build.VERSION.SDK_INT >= 33 && state == PermissionState.PROMPT ? "prompt" : "denied";
        }
        result.put("display", display);
        return result;
    }
    @Override @PluginMethod public void checkPermissions(PluginCall call) { call.resolve(permission()); }
    @Override @PluginMethod public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && !NotificationManagerCompat.from(getContext()).areNotificationsEnabled()
            && getPermissionState("display") != PermissionState.GRANTED)
            requestPermissionForAlias("display", call, "permissionResult");
        else call.resolve(permission());
    }
    @PermissionCallback private void permissionResult(PluginCall call) { call.resolve(permission()); }
    @PluginMethod public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        if (Build.VERSION.SDK_INT >= 26 && NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            try {
                JSONObject texts = new JSONObject(MobileActivityTracker.preferences(getContext()).getString("texts", "{}"));
                MobileActivityTracker.channels(getContext(), texts);
                intent.setAction(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, MobileActivityTracker.REPLIES);
            } catch (Exception ignored) { /* App notification settings remain available. */ }
        }
        getActivity().startActivity(intent); call.resolve();
    }
    @PluginMethod public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), MonoCodeNotificationService.class)
            .putExtra("endpoint", call.getString("endpoint")).putExtra("token", call.getString("token"))
            .putExtra("name", call.getString("name")).putExtra("enabled", call.getBoolean("enabled", true))
            .putExtra("environmentId", call.getString("environmentId")).putExtra("texts", call.getObject("texts", new JSObject()).toString());
        getActivity().runOnUiThread(() -> {
            unbindReceiver();
            if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) { call.reject("Notifications are disabled"); return; }
            pendingStart = call;
            ServiceConnection connection = new ServiceConnection() {
                @Override public void onServiceConnected(ComponentName name, IBinder binder) {
                    if (receiverConnection != this) return;
                    try {
                        // Promote while bound before requesting started lifetime.
                        // Cancelling a pending bind then needs no FGS startup,
                        // avoiding Android's startForeground deadline race.
                        ((MonoCodeNotificationService.ReceiverBinder) binder).start(intent);
                        ContextCompat.startForegroundService(getContext(), intent);
                        pendingStart = null;
                        // Binding only acknowledges promotion. The started
                        // service owns reception after the activity is closed.
                        unbindReceiver();
                        call.resolve();
                    } catch (Exception error) { failStart(error); }
                }
                @Override public void onServiceDisconnected(ComponentName name) {
                    if (receiverConnection == this) failStart(new IllegalStateException("Activity receiver disconnected"));
                }
                @Override public void onNullBinding(ComponentName name) {
                    if (receiverConnection == this) failStart(new IllegalStateException("Activity receiver unavailable"));
                }
                @Override public void onBindingDied(ComponentName name) {
                    if (receiverConnection == this) failStart(new IllegalStateException("Activity receiver binding ended"));
                }
            };
            try {
                receiverConnection = connection;
                if (!getContext().bindService(intent, connection, Context.BIND_AUTO_CREATE)) {
                    receiverConnection = null;
                    throw new IllegalStateException("Unable to bind activity receiver");
                }
            } catch (Exception error) { failStart(error); }
        });
    }
    private void failStart(Exception error) {
        PluginCall call = pendingStart;
        pendingStart = null;
        unbindReceiver();
        MonoCodeNotificationService.stop(getContext());
        if (call != null) call.reject("Unable to receive background conversation updates", error);
    }
    private void unbindReceiver() {
        if (receiverConnection != null) {
            getContext().unbindService(receiverConnection);
            receiverConnection = null;
        }
        if (pendingStart != null) {
            pendingStart.reject("Activity receiver stopped before connecting");
            pendingStart = null;
        }
    }
    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            unbindReceiver();
            MonoCodeNotificationService.stop(getContext());
            MobileActivityTracker.clearMonitoringNotification(getContext());
            call.resolve();
        });
    }
    @PluginMethod public void state(PluginCall call) {
        String environmentId = call.getString("environmentId");
        if (environmentId == null) { call.reject("Missing Host identity"); return; }
        call.resolve(MobileActivityTracker.state(getContext(), environmentId));
    }
    @PluginMethod public void setVisible(PluginCall call) {
        try {
            String environmentId = call.getString("environmentId");
            if (environmentId == null) { call.reject("Missing Host identity"); return; }
            Double revision = call.getDouble("revision");
            MobileActivityTracker.assistantVisible(getContext(), environmentId,
                call.getBoolean("foreground", true) && call.getBoolean("assistantVisible", false));
            call.resolve(MobileActivityTracker.visible(getContext(), environmentId, call.getString("sessionId"),
                revision == null ? null : revision.longValue(), call.getBoolean("foreground", true),
                call.getString("lastCompletedRunId"), call.getString("pendingInputKey")));
        } catch (Exception error) { call.reject("Unable to mark conversation read", error); }
    }
    @PluginMethod public void observe(PluginCall call) {
        try {
            String environmentId = call.getString("environmentId");
            if (environmentId == null || call.getArray("sessions") == null) { call.reject("Missing activity snapshot"); return; }
            JSONObject texts = new JSONObject(MobileActivityTracker.preferences(getContext()).getString("texts", "{}"));
            MobileActivityTracker.observeAssistant(getContext(), environmentId, call.getObject("assistant"), call.getBoolean("enabled", false), texts);
            call.resolve(MobileActivityTracker.observe(getContext(), environmentId, call.getArray("sessions"), call.getBoolean("enabled", false), texts));
        } catch (Exception error) { call.reject("Unable to track conversation activity", error); }
    }
    /** Changes since the last full observe; parsing the whole list each poll stalled the main thread. */
    @PluginMethod public void observeChanges(PluginCall call) {
        try {
            String environmentId = call.getString("environmentId");
            if (environmentId == null || call.getArray("sessions") == null || call.getArray("removed") == null) {
                call.reject("Missing activity changes"); return;
            }
            JSONObject texts = new JSONObject(MobileActivityTracker.preferences(getContext()).getString("texts", "{}"));
            MobileActivityTracker.observeAssistant(getContext(), environmentId, call.getObject("assistant"), call.getBoolean("enabled", false), texts);
            call.resolve(MobileActivityTracker.observeChanges(getContext(), environmentId, call.getArray("sessions"),
                call.getArray("removed"), call.getBoolean("enabled", false), texts));
        } catch (Exception error) { call.reject("Unable to track conversation activity", error); }
    }
    @PluginMethod public void consumeOpen(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingOpen != null) result.put("target", pendingOpen);
        pendingOpen = null; call.resolve(result);
    }
    static void publishUnread(JSONObject result) {
        MonoCodeNotificationsPlugin plugin = instance.get();
        if (plugin == null || plugin.getActivity() == null) return;
        plugin.getActivity().runOnUiThread(() -> {
            try { plugin.notifyListeners("unread", JSObject.fromJSONObject(result)); }
            catch (Exception ignored) { /* Foreground reconciliation loads persisted state. */ }
        });
    }
    private void captureOpen(Intent intent) {
        if (intent == null || (!intent.hasExtra("monocodeSession") && !intent.getBooleanExtra("monocodeAssistant", false))) return;
        JSObject target = new JSObject();
        target.put("environmentId", intent.getStringExtra("monocodeEnvironment"));
        if (intent.getBooleanExtra("monocodeAssistant", false)) target.put("kind", "assistant");
        else {
            target.put("projectId", intent.getStringExtra("monocodeProject"));
            target.put("sessionId", intent.getStringExtra("monocodeSession"));
        }
        intent.removeExtra("monocodeSession");
        intent.removeExtra("monocodeAssistant");
        if (hasListeners("open")) notifyListeners("open", target);
        else pendingOpen = target;
    }
    @Override protected void handleOnNewIntent(Intent intent) { captureOpen(intent); }
    @Override protected void handleOnPause() { MobileActivityTracker.foreground = false; }
    @Override protected void handleOnResume() { MobileActivityTracker.foreground = true; }
    @Override protected void handleOnDestroy() {
        unbindReceiver();
        if (instance.get() == this) {
            instance.clear();
            MobileActivityTracker.foreground = false;
        }
    }
}
