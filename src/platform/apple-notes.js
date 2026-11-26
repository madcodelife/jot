// Every note of Apple Notes as JSON, for Jot's "Import from Apple Notes" (src/apple_notes.rs reads it). Jot runs it
// with `osascript -l JavaScript` only when the user imports, from Settings; the first run makes macOS ask the user to
// let Jot control Notes. It changes nothing in Notes.
//
// Output: {"folders": [{"account", "path": ["Work", "Projects"], "deleted", "notes": [{"id", "name", "modified" (ms
// since 1970), "locked", "body" (HTML; null for a locked note, one in Recently Deleted, or one Notes gave no text
// for)}]}]}, ASCII alone (the rest escaped). Images' data (`src="data:..."`) is cut out of the HTML: Jot does not
// import it, and it would make the output huge.
//
// To look at what it gives on a Mac: osascript -l JavaScript src/platform/apple-notes.js > /tmp/apple-notes.json
// (macOS asks the app it runs in, Terminal for instance, to control Notes).

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
  return ascii(JSON.stringify({ folders: folders }, (key, value) => (typeof value === "string" ? wellFormed(value) : value)));
}

// `text` with each lone surrogate (half an emoji, a name cut in two) as U+FFFD: JSON with one is not JSON to Jot.
function wellFormed(text) {
  return text.replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (c) => (c.length === 2 ? c : "\ufffd"));
}

// JSON with every character past ASCII escaped (`\uXXXX`, a pair for one past U+FFFF): the same bytes whatever text
// encoding osascript writes in.
function ascii(json) {
  return json.replace(/[^\x00-\x7f]/g, (c) => "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4));
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
