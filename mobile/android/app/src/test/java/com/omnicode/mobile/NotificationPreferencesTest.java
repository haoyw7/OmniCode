package com.omnicode.mobile;

import java.util.Collections;
import org.junit.Test;
import static org.junit.Assert.*;

public class NotificationPreferencesTest {
    @Test public void eachCategoryCanBeMutedWithoutMutingTheOtherEvents() {
        for (int muted = 0; muted < 4; muted++) {
            NotificationPreferences preferences = new NotificationPreferences(muted != 0, muted != 1, muted != 2, muted != 3, true);
            for (int event = 0; event < 4; event++)
                assertEquals(event != muted, preferences.allows(event >= 2, event % 2 == 1));
        }
    }

    @Test public void hiddenPreviewUsesOnlyTheFallbackAndVisiblePreviewRemovesMarkdown() {
        NotificationPreferences hidden = new NotificationPreferences(true, true, true, true, false);
        assertEquals("New reply", hidden.body("**Private** `token`", "New reply"));
        NotificationPreferences visible = new NotificationPreferences(true, true, true, true, true);
        assertEquals("Private token", visible.body("**Private** `token`", "New reply"));
        assertEquals("Needs input", visible.body(null, "Needs input"));
    }

    @Test public void mutedDeliveryStillAdvancesUnreadAndDoesNotReplayWhenEnabled() {
        SessionActivityState state = new SessionActivityState();
        SessionActivityState.Activity session = new SessionActivityState.Activity();
        session.id = "one"; session.projectId = "project"; session.revision = 1; session.reply = 1;
        state.observe(Collections.singletonList(session), null);
        session.revision = 2; session.reply = 2; session.finished = "run";
        SessionActivityState.Notice notice = state.observe(Collections.singletonList(session), null).get(0);
        NotificationPreferences muted = new NotificationPreferences(false, true, true, true, true);
        assertFalse(muted.allows(false, notice.input));
        assertEquals(Collections.singletonList("one"), state.unreadIds());
        assertTrue(state.observe(Collections.singletonList(session), null).isEmpty());
    }
}
