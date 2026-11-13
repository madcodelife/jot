// Jot: notes you summon with a double press of ⌥ (or the tray), search or
// start by typing, and to-dos inside them that remind you on time. Claude
// writes to the same folder (through `jot-mcp`); the island shows it.
//
// The main window stays hidden (nsh.json `window.defaultVisible`): the app
// lives in the menu bar, and its UI is the panel's popup window and, on
// macOS, the island's overlay.
import { effect, mount, Notifications, platform, untracked } from "nsh";
import { GlobalShortcut, Tray } from "nsh/desktop";
import { Reminders, Summon, type DueEvent } from "jot/native";
import {
  allNotes,
  clampSelection,
  errorMessage,
  firstRun,
  folderError,
  notice,
  now,
  onClaudeNote,
  open,
  openFolder,
  summon,
  toggle,
  trusted,
} from "./app/store";
import { IslandWindow, showClaudeWrite, showReminder } from "./ui/Island";
import { PanelWindow } from "./ui/Panel";
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
  if (!ok) notice.set(`${T.keys.fallback} 已被别的 App 占用，从菜单栏的 Jot 呼出`);
}

/** To-dos came due: a notification each (one for several missed while the Mac slept), and the island. */
function remind(event: DueEvent) {
  if (event.missed && event.todos.length > 1) {
    void Notifications.show({ id: "missed", title: `错过了 ${event.todos.length} 个提醒`, body: event.todos.map((t) => t.text).join("、") });
    return;
  }
  for (const todo of event.todos) {
    void Notifications.show({ id: `todo:${todo.note}:${todo.line}`, title: todo.text, body: todo.note });
    if (hasIsland && !event.missed) showReminder(todo);
  }
}

function App() {
  // The notes folder, its reminders, and the first run's welcome.
  void (async () => {
    const folder = await openFolder();
    if (folder) {
      try {
        new Reminders(folder).start(remind);
      } catch (error) {
        folderError.set(`提醒没能开始：${errorMessage(error)}`);
      }
    }
    if (await firstRun()) summon();
  })();

  // Pressing a reminder's notification opens the to-do view.
  Notifications.on("press", () => summon({ query: "待办" }));

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

  // Notes Claude writes: the island says so.
  if (hasIsland) onClaudeNote(showClaudeWrite);

  // Relative times and due groups follow the clock.
  setInterval(() => now.set(Date.now()), 30_000);
  effect(() => clampSelection());

  // The tray: new note, summon, the latest notes, the to-dos, the permission while it is missing, quit.
  effect(() => {
    const recent = allNotes().slice(0, 3);
    Tray.set({
      icon: trayIcon,
      tooltip: "Jot",
      onClick: () => toggle(),
      menu: [
        { label: "新建笔记", onSelect: () => summon() },
        { label: `呼出 Jot（${trusted() ? T.keys.summon : T.keys.fallback}）`, onSelect: () => summon() },
        { type: "separator" },
        ...recent.map((meta) => ({
          label: meta.title,
          onSelect: () => {
            summon();
            open(meta.title);
          },
        })),
        recent.length > 0 && { type: "separator" as const },
        { label: "待办", onSelect: () => summon({ query: "待办" }) },
        !trusted() && { label: `开启连按两下 ${T.keys.summon}…`, onSelect: () => Summon.requestTrust() },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  });

  return (
    <>
      <PanelWindow />
      <If when={hasIsland}>
        <IslandWindow />
      </If>
    </>
  );
}

mount(App);
