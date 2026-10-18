package com.monocode.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class AssistantNotificationStateTest {
    @Test public void historyAndStreamingStayQuietUntilCompletion() {
        AssistantNotificationState state = new AssistantNotificationState();
        assertFalse(state.observe("assistant", 1, "old", 1));
        assertFalse(state.observe("assistant", 3, "old", 1));
        assertTrue(state.observe("assistant", 4, "reply", 4));
        assertFalse(state.observe("assistant", 4, "reply", 4));
        assertFalse(state.observe("assistant", 3, "old", 1));
        assertFalse(state.observe("assistant", 5, "reply", 5));
    }
    @Test public void inputResolutionAndReceiverRestartsDoNotReplay() {
        AssistantNotificationState state = new AssistantNotificationState();
        assertFalse(state.observe("assistant", 1, "reply", 1));
        assertTrue(state.observe("assistant", 2, "question", 2));
        AssistantNotificationState restored = new AssistantNotificationState();
        restored.id = state.id; restored.revision = state.revision; restored.messageId = state.messageId;
        assertFalse(restored.observe("assistant", 3, "reply", 1));
        assertTrue(restored.observe("assistant", 4, "approval", 4));
        assertFalse(restored.observe("another", 20, "history", 20));
    }
}
