# Tool content at the transport boundary

Host storage and provider events retain complete tool content. Only clients that
negotiate `sessions.tool-content.v1` and request `contentMode: "tool-refs-v1"`
receive projected `sessions.sync` responses. Legacy clients and Hosts retain the
full-content protocol. A content-mode change requires a snapshot; revisions from
one mode cannot be used as the base for the other. In-flight reads are keyed by
mode as well as session identity.

Tool bodies exceeding 8 KiB are replaced with versioned references, including
input, output, detail, preview output, diff rows and unusually large labels.
Subagent transcripts and their compatibility steps are both projected. Pending
approvals retain their full command and diff. Projection never saves to Host
storage, and detail pages never hydrate the client's main session snapshot.

`sessions.toolContent.read` resolves a session-scoped block path. Compatibility
steps use an explicit `step` flag because a transcript row can reuse the same ID.
The initial read pins the current body; subsequent pages use the returned version
and transfer token. Transfers expire after two idle minutes, with at most eight
retained across the service. Expiry requires an explicit reload. Diff row kinds
and original line numbers travel with the page. UTF-16 offsets must be at Unicode
code-point boundaries. Ordinary pages fit within 256 KiB of UTF-8 JSON; terminal
tails fit within 64 KiB and at most 200 lines. Large single lines are fragmented
without splitting surrogate pairs. These are response budgets, not storage limits.

Desktop and mobile use the same TanStack Query detail reader. Expanded, visible
running details refresh; hidden/collapsed details stop refreshing. Full-content
copy explicitly walks one pinned snapshot. Conversation find searches the complete
Host data and returns bounded result pages with offsets into tool bodies. A failed
detail request stays a detail error, independent of connection health.

Mobile saves only opened pages in a separate IndexedDB cache kind under the
existing global byte/entry budget (at most 128 detail pages per Host). Startup
restores session summaries without loading those bodies. Pages are keyed by Host,
session, block path, version, field and range; connection epochs isolate in-flight
reads. Network failures can reuse an opened page, while authentication or identity
failures cannot. Deleting a session or forgetting a Host removes its saved pages.

History pagination is negotiated separately with `sessions.history.v1`. Opted-in
sync requests carry `history: { mode: "tail-v1", start? }`. Cold starts select at
most 75 recent blocks within a roughly 1 MiB UTF-8 JSON budget. Single oversized
rows, outstanding approvals and active background work are explicit exceptions:
content and actionable controls remain complete, with responses split into pieces
smaller than 1 MiB. This is a page budget, not a message truncation rule.

`sessions.history` adds `before` equal to the current window's start identity. The
Host returns one coherent snapshot/delta that includes the preceding page and
concurrent edits/appends. Delta `blockIds` covers only the loaded window. The base
revision and `historyBase` must both match; a removed boundary (for example after
rewind) resets to a fresh tail. Legacy/non-UI full-history reads remain available.

Polling and paging share one request owner per client/session. Their retained
windows cannot shrink when two consumers publish the same revision in different
React commits. Desktop and mobile reuse the existing Load earlier control and
scroll anchor; geometry is captured just before the fetched page commits, so a
reader can scroll while waiting. Search can traverse bounded pages to reveal an
unloaded result. Mobile persists newly loaded prefixes even when the Host revision
has not changed, and restores those already loaded messages offline. A failed
history request is shown beside the pagination control without discarding history.
