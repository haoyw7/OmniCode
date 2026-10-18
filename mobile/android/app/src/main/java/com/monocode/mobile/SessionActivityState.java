package com.monocode.mobile;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Device-local read cursors and delivery cursors; independent of Android APIs. */
public final class SessionActivityState {
    public boolean initialized;
    public final Map<String, Entry> entries = new HashMap<>();
    public static final class Entry {
        public long revision, read, reply;
        public String finished, input;
    }
    public static final class Activity {
        public String id, projectId, title, harness, finished, input, replyPreview, inputPreview;
        public long revision, reply;
        public boolean archived;
    }
    public static final class Notice {
        public final Activity activity;
        public final boolean input;
        Notice(Activity activity, boolean input) { this.activity = activity; this.input = input; }
        public String body(String fallback) {
            String preview = NotificationPresentation.plainText(input ? activity.inputPreview : activity.replyPreview);
            return preview.isEmpty() ? fallback : preview;
        }
    }
    public List<Notice> observe(List<Activity> activities, String visibleId) {
        List<Notice> notices = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Activity activity : activities) {
            ids.add(activity.id);
            apply(activity, visibleId, notices);
        }
        entries.keySet().retainAll(ids);
        initialized = true;
        return notices;
    }
    /**
     * The changes since a full snapshot this state already holds: rows that
     * changed and ids that are gone. An unchanged row would apply as a no-op,
     * so leaving it out keeps the result the same as a full observe.
     */
    public List<Notice> observeChanges(List<Activity> changed, Collection<String> removed, String visibleId) {
        if (!initialized) throw new IllegalStateException("Activity changes need a full snapshot first");
        List<Notice> notices = new ArrayList<>();
        for (Activity activity : changed) apply(activity, visibleId, notices);
        entries.keySet().removeAll(removed);
        return notices;
    }
    private void apply(Activity activity, String visibleId, List<Notice> notices) {
        Entry entry = entries.get(activity.id);
        if (entry != null && entry.revision > activity.revision) return;
        if (activity.archived) {
            markRead(activity.id, activity.revision);
            Entry archived = entries.get(activity.id);
            archived.revision = Math.max(archived.revision, activity.revision);
            if (activity.finished != null) archived.finished = activity.finished;
            if (activity.input != null) archived.input = activity.input;
            return;
        }
        if (entry == null) {
            entry = new Entry();
            entry.read = initialized ? 0 : activity.revision;
            if (!initialized) { entry.finished = activity.finished; entry.input = activity.input; }
            entries.put(activity.id, entry);
        }
        entry.revision = activity.revision;
        entry.reply = Math.max(entry.reply, activity.reply);
        boolean newFinish = activity.finished != null && !Objects.equals(activity.finished, entry.finished);
        boolean newInput = activity.input != null && !Objects.equals(activity.input, entry.input);
        if (activity.finished != null) entry.finished = activity.finished;
        if (activity.input != null) entry.input = activity.input;
        if (entry.reply > entry.read && !Objects.equals(activity.id, visibleId) && (newFinish || newInput))
            notices.add(new Notice(activity, newInput));
    }
    public void markRead(String id, long revision) {
        markRead(id, revision, null, null);
    }
    public void markRead(String id, long revision, String finished, String input) {
        Entry entry = entries.get(id);
        if (entry == null) { entry = new Entry(); entry.revision = revision; entries.put(id, entry); }
        if (revision >= entry.revision) {
            if (finished != null) entry.finished = finished;
            if (input != null) entry.input = input;
        }
        entry.revision = Math.max(entry.revision, revision);
        entry.read = Math.max(entry.read, revision);
    }
    public List<String> unreadIds() {
        List<String> ids = new ArrayList<>();
        for (Map.Entry<String, Entry> row : entries.entrySet())
            if (row.getValue().reply > row.getValue().read) ids.add(row.getKey());
        return ids;
    }
}
