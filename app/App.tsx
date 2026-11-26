// Jot: notes you summon with a double press of ⌥ (or the tray), search or
// start by typing, and to-dos inside them that remind you on time. Claude
// writes to the same folder (through `jot-mcp`); the island shows it.
//
// The main window stays hidden (nsh.json `window.defaultVisible`): the app
// lives in the menu bar, and its UI is the panel's popup window, the
// settings window and, on macOS, the island's overlay.
//
// Dictation: ⌥ held in the panel (or its microphones) types into the field
// or the open note (app/ui/Panel.tsx, app/ui/Paper.tsx); the double press
// of ⌥ held anywhere says a quick note, which the island shows and files
// (below).
import { computed, effect, mount, Notifications, platform, untracked } from "nsh";
import { t } from "nsh/i18n";
import { GlobalShortcut, Tray } from "nsh/desktop";
import { Summon, type DueEvent } from "jot/native";
import { tn, todoKeyword } from "./i18n";
import { holdToTalk, islandOn, loadSettings, notificationsOn, whenOptions } from "./settings";
import { fileQuickNote } from "./quicknote";
import { cancelVoice, detectSpeech, listening, speechAvailable, startVoice, stopVoice, type VoiceSink } from "./voice";
import {
  allNotes,
  clampSelection,
  firstRun,
  notice,
  now,
  onAgentNote,
  notes,
  open,
  openFolder,
  refresh,
  stage,
  startReminders,
  summon,
  toggle,
  trusted,
} from "./store";
import { dismissDictation, IslandWindow, settleDictation, showAgentWrite, showDictation, showReminder, updateDictation } from "./ui/Island";
import { PanelWindow } from "./ui/Panel";
import { openSettings, SettingsWindow } from "./ui/Settings";
import { T } from "./ui/tokens";
import { trayInk, writeTrayIcon } from "./trayink";
import { readyUpdate, restartToUpdate, startUpdates } from "./updates";

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

/** Files a quick note's words (a to-do when they say a time, else the inbox) and has the island say where. */
function fileQuick(text: string) {
  const n = untracked(notes);
  if (!text.trim()) return settleDictation({ phase: "failed", error: "empty" });
  if (!n) return settleDictation({ phase: "failed", error: "failed" });
  try {
    const filed = fileQuickNote(n, text, { inbox: t("voice.inbox"), when: whenOptions(), now: new Date(untracked(now)) });
    refresh();
    settleDictation(
      filed.kind === "todo"
        ? { phase: "filed", text: filed.text, where: "todo", label: filed.label }
        : { phase: "filed", text: filed.text, where: "inbox", note: filed.note },
    );
  } catch {
    settleDictation({ phase: "failed", error: "failed" });
  }
}

/** The quick note's session: the words go to the island as they come, and are filed when it ends. */
const quickSink: VoiceSink = {
  update: (text) => updateDictation(text),
  finish: fileQuick,
  // Words heard before a failure are kept; with none, the island says what went wrong.
  fail: (error, text) => (text.trim() ? fileQuick(text) : settleDictation({ phase: "failed", error })),
  cancel: () => dismissDictation(),
};

/** The double press of ⌥ held, anywhere: a quick note. With the panel showing, its own ⌥ hold dictates into it instead. */
function startQuickNote() {
  if (!untracked(holdToTalk) || !untracked(speechAvailable) || untracked(listening)) return;
  if (untracked(stage) !== "hidden") return;
  showDictation();
  if (!startVoice("quick", quickSink, { byHold: true }) && !untracked(listening)) settleDictation({ phase: "failed", error: "failed" });
}

/** ⌥ let go: the note is filed. Another key pressed while it was held made it a shortcut: the words are dropped. */
function endQuickNote(event: { cancelled: boolean }) {
  if (untracked(listening) !== "quick") return;
  if (event.cancelled) cancelVoice("quick");
  else stopVoice();
}

function App() {
  // The settings first (language, theme), then the notes folder, its reminders, and the first run's welcome.
  void (async () => {
    await loadSettings();
    await openFolder();
    await detectSpeech();
    // The quick note needs the island to show it (macOS) and the platform to recognize speech.
    if (hasIsland && untracked(speechAvailable)) {
      Summon.onDoubleTapHold(T.keys.doubleTap, { start: startQuickNote, end: endQuickNote });
    }
    startReminders(remind);
    if (await firstRun()) summon();
    // Updates download in the background once Jot is up, and again every few hours (app/updates.ts).
    startUpdates();
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
    onAgentNote((title, agent) => {
      if (untracked(islandOn)) showAgentWrite(title, agent);
    });
  }

  // Relative times and due groups follow the clock.
  setInterval(() => now.set(Date.now()), 30_000);
  effect(() => clampSelection());

  // The tray's menu: new note, summon, the latest notes, the to-dos, the permission while it is missing, an update
  // that waits for a restart, settings, quit.
  // It reads `t`, so the menu is made again in the new language when the language changes.
  const trayMenu = computed(() => {
    const recent = allNotes().slice(0, 3);
    return [
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
      readyUpdate() && { label: t("tray.restart_to_update", { version: readyUpdate()!.version }), onSelect: () => void restartToUpdate() },
      { label: t("tray.settings"), shortcut: "mod+,", onSelect: () => openSettings() },
      { role: "quit" as const },
    ];
  });
  // The tray: a click summons or hides Jot and writes the icon's stroke again (app/trayink.ts).
  effect(() => {
    Tray.set({
      icon: trayInk(),
      tooltip: "Jot",
      onClick: () => {
        writeTrayIcon();
        toggle();
      },
      menu: trayMenu(),
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
