# MCP for AI apps

What `jot-mcp` (mcp/) lets AI apps do, and the setting that allows removing and rewriting notes. Part of [the
architecture](architecture.md).

## AI apps removing and rewriting notes (store/src/settings.rs, mcp/)

`trash_note` and `replace_note` work only while the user allows it: Settings › AI Apps › "Allow AI apps to move
notes to the Trash and rewrite notes", off by default. `jot-mcp` runs in each AI app's process, started by the app
with the arguments written in its configuration, so the setting cannot be an argument (changing it would mean
rewriting every app's configuration and restarting the apps) nor in NSH's Storage (the app's alone). It is a file
outside the notes folder that the app writes and `jot-mcp` reads on every call of the two tools (and as it starts,
for its instructions): `~/Library/Application Support/Jot/ai.json`, `{"allowTrashAndRewrite": true, "language":
"zh-Hans"}` (`AiSettings`; missing or unreadable is off). The language is the one Jot shows, which names a
rewritten note's previous version: `Plan (before rewrite · 2026-11-25 14.30)`, `计划（改写前 · …）`, `計劃（改寫前 · …）`,
`計画（書き換え前 · …）` (no colon: Finder shows one as a slash; the title shortened to fit 255 bytes).

The tools stay listed while the setting is off and refuse with where to turn it on: a changing tool list needs the
client to follow `notifications/tools/list_changed`, which not every client does, and `jot-mcp` would have to watch
the file; a listed tool that explains itself lets the model tell the user how to allow it. Both are annotated
`destructiveHint: true`, `readOnlyHint: false`, `openWorldHint: false` and `idempotentHint: true` (`trash_note`
again finds nothing to trash; `replace_note` with the same body changes nothing and trashes nothing). The server's
instructions say how the setting stood as the app connected, to use the tools only when asked, and to list the
notes and ask before removing many at once. `replace_note` refuses an empty body and a body that starts with a `---`
frontmatter block (it would become the note's frontmatter); the note's own frontmatter is kept.

The switch is about Jot's tools: an app that runs shell commands can edit the file, or the notes, itself; locking
a note is what keeps it as it is.

## MCP tools (mcp/)

MCP tools (mcp/) never wait on a download unbounded: a tool that needs a note's text (`read_note`, `append_note`,
`add_todo`, `complete_todo`, `reschedule_todo`) waits up to 20 s for a note iCloud is downloading, then says it is
still downloading (`NotDownloaded`); listings mark such a note "not downloaded to this Mac yet"; `read_note`
mentions conflict versions iCloud kept.

MCP tools (mcp/) on a locked note: reading, searching, listing and `list_todos` go on (listings and `read_note` say
"locked in Jot (read-only)"); every tool that writes fails with "locked in Jot … the user unlocks it in Jot first".
No tool locks or unlocks.

MCP tools (mcp/): `create_note` and `add_todo` record the calling app as the new note's `source`
(`Source::from_client` of the `initialize` handshake's `clientInfo.name`). `add_todo(text, due?, note?)` (`due`: ISO `2026-11-14T09:00` or a phrase `when::parse` reads, in
Chinese, English or Japanese; without `due`, a phrase in `text` becomes the time),
`list_todos(range?)` (`overdue` | `today` | `upcoming` | `all`, default `today`+`overdue`), `complete_todo(note, text)`,
`reschedule_todo(note, text, due)` (`due` required: ISO or a phrase `when::parse` reads; `null` removes the reminder;
only the `⏰` part of the line changes). The last two find the open to-do the same way: the exact text, else the one
whose text holds it; several or none fail, listing the candidates.
