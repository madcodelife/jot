// The settings window, headless: ⌘, from the panel opens it, and what it
// changes shows at once (the appearance, the theme, the language) and is kept
// in the app's storage (`jot.*`). Opened in Simplified Chinese with a 24-hour
// clock, Jot's reference copy.
import { expect, open, test } from "nsh/test";
import { drawsSurface, swatch, themeFromStored, themeVars, THEMES, type ThemeName } from "../ui/themes";
import { Notes } from "jot/native";
import { defaultFolder } from "../store";
import { AUTOMATION_URL, importFailure, progressText } from "../importing";
import { STAND_INS } from "./native";

/** A fresh, empty notes folder. */
const folder = (name: string) => `/tmp/jot-settings-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** `#rrggbb` of `fg` (`#rrggbb` or `#rrggbbaa`) drawn over the opaque `bg`. */
function flatten(fg: string, bg: string): string {
  const ch = (h: string, i: number) => Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const alpha = fg.length === 9 ? ch(fg, 3) / 255 : 1;
  const mix = (i: number) => Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha));
  return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG's contrast ratio of two opaque colours. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [0, 1, 2].map((i) => {
      const v = Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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

/** The AI apps' permission's stand-in: no test reads or writes the machine's own settings file. */
const AI_ACCESS = { "AiAccess.allowsTrashAndRewrite": false, "AiAccess.set": null };

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

/** Opens Jot on `dir` (`null`: no folder chosen yet), as on its first run, with `storage` over the folder's key. */
const openJot = (dir: string | null, storage: Record<string, string> = {}, modules: Record<string, unknown> = {}) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    localeSettings: { hourCycle: "h23" },
    storage: { ...(dir === null ? {} : { "jot.dir": dir }), ...storage },
    modules: {
      "jot/native": {
        ...STAND_INS,
        ...CONNECTIONS,
        ...NO_ICLOUD,
        ...AI_ACCESS,
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
  expect(color(app, "外观")).toBe("#ffffffd9");
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

  await app.press("id:theme:gruvbox");
  await app.waitUntil(() => app.storage()["jot.theme"] === "gruvbox");
  expect(color(app, "外观")).toBe(settings);

  // Back to the default.
  await app.press("id:theme:default");
  await app.waitUntil(() => app.storage()["jot.theme"] === "default");
  expect(color(app, "外观")).toBe(settings);
  app.dispose();

  // The panel shows in the kept theme's colors.
  const kept = await openJot(folder("theme-kept"), { "jot.theme": "gruvbox" });
  await kept.waitFor("id:empty");
  expect(panelColor(kept)).not.toBe(panel);
  kept.dispose();
});

test("the settings offer Jot's themes in order: the default, those after VS Code themes, high contrast", async () => {
  expect([...THEMES]).toEqual(["default", "github", "one", "dracula", "tokyo", "catppuccin", "gruvbox", "contrast"]);
  const app = await openJot(folder("theme-names"));
  await openSettings(app, "appearance");
  const shown = app.texts();
  for (const name of ["默认", "GitHub", "One", "Dracula", "Tokyo Night", "Catppuccin", "Gruvbox", "高对比"]) expect(shown).toContain(name);
  app.dispose();
});

test("a retired theme stored by an earlier version shows as its successor, and is kept so; an unknown one as the default", async () => {
  expect(themeFromStored("paper")).toBe("gruvbox");
  expect(themeFromStored("dusk")).toBe("dracula");
  expect(themeFromStored("coral")).toBe("catppuccin");
  expect(themeFromStored("moss")).toBe("default");
  expect(themeFromStored("solarized")).toBe("default");
  expect(themeFromStored("constructor")).toBe("default");
  expect(themeFromStored(null)).toBe("default");
  for (const name of THEMES) expect(themeFromStored(name)).toBe(name);

  // The panel's surface is the theme's (headless runs draw it without native glass, so every theme's fill shows).
  const fill = (name: ThemeName) => themeVars(name).cssVars.light["glass-fill"];
  for (const [stored, shown] of [["paper", "gruvbox"], ["dusk", "dracula"], ["coral", "catppuccin"], ["moss", "default"]] as const) {
    const app = await openJot(folder(`retired-${stored}`), { "jot.theme": stored });
    await app.waitFor("id:empty");
    expect(app.viewStyle("id:panel")?.backgroundColor).toBe(fill(shown));
    await app.waitUntil(() => app.storage()["jot.theme"] === shown);
    app.dispose();
  }

  // A name this version does not know (a later version's theme) shows as the default and stays stored.
  const app = await openJot(folder("unknown-theme"), { "jot.theme": "solarized" });
  await app.waitFor("id:empty");
  expect(app.viewStyle("id:panel")?.backgroundColor).toBe(fill("default"));
  await app.wait(300);
  expect(app.storage()["jot.theme"]).toBe("solarized");
  app.dispose();
});

test("every theme reads at WCAG AA in both appearances: text, the selected row, today's card, menus, to-dos, reminders, headings, AI apps' names, matches, selected text", () => {
  for (const name of THEMES) {
    for (const dark of [false, true]) {
      const v = themeVars(name).cssVars[dark ? "dark" : "light"] as Record<string, string>;
      // The panel's surface as the card shows it (the default's glass is drawn, not a colour: its card's stands in).
      const surface = swatch(name, dark).surface;
      const paper = v.paper;
      const on = (fg: string, bg: string) => flatten(fg, bg);
      const chip = (c: string) => flatten(`${c.slice(0, 7)}21`, paper);
      // The list's selected row: the accent at 12% (`bg-primary/12`) on the panel; today's card: at 6%, or 12% selected.
      const selected = flatten(`${v.primary.slice(0, 7)}1f`, surface);
      const card = flatten(`${v.primary.slice(0, 7)}0f`, surface);
      const pairs: [string, string, string][] = [
        ["text on the panel", on(v["glass-fg"], surface), surface],
        ["secondary text on the panel", on(v["glass-muted"], surface), surface],
        ["text on the paper", v["paper-fg"], paper],
        ["secondary text on the paper", v["paper-muted"], paper],
        ["heading", v.heading, paper],
        ["selected row's title", on(v["selected-ink"], selected), selected],
        ["selected row's snippet and time", on(v["selected-muted"], selected), selected],
        ["selected row's AI app's name", on(v["selected-agent"], selected), selected],
        ["today's card's second line", on(v["selected-muted"], card), card],
        ["today's card's overdue to-dos", on(v["selected-late"], card), card],
        ["selected card's overdue to-dos", on(v["selected-late"], selected), selected],
        // The action panel and the reminder time picker, menus, keep a solid accent fill.
        ["selected menu item", v["on-accent"], v.primary],
        ["selected menu item's second line", on(v["on-accent-muted"], v.primary), v.primary],
        ["to-do box", v["accent-ink"], paper],
        ["reminder chip", v.due, chip(v.due)],
        ["overdue chip", v.late, chip(v.late)],
        ["AI app's name", v["agent-ink"], surface],
        ["search match", v["mark-fg"], v.mark],
        // Selected text in a note is ink (headings, links, to-dos and chips too) on the selection's fill.
        ["selected text in a note", v["paper-fg"], on(`${v["paper-fg"].slice(0, 7)}24`, paper)],
      ];
      for (const [what, fg, bg] of pairs) {
        const ratio = contrast(fg, bg);
        if (ratio < 4.5) throw new Error(`${name} ${dark ? "dark" : "light"}: ${what} ${fg} on ${bg} is ${ratio.toFixed(2)}`);
      }
    }
  }
});

test("the selected row's words are the palette's own colours, a deeper shade only where those read below AA on the fill", () => {
  const SOURCE = { "selected-ink": "accent-ink", "selected-muted": "glass-muted", "selected-agent": "agent-ink", "selected-late": "late" };
  let deeper = 0;
  for (const name of THEMES) {
    for (const dark of [false, true]) {
      const v = themeVars(name).cssVars[dark ? "dark" : "light"] as Record<string, string>;
      const selected = flatten(`${v.primary.slice(0, 7)}1f`, swatch(name, dark).surface);
      for (const [token, from] of Object.entries(SOURCE)) {
        if (v[token] === v[from]) continue;
        deeper++;
        // Named only for a reason: the palette's own colour misses AA there.
        if (contrast(flatten(v[from], selected), selected) >= 4.5) throw new Error(`${name} ${dark ? "dark" : "light"}: ${token} need not differ from ${from}`);
      }
    }
  }
  expect(deeper).toBeGreaterThan(0);
  // A palette that names none of them (Dracula's dark ink) takes its own accent, never the base's.
  const dracula = themeVars("dracula").cssVars.dark as Record<string, string>;
  expect(dracula["selected-ink"]).toBe(dracula["accent-ink"]);
});

test("each theme's card in the settings shows its colours in the appearance shown, and the panel takes its surface", async () => {
  const app = await openJot(folder("theme-card"));
  await app.waitFor("id:empty");
  await openSettings(app, "appearance");
  const surface = (name: string) => app.viewStyle(`id:theme-card:${name}`)?.backgroundColor;

  // Each card in its theme's light surface, every one its own; its selected row a light accent fill, as the list's.
  for (const name of THEMES) expect(surface(name)).toBe(`${swatch(name, false).surface}ff`);
  for (const name of THEMES) expect(app.viewStyle(`id:theme-card-selected:${name}`)?.backgroundColor).toBe(swatch(name, false).selected);
  expect(new Set(THEMES.map(surface)).size).toBe(THEMES.length);

  // Dark: the cards follow.
  await app.press("id:settings-appearance:dark");
  await app.waitUntil(() => surface("gruvbox") === `${swatch("gruvbox", true).surface}ff`);
  for (const name of THEMES) expect(surface(name)).toBe(`${swatch(name, true).surface}ff`);
  await app.press("id:theme:gruvbox");
  await app.waitUntil(() => app.storage()["jot.theme"] === "gruvbox");
  app.dispose();

  // The panel then shows in the theme's own surface.
  const kept = await openJot(folder("theme-surface"), { "jot.theme": "gruvbox", "jot.appearance": "dark" });
  await kept.waitFor("id:empty");
  expect(kept.viewStyle("id:panel")?.backgroundColor).toBe("#1d2021f0");
  kept.dispose();
});

test("About credits the themes the colours come from", async () => {
  const app = await openJot(folder("about-credit"));
  await openSettings(app, "about");
  expect(app.texts().join("\n")).toContain("主题配色参考 GitHub Theme、One Dark Pro、Atom One Light、Dracula、Tokyo Night、Catppuccin 和 Gruvbox（MIT）。");
  app.dispose();
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
  expect(color(app, "一般")).toBe("#ffffffd9");
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

test("a note's headings take the theme's heading colour, in each appearance", async () => {
  for (const [name, look] of [["dracula", "light"], ["gruvbox", "dark"], ["default", "light"]] as const) {
    const dir = folder(`heading-${name}`);
    new Notes(dir).create("周末计划", "## 周六去公园\n\n带上相机。");
    const app = await openJot(dir, { "jot.theme": name, "jot.appearance": look });
    await app.waitFor("id:row:周末计划");
    await app.press("id:row:周末计划");
    await app.waitFor("id:paper-title");
    const v = themeVars(name).cssVars[look] as Record<string, string>;
    expect(app.spanStyle("id:editor >> text:周六去公园")?.color).toBe(`${v.heading}ff`);
    expect(app.spanStyle("id:editor >> text:带上相机")?.color).toBe(`${v["paper-fg"]}ff`);
    app.dispose();
  }
});

test("selected text in a note is ink on the selection, its heading, to-do box and reminder chip too, in each appearance", async () => {
  for (const [name, look] of [["one", "dark"], ["github", "light"], ["gruvbox", "dark"]] as const) {
    const dir = folder(`selection-${name}`);
    new Notes(dir).create("选中", "## 周六去公园\n- [ ] 带上相机 ⏰ 2026-11-14 09:00\n看 [地图](https://example.com)");
    const app = await openJot(dir, { "jot.theme": name, "jot.appearance": look });
    // Return in the search field opens the note with the keys in its text.
    await app.type("id:search", "选中");
    await app.submit("id:search");
    await app.waitFor("id:paper-title");
    await app.wait(500);
    const v = themeVars(name).cssVars[look] as Record<string, string>;
    const ink = `${v["paper-fg"]}ff`;
    expect(app.spanStyle("id:editor >> text:周六去公园")?.color).toBe(`${v.heading}ff`);
    await app.keyboard.press("mod+a");
    await app.wait(300);
    for (const words of ["周六去公园", "[ ]", "2026-11-14 09:00", "地图"]) {
      const style = app.spanStyle(`id:editor >> text:${words}`);
      expect(style?.color).toBe(ink);
      expect(style?.backgroundColor ?? "#00000000").toMatch(/00$/);
    }
    app.dispose();
  }
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

test("a first run puts the notes in iCloud Drive when it is on, and remembers the folder", async () => {
  const { jot } = drive("icloud-default");
  const app = await openJot(null, {}, { "Folder.icloud": { path: jot, available: true } });
  await app.waitUntil(() => app.storage()["jot.dir"] === jot);
  await openSettings(app);
  await app.waitFor("id:settings-icloud-on");
  expect(app.shows("id:settings-icloud-move")).toBe(false);
  app.dispose();
});

test("without a folder chosen, iCloud Drive's is the default only on a first run with iCloud Drive on", () => {
  const icloud = "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Jot";
  expect(defaultFolder(false, { path: icloud, available: true })).toBe(icloud);
  // iCloud Drive off, or none (not macOS): the Documents folder.
  expect(defaultFolder(false, { path: icloud, available: false })).toBe("~/Documents/Jot");
  expect(defaultFolder(false, { path: null, available: false })).toBe("~/Documents/Jot");
  // Jot ran here before: its notes are in the Documents folder, and stay there.
  expect(defaultFolder(true, { path: icloud, available: true })).toBe("~/Documents/Jot");
});

test("importing from Apple Notes says what it did, and only when asked", async () => {
  const dir = folder("import");
  const imports: string[] = [];
  const app = await openJot(dir, {}, {
    "AppleNotes.import": async (to: string) => {
      imports.push(to);
      return { imported: 132, renamed: [], already: 5, locked: 3, deleted: 0, waiting: 0, failed: [] };
    },
  });
  await openSettings(app);
  await app.waitFor("id:settings-import-apple-notes");
  // Nothing reads Notes until the button is pressed.
  expect(imports).toEqual([]);
  expect(app.texts()).toContain("备忘录");
  expect(app.texts().some((text) => text.startsWith("第一次导入时，macOS 会请你允许 Jot 控制「备忘录」"))).toBe(true);

  await app.press("id:settings-import-apple-notes");
  await app.waitFor("id:settings-import-report");
  expect(imports).toEqual([dir]);
  expect(app.texts()).toContain("导入了 132 条笔记 · 5 条之前已导入 · 跳过了 3 条上锁的备忘录");
  expect(app.enabled("id:settings-import-apple-notes")).toBe(true);
  app.dispose();
});

test("while an import runs, the notes folder cannot change, nor an import start while it moves", async () => {
  const { jot } = drive("import-busy");
  const dir = folder("import-busy-notes");
  // The import runs until the test lets it finish; the move looks at the import's button meanwhile.
  const started = { import: false };
  const done = { import: false };
  let importOffWhileMoving: boolean | null = null;
  const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const app = await openJot(dir, {}, {
    "Folder.icloud": { path: jot, available: true },
    "AppleNotes.import": async () => {
      started.import = true;
      while (!done.import) await later(10);
      return { imported: 1, renamed: [], already: 0, locked: 0, deleted: 0, waiting: 0, failed: [] };
    },
    "Folder.moveNotes": async () => {
      await later(50);
      importOffWhileMoving = !app.enabled("id:settings-import-apple-notes");
      return { moved: [], renamed: [], same: [], failed: [] };
    },
    "Connections.sync": async () => [],
  });
  await openSettings(app);
  await app.waitFor("id:settings-import-apple-notes");
  expect(app.enabled("id:settings-change-folder")).toBe(true);
  expect(app.enabled("id:settings-icloud-move")).toBe(true);

  // A press waits for the app to settle, which it does not while the import runs.
  const importing = app.press("id:settings-import-apple-notes");
  await app.waitUntil(() => started.import);
  expect(app.enabled("id:settings-import-apple-notes")).toBe(false);
  expect(app.enabled("id:settings-change-folder")).toBe(false);
  expect(app.enabled("id:settings-icloud-move")).toBe(false);

  done.import = true;
  await importing;
  await app.waitFor("id:settings-import-report");
  expect(app.enabled("id:settings-change-folder")).toBe(true);
  expect(app.enabled("id:settings-icloud-move")).toBe(true);
  expect(app.storage()["jot.dir"]).toBe(dir);

  // Moving: no import meanwhile.
  app.onDialog(() => "移到 iCloud 云盘");
  await app.press("id:settings-icloud-move");
  await app.waitFor("id:settings-icloud-report");
  expect(importOffWhileMoving).toBe(true);
  expect(app.enabled("id:settings-import-apple-notes")).toBe(true);
  app.dispose();
});

test("while an import runs, it says how far it is: reading Notes' folders, then writing the notes", async () => {
  const dir = folder("import-progress");
  const started = { import: false };
  const done = { import: false };
  const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const app = await openJot(dir, {}, {
    "AppleNotes.import": async () => {
      started.import = true;
      while (!done.import) await later(10);
      return { imported: 53, renamed: [], already: 0, locked: 0, deleted: 0, waiting: 0, failed: [] };
    },
  });
  await openSettings(app);
  await app.waitFor("id:settings-import-apple-notes");

  const importing = app.press("id:settings-import-apple-notes");
  await app.waitUntil(() => started.import);
  // Before Notes says how many folders: reading, no counts, in place of the footnote.
  await app.waitUntil(() => app.texts().includes("正在读取「备忘录」…"));
  expect(app.shows("id:settings-import-progress")).toBe(true);
  expect(app.texts().some((text) => text.startsWith("第一次导入时"))).toBe(false);

  done.import = true;
  await importing;
  await app.waitFor("id:settings-import-report");
  expect(app.shows("id:settings-import-progress")).toBe(false);
  expect(app.texts()).toContain("导入了 53 条笔记");
  app.dispose();
});

test("how far an import is, in a line", () => {
  // A stand-in's arguments reach the test as JSON, without the progress callback, so its lines are checked here (in
  // English, the test's own language).
  expect(progressText(null)).toBe("Reading Notes…");
  expect(progressText({ phase: "reading", done: 5, total: 15 })).toBe("Reading Notes… 5/15");
  expect(progressText({ phase: "writing", done: 12, total: 53 })).toBe("Writing… 12/53");
});

test("an import Jot may not make says where to allow it", () => {
  // A stand-in's error reaches the app without its `code`, so the denied report is checked here, not on screen.
  const denied = importFailure({ name: "Error", message: "Jot is not allowed to control Notes", code: "ERR_JOT_NOT_AUTHORIZED" });
  expect(denied.denied).toBe(true);
  expect(denied.failed).toBe(true);
  expect(importFailure(new Error("disk full")).denied).toBe(false);
  // Notes too slow to answer: said in words of its own.
  const late = importFailure({ name: "Error", message: "Apple Notes did not give its notes within 10 minutes", code: "ERR_JOT_TIMED_OUT" });
  expect(late).toEqual({
    text: "Notes took longer than 10 minutes to answer, so the import stopped and nothing was imported. Open Notes, check it isn’t waiting on you, then import again.",
    failed: true,
    denied: false,
  });
  expect(AUTOMATION_URL).toBe("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation");
});

test("an import that fails says why; without Apple Notes there is none", async () => {
  const app = await openJot(folder("import-failed"), {}, {
    "AppleNotes.import": async () => {
      throw new Error("cannot read Apple Notes: Notes got an error");
    },
  });
  await openSettings(app);
  await app.press("id:settings-import-apple-notes");
  await app.waitFor("id:settings-import-report");
  expect(app.texts()).toContain("没能从「备忘录」导入：cannot read Apple Notes: Notes got an error");
  expect(app.shows("id:settings-import-allow")).toBe(false);
  app.dispose();

  const other = await openJot(folder("import-none"), {}, { "AppleNotes.available": false });
  await openSettings(other);
  expect(other.shows("id:settings-import")).toBe(false);
  expect(other.texts()).not.toContain("导入");
  other.dispose();
});
