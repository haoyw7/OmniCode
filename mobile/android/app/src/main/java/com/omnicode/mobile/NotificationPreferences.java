package com.omnicode.mobile;

final class NotificationPreferences {
    final boolean replies, input, botReplies, botInput, preview;

    NotificationPreferences(boolean replies, boolean input, boolean botReplies, boolean botInput, boolean preview) {
        this.replies = replies;
        this.input = input;
        this.botReplies = botReplies;
        this.botInput = botInput;
        this.preview = preview;
    }

    boolean allows(boolean bot, boolean needsInput) {
        return bot ? (needsInput ? botInput : botReplies) : (needsInput ? input : replies);
    }

    String body(String text, String fallback) {
        String content = preview ? NotificationPresentation.plainText(text) : "";
        return content.isEmpty() ? fallback : content;
    }
}
