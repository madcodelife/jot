// The island saying what AI apps write: driven by the activity log `jot-mcp` keeps (a log of the test's own, through
// `ActivityLog.path`), the notes folder the test's own too. The log's lines are written as jot-mcp writes them
// (`ActivityLog.append`).
import { expect, open, test } from "nsh/test";
import { ActivityLog, Notes, type AgentAction } from "jot/native";
import { STAND_INS } from "./native";
import { THEMES, themeVars } from "../ui/themes";

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
/** A fresh notes folder, and a log beside it. */
const setup = (name: string) => {
  const base = `/tmp/jot-test-island-${name}-${unique()}`;
  return { dir: `${base}/Jot`, log: `${base}/Application Support/Jot/activity.jsonl` };
};

/**
 * Opens Jot on `dir`, following the log `log`; `trashShown` gets what the island asks Finder to show in the Trash.
 * With reduced motion unless `motion`.
 */
const openJot = (dir: string, log: string, trashShown: (string | null)[] = [], motion = false) => {
  new Notes(dir);
  return open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: !motion,
    locale: "zh-CN",
    storage: { "jot.dir": dir },
    modules: {
      "jot/native": {
        ...STAND_INS,
        "ActivityLog.path": log,
        "Folder.showInTrash": async (path: string | null) => void trashShown.push(path ?? null),
      },
    },
  });
};

/** A line of the log: `agent` did `action` to the note `title` in `dir`. */
function wrote(log: string, dir: string, action: AgentAction, title: string, more: { agent?: string; previous?: string; inTrash?: string } = {}) {
  ActivityLog.append(log, {
    at: "2026-11-26T14:30:05",
    dir,
    agent: more.agent ?? "Claude Code",
    action,
    title,
    previous: more.previous ?? null,
    inTrash: more.inTrash ?? null,
  });
}

const showing = (app: { texts(): string[] }, text: string) => app.texts().includes(text);

test("each kind of write says what the app did: a new note is written letter by letter, the others at once", async () => {
  const { dir, log } = setup("kinds");
  const app = await openJot(dir, log);
  await app.waitFor("id:search");

  wrote(log, dir, "create", "周会纪要");
  await app.waitUntil(() => showing(app, "Claude Code · 正在记到 Jot"));
  // The avatar says so for screen readers; the title comes in letter by letter.
  expect(app.shows("label:正在写")).toBe(true);
  expect(app.texts()).toContain("纪");
  await app.waitUntil(() => showing(app, "Claude Code · 已记下"));
  expect(app.shows("label:正在写")).toBe(false);
  await app.waitFor("id:island-write", { state: "gone" });

  const kinds: [AgentAction, string, string][] = [
    ["append", "部署命令", "Claude Code · 追加到"],
    ["todo", "待办", "Claude Code · 加了一条待办"],
    ["complete", "购物", "Claude Code · 勾选了一条待办"],
    ["reschedule", "账单", "Claude Code · 改了提醒时间"],
    ["replace", "计划", "Claude Code · 改写了 · 旧版本在版本历史里"],
    ["trash", "旧想法", "Claude Code · 移到了废纸篓"],
  ];
  // One after another, each on its own island.
  for (const [action, title] of kinds) wrote(log, dir, action, title);
  for (const [, title, label] of kinds) {
    await app.waitUntil(() => showing(app, label) && app.texts().includes(title), { timeout: 8000 });
    // Never the new note's letters, never "writing".
    expect(app.texts().some((s) => s.includes("正在记到 Jot"))).toBe(false);
  }
  app.dispose();
});

type Seen = { opens: number; open: boolean };

/**
 * Counts the island's openings, looking every 50 ms for `ms` (it stays shut 420 ms between two islands), and runs
 * `each` at every look. Timed by the clock, not by the looks: on a slow machine a look takes longer than its wait, and
 * counting them ran the test past its 30 s.
 */
async function countOpens(
  app: { wait(ms: number): Promise<void>; layout(selector: string): { height: number } | null },
  ms: number,
  each: () => void = () => {},
): Promise<Seen> {
  const seen = { opens: 0, open: false };
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const open = (app.layout("id:island")?.height ?? 0) > 60;
    if (open && !seen.open) seen.opens++;
    seen.open = open;
    each();
    await app.wait(50);
  }
  return seen;
}

test("writes of one app to one note close together are one island; another app's are its own", async () => {
  const { dir, log } = setup("merge");
  const app = await openJot(dir, log);
  await app.waitFor("id:search");
  await app.keyboard.press("escape");

  // Read together: the first shows, the others join it, and it says the latest. One more, written while it shows,
  // joins it too.
  wrote(log, dir, "append", "待办");
  wrote(log, dir, "todo", "待办");
  wrote(log, dir, "complete", "待办");
  const said: string[] = [];
  let later = false;
  const one = await countOpens(app, 5000, () => {
    for (const text of app.texts()) if (text.startsWith("Claude Code · ") && said.at(-1) !== text) said.push(text);
    if (!later && said.includes("Claude Code · 勾选了一条待办")) {
      later = true;
      wrote(log, dir, "reschedule", "待办");
    }
  });
  expect(one.opens).toBe(1);
  expect(one.open).toBe(false);
  expect(said.at(-1)).toBe("Claude Code · 改了提醒时间");

  // Another app's write to the same note, and the same app's to another note: an island each.
  wrote(log, dir, "append", "待办", { agent: "Cursor" });
  wrote(log, dir, "append", "日记");
  const titles = new Set<string>();
  const two = await countOpens(app, 6000, () => {
    for (const text of app.texts()) if (text === "Cursor · 追加到" || text === "日记") titles.add(text);
  });
  expect(two.opens).toBe(2);
  expect([...titles].sort()).toEqual(["Cursor · 追加到", "日记"].sort());
  app.dispose();
});

test("only this folder's writes, and only from the log: a note an AI app made elsewhere and synced here says nothing", async () => {
  const { dir, log } = setup("only-log");
  const app = await openJot(dir, log);
  await app.waitFor("id:search");

  // Another folder's write.
  wrote(log, `${dir}-other`, "append", "别处");
  // A note an AI app wrote on another Mac, arriving through iCloud Drive: its row drops in, the island stays shut.
  new Notes(dir).create("命令", "---\nsource: cursor\n---\nls -la");
  await app.waitFor("id:row:命令");
  await app.wait(1500);
  expect(app.shows("id:island-write")).toBe(false);
  expect(app.texts().some((s) => s.includes("别处") || s.startsWith("Cursor · "))).toBe(false);

  // Another spelling of the folder names it too (and /tmp is a link to /private/tmp, which the app resolves).
  wrote(log, dir.replace("/Jot", "/./Jot"), "append", "这里");
  await app.waitUntil(() => showing(app, "Claude Code · 追加到") && app.texts().includes("这里"));
  app.dispose();
});

test("a click opens the note the app wrote to, a rewritten one with its version history, or shows a trashed one in the Trash", async () => {
  const { dir, log } = setup("click");
  new Notes(dir).create("周报", "本周进展");
  const trashShown: (string | null)[] = [];
  const app = await openJot(dir, log, trashShown);
  await app.waitFor("id:search");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:search"));

  wrote(log, dir, "append", "周报");
  await app.waitUntil(() => showing(app, "Claude Code · 追加到"));
  expect(app.shows("label:打开「周报」")).toBe(true);
  await app.press("id:island-write");
  await app.waitFor("id:paper-title");
  expect(app.texts()).toContain("周报");
  await app.waitFor("id:island-write", { state: "gone" });

  // A rewrite: the note opens with its version history over it; Escape goes back to the note.
  wrote(log, dir, "replace", "周报");
  await app.waitUntil(() => showing(app, "Claude Code · 改写了 · 旧版本在版本历史里"));
  expect(app.shows("label:查看「周报」的版本历史")).toBe(true);
  await app.press("id:island-write");
  await app.waitFor("id:history");
  expect(app.texts()).toContain("版本历史");
  await app.keyboard.press("escape");
  await app.waitFor("id:history", { state: "gone" });
  expect(app.shows("id:paper-title")).toBe(true);
  await app.waitFor("id:island-write", { state: "gone" });

  wrote(log, dir, "trash", "旧想法", { inTrash: "/Users/me/.Trash/旧想法.md" });
  await app.waitUntil(() => showing(app, "Claude Code · 移到了废纸篓"));
  await app.press("id:island-write");
  await app.waitUntil(() => trashShown.length === 1);
  expect(trashShown).toEqual(["/Users/me/.Trash/旧想法.md"]);
  app.dispose();
});

/**
 * What the avatar shows each time it changes, while `ms` pass or until the island closes: "ink" while Jot's logo is
 * written, "logo" once whole. Timed by the clock, not by the steps: on a slow machine a step takes longer than its wait,
 * and counting them would go on sampling after the island has closed.
 */
async function logoStates(app: { wait(ms: number): Promise<void>; shows(selector: string): boolean }, ms: number) {
  const states: string[] = [];
  const until = Date.now() + ms;
  while (Date.now() < until && app.shows("id:island-write")) {
    const state = app.shows("id:island-ink") ? "ink" : app.shows("id:island-logo") ? "logo" : "none";
    if (states.at(-1) !== state) states.push(state);
    await app.wait(20);
  }
  return states;
}

test("the avatar writes Jot's logo as it falls, whole about as it lands and from then on, for every write", async () => {
  const { dir, log } = setup("logo");
  const app = await openJot(dir, log, [], true);
  await app.waitFor("id:search");

  for (const [action, title] of [["complete", "购物"], ["create", "周会纪要"]] as const) {
    wrote(log, dir, action, title);
    await app.waitFor("id:island-write");
    const opened = Date.now();
    // The pen writes while the avatar falls; whole well within a second, and whole until the island closes (the note
    // in, the avatar hopping).
    expect(await logoStates(app, 1000)).toEqual(["ink", "logo"]);
    expect(app.layout("id:island-logo")?.width).toBe(28);
    await app.waitUntil(() => !app.shows("id:island-write") || app.shows("id:island-ink"), { timeout: 8000 });
    expect(app.shows("id:island-ink")).toBe(false);
    expect(Date.now() - opened).toBeGreaterThan(1000);
    await app.waitFor("id:island-write", { state: "gone", timeout: 8000 });
  }
  app.dispose();
});

test("the avatar's colors are Jot's mark, the same in every theme and appearance: white on the brand's indigo", () => {
  for (const name of THEMES) {
    for (const look of ["light", "dark"] as const) {
      const v = themeVars(name).cssVars[look] as Record<string, string>;
      expect([v["island-logo"], v["island-logo-light"], v["island-logo-ink"]]).toEqual(["#2b2f8f", "#4a4fc4", "#ffffff"]);
    }
  }
});

test("with reduced motion the logo is whole at once", async () => {
  const { dir, log } = setup("logo-still");
  const app = await openJot(dir, log);
  await app.waitFor("id:search");
  wrote(log, dir, "create", "周会纪要");
  await app.waitFor("id:island-write");
  expect(app.shows("id:island-logo")).toBe(true);
  expect(await logoStates(app, 800)).toEqual(["logo"]);
  app.dispose();
});
