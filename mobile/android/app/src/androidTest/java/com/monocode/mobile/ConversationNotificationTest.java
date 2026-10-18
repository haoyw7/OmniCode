package com.monocode.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public final class ConversationNotificationTest {
    private static final class ResultCall extends PluginCall {
        final CountDownLatch completed = new CountDownLatch(1);
        volatile String failure;
        ResultCall(String method, JSObject data) { super(null, "MonoCodeNotifications", "test", method, data); }
        @Override public void resolve() { completed.countDown(); }
        @Override public void reject(String message, String code, Exception error, JSObject data) {
            failure = message; completed.countDown();
        }
        void awaitSuccess() throws Exception {
            assertTrue("Native call should finish", completed.await(10, TimeUnit.SECONDS));
            assertNull(failure);
        }
    }
    private static MonoCodeNotificationsPlugin plugin(MainActivity activity) {
        return (MonoCodeNotificationsPlugin) activity.getBridge().getPlugin("MonoCodeNotifications").getInstance();
    }
    private static StatusBarNotification awaitRemoteCard(NotificationManager manager) throws Exception {
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            for (StatusBarNotification notice : manager.getActiveNotifications())
                if (notice.getId() == MonoCodeNotificationService.REMOTE_ID) return notice;
            Thread.sleep(100);
        }
        fail("Remote card should be posted immediately");
        return null;
    }
    @Test public void disablingDuringBindingCancelsStartupAndAllowsRestart() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        if (Build.VERSION.SDK_INT >= 33)
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.cancelAll();
        JSObject options = new JSObject().put("endpoint", "http://127.0.0.1:1").put("token", "test-token")
            .put("environmentId", "test-host").put("texts", new JSObject());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCall cancelled = new ResultCall("start", options);
            ResultCall stop = new ResultCall("stop", new JSObject());
            scenario.onActivity(activity -> {
                plugin(activity).start(cancelled);
                plugin(activity).stop(stop);
            });
            stop.awaitSuccess();
            assertTrue(cancelled.completed.await(10, TimeUnit.SECONDS));
            assertEquals("Activity receiver stopped before connecting", cancelled.failure);
            ResultCall restart = new ResultCall("start", options);
            scenario.onActivity(activity -> plugin(activity).start(restart));
            restart.awaitSuccess();
            awaitRemoteCard(manager);
            assertEquals("Remote connection should have one ongoing card", 1, manager.getActiveNotifications().length);
            assertEquals(MonoCodeNotificationService.REMOTE_ID, manager.getActiveNotifications()[0].getId());
            ResultCall finalStop = new ResultCall("stop", new JSObject());
            scenario.onActivity(activity -> plugin(activity).stop(finalStop));
            finalStop.awaitSuccess();
        }
    }
    @Test public void receivesOneSystemNotificationWithUnreadStateAfterWebViewBackgrounds() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        if (Build.VERSION.SDK_INT >= 33)
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.cancelAll();
        if (Build.VERSION.SDK_INT >= 26)
            manager.createNotificationChannel(new NotificationChannel("monocode-monitoring", "Legacy receiver", NotificationManager.IMPORTANCE_LOW));
        manager.notify(9041, new NotificationCompat.Builder(context, "monocode-monitoring")
            .setSmallIcon(R.drawable.ic_stat_monocode).setContentTitle("Receiving conversation updates").setOngoing(true).build());
        MobileActivityTracker.preferences(context).edit().clear().commit();
        JSONObject old = new JSONObject().put("id", "one").put("projectId", "project").put("title", "codex · Test conversation").put("harness", "codex")
            .put("revision", 10).put("lastReplyRevision", 8).put("lastCompletedRunId", "old");
        MobileActivityTracker.observe(context, "test-host", new JSONArray().put(old), false, new JSONObject());
        AtomicInteger polls = new AtomicInteger();
        JSONObject[] received = { null };
        String[] authorization = { null };
        try (ServerSocket server = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
             ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            Thread fixture = new Thread(() -> {
                while (!server.isClosed()) try (Socket socket = server.accept()) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                    int length = 0;
                    String line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) {
                        if (line.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                        if (line.toLowerCase().startsWith("authorization:")) authorization[0] = line.substring(line.indexOf(':') + 1).trim();
                        assertFalse("Device HTTP must not send a browser Origin", line.toLowerCase().startsWith("origin:"));
                    }
                    char[] body = new char[length];
                    int offset = 0;
                    while (offset < length) { int read = reader.read(body, offset, length - offset); if (read < 0) break; offset += read; }
                    received[0] = new JSONObject(new String(body));
                    JSONObject reply = new JSONObject(old.toString()).put("revision", 12).put("lastReplyRevision", 12).put("lastCompletedRunId", "new")
                        .put("notificationPreview", new JSONObject().put("reply", "**Login now works.** `Tests pass.`").put("input", JSONObject.NULL));
                    byte[] response = new JSONObject().put("result", new JSONObject().put("environmentId", "test-host").put("sessions", new JSONArray().put(reply))).toString().getBytes(StandardCharsets.UTF_8);
                    socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + response.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    socket.getOutputStream().write(response);
                    socket.getOutputStream().flush();
                    polls.incrementAndGet();
                } catch (Exception ignored) { /* Server close ends the fixture. */ }
            });
            fixture.setDaemon(true); fixture.start();
            // This test isolates native reception; React routing/read cursors
            // are exercised by the separate UI and bridge tests.
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().stopLoading();
                activity.getBridge().getWebView().loadUrl("about:blank");
            });
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            Thread.sleep(1_000);
            ResultCall start = new ResultCall("start", new JSObject()
                .put("endpoint", "http://127.0.0.1:" + server.getLocalPort()).put("token", "test-device-token")
                .put("environmentId", "test-host").put("texts", new JSObject().put("reply", "A new reply is ready.")));
            scenario.onActivity(activity -> plugin(activity).start(start));
            start.awaitSuccess();
            awaitRemoteCard(manager);
            assertEquals("Receiver startup posts one Remote card", 1, manager.getActiveNotifications().length);
            assertEquals(MonoCodeNotificationService.REMOTE_ID, manager.getActiveNotifications()[0].getId());
            if (Build.VERSION.SDK_INT >= 26) assertNull(manager.getNotificationChannel("monocode-monitoring"));
            scenario.moveToState(Lifecycle.State.CREATED);
            StatusBarNotification delivered = null;
            long deadline = System.currentTimeMillis() + 20_000;
            while (delivered == null && System.currentTimeMillis() < deadline) {
                for (StatusBarNotification notification : manager.getActiveNotifications())
                    if ("test-host:one".equals(notification.getTag())) delivered = notification;
                if (delivered == null) Thread.sleep(200);
            }
            assertNotNull("Background conversation reply should reach the system notification manager; received polls=" + polls.get(), delivered);
            assertEquals("Test conversation", delivered.getNotification().extras.getString(Notification.EXTRA_TITLE));
            assertNotNull("Conversation alert should display its agent icon", delivered.getNotification().getLargeIcon());
            assertEquals("Login now works. Tests pass.", delivered.getNotification().extras.getString(Notification.EXTRA_TEXT));
            assertEquals("Login now works. Tests pass.", delivered.getNotification().extras.getString(Notification.EXTRA_BIG_TEXT));
            assertEquals("Remote card and conversation alert should be posted", 2, manager.getActiveNotifications().length);
            assertEquals(0, delivered.getNotification().flags & Notification.FLAG_ONGOING_EVENT);
            assertNotEquals(0, delivered.getNotification().flags & Notification.FLAG_AUTO_CANCEL);
            assertEquals(Notification.PRIORITY_HIGH, delivered.getNotification().priority);
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = manager.getNotificationChannel(delivered.getNotification().getChannelId());
                assertEquals("Conversation alerts should request heads-up delivery", NotificationManager.IMPORTANCE_HIGH, channel.getImportance());
                assertNotNull(channel.getSound());
            } else assertEquals(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE,
                delivered.getNotification().defaults & (Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE));
            assertEquals(1, received[0].getInt("version"));
            assertEquals("test-host", received[0].getString("environmentId"));
            assertEquals("sessions.activity", received[0].getString("method"));
            assertEquals("Bearer test-device-token", authorization[0]);
            assertEquals("one", MobileActivityTracker.state(context, "test-host").getJSONArray("unreadIds").getString(0));
            long posted = delivered.getPostTime();
            int firstPolls = polls.get();
            deadline = System.currentTimeMillis() + 12_000;
            while (polls.get() == firstPolls && System.currentTimeMillis() < deadline) Thread.sleep(200);
            assertTrue("Background reception should continue", polls.get() > firstPolls);
            for (StatusBarNotification notification : manager.getActiveNotifications())
                if ("test-host:one".equals(notification.getTag())) assertEquals("Repeated polling must not alert twice", posted, notification.getPostTime());
            MobileActivityTracker.visible(context, "test-host", "one", 12L, true);
            assertEquals("A stale WebView foreground flag must not mark a background reply read", 1,
                MobileActivityTracker.state(context, "test-host").getJSONArray("unreadIds").length());
            scenario.moveToState(Lifecycle.State.RESUMED);
            MobileActivityTracker.visible(context, "test-host", "one", 12L, true);
            assertEquals(0, MobileActivityTracker.state(context, "test-host").getJSONArray("unreadIds").length());
            for (StatusBarNotification notification : manager.getActiveNotifications()) assertNotEquals("test-host:one", notification.getTag());
            ResultCall stop = new ResultCall("stop", new JSObject());
            scenario.onActivity(activity -> plugin(activity).stop(stop));
            stop.awaitSuccess();
            scenario.moveToState(Lifecycle.State.CREATED);
            Thread.sleep(1_000);
            int stoppedPolls = polls.get();
            Thread.sleep(6_000);
            assertEquals("Explicit stop must end background polling", stoppedPolls, polls.get());
            assertEquals(0, manager.getActiveNotifications().length);
        } finally {
            manager.cancelAll();
        }
    }
}
