// A note's emoji, headless. Rows are words alone: a note with an emoji shows it
// before its title ("🍕 周末聚餐"), one without shows its title only, and the
// "today" and "new" rows have no icon either. ⌘K (or a right click) offers
// "设置 Emoji…", which shows the emoji picker (NSH's `EmojiPicker`) in the
// list's place in the panel, the note named at its top, and "移除 Emoji" once
// there is one. The open note's header shows its emoji before the title, and a
// faint button above it adds or removes one, the picker a card under the title
// and its date. Neither moves the note in the list: its time stays.
import { expect, open, test } from "nsh/test";
import { ActivityLog, Notes } from "jot/native";
import { STAND_INS } from "./native";

const folder = (name: string) => `/tmp/jot-emoji-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const openJot = (dir: string) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: {
      "jot/native": {
        ...STAND_INS,
        "Connections.server": "/Applications/Jot.app/Contents/MacOS/jot-mcp",
        "Connections.translocated": false,
        "Connections.clients": async () => [],
        "Connections.sync": async () => [],
        "Connections.generic": { command: "jot-mcp --dir /tmp/notes", json: "{}" },
        "Folder.icloud": { path: null, available: false },
      },
    },
  });

type App = Awaited<ReturnType<typeof openJot>>;

/** The picker's search field. */
const SEARCH = "label:搜索 Emoji（英文）";

/** Searches the open picker for `words` and chooses the first match with Return. */
async function choose(app: App, words: string) {
  await app.type(SEARCH, words);
  await app.wait(100);
  await app.keyboard.press("enter");
  await app.waitUntil(() => !app.shows("id:emoji-picker"));
}

/** Two notes, the second the newer: "周末聚餐" stays below it whatever its emoji does. */
function twoNotes(name: string) {
  const dir = folder(name);
  const n = new Notes(dir);
  n.create("周末聚餐", "周六晚上七点");
  n.create("购物清单", "牛奶");
  return { dir, n, modified: n.read("周末聚餐")!.meta.modified };
}

const rowTop = (app: App, title: string) => app.layout(`id:row:${title}`)!.y;

/** `inner` lies within `outer`'s frame. */
function inside(app: App, inner: string, outer: string) {
  const a = app.layout(inner)!;
  const b = app.layout(outer)!;
  expect(a.x).toBeGreaterThanOrEqual(b.x);
  expect(a.y).toBeGreaterThanOrEqual(b.y);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width);
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height);
}

test("a row shows a note's emoji before its title, and rows without one show their words alone", async () => {
  const { dir, n } = twoNotes("rows");
  n.setIcon("周末聚餐", "🍕");
  const app = await openJot(dir);
  await app.waitFor("id:row:周末聚餐");
  expect(app.texts()).toContain("🍕 周末聚餐");
  expect(app.texts()).toContain("购物清单");
  expect(app.texts().some((text) => text.endsWith(" 购物清单"))).toBe(false);
  // No icon tile: the title starts at the row's padding, as the "new note" row's words do.
  const title = app.layout("id:row:购物清单 >> id:note-title")!.x - app.layout("id:row:购物清单")!.x;
  expect(title).toBeLessThan(20);

  // A search marks the title's words, not the emoji.
  await app.type("id:search", "聚餐");
  await app.waitFor("id:row:create");
  expect(app.texts()).toContain("🍕 周末聚餐");
  // The row is selected: its marked words are in the highlighter's fill, as on any row; the emoji is not marked.
  expect(app.spanStyle("id:row:周末聚餐 >> text:聚餐 >> nth=0")?.backgroundColor ?? "#00000000").not.toMatch(/00$/);
  expect(app.spanStyle("id:row:周末聚餐 >> text:🍕 >> nth=0")?.backgroundColor ?? "#00000000").toMatch(/00$/);
  const create = app.layout("id:row:create >> text:新建「聚餐」")!.x - app.layout("id:row:create")!.x;
  expect(create).toBeLessThan(20);
  app.dispose();
});

test("⌘K shows the emoji picker in the list's place; the emoji chosen becomes the note's, back to the list; the note keeps its place and time", async () => {
  const { dir, modified } = twoNotes("actions");
  const app = await openJot(dir);
  await app.waitFor("id:row:周末聚餐");
  expect(rowTop(app, "购物清单")).toBeLessThan(rowTop(app, "周末聚餐"));
  await app.type("id:search", "周末");
  await app.waitFor("id:row:create");

  // No emoji yet: nothing to remove.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:emoji");
  expect(app.shows("id:action:emoji-remove")).toBe(false);
  await app.press("id:action:emoji");
  await app.waitFor("id:emoji-picker");
  // In the list's place, within the panel, the note named at its top; groups in Jot's words.
  expect(app.shows("id:row:周末聚餐")).toBe(false);
  inside(app, "id:emoji-picker", "id:panel");
  expect(app.shows("id:emoji-note")).toBe(true);
  expect(app.texts()).toContain("周末聚餐");
  expect(app.texts()).toContain("笑脸与情感");
  expect(app.shows("id:emoji-remove")).toBe(false);

  await choose(app, "pizza");
  await app.waitUntil(() => app.texts().includes("🍕 周末聚餐"));
  const note = new Notes(dir).read("周末聚餐")!;
  expect(note.meta.icon).toBe("🍕");
  expect(note.meta.modified).toBe(modified);
  expect(note.body).toBe("周六晚上七点");
  // The search field has the keys again.
  await app.type("id:search", "聚");
  expect(app.value("id:search")).toBe("周末聚");

  // The picker again: the note with its emoji at the top, and Remove there; then ⌘K's Remove.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:emoji");
  await app.press("id:action:emoji");
  await app.waitFor("id:emoji-picker");
  expect(app.shows("id:row:周末聚餐")).toBe(false);
  expect(app.texts()).toContain("🍕 周末聚餐");
  expect(app.shows("id:emoji-remove")).toBe(true);
  await app.keyboard.press("escape");
  await app.waitFor("id:row:周末聚餐");
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:emoji-remove");
  await app.press("id:action:emoji-remove");
  await app.waitUntil(() => !app.texts().includes("🍕 周末聚餐"));
  expect(new Notes(dir).read("周末聚餐")!.meta.icon ?? null).toBeNull();
  expect(new Notes(dir).read("周末聚餐")!.meta.modified).toBe(modified);

  // Still below the newer note.
  await app.clear("id:search");
  await app.waitFor("id:row:购物清单");
  expect(rowTop(app, "购物清单")).toBeLessThan(rowTop(app, "周末聚餐"));
  app.dispose();
});

test("the picker shows the notes' own emoji first; a press picks one; Escape clears the search, then goes back to the list", async () => {
  const { dir, n } = twoNotes("picker");
  n.setIcon("购物清单", "🛒");
  const app = await openJot(dir);
  await app.waitFor("id:row:周末聚餐");
  await app.rightClick("id:row:周末聚餐");
  await app.waitFor("id:action:emoji");
  await app.press("id:action:emoji");
  await app.waitFor("id:emoji-picker");
  expect(app.texts()).toContain("笔记里用过的");

  // Escape: the search first, then the picker; the panel stays, its list back, the search field with the keys.
  await app.type(SEARCH, "zzzz");
  await app.waitFor("text:没有找到 Emoji");
  await app.keyboard.press("escape");
  await app.waitUntil(() => app.value(SEARCH) === "");
  expect(app.shows("id:emoji-picker")).toBe(true);
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:emoji-picker"));
  await app.waitFor("id:row:周末聚餐");
  expect(new Notes(dir).read("周末聚餐")!.meta.icon ?? null).toBeNull();
  await app.type("id:search", "周");
  expect(app.value("id:search")).toBe("周");
  await app.clear("id:search");
  await app.waitFor("id:row:购物清单");

  // The used emoji, pressed.
  await app.rightClick("id:row:周末聚餐");
  await app.waitFor("id:action:emoji");
  await app.press("id:action:emoji");
  await app.waitFor("id:emoji-picker");
  await app.press("id:emoji-picker >> text:🛒 >> nth=0");
  await app.waitUntil(() => !app.shows("id:emoji-picker"));
  await app.waitUntil(() => new Notes(dir).read("周末聚餐")!.meta.icon === "🛒");
  // Removed from the picker: back to the list too.
  await app.rightClick("id:row:购物清单");
  await app.waitFor("id:action:emoji");
  await app.press("id:action:emoji");
  await app.waitFor("id:emoji-remove");
  await app.press("id:emoji-remove");
  await app.waitFor("id:row:购物清单");
  await app.waitUntil(() => app.texts().includes("购物清单"));
  expect(new Notes(dir).read("购物清单")!.meta.icon ?? null).toBeNull();
  app.dispose();
});

test("the open note's header shows its emoji before the title; the faint button above adds and removes one, the picker under the title and date", async () => {
  const { dir, modified } = twoNotes("paper");
  const app = await openJot(dir);
  await app.waitFor("id:row:周末聚餐");
  await app.press("id:row:周末聚餐");
  await app.waitFor("id:paper-title");
  expect(app.shows("id:paper-emoji")).toBe(false);

  await app.press("id:paper-emoji-add");
  await app.waitFor("id:emoji-picker");
  // Under the title and its date, not over them, its left edge the title's; within the panel.
  const card = app.layout("id:emoji-picker")!;
  const date = app.layout("id:paper-meta")!;
  expect(card.y).toBeGreaterThanOrEqual(date.y + date.height);
  expect(Math.abs(card.x - app.layout("id:paper-title")!.x)).toBeLessThan(1);
  inside(app, "id:emoji-picker", "id:panel");
  await choose(app, "pizza");
  await app.waitFor("id:paper-emoji");
  expect(app.texts()).toContain("🍕");
  expect(app.shows("id:paper-emoji-add")).toBe(false);
  // The sidebar's row shows it too.
  await app.waitUntil(() => app.texts().includes("🍕 周末聚餐"));

  // A press on the emoji changes it; the picker can remove it too. The card stays under the date, the title's left
  // edge its own (the emoji's, now).
  await app.press("id:paper-emoji");
  await app.waitFor("id:emoji-picker");
  expect(app.layout("id:emoji-picker")!.y).toBeGreaterThanOrEqual(app.layout("id:paper-meta")!.y + app.layout("id:paper-meta")!.height);
  inside(app, "id:emoji-picker", "id:panel");
  await choose(app, "sushi");
  await app.waitUntil(() => new Notes(dir).read("周末聚餐")!.meta.icon === "🍣");
  await app.press("id:paper-emoji");
  await app.waitFor("id:emoji-remove");
  await app.press("id:emoji-remove");
  await app.waitUntil(() => !app.shows("id:paper-emoji"));
  expect(new Notes(dir).read("周末聚餐")!.meta.icon ?? null).toBeNull();

  // And the faint button above the title.
  await app.press("id:paper-emoji-add");
  await choose(app, "pizza");
  await app.waitFor("id:paper-emoji-remove");
  await app.press("id:paper-emoji-remove");
  await app.waitUntil(() => !app.shows("id:paper-emoji"));
  await app.waitFor("id:paper-emoji-add");
  const note = new Notes(dir).read("周末聚餐")!;
  expect(note.meta.icon ?? null).toBeNull();
  expect(note.meta.modified).toBe(modified);
  expect(note.body).toBe("周六晚上七点");
  app.dispose();
});

test("the panel hidden while an emoji is being chosen: shown again, the list's keys and ⌘K work", async () => {
  const { dir } = twoNotes("dismiss");
  // The panel comes back as a click on the island does it (what an AI app wrote): the summon keys are the system's.
  const log = `${dir}-activity.jsonl`;
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: { "jot/native": { ...STAND_INS, "ActivityLog.path": log } },
  });
  await app.waitFor("id:row:周末聚餐");
  for (const from of ["list", "paper"] as const) {
    if (from === "list") {
      await app.rightClick("id:row:周末聚餐");
      await app.waitFor("id:action:emoji");
      await app.press("id:action:emoji");
    } else {
      await app.press("id:row:周末聚餐");
      await app.press("id:paper-emoji-add");
    }
    await app.waitFor("id:emoji-picker");
    // ⌘, : the settings window takes the focus, and the panel hides, the picker with it.
    await app.keyboard.press("mod+,");
    await app.waitUntil(() => !app.shows("id:search"));
    expect(app.shows("id:emoji-picker")).toBe(false);

    ActivityLog.append(log, { at: "2026-11-26T14:30:05", dir, agent: "Claude Code", action: "append", title: "购物清单", previous: null, inTrash: null });
    await app.waitFor("id:island-write");
    await app.press("id:island-write");
    await app.waitFor("id:paper-title");
    expect(app.shows("id:emoji-picker")).toBe(false);
    // ⌘K on the open note, then back to the list: ↓ moves the selection, ⌘K opens the row's actions.
    await app.keyboard.press("mod+k");
    await app.waitFor("id:actions");
    await app.keyboard.press("escape");
    await app.waitUntil(() => !app.shows("id:actions"));
    await app.keyboard.press("escape");
    await app.waitUntil(() => !app.shows("id:paper-title"));
    await app.waitUntil(() => app.accessibility("id:row:购物清单")?.selected === true);
    await app.keyboard.press("down");
    await app.waitUntil(() => app.accessibility("id:row:周末聚餐")?.selected === true);
    await app.keyboard.press("mod+k");
    await app.waitFor("id:action:emoji");
    await app.keyboard.press("escape");
    await app.waitUntil(() => !app.shows("id:actions"));
    await app.waitFor("id:island-write", { state: "gone" });
  }
  expect(new Notes(dir).read("周末聚餐")!.meta.icon ?? null).toBeNull();
  app.dispose();
});

test("a locked note keeps its emoji: no emoji actions, and no button in its header", async () => {
  const { dir, n } = twoNotes("locked");
  n.setIcon("周末聚餐", "🍕");
  n.lock("周末聚餐");
  const app = await openJot(dir);
  await app.waitFor("id:row:周末聚餐");
  await app.type("id:search", "周末");
  await app.waitFor("id:row:create");
  await app.keyboard.press("mod+k");
  await app.waitFor("id:action:unlock");
  expect(app.shows("id:action:emoji")).toBe(false);
  expect(app.shows("id:action:emoji-remove")).toBe(false);
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:actions"));

  await app.press("id:row:周末聚餐");
  await app.waitFor("id:paper-emoji");
  expect(app.enabled("id:paper-emoji")).toBe(false);
  expect(app.shows("id:paper-emoji-add")).toBe(false);
  expect(app.shows("id:paper-emoji-remove")).toBe(false);
  app.dispose();
  new Notes(dir).unlock("周末聚餐");
});
