package com.monocode.mobile;

import java.net.URI;

final class UpdateDownloadRedirect {
    private static final String RELEASE_PATH = "/yyy0107/ohmymonocode/releases/";

    static URI resolve(URI original, URI current, String location) {
        URI next = current.resolve(location);
        // LAN downloads stay direct. GitHub release assets redirect to its CDN.
        boolean githubSource = "https".equals(original.getScheme()) &&
            "github.com".equals(original.getHost()) && original.getPath().startsWith(RELEASE_PATH);
        boolean githubTarget = "github.com".equals(next.getHost()) && next.getPath().startsWith(RELEASE_PATH);
        boolean assetTarget = "release-assets.githubusercontent.com".equals(next.getHost());
        if (!githubSource || !"https".equals(next.getScheme()) ||
            next.getUserInfo() != null || (next.getPort() != -1 && next.getPort() != 443) ||
            (!githubTarget && !assetTarget))
            throw new IllegalArgumentException("Invalid update redirect.");
        return next;
    }
}
