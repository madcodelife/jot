// The settings window, headless: ⌘, from the panel opens it, and what it
// changes shows at once (the appearance, the theme, the language) and is kept
// in the app's storage (`jot.*`). Opened in Simplified Chinese with a 24-hour
// clock, Jot's reference copy.
import { expect, open, test } from "nsh/test";

/** A fresh, empty notes folder. */
const folder = (name: string) => `/tmp/jot-settings-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** The AI apps' stand-ins: no test reads or writes the machine's own configuration files. */
const CONNECTIONS = {
  "Connections.server": "/Applications/Jot.app/Contents/MacOS/jot-mcp",
  "Connections.translocated": false,
  "Connections.clients": async () => [],
  "Connections.connect": async () => {
    throw new Error("not in tests");
  },
  "Connections.disconnect": async () => {
    throw new Error("not in tests");
  },
  "Connections.sync": async () => [],
  "Connections.generic": {
    command: "/Applications/Jot.app/Contents/MacOS/jot-mcp --dir /tmp/notes",
    json: '{\n  "mcpServers": {\n    "jot": {\n      "command": "/Applications/Jot.app/Contents/MacOS/jot-mcp",\n      "args": ["--dir", "/tmp/notes"]\n    }\n  }\n}',
  },
};

/** iCloud Drive's stand-in: off, so no test reads the machine's own account. */
const NO_ICLOUD = { "Folder.icloud": { path: "/tmp/jot-settings-no-icloud/Jot", available: false } };

/** An AI app as `Connections` reports it. */
const aiClient = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  installed: true,
  connected: false,
  current: false,
  manual: null,
  config: `~/.${id}/mcp.json`,
  snippet: `{"mcpServers":{"jot":{}}} for ${id}`,
  error: null,
  ...over,
});

/** Opens Jot on `dir`, as on its first run, with `storage` over the folder's key. */
const openJot = (dir: string, storage: Record<string, string> = {}, modules: Record<string, unknown> = {}) =>
  open("./App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    localeSettings: { hourCycle: "h23" },
    storage: { "jot.dir": dir, ...storage },
    modules: {
      "jot/native": {
        "Summon.isTrusted": true,
        "Summon.requestTrust": null,
        "Summon.onDoubleTap": null,
        ...CONNECTIONS,
        ...NO_ICLOUD,
        ...modules,
      },
    },
  });

type App = Awaited<ReturnType<typeof openJot>>;

/** ⌘, in the panel, then the settings window's tab `tab`. */
async function openSettings(app: App, tab?: string) {
  await app.waitFor("id:search");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:settings");
  if (tab) {
    await app.press(`id:settings-tab:${tab}`);
    await app.waitFor(`id:settings-pane:${tab}`);
  }
}

/** The color of the settings window's title, which reads `title` (the page's name). */
const color = (app: App, title: string) => app.spanStyle(`id:settings-title >> text:${title}`)?.color;

/** The color of the empty panel's title (the theme's text). */
const panelColor = (app: App) => app.spanStyle("id:empty >> text:还没有笔记")?.color;

test("⌘, in the panel opens the settings window on General", async () => {
  const app = await openJot(folder("open"));
  await openSettings(app);
  expect(app.window("settings").state()).toMatchObject({ visible: true, focused: true });
  expect(app.shows("id:settings-pane:general")).toBe(true);
  expect(app.texts()).toContain("通用");
  // The double press stands in as granted, so its page says it is on.
  await app.press("id:settings-tab:summon");
  await app.waitFor("id:settings-pane:summon");
  expect(app.shows("id:settings-summon-on")).toBe(true);
  // The app's card opens About.
  await app.press("id:settings-tab:about");
  await app.waitFor("id:settings-pane:about");
  expect(app.texts()).toContain("关于 Jot");
  app.dispose();
});

test("the appearance switches the windows to dark and back, and is kept", async () => {
  const app = await openJot(folder("appearance"));
  await openSettings(app, "appearance");
  const light = color(app, "外观");

  await app.press("id:settings-appearance:dark");
  await app.waitUntil(() => color(app, "外观") !== light);
  expect(color(app, "外观")).toBe("#f1f2f6ff");
  expect(app.storage()["jot.appearance"]).toBe("dark");

  await app.press("id:settings-appearance:light");
  await app.waitUntil(() => color(app, "外观") === light);
  expect(app.storage()["jot.appearance"]).toBe("light");
  app.dispose();
});

test("a theme recolors the panel, not the settings window, and is kept", async () => {
  const app = await openJot(folder("theme"));
  await app.waitFor("id:empty");
  const panel = panelColor(app);
  await openSettings(app, "appearance");
  const settings = color(app, "外观");

  await app.press("id:theme:paper");
  await app.waitUntil(() => app.storage()["jot.theme"] === "paper");
  expect(color(app, "外观")).toBe(settings);

  // Back to the default.
  await app.press("id:theme:default");
  await app.waitUntil(() => app.storage()["jot.theme"] === "default");
  expect(color(app, "外观")).toBe(settings);
  app.dispose();

  // The panel shows in the kept theme's colors.
  const paper = await openJot(folder("theme-paper"), { "jot.theme": "paper" });
  await paper.waitFor("id:empty");
  expect(panelColor(paper)).not.toBe(panel);
  paper.dispose();
});

test("the language changes every window's words at once, and is kept", async () => {
  const app = await openJot(folder("language"));
  await app.waitFor("id:search");
  expect(app.shows("text:搜索或新建…")).toBe(true);
  await openSettings(app);

  await app.press("id:settings-language >> text:跟随系统");
  await app.press("text:English");
  await app.waitFor("text:General");
  expect(app.texts()).toContain("Appearance");
  expect(app.texts()).toContain("Notes Folder");
  expect(app.storage()["jot.language"]).toBe("en");
  app.dispose();
});

test("stored settings apply before anything shows", async () => {
  const app = await openJot(folder("stored"), { "jot.language": "ja", "jot.appearance": "dark" });
  await app.waitFor("id:search");
  expect(app.shows("text:検索または新規作成…")).toBe(true);
  await openSettings(app);
  expect(app.texts()).toContain("一般");
  expect(color(app, "一般")).toBe("#f1f2f6ff");
  app.dispose();
});

test("typing a default time keeps it, for reminders written with a date alone", async () => {
  const app = await openJot(folder("time"));
  await openSettings(app, "reminders");
  expect(app.storage()["jot.defaultTime"]).toBeUndefined();

  await app.press("id:settings-default-time >> text:09");
  await app.keyboard.press("1");
  await app.keyboard.press("0");
  await app.waitUntil(() => app.storage()["jot.defaultTime"] === "10:00");
  app.dispose();
});

test("Change… opens the chosen folder and keeps it, and the connected AI apps follow it", async () => {
  const other = folder("other");
  const synced: string[] = [];
  const app = await openJot(folder("change"), {}, {
    "Folder.choose": async () => other,
    "Connections.sync": async (dir: string) => {
      synced.push(dir);
      return [];
    },
  });
  await openSettings(app);

  await app.press("id:settings-change-folder");
  await app.waitUntil(() => app.storage()["jot.dir"] === other);
  await app.waitUntil(() => (app.texts().find((s) => s.startsWith("/tmp/jot-settings-other")) ?? "") !== "");
  await app.waitUntil(() => synced.length === 1);
  expect(synced[0].endsWith(other.slice(other.lastIndexOf("/")))).toBe(true);
  app.dispose();
});

test("the AI page lists the apps on this Mac, connects and disconnects them", async () => {
  const dir = folder("ai");
  const calls: string[] = [];
  let cursor = aiClient("cursor", "Cursor");
  const app = await openJot(dir, {}, {
    "Connections.clients": async (d: string) => {
      calls.push(`clients ${d}`);
      return [
        aiClient("claude-code", "Claude Code", { manual: "no-cli", snippet: "claude mcp add --scope user jot -- /x --dir /y" }),
        aiClient("claude-desktop", "Claude", { connected: true, current: true }),
        cursor,
        aiClient("codex", "Codex", { connected: true, current: false }),
        aiClient("windsurf", "Windsurf", { installed: false }),
      ];
    },
    "Connections.connect": async (id: string, d: string) => {
      calls.push(`connect ${id} ${d}`);
      cursor = { ...cursor, connected: true, current: true };
      return cursor;
    },
    "Connections.disconnect": async (id: string, d: string) => {
      calls.push(`disconnect ${id} ${d}`);
      cursor = { ...cursor, connected: false, current: false };
      return cursor;
    },
  });
  await openSettings(app, "ai");
  await app.waitFor("id:settings-ai:cursor");
  expect(app.texts()).toContain("AI 应用");
  expect(calls[0]).toBe(`clients ${dir}`);

  // Installed apps only, each with its state.
  expect(app.shows("id:settings-ai:windsurf")).toBe(false);
  expect(app.shows("id:settings-ai-state:claude-desktop >> text:已连接")).toBe(true);
  expect(app.shows("id:settings-ai-state:cursor >> text:未连接")).toBe(true);
  expect(app.shows("id:settings-ai-state:codex >> text:连接的是另一个文件夹")).toBe(true);
  expect(app.shows("id:settings-ai-update:codex")).toBe(true);
  // Claude Code without its CLI: the command to copy.
  expect(app.shows("id:settings-ai-state:claude-code >> text:需要手动设置")).toBe(true);
  expect(app.shows("id:settings-ai-toggle:claude-code")).toBe(false);
  await app.press("id:settings-ai-copy:claude-code");
  await app.waitFor("id:settings-ai-copy:claude-code >> text:已复制");

  // Connect, then disconnect.
  await app.press("id:settings-ai-toggle:cursor");
  await app.waitFor("id:settings-ai-state:cursor >> text:已连接");
  expect(calls).toContain(`connect cursor ${dir}`);
  await app.press("id:settings-ai-toggle:cursor");
  await app.waitFor("id:settings-ai-state:cursor >> text:未连接");
  expect(calls).toContain(`disconnect cursor ${dir}`);

  // Any other app: the command and the JSON, to copy.
  expect(app.shows("id:settings-ai-command")).toBe(true);
  expect(app.shows("id:settings-ai-json")).toBe(true);
  app.dispose();
});

test("the AI page says why an app could not be connected, and when jot-mcp is missing", async () => {
  const app = await openJot(folder("ai-errors"), {}, {
    "Connections.clients": async () => [
      aiClient("vscode", "VS Code", { manual: "unreadable", config: "~/Library/Application Support/Code/User/mcp.json" }),
      aiClient("gemini", "Gemini CLI"),
    ],
    "Connections.connect": async () => {
      throw new Error("permission denied");
    },
  });
  await openSettings(app, "ai");
  await app.waitFor("id:settings-ai:gemini");
  expect(app.shows("id:settings-ai-copy:vscode")).toBe(true);
  expect(app.texts().some((s) => s.includes("~/Library/Application Support/Code/User/mcp.json"))).toBe(true);
  await app.press("id:settings-ai-toggle:gemini");
  await app.waitUntil(() => app.texts().some((s) => s.includes("permission denied")));
  expect(app.shows("id:settings-ai-state:gemini >> text:未连接")).toBe(true);
  app.dispose();

  // Without jot-mcp: said so, and nothing to connect with.
  let connected = 0;
  const bare = await openJot(folder("ai-no-server"), {}, {
    "Connections.server": null,
    "Connections.clients": async () => [aiClient("cursor", "Cursor")],
    "Connections.connect": async () => {
      connected += 1;
      return aiClient("cursor", "Cursor", { connected: true, current: true });
    },
  });
  await openSettings(bare, "ai");
  await bare.waitFor("id:settings-ai:cursor");
  expect(bare.shows("id:settings-ai-no-server")).toBe(true);
  // Connect is disabled: the press is refused, and nothing is connected.
  let refused = false;
  try {
    await bare.press("id:settings-ai-toggle:cursor");
  } catch {
    refused = true;
  }
  expect(refused).toBe(true);
  expect(connected).toBe(0);
  expect(bare.shows("id:settings-ai-state:cursor >> text:未连接")).toBe(true);
  bare.dispose();
});

test("the AI page says when no app is found", async () => {
  const app = await openJot(folder("ai-none"));
  await openSettings(app, "ai");
  await app.waitFor("id:settings-ai-none");
  app.dispose();
});

test("the AI page connects nothing while Jot runs from a translocated path, and says to move it", async () => {
  let connected = 0;
  const app = await openJot(folder("ai-translocated"), {}, {
    "Connections.server": "/private/var/folders/x/T/AppTranslocation/ABC/d/Jot.app/Contents/MacOS/jot-mcp",
    "Connections.translocated": true,
    "Connections.clients": async () => [
      aiClient("cursor", "Cursor"),
      aiClient("codex", "Codex", { connected: true, current: false }),
    ],
    "Connections.connect": async () => {
      connected += 1;
      return aiClient("cursor", "Cursor", { connected: true, current: true });
    },
  });
  await openSettings(app, "ai");
  await app.waitFor("id:settings-ai:cursor");
  expect(app.shows("id:settings-ai-translocated")).toBe(true);
  expect(app.texts().some((s) => s.includes("「应用程序」"))).toBe(true);
  expect(app.shows("id:settings-ai-no-server")).toBe(false);
  expect(app.enabled("id:settings-ai-toggle:cursor")).toBe(false);
  expect(app.enabled("id:settings-ai-update:codex")).toBe(false);
  // Disconnecting still works.
  expect(app.enabled("id:settings-ai-toggle:codex")).toBe(true);
  expect(connected).toBe(0);
  app.dispose();
});

test("an app Jot cannot write says it stayed on the old folder", async () => {
  const app = await openJot(folder("ai-stale"), {}, {
    "Connections.clients": async () => [
      aiClient("gemini", "Gemini CLI", { connected: true, current: false, manual: "unreadable", config: "~/.gemini/settings.json" }),
    ],
  });
  await openSettings(app, "ai");
  await app.waitFor("id:settings-ai:gemini");
  expect(app.texts().some((s) => s.startsWith("它还连着之前的文件夹") && s.includes("~/.gemini/settings.json"))).toBe(true);
  app.dispose();
});

test("after a folder change the AI page shows the apps as the sync left them", async () => {
  const other = folder("ai-follow-other");
  let synced = false;
  const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const cursor = () => aiClient("cursor", "Cursor", { connected: true, current: synced });
  const app = await openJot(folder("ai-follow"), {}, {
    "Folder.choose": async () => other,
    // A read that started before the sync answers after it, with what it read then.
    "Connections.clients": async () => {
      const seen = cursor();
      await later(150);
      return [seen];
    },
    "Connections.sync": async () => {
      await later(30);
      synced = true;
      return [cursor()];
    },
  });
  // The page's first read is still under way when the folder changes.
  await openSettings(app, "ai");
  await app.press("id:settings-tab:general");
  await app.press("id:settings-change-folder");
  await app.waitUntil(() => app.storage()["jot.dir"] === other);
  await app.press("id:settings-tab:ai");
  await app.waitFor("id:settings-ai-state:cursor >> text:已连接", { timeout: 3000 });
  await later(400);
  expect(app.shows("id:settings-ai-state:cursor >> text:已连接")).toBe(true);
  app.dispose();
});

/** iCloud Drive's root on a made-up home, and Jot's folder in it. */
const drive = (name: string) => {
  const root = `${folder(name)}/Library/Mobile Documents/com~apple~CloudDocs`;
  return { root, jot: `${root}/Jot` };
};

test("with iCloud Drive off, the move to it is disabled and says why", async () => {
  const { jot } = drive("icloud-off");
  const app = await openJot(folder("icloud-off-notes"), {}, { "Folder.icloud": { path: jot, available: false } });
  await openSettings(app);
  await app.waitFor("id:settings-icloud");
  expect(app.texts()).toContain("iCloud 云盘没有打开：在「系统设置」›「Apple 账户」›「iCloud」里打开「iCloud 云盘」。");
  expect(app.enabled("id:settings-icloud-move")).toBe(false);
  expect(app.dialogs()).toEqual([]);
  app.dispose();
});

test("moving to iCloud Drive asks first, moves the notes, switches the folder and says what it did", async () => {
  const { jot } = drive("icloud-move");
  const from = folder("icloud-move-notes");
  const moves: [string, string][] = [];
  const syncs: string[] = [];
  const app = await openJot(from, {}, {
    "Folder.icloud": { path: jot, available: true },
    "Folder.moveNotes": async (source: string, target: string) => {
      moves.push([source, target]);
      return { moved: ["A", "B"], renamed: [{ from: "Plan", to: "Plan 2" }], same: ["Same"], failed: [] };
    },
    "Connections.sync": async (dir: string) => {
      syncs.push(dir);
      return [];
    },
  });
  await openSettings(app);
  await app.waitFor("id:settings-icloud-move");
  expect(app.texts()).toContain("把笔记移到 iCloud 云盘，在 iPhone、iPad 和其他 Mac 上也能看到。");

  // Cancelled: nothing moves.
  app.onDialog(() => "取消");
  await app.press("id:settings-icloud-move");
  await app.waitUntil(() => app.dialogs().length === 1);
  expect(app.dialogs()[0]).toMatchObject({ title: "把笔记移到 iCloud 云盘？", buttons: ["移到 iCloud 云盘", "取消"] });
  expect(app.dialogs()[0].message).toContain("加上编号另存");
  expect(moves).toEqual([]);
  expect(app.storage()["jot.dir"]).toBe(from);

  // Confirmed: moved, and the folder follows.
  app.onDialog(() => "移到 iCloud 云盘");
  await app.press("id:settings-icloud-move");
  await app.waitFor("id:settings-icloud-report");
  expect(moves).toEqual([[from, jot]]);
  expect(app.storage()["jot.dir"]).toBe(jot);
  expect(syncs).toContain(jot);
  const report = app.texts().find((text) => text.startsWith("已把 3 条笔记移到 iCloud 云盘。"));
  expect(report).toContain("「Plan」和那里的笔记同名，存成了「Plan 2」。");
  expect(report).toContain("1 条那里已有一模一样的");
  // Now it is there.
  await app.waitFor("id:settings-icloud-on");
  expect(app.shows("id:settings-icloud-move")).toBe(false);
  expect(app.texts()).toContain("笔记在 iCloud 云盘里，会同步到你的其他设备。");
  app.dispose();
});

test("a move that fails keeps the folder and says why", async () => {
  const { jot } = drive("icloud-fail");
  const from = folder("icloud-fail-notes");
  const app = await openJot(from, {}, {
    "Folder.icloud": { path: jot, available: true },
    "Folder.moveNotes": async () => {
      throw new Error("cannot move the notes: disk full");
    },
  });
  app.onDialog(() => "移到 iCloud 云盘");
  await openSettings(app);
  await app.press("id:settings-icloud-move");
  await app.waitFor("id:settings-icloud-report");
  expect(app.texts().some((text) => text.startsWith("没能移到 iCloud 云盘：") && text.includes("disk full"))).toBe(true);
  expect(app.storage()["jot.dir"]).toBe(from);
  expect(app.enabled("id:settings-icloud-move")).toBe(true);
  app.dispose();
});

test("a notes folder already in iCloud Drive shows so, with nothing to move", async () => {
  const { root, jot } = drive("icloud-there");
  const app = await openJot(`${root}/Notes`, {}, { "Folder.icloud": { path: jot, available: true } });
  await openSettings(app);
  await app.waitFor("id:settings-icloud-on");
  expect(app.shows("id:settings-icloud-move")).toBe(false);
  expect(app.texts()).toContain("已在 iCloud 云盘");
  app.dispose();
});
