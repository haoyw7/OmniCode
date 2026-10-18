package com.monocode.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class RemoteConnectionServiceTest {
    private Context context;
    private NotificationManager manager;
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
    private static final class Host implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        final AtomicInteger polls = new AtomicInteger();
        volatile int status = 200;
        volatile String environment = "test-host";
        Host() throws Exception {
            Thread fixture = new Thread(() -> {
                while (!server.isClosed()) try (Socket socket = server.accept()) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                    int length = 0;
                    String line;
                    while ((line = reader.readLine()) != null && !line.isEmpty())
                        if (line.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                    char[] body = new char[length];
                    int offset = 0;
                    while (offset < length) { int read = reader.read(body, offset, length - offset); if (read < 0) break; offset += read; }
                    byte[] response = new JSONObject().put("result", new JSONObject().put("environmentId", environment)
                        .put("sessions", new JSONArray().put(row(20, "new")))).toString().getBytes(StandardCharsets.UTF_8);
                    int code = status;
                    socket.getOutputStream().write(("HTTP/1.1 " + code + " Fixture\r\nContent-Type: application/json\r\nContent-Length: "
                        + response.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    socket.getOutputStream().write(response); socket.getOutputStream().flush();
                    polls.incrementAndGet();
                } catch (Exception ignored) { /* Closing the fixture ends reception. */ }
            });
            fixture.setDaemon(true); fixture.start();
        }
        String endpoint() { return "http://127.0.0.1:" + server.getLocalPort(); }
        @Override public void close() throws Exception { server.close(); }
    }
    private static JSONObject row(long revision, String run) throws Exception {
        return new JSONObject().put("id", "one").put("projectId", "project").put("title", "Test conversation")
            .put("revision", revision).put("lastReplyRevision", revision).put("lastCompletedRunId", run);
    }
    @Before public void before() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        if (Build.VERSION.SDK_INT >= 33)
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        manager = context.getSystemService(NotificationManager.class);
        MonoCodeNotificationService.stop(context);
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        manager.cancelAll();
        MobileActivityTracker.preferences(context).edit().clear().commit();
        context.getSharedPreferences("monocode-credentials", Context.MODE_PRIVATE).edit().clear().commit();
        MobileActivityTracker.observe(context, "test-host", new JSONArray().put(row(10, "old")), false, new JSONObject());
    }
    @After public void after() {
        MonoCodeNotificationService.stop(context);
        manager.cancelAll();
        context.getSharedPreferences("monocode-credentials", Context.MODE_PRIVATE).edit().clear().commit();
    }
    private static MonoCodeNotificationsPlugin plugin(MainActivity activity) {
        return (MonoCodeNotificationsPlugin) activity.getBridge().getPlugin("MonoCodeNotifications").getInstance();
    }
    private JSObject options(Host host, boolean enabled) {
        return new JSObject().put("endpoint", host.endpoint()).put("token", "test-device-token").put("name", "wy-ubuntu")
            .put("environmentId", "test-host").put("enabled", enabled).put("texts", new JSObject()
                .put("remote", "Remote").put("remoteChannel", "远程连接").put("connected", "已连接到 wy-ubuntu")
                .put("reconnecting", "正在重新连接到 wy-ubuntu"));
    }
    private void start(ActivityScenario<MainActivity> scenario, JSObject options) throws Exception {
        scenario.onActivity(activity -> {
            activity.getBridge().getWebView().stopLoading();
            activity.getBridge().getWebView().loadUrl("about:blank");
        });
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        ResultCall call = new ResultCall("start", options);
        scenario.onActivity(activity -> plugin(activity).start(call));
        call.awaitSuccess();
    }
    private StatusBarNotification remote() {
        for (StatusBarNotification notice : manager.getActiveNotifications())
            if (notice.getId() == MonoCodeNotificationService.REMOTE_ID && notice.getTag() == null) return notice;
        return null;
    }
    private void awaitText(String text) throws Exception {
        long deadline = System.currentTimeMillis() + 25_000;
        while (System.currentTimeMillis() < deadline) {
            StatusBarNotification notice = remote();
            if (notice != null && text.equals(notice.getNotification().extras.getString(Notification.EXTRA_TEXT))) return;
            Thread.sleep(100);
        }
        fail("Remote card should show " + text);
    }
    @Test public void keepsSilentRemoteCardAndUnreadReceptionAfterActivityAndRecentTaskAreRemoved() throws Exception {
        try (Host host = new Host(); ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            start(scenario, options(host, false));
            awaitText("已连接到 wy-ubuntu");
            Notification card = remote().getNotification();
            assertEquals("Remote", card.extras.getString(Notification.EXTRA_TITLE));
            assertNotEquals(0, card.flags & Notification.FLAG_ONGOING_EVENT);
            assertNotEquals(0, card.flags & Notification.FLAG_FOREGROUND_SERVICE);
            assertEquals(0, card.flags & Notification.FLAG_AUTO_CANCEL);
            assertNotNull(card.contentIntent);
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = manager.getNotificationChannel(MonoCodeNotificationService.REMOTE_CHANNEL);
                assertEquals(NotificationManager.IMPORTANCE_LOW, channel.getImportance());
                assertNull(channel.getSound());
                assertFalse(channel.shouldVibrate());
            }
            scenario.onActivity(MainActivity::finishAndRemoveTask);
            long deadline = System.currentTimeMillis() + 10_000;
            while (scenario.getState() != Lifecycle.State.DESTROYED && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertEquals(Lifecycle.State.DESTROYED, scenario.getState());
            int firstPolls = host.polls.get();
            deadline = System.currentTimeMillis() + 15_000;
            while ((host.polls.get() <= firstPolls || MobileActivityTracker.state(context, "test-host").getJSONArray("unreadIds").length() == 0)
                && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertTrue("Activity destruction must leave native reception running", host.polls.get() > firstPolls);
            assertEquals("one", MobileActivityTracker.state(context, "test-host").getJSONArray("unreadIds").getString(0));
            assertEquals("Disabled reply alerts must leave only the Remote card", 1, manager.getActiveNotifications().length);
            awaitText("已连接到 wy-ubuntu");
        }
    }
    @Test public void reconnectsAfterTransientFailureAndStopsAfterCredentialRejection() throws Exception {
        try (Host host = new Host(); ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            host.status = 503;
            start(scenario, options(host, false));
            scenario.moveToState(Lifecycle.State.CREATED);
            awaitText("正在重新连接到 wy-ubuntu");
            host.status = 200;
            awaitText("已连接到 wy-ubuntu");
            host.status = 401;
            long deadline = System.currentTimeMillis() + 15_000;
            while (remote() != null && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertNull("Rejected credentials must stop the card and service", remote());
            assertNull(MonoCodeNotificationService.restoreIntent(context));
            int stopped = host.polls.get();
            Thread.sleep(6_000);
            assertEquals(stopped, host.polls.get());
        }
    }
    @Test public void stopsReceptionWhenTheEndpointBecomesAnotherHost() throws Exception {
        try (Host host = new Host(); ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            host.environment = "another-host";
            start(scenario, options(host, false));
            awaitText("已连接到 wy-ubuntu");
            long deadline = System.currentTimeMillis() + 15_000;
            while (remote() != null && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertTrue("The pinned Host must have been checked", host.polls.get() > 0);
            assertNull("Different Host identity must stop the receiver", remote());
            assertNull(MonoCodeNotificationService.restoreIntent(context));
            assertEquals("Identity mismatch must not observe another Host's activity", 0,
                MobileActivityTracker.state(context, "test-host").getJSONArray("unreadIds").length());
        }
    }
    @Test public void restoresOnlyTheExistingEncryptedPinnedConnectionAndDisconnectDeactivatesIt() throws Exception {
        try (Host host = new Host(); ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            JSObject options = options(host, false);
            ResultCall save = new ResultCall("set", new JSObject().put("key", "connection").put("value", options.toString()));
            scenario.onActivity(activity -> ((MonoCodeCredentialsPlugin) activity.getBridge().getPlugin("MonoCodeCredentials").getInstance()).set(save));
            save.awaitSuccess();
            start(scenario, options);
            Intent restored = MonoCodeNotificationService.restoreIntent(context);
            assertNotNull(restored);
            assertEquals("test-device-token", restored.getStringExtra("token"));
            assertEquals("wy-ubuntu", restored.getStringExtra("name"));
            assertFalse(restored.getBooleanExtra("enabled", true));
            assertFalse("Activity preferences must not contain a credential copy",
                MobileActivityTracker.preferences(context).getAll().toString().contains("test-device-token"));
            assertFalse("Connection must be encrypted at rest", context.getSharedPreferences("monocode-credentials", Context.MODE_PRIVATE)
                .getString("connection", "").contains("test-device-token"));
            MobileActivityTracker.preferences(context).edit().putString("remote-environment", "another-host").commit();
            assertNull("Another Host identity must not be restored", MonoCodeNotificationService.restoreIntent(context));
            MobileActivityTracker.preferences(context).edit().putString("remote-environment", "test-host").commit();
            ResultCall remove = new ResultCall("remove", new JSObject().put("key", "connection"));
            scenario.onActivity(activity -> ((MonoCodeCredentialsPlugin) activity.getBridge().getPlugin("MonoCodeCredentials").getInstance()).remove(remove));
            remove.awaitSuccess();
            assertNull(MonoCodeNotificationService.restoreIntent(context));
            assertNull(MonoCodeCredentialsPlugin.read(context, "connection"));
            long deadline = System.currentTimeMillis() + 5_000;
            while (remote() != null && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertNull(remote());
        }
    }
}
