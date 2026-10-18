package com.monocode.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Arrays;
import java.util.Collections;

public class SessionActivityStateTest {
    @Test public void deliveredNoticesUseTheirConversationReplyOrInputAndDoNotReplayOnPreviewChanges() {
        SessionActivityState state = new SessionActivityState();
        state.observe(Arrays.asList(activity(10, 8, "old", null)), null);
        SessionActivityState.Activity reply = activity(12, 12, "new", null);
        reply.replyPreview = "**Login now works.**";
        SessionActivityState.Notice notice = state.observe(Arrays.asList(reply), null).get(0);
        assertEquals("Login now works.", notice.body("New reply"));
        reply.replyPreview = "Updated result";
        assertTrue(state.observe(Arrays.asList(reply), null).isEmpty());
        SessionActivityState.Activity input = activity(13, 13, "new", "question:1");
        input.replyPreview = "Previous reply";
        input.inputPreview = "### Which **environment** should I deploy to?";
        notice = state.observe(Arrays.asList(input), null).get(0);
        assertEquals("Which environment should I deploy to?", notice.body("Needs input"));
        input.inputPreview = "  ";
        assertEquals("Needs input", notice.body("Needs input"));
        input.inputPreview = null;
        assertEquals("Needs input", notice.body("Needs input"));
        input.inputPreview = "---";
        assertEquals("Needs input", notice.body("Needs input"));
    }

    @Test public void staleArchivedSnapshotDoesNotReplayDeliveredCompletion() {
        SessionActivityState state = new SessionActivityState();
        state.observe(Arrays.asList(activity(10, 8, "old", null)), null);
        assertEquals(1, state.observe(Arrays.asList(activity(20, 20, "new", null)), null).size());
        SessionActivityState.Activity archived = activity(11, 8, "old", null);
        archived.archived = true;
        assertTrue(state.observe(Arrays.asList(archived), null).isEmpty());
        assertTrue(state.observe(Arrays.asList(activity(21, 21, "new", null)), null).isEmpty());
        assertEquals(Arrays.asList("one"), state.unreadIds());
    }
    @Test public void renderedCompletionAndInputCursorsPreventLateReplayDuringAnotherStream() {
        SessionActivityState state = new SessionActivityState();
        state.observe(Arrays.asList(activity(10, 8, "old", null)), null);
        state.markRead("one", 20, "seen", "question:seen");
        assertTrue(state.observe(Arrays.asList(activity(19, 19, "stale", null)), null).isEmpty());
        assertTrue(state.observe(Arrays.asList(activity(21, 21, "seen", "question:seen")), null).isEmpty());
        assertEquals(Arrays.asList("one"), state.unreadIds());
        assertEquals(1, state.observe(Arrays.asList(activity(22, 22, "unseen", null)), null).size());
    }
    private SessionActivityState.Activity activity(long revision, long reply, String finished, String input) {
        SessionActivityState.Activity activity = new SessionActivityState.Activity();
        activity.id = "one"; activity.projectId = "project"; activity.title = "Conversation";
        activity.revision = revision; activity.reply = reply; activity.finished = finished; activity.input = input;
        return activity;
    }
    @Test public void baselineDoesNotNotifyOldHistoryOrMetadata() {
        SessionActivityState state = new SessionActivityState();
        assertTrue(state.observe(Arrays.asList(activity(10, 8, "old", null)), null).isEmpty());
        assertTrue(state.observe(Arrays.asList(activity(11, 8, "old", null)), null).isEmpty());
        assertTrue(state.unreadIds().isEmpty());
    }
    @Test public void streamedReplyNotifiesOnceOnDurableCompletion() {
        SessionActivityState state = new SessionActivityState();
        state.observe(Arrays.asList(activity(10, 8, "old", null)), null);
        assertTrue(state.observe(Arrays.asList(activity(11, 11, "old", null)), null).isEmpty());
        assertEquals(Arrays.asList("one"), state.unreadIds());
        assertEquals(1, state.observe(Arrays.asList(activity(12, 12, "new", null)), null).size());
        assertTrue(state.observe(Arrays.asList(activity(13, 12, "new", null)), null).isEmpty());
    }
    @Test public void viewedReplyIsQuietAndRequiresSuccessfulReadAcknowledgement() {
        SessionActivityState state = new SessionActivityState();
        state.observe(Arrays.asList(activity(10, 8, "old", null)), null);
        assertTrue(state.observe(Arrays.asList(activity(12, 12, "new", null)), "one").isEmpty());
        assertEquals(Arrays.asList("one"), state.unreadIds());
        state.markRead("one", 12);
        assertTrue(state.unreadIds().isEmpty());
        state.markRead("one", 9);
        assertEquals(12, state.entries.get("one").read);
    }
    @Test public void newQuestionsNotifyOnceWithoutReplayingOldCompletion() {
        SessionActivityState state = new SessionActivityState();
        state.observe(Arrays.asList(activity(10, 8, "old", null)), null);
        assertEquals(1, state.observe(Arrays.asList(activity(12, 12, "old", "question:1")), null).size());
        assertTrue(state.observe(Arrays.asList(activity(13, 12, "old", "question:1")), null).isEmpty());
        assertTrue(state.observe(Arrays.asList(activity(14, 12, "old", null)), null).isEmpty());
        assertEquals(1, state.observe(Arrays.asList(activity(15, 15, "old", "question:2")), null).size());
    }
    @Test public void stalePollsArchivesAndDeletedSessionsDoNotReplayNotifications() {
        SessionActivityState state = new SessionActivityState();
        state.observe(Arrays.asList(activity(10, 8, "old", null)), null);
        state.observe(Arrays.asList(activity(12, 12, "new", null)), null);
        assertTrue(state.observe(Arrays.asList(activity(11, 11, "stale", null)), null).isEmpty());
        SessionActivityState.Activity archived = activity(13, 13, "archived", null);
        archived.archived = true;
        assertTrue(state.observe(Arrays.asList(archived), null).isEmpty());
        assertTrue(state.unreadIds().isEmpty());
        archived.archived = false;
        assertTrue(state.observe(Arrays.asList(archived), null).isEmpty());
        state.observe(Collections.emptyList(), null);
        assertTrue(state.entries.isEmpty());
    }
    @Test public void newConversationAfterInitialSyncIsUnread() {
        SessionActivityState state = new SessionActivityState();
        state.observe(Collections.emptyList(), null);
        assertEquals(1, state.observe(Arrays.asList(activity(3, 3, "first", null)), null).size());
        assertEquals(Arrays.asList("one"), state.unreadIds());
    }
    @Test public void changesMatchAFullSnapshotAndRequireOneFirst() {
        SessionActivityState full = new SessionActivityState();
        SessionActivityState delta = new SessionActivityState();
        SessionActivityState.Activity two = activity(5, 5, "done", null);
        two.id = "two";
        try {
            delta.observeChanges(Arrays.asList(two), Collections.emptyList(), null);
            fail("Changes before a full snapshot would drop untracked conversations");
        } catch (IllegalStateException expected) { }
        full.observe(Arrays.asList(activity(10, 8, "old", null), two), null);
        delta.observe(Arrays.asList(activity(10, 8, "old", null), two), null);

        SessionActivityState.Activity reply = activity(12, 12, "new", null);
        assertEquals(1, full.observe(Arrays.asList(reply, two), null).size());
        assertEquals(1, delta.observeChanges(Arrays.asList(reply), Collections.emptyList(), null).size());
        assertEquals(full.unreadIds(), delta.unreadIds());

        full.observe(Arrays.asList(reply), null);
        delta.observeChanges(Collections.emptyList(), Arrays.asList("two"), null);
        assertEquals(full.entries.keySet(), delta.entries.keySet());
        assertEquals(Arrays.asList("one"), delta.unreadIds());
    }
}
