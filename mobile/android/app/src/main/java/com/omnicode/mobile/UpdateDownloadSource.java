package com.omnicode.mobile;

import java.net.URI;

final class UpdateDownloadSource {
    static boolean matches(String source, String prefix, Integer code, URI requested) {
        if (code == null || code < 1) return false;
        String filename = "/".equals(prefix) ? "OmniCode.apk" : "omnicode-" + code + ".apk";
        return URI.create(source + prefix + filename).equals(requested);
    }
}
