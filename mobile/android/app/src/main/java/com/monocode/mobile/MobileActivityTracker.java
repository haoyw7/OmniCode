package com.monocode.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

final class MobileActivityTracker {
    static final String REPLIES = "monocode-replies";
    private static final String LEGACY_MONITORING = "monocode-monitoring";
    private static final int LEGACY_MONITORING_ID = 9041;
    // A sticky service may create the process without an activity/WebView.
    static volatile boolean foreground = false;
    static String visibleEnvironment, visibleSession;
    static String visibleAssistantEnvironment;

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("monocode-session-activity", Context.MODE_PRIVATE);
    }
    private static SessionActivityState read(Context context, String environmentId) {
        SessionActivityState state = new SessionActivityState();
        try {
            JSONObject stored = new JSONObject(preferences(context).getString("state:" + environmentId, "{}"));
            state.initialized = stored.optBoolean("initialized");
            JSONObject entries = stored.optJSONObject("entries");
            if (entries != null) for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) {
                String id = it.next();
                JSONObject row = entries.getJSONObject(id);
                SessionActivityState.Entry entry = new SessionActivityState.Entry();
                entry.revision = row.getLong("revision"); entry.read = row.getLong("read"); entry.reply = row.getLong("reply");
                entry.finished = nullable(row, "finished"); entry.input = nullable(row, "input");
                state.entries.put(id, entry);
            }
        } catch (JSONException ignored) { return new SessionActivityState(); }
        return state;
    }
    private static void write(Context context, String environmentId, SessionActivityState state) throws JSONException {
        JSONObject entries = new JSONObject();
        for (java.util.Map.Entry<String, SessionActivityState.Entry> row : state.entries.entrySet()) {
            SessionActivityState.Entry entry = row.getValue();
            entries.put(row.getKey(), new JSONObject().put("revision", entry.revision).put("read", entry.read)
                .put("reply", entry.reply).put("finished", entry.finished == null ? JSONObject.NULL : entry.finished)
                .put("input", entry.input == null ? JSONObject.NULL : entry.input));
        }
        if (!preferences(context).edit().putString("state:" + environmentId,
            new JSONObject().put("initialized", state.initialized).put("entries", entries).toString()).commit())
            throw new IllegalStateException("Unable to persist unread conversation state");
    }
    static String nullable(JSONObject value, String key) {
        return value.isNull(key) || !value.has(key) ? null : value.optString(key, null);
    }
    static synchronized JSObject state(Context context, String environmentId) {
        return result(environmentId, read(context, environmentId));
    }
    private static JSObject result(String environmentId, SessionActivityState state) {
        JSObject result = new JSObject();
        result.put("environmentId", environmentId);
        result.put("unreadIds", new JSArray(state.unreadIds()));
        return result;
    }
    static synchronized JSObject visible(Context context, String environmentId, String sessionId, Long revision, boolean active) throws JSONException {
        return visible(context, environmentId, sessionId, revision, active, null, null);
    }
    static synchronized JSObject visible(Context context, String environmentId, String sessionId, Long revision, boolean active, String finished, String input) throws JSONException {
        // Android lifecycle owns foreground status. A queued WebView call may
        // arrive after onPause and must not acknowledge an unseen background reply.
        active = active && foreground;
        visibleEnvironment = environmentId;
        visibleSession = active ? sessionId : null;
        SessionActivityState state = read(context, environmentId);
        if (active && sessionId != null && revision != null) {
            state.markRead(sessionId, revision, finished, input);
            cancel(context, environmentId, sessionId);
            write(context, environmentId, state);
        }
        return result(environmentId, state);
    }
    static synchronized JSObject observe(Context context, String environmentId, JSONArray sessions, boolean enabled, JSONObject texts) throws JSONException {
        SessionActivityState state = read(context, environmentId);
        List<SessionActivityState.Notice> notices = state.observe(activities(sessions), visibleSessionIn(environmentId));
        return settle(context, environmentId, state, notices, enabled, texts);
    }
    /** Rows that changed since the last full snapshot, and ids that are gone. */
    static synchronized JSObject observeChanges(Context context, String environmentId, JSONArray changed, JSONArray removed, boolean enabled, JSONObject texts) throws JSONException {
        SessionActivityState state = read(context, environmentId);
        List<String> gone = new ArrayList<>();
        for (int index = 0; index < removed.length(); index++) gone.add(removed.getString(index));
        List<SessionActivityState.Notice> notices = state.observeChanges(activities(changed), gone, visibleSessionIn(environmentId));
        return settle(context, environmentId, state, notices, enabled, texts);
    }
    private static String visibleSessionIn(String environmentId) {
        return foreground && environmentId.equals(visibleEnvironment) ? visibleSession : null;
    }
    private static List<SessionActivityState.Activity> activities(JSONArray sessions) throws JSONException {
        List<SessionActivityState.Activity> activities = new ArrayList<>();
        for (int index = 0; index < sessions.length(); index++) {
            JSONObject row = sessions.getJSONObject(index);
            SessionActivityState.Activity activity = new SessionActivityState.Activity();
            activity.id = row.getString("id"); activity.projectId = row.getString("projectId"); activity.title = row.optString("title");
            activity.harness = nullable(row, "harness");
            activity.revision = row.getLong("revision"); activity.reply = row.optLong("lastReplyRevision", 0);
            activity.finished = nullable(row, "lastCompletedRunId"); activity.input = nullable(row, "pendingInputKey");
            JSONObject preview = row.optJSONObject("notificationPreview");
            if (preview != null) {
                activity.replyPreview = nullable(preview, "reply");
                activity.inputPreview = nullable(preview, "input");
            }
            activity.archived = row.optBoolean("archived");
            activities.add(activity);
        }
        return activities;
    }
    private static JSObject settle(Context context, String environmentId, SessionActivityState state,
                                   List<SessionActivityState.Notice> notices, boolean enabled, JSONObject texts) throws JSONException {
        write(context, environmentId, state);
        if (enabled && NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            channels(context, texts);
            for (SessionActivityState.Notice notice : notices) show(context, environmentId, notice, texts);
        }
        return result(environmentId, state);
    }
    static synchronized void assistantVisible(Context context, String environmentId, boolean visible) {
        visibleAssistantEnvironment = visible && foreground ? environmentId : null;
        if (visible && foreground) cancel(context, environmentId, "assistant");
    }
    static synchronized void observeAssistant(Context context, String environmentId, JSONObject activity, boolean enabled, JSONObject texts) throws JSONException {
        // Older Hosts omit the optional assistant snapshot.
        if (activity == null) return;
        String key = "assistant:" + environmentId;
        JSONObject stored = new JSONObject(preferences(context).getString(key, "{}"));
        AssistantNotificationState state = new AssistantNotificationState();
        state.id = nullable(stored, "id"); state.messageId = nullable(stored, "messageId");
        state.revision = stored.optLong("revision", 0);
        JSONObject latest = activity.optJSONObject("latest");
        boolean notify = state.observe(activity.getString("id"), activity.getLong("revision"),
            latest == null ? null : latest.getString("id"), latest == null ? 0 : latest.getLong("revision"));
        if (!preferences(context).edit().putString(key, new JSONObject().put("id", state.id)
            .put("revision", state.revision).put("messageId", state.messageId).toString()).commit())
            throw new IllegalStateException("Unable to persist assistant notification state");
        if (!notify || latest == null || !enabled || (foreground && environmentId.equals(visibleAssistantEnvironment))
            || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        channels(context, texts);
        String kind = latest.optString("kind", "reply");
        String body = NotificationPresentation.plainText(latest.optString("text"));
        if (body.isEmpty()) body = texts.optString(kind, "input".equals(kind)
            ? "This conversation needs your input." : "A new reply is ready.");
        String title = activity.optString("name");
        if (title.isEmpty()) title = texts.optString("assistant", "Assistant");
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData(new Uri.Builder().scheme("monocode-notification").authority("assistant").appendPath(environmentId).build())
            .putExtra("monocodeEnvironment", environmentId).putExtra("monocodeAssistant", true);
        PendingIntent open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        showNotice(context, environmentId + ":assistant", title, body, open, null);
    }
    static void channels(Context context, JSONObject texts) {
        clearMonitoringNotification(context);
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel replies = new NotificationChannel(REPLIES, texts.optString("channel", "Conversation notifications"), NotificationManager.IMPORTANCE_HIGH);
        replies.enableVibration(true);
        replies.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        // Existing channels retain the user's choices; Android owns their
        // importance, sound, vibration and popup settings after creation.
        manager.createNotificationChannel(replies);
    }
    static void clearMonitoringNotification(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.cancel(LEGACY_MONITORING_ID);
        if (Build.VERSION.SDK_INT >= 26) manager.deleteNotificationChannel(LEGACY_MONITORING);
    }
    static PendingIntent openIntent(Context context, String environmentId, String projectId, String sessionId) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.setData(new Uri.Builder().scheme("monocode-notification").authority("session").appendPath(environmentId).appendPath(sessionId == null ? "" : sessionId).build());
        if (sessionId != null) intent.putExtra("monocodeEnvironment", environmentId).putExtra("monocodeProject", projectId).putExtra("monocodeSession", sessionId);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void show(Context context, String environmentId, SessionActivityState.Notice notice, JSONObject texts) {
        String body = notice.body(texts.optString(notice.input ? "input" : "reply", notice.input ? "This conversation needs your input." : "A new reply is ready."));
        showNotice(context, environmentId + ":" + notice.activity.id,
            NotificationPresentation.displayTitle(notice.activity.title, notice.activity.harness, texts.optString("newSession", "New session")), body,
            openIntent(context, environmentId, notice.activity.projectId, notice.activity.id), notice.activity.harness);
    }
    private static void showNotice(Context context, String tag, String title, String body, PendingIntent open, String harness) {
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, REPLIES)
            .setSmallIcon(R.drawable.ic_stat_monocode).setContentTitle(title)
            .setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE)
            .setAutoCancel(true).setContentIntent(open);
        int icon = harnessIcon(harness);
        if (icon != 0) notification.setLargeIcon(BitmapFactory.decodeResource(context.getResources(), icon));
        try { NotificationManagerCompat.from(context).notify(tag, 1, notification.build()); }
        catch (SecurityException ignored) { /* Permission can be revoked after the check. */ }
    }
    // Raster exports of src/assets/providers/*.svg, with a light backing for monochrome marks.
    private static int harnessIcon(String harness) {
        switch (harness == null ? "" : harness) {
            case "claude": return R.drawable.ic_harness_claude;
            case "codex": return R.drawable.ic_harness_codex;
            case "cursor": return R.drawable.ic_harness_cursor;
            case "grok": return R.drawable.ic_harness_grok;
            case "opencode": return R.drawable.ic_harness_opencode;
            case "pi": return R.drawable.ic_harness_pi;
            case "omp": return R.drawable.ic_harness_omp;
            case "fx": return R.drawable.ic_harness_fx;
            case "hermes": return R.drawable.ic_harness_hermes;
            case "antigravity": return R.drawable.ic_harness_antigravity;
            default: return 0;
        }
    }
    static void cancel(Context context, String environmentId, String sessionId) {
        NotificationManagerCompat.from(context).cancel(environmentId + ":" + sessionId, 1);
    }
}
