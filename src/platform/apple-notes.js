// Every note of Apple Notes as JSON, for Jot's "Import from Apple Notes" (src/apple_notes.rs reads it). Jot runs it
// with `osascript -l JavaScript` only when the user imports, from Settings; the first run makes macOS ask the user to
// let Jot control Notes. It changes nothing in Notes.
//
// Output, on stdout: {"folders": [{"account", "path": ["Work", "Projects"], "deleted", "notes": [{"id", "name",
// "modified" (ms since 1970), "locked", "body" (HTML; null for a locked note, one in Recently Deleted, or one Notes
// gave no text for)}]}]}, ASCII alone (the rest escaped). Images' data (`src="data:..."`) is cut out of the HTML: Jot
// does not import it, and it would make the output huge. Notes whose folder Notes did not name come last, in a folder
// with no path.
//
// Progress, on stderr (JXA's `console.log` writes there): `progress <done> <total>`, the folders whose text is read,
// once before the first and after each.
//
// Each request to Notes is an Apple Event, and one can take seconds when the Mac is busy: so whole collections are
// asked for at once (every folder's id, every note's name, ...), and the tree is built here. Ten requests read every
// account, folder and note but their text; then two per folder (its notes' ids and texts), or one per note in a
// folder with a locked one (asking for all the texts at once fails there).
//
// To look at what it gives on a Mac: osascript -l JavaScript src/platform/apple-notes.js > /tmp/apple-notes.json
// (macOS asks the app it runs in, Terminal for instance, to control Notes). Without Notes:
// node scripts/apple-notes-fake.mjs (an invented Notes, counting the requests).

// Recently Deleted, as Notes names it in each language: a top-level folder of an account with one of these names is
// left out. Notes' scripting has no other mark for it (`sdef /System/Applications/Notes.app`: a folder has a name, an
// id, `shared` and its container, no more). Escaped, so they read the same whatever text encoding osascript
// reads the script in.
//
// Generated from macOS's own Notes (the "Recently Deleted" string of every language NotesShared has), sorted; to
// regenerate, on a Mac:
// python3 -c 'import plistlib,json; t=plistlib.load(open("/System/Library/PrivateFrameworks/NotesShared.framework/Resources/Localizable.loctable","rb")); [print("  "+json.dumps(n)+","+(" // "+n if json.dumps(n)[1:-1]!=n else "")) for n in sorted({v["Recently Deleted"] for v in t.values() if isinstance(v,dict) and "Recently Deleted" in v})]'
const RECENTLY_DELETED = [
  "Apagadas",
  "Baru Dihapus",
  "Eliminadas",
  "Eliminades fa poc",
  "Eliminate",
  "Nedavno izbrisano",
  "Nedavno obrisano",
  "Ned\u00e1vno smazan\u00e9", // Nedávno smazané
  "Ned\u00e1vno vymazan\u00e9", // Nedávno vymazané
  "Nemr\u00e9g t\u00f6r\u00f6lt", // Nemrég törölt
  "Nylig slettet",
  "Ostatnio usuni\u0119te", // Ostatnio usunięte
  "Recent verwijderd",
  "Recently Deleted",
  "Reci\u00e9n eliminado", // Recién eliminado
  "Senast raderade",
  "Slettet for nylig",
  "Son Silinenler",
  "Suppr. r\u00e9centes", // Suppr. récentes
  "Terbaru Dipadam",
  "Zuletzt gel\u00f6scht", // Zuletzt gelöscht
  "\u00c4skett\u00e4in poistetut", // Äskettäin poistetut
  "\u0110\u00e3 x\u00f3a g\u1ea7n \u0111\u00e2y", // Đã xóa gần đây
  "\u0218terse recent", // Șterse recent
  "\u03a0\u03c1\u03cc\u03c3\u03c6\u03b1\u03c4\u03b5\u03c2 \u03b4\u03b9\u03b1\u03b3\u03c1\u03b1\u03c6\u03ad\u03c2", // Πρόσφατες διαγραφές
  "\u041d\u0435\u0434\u0430\u0432\u043d\u043e \u0432\u0438\u0434\u0430\u043b\u0435\u043d\u0456", // Недавно видалені
  "\u041d\u0435\u0434\u0430\u0432\u043d\u043e \u0443\u0434\u0430\u043b\u0435\u043d\u043d\u044b\u0435", // Недавно удаленные
  "\u05e0\u05de\u05d7\u05e7\u05d5 \u05dc\u05d0\u05d7\u05e8\u05d5\u05e0\u05d4", // נמחקו לאחרונה
  "\u0627\u0644\u0645\u062d\u0630\u0648\u0641\u0629 \u0645\u0624\u062e\u0631\u064b\u0627", // المحذوفة مؤخرًا
  "\u0939\u093e\u0932\u093f\u092f\u093e \u0921\u093f\u0932\u0940\u091f \u0915\u093f\u090f \u0917\u090f", // हालिया डिलीट किए गए
  "\u0e17\u0e35\u0e48\u0e25\u0e1a\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14", // ที่ลบล่าสุด
  "\u6700\u8fd1\u5220\u9664", // 最近删除
  "\u6700\u8fd1\u522a\u9664", // 最近刪除
  "\u6700\u8fd1\u524a\u9664\u3057\u305f\u9805\u76ee", // 最近削除した項目
  "\ucd5c\uadfc \uc0ad\uc81c\ub41c \ud56d\ubaa9", // 최근 삭제된 항목
  // Not generated: earlier names, which an older macOS may still give.
  "Apagados recentemente",
  "Eliminado recientemente",
  "Eliminati di recente",
  "Onlangs verwijderd",
  "Recentemente apagadas",
  "Suppressions r\u00e9centes", // Suppressions récentes
];

const DATA_SRC = /(\bsrc\s*=\s*)"data:[^"]*"/gi;

function run() {
  const app = Application("Notes");
  const accounts = new Map(zip(app.accounts.id(), app.accounts.name()));

  // Every folder, nested ones too; its container is its parent folder, or its account for a top-level one.
  const folderIds = app.folders.id();
  const folderNames = app.folders.name();
  const folderParents = app.folders.container.id();
  same(folderIds, [folderNames, folderParents]);
  const parents = new Map();
  for (let i = 0; i < folderIds.length; i++) parents.set(folderIds[i], { name: folderNames[i], parent: folderParents[i] });
  const placed = new Map();
  const place = (id, seen) => {
    if (placed.has(id)) return placed.get(id);
    const folder = parents.get(id);
    let where;
    if (accounts.has(folder.parent)) {
      where = { account: accounts.get(folder.parent), path: [folder.name], deleted: RECENTLY_DELETED.indexOf(folder.name) >= 0 };
    } else if (parents.has(folder.parent) && !seen.has(folder.parent)) {
      seen.add(id);
      const up = place(folder.parent, seen);
      // A folder in Recently Deleted is deleted too.
      where = { account: up.account, path: up.path.concat([folder.name]), deleted: up.deleted };
    } else {
      // A container Notes did not list (or a loop, not expected): the folder on its own.
      where = { account: "", path: [folder.name], deleted: false };
    }
    placed.set(id, where);
    return where;
  };

  // Every note, put in its folder.
  const ids = app.notes.id();
  const names = app.notes.name();
  const dates = app.notes.modificationDate();
  const locked = app.notes.passwordProtected();
  same(ids, [names, dates, locked]);
  const records = new Map();
  for (let i = 0; i < ids.length; i++) {
    records.set(ids[i], {
      id: ids[i],
      name: names[i],
      modified: dates[i] ? dates[i].getTime() : null,
      locked: !!locked[i],
      body: null,
    });
  }
  // Which folder each note is in: a folder's notes' ids, one request a folder (Notes answers `app.notes.container`
  // with null for every note, so the notes cannot be placed all at once). The same list orders the folder's texts.
  const groups = new Map();
  for (const id of folderIds) {
    const group = Object.assign({ id: id, notes: [], listed: [] }, place(id, new Set()));
    try {
      group.listed = app.folders.byId(id).notes.id();
    } catch (e) {
      group.listed = [];
    }
    for (const noteId of group.listed) {
      const note = records.get(noteId);
      if (note && !note.placed) {
        note.placed = true;
        group.notes.push(note);
      }
    }
    groups.set(id, group);
  }
  // A note in no folder Notes listed: kept, under no folder.
  const loose = { id: null, account: "", path: [], deleted: false, notes: [], listed: [] };
  for (const note of records.values()) {
    if (!note.placed) loose.notes.push(note);
    delete note.placed;
  }
  if (loose.notes.length) groups.set(null, loose);

  // Their text, folder by folder.
  const reading = Array.from(groups.values()).filter((group) => !group.deleted && group.notes.some((note) => !note.locked));
  console.log("progress 0 " + reading.length);
  reading.forEach((group, done) => {
    readBodies(app, group);
    console.log("progress " + (done + 1) + " " + reading.length);
  });

  const folders = Array.from(groups.values()).map((group) => ({
    account: group.account,
    path: group.path,
    deleted: group.deleted,
    notes: group.notes,
  }));
  return ascii(JSON.stringify({ folders: folders }, (key, value) => (typeof value === "string" ? wellFormed(value) : value)));
}

// The text of `group`'s unlocked notes: all at once, in the order of the folder's ids read before (`listed`; Notes
// may list a folder's notes in another order than all notes), when none is locked; else, or for those that did not
// come so, one request each.
function readBodies(app, group) {
  const bodies = new Map();
  if (group.id !== null && !group.notes.some((note) => note.locked)) {
    try {
      const texts = app.folders.byId(group.id).notes.body();
      if (texts.length === group.listed.length) for (let i = 0; i < texts.length; i++) bodies.set(group.listed[i], texts[i]);
    } catch (e) {
      bodies.clear();
    }
  }
  for (const note of group.notes) {
    if (note.locked) continue;
    let body = bodies.get(note.id);
    if (typeof body !== "string") {
      try {
        body = app.notes.byId(note.id).body();
      } catch (e) {
        body = null;
      }
    }
    note.body = typeof body === "string" ? body.replace(DATA_SRC, '$1"data:"') : null;
  }
}

// Pairs of `keys` and `values`.
function zip(keys, values) {
  same(keys, [values]);
  return keys.map((key, i) => [key, values[i]]);
}

// Throws unless every list of `others` is as long as `list`: Notes answered each request for a collection with its
// own list, and they must line up.
function same(list, others) {
  for (const other of others) {
    if (!other || other.length !== list.length) throw new Error("Notes changed while it was read: import again");
  }
}

// `text` with each lone surrogate (half an emoji, a name cut in two) as U+FFFD: JSON with one is not JSON to Jot.
function wellFormed(text) {
  return text.replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (c) => (c.length === 2 ? c : "�"));
}

// JSON with every character past ASCII escaped (`\uXXXX`, a pair for one past U+FFFF): the same bytes whatever text
// encoding osascript writes in.
function ascii(json) {
  return json.replace(/[^\x00-\x7f]/g, (c) => "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4));
}
