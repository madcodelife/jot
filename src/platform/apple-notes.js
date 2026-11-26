// Every note of Apple Notes as JSON, for Jot's "Import from Apple Notes" (src/apple_notes.rs reads it). Jot runs it
// with `osascript -l JavaScript` only when the user imports, from Settings; the first run makes macOS ask the user to
// let Jot control Notes. It changes nothing in Notes.
//
// Output: {"folders": [{"account", "path": ["Work", "Projects"], "deleted", "notes": [{"id", "name", "modified" (ms
// since 1970), "locked", "body" (HTML; null for a locked note, one in Recently Deleted, or one Notes gave no text
// for)}]}]}. Images' data (`src="data:…"`) is cut out of the HTML: Jot does not import it, and it would make the
// output huge.
//
// To look at what it gives on a Mac: osascript -l JavaScript src/platform/apple-notes.js > /tmp/apple-notes.json
// (macOS asks the app it runs in, Terminal for instance, to control Notes).

// Recently Deleted, as Notes names it in each language (it has no other mark in Notes' scripting): a top-level
// folder of an account with one of these names is left out.
const RECENTLY_DELETED = [
  "Recently Deleted",
  "最近删除",
  "最近刪除",
  "最近削除した項目",
  "최근 삭제된 항목",
  "Zuletzt gelöscht",
  "Suppressions récentes",
  "Eliminado recientemente",
  "Eliminati di recente",
  "Recentemente apagadas",
  "Apagados recentemente",
  "Onlangs verwijderd",
  "Недавно удаленные",
];

const DATA_SRC = /(\bsrc\s*=\s*)"data:[^"]*"/gi;

function run() {
  const app = Application("Notes");
  const folders = [];
  for (const account of app.accounts()) {
    const accountName = account.name();
    const all = account.folders();
    // An account's folders may list nested ones too: the top-level ones are those no folder holds.
    const nested = {};
    for (const folder of all) {
      for (const sub of folder.folders()) nested[sub.id()] = true;
    }
    const seen = {};
    const visit = (folder, path, top) => {
      const id = folder.id();
      if (seen[id]) return;
      seen[id] = true;
      const name = folder.name();
      const here = path.concat([name]);
      const deleted = top && RECENTLY_DELETED.indexOf(name) >= 0;
      folders.push({ account: accountName, path: here, deleted: deleted, notes: notesOf(folder.notes, deleted) });
      for (const sub of folder.folders()) visit(sub, here, false);
    };
    for (const folder of all) {
      if (!nested[folder.id()]) visit(folder, [], true);
    }
    // One no walk reached (not expected): on its own.
    for (const folder of all) visit(folder, [], false);
  }
  return JSON.stringify({ folders: folders });
}

// A folder's notes: their ids, names, dates and locks in one request each; the bodies of all in one too when none
// is locked (else, or when that fails, one by one), none for Recently Deleted.
function notesOf(notes, deleted) {
  const ids = notes.id();
  if (ids.length === 0) return [];
  const names = notes.name();
  const dates = notes.modificationDate();
  const locked = notes.passwordProtected();
  let bodies = null;
  if (!deleted && locked.indexOf(true) < 0) {
    try {
      bodies = notes.body();
      if (bodies.length !== ids.length) bodies = null;
    } catch (e) {
      bodies = null;
    }
  }
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    let body = null;
    if (!deleted && !locked[i]) {
      if (bodies) {
        body = bodies[i];
      } else {
        try {
          body = notes.byId(ids[i]).body();
        } catch (e) {
          body = null;
        }
      }
      body = typeof body === "string" ? body.replace(DATA_SRC, '$1"data:"') : null;
    }
    out.push({
      id: ids[i],
      name: names[i],
      modified: dates[i] ? dates[i].getTime() : null,
      locked: !!locked[i],
      body: body,
    });
  }
  return out;
}
