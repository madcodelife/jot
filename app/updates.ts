// Jot's updates, in the background: a newer release's code alone (an OTA package) when it fits this installed app,
// else the whole app. Either downloads quietly and waits; the panel's footer, the tray's menu and the settings' About
// page then offer to restart into it, and quitting Jot installs it all the same. Nothing here interrupts the user:
// a failed check or download is logged, and the next one tries again.
//
// A package carries the TSX, never the Rust: a release published for other native code (`NativeBuild`, its version's
// `+native.<fingerprint>`) would call what this app does not have, so it comes as the whole app instead.
// docs/app.md (Updates) has the rules; the release side is in CONTRIBUTING.md (Releasing).
import { appInfo, signal, untracked } from "nsh";
import {
  checkForPackage,
  checkForUpdate,
  downloadPackage,
  downloadUpdate,
  installAndRestart,
  installOnQuit,
  restartToPackage,
  runningPackage,
  shellInfo,
} from "nsh/updater";
import { NativeBuild } from "jot/native";

/** How long after a check a running Jot looks again: Jot is never quit, so this is how late a release reaches it. */
export const CHECK_EVERY = 60 * 60 * 1000;

/** How soon a failed check is tried again: sooner than `CHECK_EVERY`, as it is often only a moment offline. */
export const RETRY_AFTER = 15 * 60 * 1000;

/** Showing the panel checks when the last check is older than this, so a release is usually ready by the next show. */
export const CHECK_ON_SHOW = 15 * 60 * 1000;

/**
 * How often the background looks at the clock. Timers do not run while the Mac sleeps, so a check due during the
 * night comes within this of waking, not a whole `CHECK_EVERY` later.
 */
export const TICK = 5 * 60 * 1000;

/** The fingerprint of a build that has none (`nsh run`): it fits no package. */
export const DEV_FINGERPRINT = "dev";

/** What the last check did, for the About page. "unavailable": this copy does not update itself (a development run). */
export type UpdatePhase = "unavailable" | "idle" | "checking" | "downloading" | "current" | "failed";

/** A newer Jot, downloaded and waiting for a restart: its code alone (a package) or the whole app. */
export type ReadyUpdate = { kind: "package"; version: string; build: number } | { kind: "app"; version: string };

export const updatePhase = signal<UpdatePhase>("idle");
/** The version being downloaded, while `updatePhase` is "downloading". */
export const downloading = signal<string | null>(null);
export const readyUpdate = signal<ReadyUpdate | null>(null);
/** A newer Jot this copy cannot install itself (it sits where the user cannot write): where to get it. */
export const manualUpdate = signal<{ version: string; url: string } | null>(null);

// ——— The rules, pure ———

/** A version's semver build metadata (`1.2.0+native.0123456789abcdef` → `["native", "0123456789abcdef"]`). */
function metadata(version: string): string[] {
  const plus = version.indexOf("+");
  return plus < 0 ? [] : version.slice(plus + 1).split(".");
}

/** The native fingerprint a package was published for, from its version (`+native.<fingerprint>`), or null. */
export function packageFingerprint(version: string): string | null {
  const ids = metadata(version);
  const at = ids.indexOf("native");
  return at >= 0 && at + 1 < ids.length && ids[at + 1] ? ids[at + 1] : null;
}

/** The version as the user reads it: without its build metadata. */
export const plainVersion = (version: string) => version.split("+")[0];

/** Whether a package of `version` runs on native code `native`: published for the same, and this a release build. */
export function packageFits(version: string, native: string): boolean {
  return native !== DEV_FINGERPRINT && packageFingerprint(version) === native;
}

/** Whether a check found what already waits, so it is not downloaded again. */
export function sameAsReady(ready: ReadyUpdate | null, found: ReadyUpdate): boolean {
  if (!ready || ready.kind !== found.kind) return false;
  return ready.kind === "package" && found.kind === "package" ? ready.build === found.build : ready.version === found.version;
}

/** The version and build of the code that runs: a package's when Jot runs one, else the installed app's. */
export function runningVersion(): { version: string; build: number } {
  const running = runningPackage();
  if (running) return { version: plainVersion(running.version), build: running.build };
  const shell = shellInfo();
  const info = appInfo();
  return { version: plainVersion(shell.version ?? info.version ?? "0.1.0"), build: shell.build ?? info.build ?? 1 };
}

/**
 * Whether another check is due: none yet (`last` null), or the last one started `after` ago or more. A clock set back
 * past the last check makes one due too, rather than none until the clock catches up.
 */
export function checkDue(last: number | null, now: number, after: number): boolean {
  return last === null || now - last >= after || now < last;
}

/** Whether this copy updates itself: a packaged Jot with an update source (not `nsh run`). */
export const updatesAvailable = () => shellInfo().version != null;

// ——— Checking ———

/** This app's native fingerprint; "dev" when it cannot say. */
function nativeFingerprint(): string {
  try {
    return NativeBuild.fingerprint();
  } catch {
    return DEV_FINGERPRINT;
  }
}

let busy = false;
/** When the last check started (`Date.now()`), or null before the first. */
let lastCheck: number | null = null;

/**
 * Looks for a newer Jot and downloads it: a package when one fits this app's native code, else the whole app, which
 * then installs as Jot quits (or at once from `restartToUpdate`). A check while one runs does nothing; a failure is
 * logged, and the next check tries again.
 */
export async function checkForUpdates(): Promise<void> {
  if (busy) return;
  if (!updatesAvailable()) {
    updatePhase.set("unavailable");
    return;
  }
  busy = true;
  lastCheck = Date.now();
  updatePhase.set("checking");
  try {
    const native = nativeFingerprint();
    const found = await checkForPackage();
    if (found && packageFits(found.version, native)) {
      const ready: ReadyUpdate = { kind: "package", version: plainVersion(found.version), build: found.build };
      if (!sameAsReady(untracked(readyUpdate), ready)) {
        downloading.set(ready.version);
        updatePhase.set("downloading");
        await downloadPackage();
        readyUpdate.set(ready);
      }
      updatePhase.set("current");
      return;
    }
    if (found) {
      console.info(
        `updates: package ${found.version} (build ${found.build}) is for native ${packageFingerprint(found.version) ?? "unknown"}, this app is ${native}: the whole app updates instead`,
      );
    }

    const update = await checkForUpdate();
    // `shell`: the code that runs is already this release's (a package that fit, so the same native code): nothing
    // new to install.
    if (update && !update.shell) {
      if (!update.canInstall) {
        manualUpdate.set({ version: plainVersion(update.version), url: update.url });
      } else {
        const ready: ReadyUpdate = { kind: "app", version: plainVersion(update.version) };
        if (!sameAsReady(untracked(readyUpdate), ready)) {
          downloading.set(ready.version);
          updatePhase.set("downloading");
          await downloadUpdate();
          // Installed when Jot quits, whatever happens to the restart offered meanwhile.
          await installOnQuit();
          readyUpdate.set(ready);
        }
      }
    }
    updatePhase.set("current");
  } catch (error) {
    console.warn("updates: the check failed; the next one tries again:", error);
    updatePhase.set("failed");
  } finally {
    downloading.set(null);
    busy = false;
  }
}

/** Restarts Jot into what waits: the package's code, or the new app. A failure is logged and Jot keeps running. */
export async function restartToUpdate(): Promise<void> {
  const ready = untracked(readyUpdate);
  if (!ready || busy) return;
  try {
    if (ready.kind === "package") await restartToPackage();
    else await installAndRestart();
  } catch (error) {
    console.warn("updates: the restart into the update failed:", error);
    readyUpdate.set(null);
    updatePhase.set("failed");
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Checks when one is due: `CHECK_EVERY` after the last, or `RETRY_AFTER` when it failed. */
function checkWhenDue() {
  const after = untracked(updatePhase) === "failed" ? RETRY_AFTER : CHECK_EVERY;
  if (checkDue(lastCheck, Date.now(), after)) void checkForUpdates();
}

/**
 * Checks now, then whenever one is due while Jot runs, looking every `TICK`. A copy that does not update itself never
 * checks.
 */
export function startUpdates() {
  if (!updatesAvailable()) {
    updatePhase.set("unavailable");
    return;
  }
  void checkForUpdates();
  clearInterval(timer);
  timer = setInterval(checkWhenDue, TICK);
}

/**
 * The panel shows: checks when the last check is older than `CHECK_ON_SHOW`, so what the user opens Jot for next time
 * is usually downloaded by then. Nothing before `startUpdates` (Jot still starting) or in a copy that does not update
 * itself.
 */
export function checkOnShow() {
  if (timer === undefined) return;
  if (checkDue(lastCheck, Date.now(), CHECK_ON_SHOW)) void checkForUpdates();
}
