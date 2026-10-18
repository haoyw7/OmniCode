package com.omnicode.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import java.net.URI;
import org.junit.Test;

public class UpdateDownloadSourceTest {
    private final String source = "https://github.com/haoyw7/OmniCode/releases/latest/download";

    @Test public void acceptsFixedReleaseName() {
        assertTrue(UpdateDownloadSource.matches(source, "/", 3, URI.create(source + "/OmniCode.apk")));
    }

    @Test public void rejectsUnexpectedReleaseUrls() {
        for (String path : new String[] {
            "/omnicode-3.apk", "/omnicode.apk", "/OmniCode-3.apk", "/../OmniCode.apk",
            "/OmniCode.apk?version=3", "/OmniCode.apk#fragment"
        }) assertFalse(UpdateDownloadSource.matches(source, "/", 3, URI.create(source + path)));
        assertFalse(UpdateDownloadSource.matches(source, "/", 3, URI.create("https://other.example/OmniCode.apk")));
        assertFalse(UpdateDownloadSource.matches(source, "/", null, URI.create(source + "/OmniCode.apk")));
        assertFalse(UpdateDownloadSource.matches(source, "/", 0, URI.create(source + "/OmniCode.apk")));
    }

    @Test public void preservesVersionedLanDownloads() {
        String lan = "http://192.168.0.206:3780";
        assertTrue(UpdateDownloadSource.matches(lan, "/apk/", 3, URI.create(lan + "/apk/omnicode-3.apk")));
        assertFalse(UpdateDownloadSource.matches(lan, "/apk/", 3, URI.create(lan + "/apk/omnicode-4.apk")));
        assertFalse(UpdateDownloadSource.matches(lan, "/apk/", 3, URI.create(lan + "/apk/OmniCode.apk")));
    }
}
