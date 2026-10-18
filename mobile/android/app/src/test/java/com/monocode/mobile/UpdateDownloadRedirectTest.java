package com.monocode.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import java.net.URI;
import org.junit.Test;

public class UpdateDownloadRedirectTest {
    private final URI source = URI.create("https://github.com/yyy0107/ohmymonocode/releases/latest/download/monocode-5.apk");

    @Test public void followsReleaseTagAndAssetRedirects() {
        URI tag = UpdateDownloadRedirect.resolve(source, source, "../../download/v0.7.0/monocode-5.apk");
        assertEquals("https://github.com/yyy0107/ohmymonocode/releases/download/v0.7.0/monocode-5.apk", tag.toString());
        URI asset = URI.create("https://release-assets.githubusercontent.com/github-production-release-asset/123?token=opaque");
        assertEquals(asset, UpdateDownloadRedirect.resolve(source, tag, asset.toString()));
    }

    @Test public void rejectsUntrustedRedirectsAndDowngrades() {
        for (String target : new String[] {
            "http://release-assets.githubusercontent.com/file", "https://evil.example/file",
            "https://github.com/another/repo/releases/file", "https://user@github.com/yyy0107/ohmymonocode/releases/file",
            "https://release-assets.githubusercontent.com:444/file", "file:///tmp/file.apk"
        }) assertThrows(IllegalArgumentException.class, () -> UpdateDownloadRedirect.resolve(source, source, target));
        URI lan = URI.create("http://192.168.0.206:3780/apk/monocode-5.apk");
        assertThrows(IllegalArgumentException.class, () -> UpdateDownloadRedirect.resolve(lan, lan, source.toString()));
    }
}
