// Updates, headless: `nsh/updater` and the app's native fingerprint stood in for, so each test plays a release.
// A package published for this app's native code downloads and offers a restart into it; one for other native code
// is left for the whole app, which downloads, waits to install on quit and offers a restart too. A copy that does
// not update itself (`nsh run`) checks nothing, and a failed check only says so on the About page.
import { expect, open, test } from "nsh/test";
import { packageFingerprint, packageFits, plainVersion, sameAsReady } from "../updates";
import { STAND_INS } from "./native";

const NATIVE = "0123456789abcdef";
const OTHER = "fedcba9876543210";

/** A fresh, empty notes folder. */
const folder = (name: string) => `/tmp/jot-updates-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** A packaged Jot 0.1.0 (build 1) that takes packages, running the code it shipped with. */
const SHELL = { version: "0.1.0", build: 1, nshVersion: "0.7.0", packages: true };

/** What the updater was asked, in order. */
type Calls = string[];

/** The updater of a release: `pkg` and `app` are what its manifest offers this copy (null: nothing). */
function updater(calls: Calls, release: { pkg?: object | null; app?: object | null; shell?: object; fail?: boolean }) {
  return {
    shellInfo: release.shell ?? SHELL,
    runningPackage: null,
    checkForPackage: async () => {
      calls.push("checkForPackage");
      if (release.fail) throw new Error("offline");
      return release.pkg ?? null;
    },
    downloadPackage: async () => void calls.push("downloadPackage"),
    restartToPackage: async () => void calls.push("restartToPackage"),
    checkForUpdate: async () => {
      calls.push("checkForUpdate");
      return release.app ?? null;
    },
    downloadUpdate: async () => void calls.push("downloadUpdate"),
    installOnQuit: async () => void calls.push("installOnQuit"),
    installAndRestart: async () => void calls.push("installAndRestart"),
  };
}

/** Opens Jot on a new folder (its first run shows the panel) with the updater `fake` and this app's fingerprint `native`. */
const openJot = (name: string, fake: ReturnType<typeof updater>, native = NATIVE) =>
  open("../App.tsx", {
    platform: "macos",
    width: 1200,
    height: 800,
    reducedMotion: true,
    locale: "zh-CN",
    storage: { "jot.dir": folder(name) },
    modules: {
      "nsh/updater": fake,
      "jot/native": {
        ...STAND_INS,
        "Folder.icloud": { path: "/tmp/jot-updates-no-icloud/Jot", available: false },
        "NativeBuild.fingerprint": native,
      },
    },
  });

type App = Awaited<ReturnType<typeof openJot>>;

async function openAbout(app: App) {
  await app.waitFor("id:search");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:settings");
  await app.press("id:settings-tab:about");
  await app.waitFor("id:settings-pane:about");
}

test("a package's native fingerprint is in its version's build metadata", () => {
  expect(packageFingerprint(`0.2.0+native.${NATIVE}`)).toBe(NATIVE);
  expect(packageFingerprint(`1.0.0-beta.1+ci.7.native.${NATIVE}`)).toBe(NATIVE);
  expect(packageFingerprint("0.2.0")).toBeNull();
  expect(packageFingerprint("0.2.0+native")).toBeNull();
  expect(packageFingerprint("0.2.0+native.")).toBeNull();
  expect(plainVersion(`0.2.0+native.${NATIVE}`)).toBe("0.2.0");
  expect(plainVersion("0.2.0")).toBe("0.2.0");
});

test("a package fits only the native code it was published for, never a development build", () => {
  expect(packageFits(`0.2.0+native.${NATIVE}`, NATIVE)).toBe(true);
  expect(packageFits(`0.2.0+native.${OTHER}`, NATIVE)).toBe(false);
  // A release from before fingerprints, or published by hand without one.
  expect(packageFits("0.2.0", NATIVE)).toBe(false);
  expect(packageFits("0.2.0+native.dev", "dev")).toBe(false);
});

test("what already waits is not downloaded again; a newer build or version is", () => {
  const pkg = { kind: "package", version: "0.2.0", build: 5 } as const;
  const app = { kind: "app", version: "0.2.0" } as const;
  expect(sameAsReady(null, pkg)).toBe(false);
  expect(sameAsReady(pkg, { ...pkg })).toBe(true);
  expect(sameAsReady(pkg, { ...pkg, build: 6 })).toBe(false);
  expect(sameAsReady(app, { ...app })).toBe(true);
  expect(sameAsReady(app, { kind: "app", version: "0.3.0" })).toBe(false);
  expect(sameAsReady(pkg, app)).toBe(false);
});

test("a package for this app's native code downloads, and the footer offers the restart into it", async () => {
  const calls: Calls = [];
  const app = await openJot("package", updater(calls, { pkg: { version: `0.2.0+native.${NATIVE}`, build: 2, notes: null, size: 1000 } }));
  await app.waitFor("id:footer-update");
  expect(calls).toEqual(["checkForPackage", "downloadPackage"]);
  expect(app.texts()).toContain("新版本已就绪 · 重启");

  // About says what waits, without the fingerprint, and restarts too.
  await openAbout(app);
  expect(app.texts()).toContain("Jot 0.2.0 已下载：重启 Jot 即可使用，下次打开时也会用上。");
  await app.press("id:settings-update-restart");
  await app.waitUntil(() => calls.includes("restartToPackage"));
  expect(calls).not.toContain("checkForUpdate");
  app.dispose();
});

test("a package for other native code is left: the whole app downloads, installs on quit, and the footer restarts into it", async () => {
  const calls: Calls = [];
  const app = await openJot(
    "app",
    updater(calls, {
      pkg: { version: `0.2.0+native.${OTHER}`, build: 2, notes: null, size: 1000 },
      app: { version: "0.2.0", notes: null, url: "https://github.com/madcodelife/jot/releases/download/v0.2.0/Jot-0.2.0-macos-aarch64.tar.gz", canInstall: true, shell: false },
    }),
  );
  await app.waitFor("id:footer-update");
  expect(calls).toEqual(["checkForPackage", "checkForUpdate", "downloadUpdate", "installOnQuit"]);

  await app.press("id:footer-update");
  await app.waitUntil(() => calls.includes("installAndRestart"));
  expect(calls).not.toContain("downloadPackage");
  expect(calls).not.toContain("restartToPackage");
  app.dispose();
});

test("an update the running package already brought (`shell`) is not downloaded", async () => {
  const calls: Calls = [];
  const app = await openJot(
    "shell",
    updater(calls, { app: { version: "0.2.0", notes: null, url: "https://example.com/jot.tar.gz", canInstall: true, shell: true } }),
  );
  await openAbout(app);
  await app.waitFor("text:Jot 已是最新版本。");
  expect(calls).toEqual(["checkForPackage", "checkForUpdate"]);
  expect(app.shows("id:footer-update")).toBe(false);
  app.dispose();
});

test("a copy that cannot replace itself offers the download page in About", async () => {
  const calls: Calls = [];
  const url = "https://github.com/madcodelife/jot/releases/download/v0.2.0/Jot-0.2.0-macos-aarch64.tar.gz";
  const app = await openJot("manual", updater(calls, { app: { version: "0.2.0", notes: null, url, canInstall: false, shell: false } }));
  await openAbout(app);
  await app.waitFor("id:settings-update-download");
  expect(calls).not.toContain("downloadUpdate");
  await app.press("id:settings-update-download");
  expect(app.openedUrls()).toEqual([url]);
  app.dispose();
});

test("a failed check is only told on the About page, and checking again there tries again", async () => {
  const calls: Calls = [];
  const app = await openJot("failed", updater(calls, { fail: true }));
  await openAbout(app);
  await app.waitFor("text:暂时无法检查更新，Jot 稍后会再试。");
  expect(app.shows("id:footer-update")).toBe(false);
  expect(app.shows("id:notice")).toBe(false);

  await app.press("id:settings-update-check");
  await app.waitUntil(() => calls.filter((c) => c === "checkForPackage").length === 2);
  app.dispose();
});

test("a development run checks nothing, and About says it does not update itself", async () => {
  const calls: Calls = [];
  const app = await openJot("dev", updater(calls, { shell: { version: null, build: null, nshVersion: "0.7.0", packages: false } }), "dev");
  await openAbout(app);
  expect(app.texts()).toContain("这个 Jot 是开发版本，不会自动更新。");
  await expect(app.press("id:settings-update-check")).rejects.toMatchObject({ code: "ERR_NSH_TEST_DISABLED" });
  expect(calls).toEqual([]);
  app.dispose();
});
