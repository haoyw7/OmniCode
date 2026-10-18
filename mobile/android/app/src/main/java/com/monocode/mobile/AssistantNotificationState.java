package com.monocode.mobile;

import java.util.Objects;

/** Delivery cursor independent of chat read receipts and Android lifecycle. */
final class AssistantNotificationState {
    String id, messageId;
    long revision;

    boolean observe(String nextId, long nextRevision, String nextMessageId, long messageRevision) {
        if (Objects.equals(id, nextId) && revision >= nextRevision) return false;
        boolean notify = Objects.equals(id, nextId) && nextMessageId != null
            && messageRevision > revision && !Objects.equals(messageId, nextMessageId);
        id = nextId;
        revision = nextRevision;
        if (nextMessageId != null) messageId = nextMessageId;
        return notify;
    }
}
