// Jot: notes you summon with a double press of ⌥ (or the tray), search or
// start by typing, and to-dos inside them that remind you on time. Claude
// writes to the same folder (through `jot-mcp`); the island shows it.
//
// The main window stays hidden (nsh.json `window.defaultVisible`): the app
// lives in the menu bar, and its UI is the panel's popup window, the
// settings window and, on macOS, the island's overlay.
import { effect, mount, Notifications, platform, untracked } from "nsh";
import { t } from "nsh/i18n";
import { GlobalShortcut, Tray } from "nsh/desktop";
import { Summon, type DueEvent } from "jot/native";
import { tn, todoKeyword } from "./app/i18n";
import { islandOn, loadSettings, notificationsOn } from "./app/settings";
import {
  allNotes,
  clampSelection,
  firstRun,
  notice,
  now,
  onClaudeNote,
  open,
  openFolder,
  startReminders,
  summon,
  toggle,
  trusted,
} from "./app/store";
import { IslandWindow, showClaudeWrite, showReminder } from "./ui/Island";
import { PanelWindow } from "./ui/Panel";
import { openSettings, SettingsWindow } from "./ui/Settings";
import { T } from "./ui/tokens";
import trayIcon from "./ui/tray.svg";

/** The island lives at the notch or under the menu bar: macOS's. */
const hasIsland = platform.os === "macos";

/** Listens to the double press; again after the user grants the permission, so the system's monitor takes it. */
function listenToDoubleTap() {
  Summon.onDoubleTap(T.keys.doubleTap, toggle);
}

/** Without the permission, the fallback shortcut summons Jot; it goes once the double press works. */
async function useFallbackShortcut() {
  const ok = await GlobalShortcut.register(T.keys.fallbackShortcut, toggle);
  if (!ok) notice.set(t("notify.shortcut_taken", { keys: T.keys.fallback }));
}

/** To-dos came due: a notification each (one for several missed while the Mac slept), and the island, as the settings allow. */
function remind(event: DueEvent) {
  const notify = untracked(notificationsOn);
  const island = hasIsland && untracked(islandOn);
  if (event.missed && event.todos.length > 1) {
    if (notify) {
      void Notifications.show({
        id: "missed",
        title: tn("notify.missed", event.todos.length),
        body: event.todos.map((todo) => todo.text).join(t("notify.list_separator")),
      });
    }
    return;
  }
  for (const todo of event.todos) {
    if (notify) void Notifications.show({ id: `todo:${todo.note}:${todo.line}`, title: todo.text, body: todo.note });
    if (island && !event.missed) showReminder(todo);
  }
}

function App() {
  // The settings first (language, theme), then the notes folder, its reminders, and the first run's welcome.
  void (async () => {
    await loadSettings();
    await openFolder();
    startReminders(remind);
    if (await firstRun()) summon();
  })();

  // Pressing a reminder's notification opens the to-do view.
  Notifications.on("press", () => summon({ query: todoKeyword() }));

  // The summon keys.
  listenToDoubleTap();
  if (!untracked(trusted)) void useFallbackShortcut();
  // The permission comes from System Settings while Jot runs: look again now and then until it does.
  const trustPoll = setInterval(() => {
    if (untracked(trusted) || !Summon.isTrusted()) return;
    trusted.set(true);
    listenToDoubleTap();
    GlobalShortcut.unregister(T.keys.fallbackShortcut);
    clearInterval(trustPoll);
  }, 3000);
  if (untracked(trusted)) clearInterval(trustPoll);

  // Notes Claude writes: the island says so, while the settings keep it on.
  if (hasIsland) {
    onClaudeNote((title) => {
      if (untracked(islandOn)) showClaudeWrite(title);
    });
  }

  // Relative times and due groups follow the clock.
  setInterval(() => now.set(Date.now()), 30_000);
  effect(() => clampSelection());

  // The tray: new note, summon, the latest notes, the to-dos, the permission while it is missing, settings, quit.
  // It reads `t`, so the menu is made again in the new language when the language changes.
  effect(() => {
    const recent = allNotes().slice(0, 3);
    Tray.set({
      icon: trayIcon,
      tooltip: "Jot",
      onClick: () => toggle(),
      menu: [
        { label: t("tray.new_note"), onSelect: () => summon() },
        { label: t("tray.summon", { keys: trusted() ? T.keys.summon : T.keys.fallback }), onSelect: () => summon() },
        { type: "separator" },
        ...recent.map((meta) => ({
          label: meta.title,
          onSelect: () => {
            summon();
            open(meta.title);
          },
        })),
        recent.length > 0 && { type: "separator" as const },
        { label: t("tray.todos"), onSelect: () => summon({ query: todoKeyword() }) },
        !trusted() && { label: t("tray.enable_double_tap", { keys: T.keys.summon }), onSelect: () => Summon.requestTrust() },
        { type: "separator" },
        { label: t("tray.settings"), shortcut: "mod+,", onSelect: () => openSettings() },
        { role: "quit" },
      ],
    });
  });

  return (
    <>
      <PanelWindow />
      <SettingsWindow />
      <If when={hasIsland}>
        <IslandWindow />
      </If>
    </>
  );
}

mount(App);
