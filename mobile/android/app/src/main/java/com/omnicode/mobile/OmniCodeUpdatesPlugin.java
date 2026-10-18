package com.omnicode.mobile;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "OmniCodeUpdates")
public class OmniCodeUpdatesPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    @PluginMethod
    public void installPermission(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
        if (!allowed && Boolean.TRUE.equals(call.getBoolean("request", false))) {
            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())));
        }
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        String checksum = call.getString("sha256", "");
        Integer size = call.getInt("size");
        Integer code = call.getInt("versionCode");
        try {
            URI requested = URI.create(url);
            boolean trusted = Arrays.stream(BuildConfig.OMNICODE_UPDATE_BASE_URLS).anyMatch(source ->
                UpdateDownloadSource.matches(source, BuildConfig.OMNICODE_UPDATE_DOWNLOAD_PREFIX, code, requested));
            if (!trusted || code == null || code < 1 ||
                size == null || size <= 0 || size > 512L * 1024 * 1024 || !checksum.matches("[a-f0-9]{64}"))
                throw new IllegalArgumentException("Invalid update package.");
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls())
                throw new IllegalStateException("Allow OmniCode to install apps, then try again.");
        } catch (Exception error) { call.reject(error.getMessage()); return; }
        if (!downloading.compareAndSet(false, true)) { call.reject("An update is already downloading."); return; }
        worker.execute(() -> download(call, url, checksum, size, code));
    }

    private void download(PluginCall call, String url, String checksum, long expectedSize, int code) {
        HttpURLConnection connection = null;
        File temporary = null;
        try {
            File directory = new File(getContext().getCacheDir(), "updates");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot create update cache.");
            temporary = new File(directory, "download.partial");
            URI target = URI.create(url);
            for (int redirects = 0; ; redirects++) {
                connection = (HttpURLConnection) target.toURL().openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                int status = connection.getResponseCode();
                if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) break;
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (redirects >= 5 || location == null) throw new Exception("Unable to download update.");
                target = UpdateDownloadRedirect.resolve(URI.create(url), target, location);
            }
            if (connection.getResponseCode() != 200) throw new Exception("Unable to download update.");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long received = 0;
            long lastProgress = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[65536];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    received += length;
                    if (received > expectedSize) throw new Exception("Update size does not match.");
                    output.write(buffer, 0, length);
                    digest.update(buffer, 0, length);
                    long now = System.currentTimeMillis();
                    if (now - lastProgress > 150 || received == expectedSize) {
                        JSObject progress = new JSObject();
                        progress.put("received", received);
                        progress.put("total", expectedSize);
                        notifyListeners("downloadProgress", progress);
                        lastProgress = now;
                    }
                }
            }
            StringBuilder actual = new StringBuilder();
            for (byte value : digest.digest()) actual.append(String.format("%02x", value & 0xff));
            if (received != expectedSize || !checksum.equals(actual.toString()))
                throw new Exception("Update checksum does not match. Please download again.");
            verifyPackage(temporary, code);
            File apk = new File(directory, "OmniCode.apk");
            if (apk.exists() && !apk.delete()) throw new Exception("Cannot replace cached update.");
            if (!temporary.renameTo(apk)) throw new Exception("Cannot save update.");
            Uri content = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent installer = new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(content, "application/vnd.android.package-archive");
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                try { getActivity().startActivity(installer); call.resolve(); }
                catch (Exception error) { call.reject("Unable to open Android installer.", error); }
            });
        } catch (Exception error) { call.reject(error.getMessage(), error); }
        finally {
            if (connection != null) connection.disconnect();
            if (temporary != null && temporary.exists()) temporary.delete();
            downloading.set(false);
        }
    }

    @SuppressWarnings("deprecation")
    private void verifyPackage(File file, int expectedCode) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(file.getPath(), flags);
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), flags);
        long archiveCode = archive == null ? -1 : Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        long installedCode = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        if (archive == null || !installed.packageName.equals(archive.packageName) || archiveCode != expectedCode || archiveCode <= installedCode)
            throw new Exception("Update package or version does not match this app.");
        Signature[] candidate = Build.VERSION.SDK_INT >= 28 ? archive.signingInfo.getApkContentsSigners() : archive.signatures;
        Signature[] current = Build.VERSION.SDK_INT >= 28 ? installed.signingInfo.getApkContentsSigners() : installed.signatures;
        if (!Arrays.equals(candidate, current)) throw new Exception("Update signing certificate does not match this app.");
    }
}
