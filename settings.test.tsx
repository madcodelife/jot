// The settings window, headless: ⌘, from the panel opens it, and what it
// changes shows at once (the appearance, the theme, the language) and is kept
// in the app's storage (`jot.*`). Opened in Simplified Chinese with a 24-hour
// clock, Jot's reference copy.
import { expect, open, test } from "nsh/test";

/** A fresh, empty notes folder. */
const folder = (name: string) => `/tmp/jot-settings-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

/** The color of the settings window's title, which reads `title` (the pane's name). */
const color = (app: App, title: string) => app.spanStyle(`id:settings-title >> text:${title}`)?.color;

test("⌘, in the panel opens the settings window on General", async () => {
  const app = await openJot(folder("open"));
  await openSettings(app);
  expect(app.window("settings").state()).toMatchObject({ visible: true, focused: true });
  expect(app.shows("id:settings-pane:general")).toBe(true);
  expect(app.texts()).toContain("通用");
  // The double press stands in as granted, so General says it is on.
  expect(app.shows("id:settings-summon-on")).toBe(true);
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

test("a theme card recolors the windows at once, and is kept", async () => {
  const app = await openJot(folder("theme"));
  await openSettings(app, "appearance");
  const graphite = color(app, "外观");

  await app.press("id:theme:paper");
  await app.waitUntil(() => color(app, "外观") !== graphite);
  expect(app.storage()["jot.theme"]).toBe("paper");

  // Back to the default: the theme's tokens go, the base ones return.
  await app.press("id:theme:default");
  await app.waitUntil(() => color(app, "外观") === graphite);
  expect(app.storage()["jot.theme"]).toBe("default");
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

test("Change… opens the chosen folder and keeps it", async () => {
  const other = folder("other");
  const app = await openJot(folder("change"), {}, { "Folder.choose": async () => other });
  await openSettings(app);

  await app.press("id:settings-change-folder");
  await app.waitUntil(() => app.storage()["jot.dir"] === other);
  await app.waitUntil(() => (app.texts().find((s) => s.startsWith("/tmp/jot-settings-other")) ?? "") !== "");
  app.dispose();
});
