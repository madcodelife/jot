#!/usr/bin/env node
// Runs src/platform/apple-notes.js (or the script given) against an invented Notes, without Notes or osascript: prints
// what it gives on stdout, as osascript would, and on stderr its progress lines then how many requests (Apple Events)
// it made. Not in CI: it needs Node. `cargo test -p nsh-app-jot apple_notes_script_under_node -- --ignored` runs it.
//
//   node scripts/apple-notes-fake.mjs [--odd] [script.js]
//
// The invented Notes: two accounts, 15 folders (nested ones among them, Recently Deleted in each account), 54 notes,
// one of them locked. Each call that would be an Apple Event counts one: a property of a collection
// (`app.notes.name()`), of one element (`folder.name()`) or the elements themselves (`app.accounts()`); making a
// specifier (`app.folders.byId(id)`, `.notes`) does not. As Notes does, asking for every text of a collection with a
// locked note or one in Recently Deleted fails. `--odd` adds a note and a folder whose containers Notes does not list.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const args = process.argv.slice(2);
const odd = args.includes("--odd");
const script = args.find((arg) => !arg.startsWith("--")) ?? fileURLToPath(new URL("../src/platform/apple-notes.js", import.meta.url));

const accounts = [
  { id: "x-coredata://ACCT/ICAccount/p1", name: "iCloud" },
  { id: "x-coredata://ACCT/IMAPAccount/p2", name: "On My Mac" },
];
const [icloud, mac] = accounts.map((account) => account.id);
const folder = (n, name, container) => ({ id: `x-coredata://ACCT/ICFolder/p${n}`, name, container });
const folders = [
  folder(1, "Notes", icloud),
  folder(2, "Work", icloud),
  folder(3, "Projects", "x-coredata://ACCT/ICFolder/p2"),
  folder(4, "Archive", "x-coredata://ACCT/ICFolder/p3"),
  folder(5, "Recipes", icloud),
  folder(6, "Baking", "x-coredata://ACCT/ICFolder/p5"),
  folder(7, "Travel", icloud),
  folder(8, "Lisbon", "x-coredata://ACCT/ICFolder/p7"),
  folder(9, "Reading", icloud),
  folder(10, "Recently Deleted", icloud),
  folder(11, "Notes", mac),
  folder(12, "Ideas", mac),
  folder(13, "Café 😀", "x-coredata://ACCT/ICFolder/p12"),
  folder(14, "Empty", mac),
  folder(15, "Recently Deleted", mac),
];
if (odd) folders.push(folder(16, "Stray", "x-coredata://ACCT/ICFolder/p99"));

// 54 notes over the folders but Empty: one locked (in Reading), one in each Recently Deleted.
const spread = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13];
const notes = [];
for (let i = 1; i <= 52; i++) {
  const where = spread[i % spread.length];
  notes.push({
    id: `x-coredata://ACCT/ICNote/p${i}`,
    name: `Note ${i}`,
    modified: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    locked: i === 9,
    container: `x-coredata://ACCT/ICFolder/p${where}`,
    body: `<div><h1>Note ${i}</h1></div><div>Line of note ${i}</div><div><img src="data:image/png;base64,AAAA"></div>`,
  });
}
for (const [n, where] of [[53, 10], [54, 15]]) {
  notes.push({ id: `x-coredata://ACCT/ICNote/p${n}`, name: `Gone ${n}`, modified: new Date(0), locked: false, container: `x-coredata://ACCT/ICFolder/p${where}`, body: "<div>gone</div>", deleted: true });
}
if (odd) {
  notes.push({ id: "x-coredata://ACCT/ICNote/p90", name: "Loose", modified: new Date(0), locked: false, container: "x-coredata://ACCT/ICFolder/p98", body: "<div>loose</div>" });
  notes.push({ id: "x-coredata://ACCT/ICNote/p91", name: "Strayed", modified: new Date(0), locked: false, container: "x-coredata://ACCT/ICFolder/p16", body: "<div>strayed</div>" });
}

let events = 0;
const event = (f) => (...args) => {
  events++;
  return f(...args);
};

const textOf = (note) => {
  if (note.locked || note.deleted) throw new Error("An error occurred.");
  return note.body;
};

// A collection of `kind` ("account", "folder", "note"), its records from `records()`.
function collection(kind, records) {
  const all = event(() => records().map((record) => element(kind, record)));
  all.id = event(() => records().map((record) => record.id));
  // A function's own `name` is read-only: defined over.
  Object.defineProperty(all, "name", { value: event(() => records().map((record) => record.name)) });
  // As Notes does: a folder's container (its parent folder or account) comes with the rest, a note's is always null.
  all.container = { id: event(() => records().map((record) => (kind === "note" ? null : record.container))) };
  all.byId = (id) => element(kind, records().find((record) => record.id === id));
  if (kind === "note") {
    all.modificationDate = event(() => records().map((record) => record.modified));
    all.passwordProtected = event(() => records().map((record) => record.locked));
    all.body = event(() => records().map(textOf));
  }
  return all;
}

function element(kind, record) {
  const missing = () => {
    throw new Error("Can't get object.");
  };
  const one = (f) => event(() => (record ? f(record) : missing()));
  const it = { id: one((r) => r.id), name: one((r) => r.name) };
  if (kind === "account") {
    // An account's folders, nested ones too.
    const top = (f) => {
      let up = f;
      while (up && !accounts.some((a) => a.id === up.container)) up = folders.find((g) => g.id === up.container);
      return up?.container;
    };
    it.folders = collection("folder", () => folders.filter((f) => top(f) === record.id));
  }
  if (kind === "folder") {
    it.folders = collection("folder", () => folders.filter((f) => f.container === record?.id));
    // A folder lists its notes in another order than all notes.
    it.notes = collection("note", () => notes.filter((n) => n.container === record?.id).reverse());
  }
  if (kind === "note") it.body = one(textOf);
  return it;
}

const app = {
  accounts: collection("account", () => accounts),
  folders: collection("folder", () => folders),
  notes: collection("note", () => notes),
};

const context = vm.createContext({
  Application: (name) => {
    if (name !== "Notes") throw new Error(`no app ${name}`);
    return app;
  },
  console: { log: (...line) => process.stderr.write(line.join(" ") + "\n") },
});
vm.runInContext(readFileSync(script, "utf8"), context, { filename: script });
const out = vm.runInContext("run()", context);
process.stdout.write(out + "\n");
process.stderr.write(`apple events ${events}\n`);
