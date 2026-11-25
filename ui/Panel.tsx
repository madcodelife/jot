// The floating panel: a popup window that shows over everything, on every
// desktop, below the top of the screen. It is one glass surface that morphs
// between the summoned capsule (the field alone), the list under it, the
// to-do view, and a note open beside the list, each change a spring.
// Holding ⌥ (or the field's microphone) dictates into the field, or into
// the open note when it has the focus.
import { Animated, computed, createAnimatedValue, effect, keymap, reduceMotion, signal, Text, token, untracked, View, type AnimatedValue, type InputRef } from "nsh";
import { Input } from "nsh/base";
import { t } from "nsh/i18n";
import { displays, Window, type Display, type WindowRef } from "nsh/desktop";
import {
  activate,
  allNotes,
  allTodos,
  back,
  checkSelected,
  createFromQuery,
  dismiss,
  focusRequest,
  folderError,
  folderShown,
  move,
  notice,
  query,
  rows,
  setQuery,
  stage,
  todoItems,
  todoMode,
  trashCountdown,
  trashed,
  flash,
  renaming,
  undoTrash,
  binName,
} from "../app/store";
import { actionShortcuts, actionsReturn, actionsTarget, filteredActions, primaryAction, runShortcut, toggleActions, type Action } from "../app/actions";
import { ActionPanel, actionsHeight } from "./ActionPanel";
import { DuePicker } from "./DuePicker";
import { duePicker } from "../app/due";
import { Icon } from "./icons";
import { fadeTo, springConfig } from "./motion";
import { NoteList } from "./NoteList";
import { dictateIntoNote, Paper, toggleTaskAtCaret } from "./Paper";
import { HintDivider, KeyHint, Keycaps } from "./parts";
import { PushButton } from "./controls";
import {
  cancelVoice,
  fieldSink,
  forgetHold,
  holdKeyDown,
  holdKeyUp,
  listening,
  listeningByHold,
  listeningLang,
  speechAvailable,
  startVoice,
  switchVoiceLanguage,
  toggleVoice,
} from "../app/voice";
import { Breathing, LanguageTag, MicButton } from "./Voice";
import { openSettings } from "./Settings";
import { fade } from "./themes";
import { tn } from "../app/i18n";
import { keyCaps, T, materialFill, materialStyle } from "./tokens";
import { TodoView, todoViewHeight } from "./TodoView";

/** The window: as large as the panel grows (a note open), with room for its shadow. */
const WINDOW = { width: T.size.editorWidth + T.size.windowMargin * 2, height: T.size.editorHeight + T.size.windowMargin * 2 };

/** Where the panel's window goes: centered on the primary display, its top a sixth of the way down. */
function placement(list: readonly Display[]) {
  const display = list.find((d) => d.primary) ?? list[0];
  if (!display) return null;
  const { origin, size } = display.bounds;
  return {
    x: Math.round(origin.x + (size.width - WINDOW.width) / 2),
    y: Math.round(origin.y + size.height * T.size.panelTop - T.size.windowMargin),
  };
}

/** How tall the panel is in each stage (the list grows with its rows; filtering does not animate). */
const emptyHeight = 150;
let shownSize = { width: T.size.panelWidth, height: T.size.field };
const panelSize = computed(() => {
  const s = stage();
  // Hiding keeps the size it had: the panel fades out as it was, never snapping to another shape on the way.
  if (s === "hidden") return shownSize;
  shownSize = visibleSize(s);
  return shownSize;
});
function visibleSize(s: Exclude<ReturnType<typeof stage>, "hidden">) {
  if (s === "editor") return { width: T.size.editorWidth, height: T.size.editorHeight };
  if (s === "capsule") return { width: T.size.panelWidth, height: T.size.field };
  const body = todoMode()
    ? todoViewHeight(todoItems())
    : rows().length
      ? T.size.listTop + rows().length * T.size.row
      : emptyHeight;
  return { width: T.size.panelWidth, height: T.size.field + body + T.size.footer };
}

/**
 * The action panel's place in the window: at the panel's bottom right, above the footer (Raycast's). Its top
 * keeps clear of the window's edge, so a tall panel over a short list reaches below the list.
 */
function actionsPlace(all: readonly Action[]) {
  const size = panelSize();
  const panelLeft = (WINDOW.width - size.width) / 2;
  const bottom = T.size.windowMargin + size.height - (stage() === "editor" ? T.size.inset : T.size.footer + 6);
  return {
    left: panelLeft + size.width - T.size.actionsWidth - 8,
    top: Math.max(T.size.windowMargin + 8, bottom - actionsHeight(all)),
  };
}

/** The panel's window. It stays open once summoned and shows or hides, so the next summon is instant. */
export function PanelWindow() {
  let win: WindowRef | undefined;
  const everShown = signal(false);
  const opacity = createAnimatedValue(0);
  const lift = createAnimatedValue(0);
  const scale = createAnimatedValue(1);

  // Summoned: the window goes where the user looks, the capsule pops in. Dismissed: it fades, then the window hides.
  effect(() => {
    const showing = stage() !== "hidden";
    untracked(() => {
      if (showing) {
        everShown.set(true);
        // Invisible first, then shown: the window's first frame is never last time's panel.
        opacity.set(0);
        const at = placement(displays());
        if (win) {
          if (at) win.setBounds({ origin: at });
          win.show();
          win.focus();
        }
        if (reduceMotion()) {
          lift.set(0);
          scale.set(1);
          fadeTo(opacity, 1, 160);
        } else {
          lift.set(-16);
          scale.set(0.9);
          Animated.parallel([
            Animated.timing(opacity, { toValue: 1, duration: 160, easing: "easeOut" }),
            Animated.spring(lift, { toValue: 0, ...springConfig(T.spring.summon) }),
            Animated.spring(scale, { toValue: 1, ...springConfig(T.spring.summon) }),
          ]).start();
        }
      } else if (win) {
        // Hidden while dictating into the field or a note: what was said goes with it.
        if (!cancelVoice("field")) cancelVoice("editor");
        forgetHold();
        const closing = win;
        void Animated.timing(opacity, { toValue: 0, duration: 120, easing: "easeIn" })
          .start()
          .then(() => {
            if (untracked(stage) === "hidden") closing.hide();
          });
      }
    });
  });

  return (
    <If when={everShown()}>
      <Window
        id="panel"
        kind="popup"
        title="Jot"
        ref={(r) => {
          const first = !win;
          win = r;
          // The first summon makes the window, after the effect above ran without one: a new window only asks
          // macOS to bring Jot forward, and an accessory app is often turned down, leaving the keyboard in the
          // app in front. Take it, as every later summon does, and put the caret in the field.
          if (first && r && untracked(stage) !== "hidden") {
            r.focus();
            focusRequest.set({ target: "field" });
          }
        }}
        defaultSize={{ width: WINDOW.width, height: WINDOW.height }}
        defaultPosition={placement(untracked(displays)) ?? "center"}
        transparent
        shadow={false}
        // Escape steps back (note → list → hidden) and losing the focus hides the panel,
        // keeping its window: both are the app's, below.
        closeOnEscape={false}
        closeOnBlur={false}
        onFocusChange={({ focused }) => {
          if (focused) return;
          forgetHold();
          // The system's microphone prompt takes the focus the first time: the panel stays for it.
          if (!untracked(listening)) dismiss();
        }}
      >
        <View class="flex-1 items-center" style={{ paddingTop: T.size.windowMargin, backgroundColor: "transparent" }}>
          <Panel opacity={opacity} lift={lift} scale={scale} />
          <If when={actionsTarget()}>
            {(target) => <ActionPanel {...actionsPlace(filteredActions(target(), ""))} returnFocus={actionsReturn()} />}
          </If>
          <DuePicker />
        </View>
      </Window>
    </If>
  );
}

function Panel(props: { opacity: AnimatedValue; lift: AnimatedValue; scale: AnimatedValue }) {
  const editing = () => stage() === "editor";
  const expanded = () => stage() === "list" || stage() === "editor";
  const radius = () => (stage() === "capsule" ? T.radius.capsule : T.radius.panel);
  const fieldFocused = signal(true);

  // Escape: one step back. ⌘↩: tick the caret's task, tick the selected to-do, or make a note of the query.
  keymap.bind(
    {
      // Escape while dictating takes back what was said; otherwise one step back.
      escape: () => {
        if (!cancelVoice("field") && !cancelVoice("editor")) back();
      },
      // ⌘,: the settings, as in every Mac app (the panel hides as the settings window takes the focus).
      "mod+,": () => openSettings(),
      // ⌘K: the row's actions (Raycast's action panel); again, it closes.
      [T.keys.actions]: () => {
        if (untracked(renaming) !== null || untracked(duePicker)) return;
        toggleActions(untracked(stage) === "editor" && !untracked(fieldFocused) ? "editor" : "field");
      },
      "mod+enter": () => {
        if (untracked(stage) === "editor" && !untracked(fieldFocused)) toggleTaskAtCaret();
        else if (untracked(todoMode)) checkSelected();
        else createFromQuery();
      },
    },
    { when: "always" },
  );
  // ⌘L while dictating (into the field or the note): the next language, the words so far kept.
  effect(() => {
    if (!listening()) return;
    const stop = keymap.bind({ "mod+l": () => void switchVoiceLanguage() }, { when: "always" });
    return stop;
  });
  // The actions' own keys, with the action panel closed too. Ctrl+D (Windows, Linux) stays the note text's
  // "select the next occurrence" while the text has the focus; macOS's ⌃X is no text key.
  effect(() => {
    if (renaming() !== null || duePicker()) return;
    const inText = editing() && !fieldFocused();
    const keys = actionShortcuts().filter((k) => !(inText && k === T.keys.trashShortcut && !T.keys.trashInText));
    const stop = keymap.bind(Object.fromEntries(keys.map((k) => [k, () => runShortcut(k)])), { when: "always" });
    return stop;
  });
  // ⌘Z takes the last trashed note back while "Moved to the trash" shows; then it is the field's undo again.
  effect(() => {
    if (!trashed().length || editing() || renaming() !== null) return;
    const stop = keymap.bind(T.keys.undoShortcut, () => undoTrash(), { when: "always" });
    return stop;
  });
  // The arrow keys move the selection, except in the note's text, where they move the caret, a title being
  // renamed, and the action panel's and the reminder time picker's own lists.
  effect(() => {
    if (renaming() !== null || actionsTarget() || duePicker()) return;
    if (editing() && !fieldFocused()) return;
    const stop = keymap.bind({ up: () => move(-1), down: () => move(1) }, { when: "always", repeat: true });
    return stop;
  });

  // Holding ⌥: into the open note when it has the focus, else into the field.
  const beginHold = () =>
    untracked(stage) === "editor" && !untracked(fieldFocused)
      ? dictateIntoNote({ byHold: true })
      : startVoice("field", fieldSink(), { byHold: true });

  return (
    <View
      testID="panel"
      onKeyDown={(e) => holdKeyDown(e, beginHold)}
      onKeyUp={(e) => holdKeyUp(e)}
      class={`${materialFill()} border border-glass-edge ${fade()}`}
      style={{
        ...materialStyle(),
        width: panelSize().width,
        height: panelSize().height,
        borderRadius: radius(),
        borderCurve: "continuous",
        overflow: "hidden",
        boxShadow: [{ x: 0, y: 18, blur: 48, color: token("glass-shadow") }],
        opacity: props.opacity,
        transform: [{ translateY: props.lift }, { scale: props.scale }],
      }}
    >
      <Field onFocusChange={(focused) => fieldFocused.set(focused)} />
      <If when={expanded()}>
        <If
          when={todoMode()}
          else={
            <View class="flex-1 flex-row">
              <View style={{ width: editing() ? T.size.sidebar : T.size.panelWidth - 2 }}>
                <If when={rows().length > 0 || query().trim()} else={<EmptyNotes />}>
                  <NoteList compact={editing()} />
                </If>
              </View>
              <If when={editing()}>
                <View class="flex-1" style={{ paddingLeft: T.size.inset * 2, paddingRight: T.size.inset, paddingBottom: T.size.inset }}>
                  <Paper />
                </View>
              </If>
            </View>
          }
        >
          <View class="flex-1">
            <TodoView />
          </View>
        </If>
        <If when={!editing()}>
          <Footer />
        </If>
      </If>
    </View>
  );
}

/** The search field: what is typed searches, and Return makes a note of it when nothing matches. */
function Field(props: { onFocusChange: (focused: boolean) => void }) {
  let input: InputRef | undefined;
  effect(() => {
    const request = focusRequest();
    if (request.target === "field") input?.focus();
  });
  const hearing = () => listening() === "field";
  return (
    <View class="flex-row items-center" style={{ height: T.size.field, gap: 12, paddingLeft: 22, paddingRight: speechAvailable() ? 16 : 22 }}>
      <View class="items-center justify-center" style={{ width: 20, height: 20 }}>
        <If when={hearing()} else={<Icon name="search" size={20} tint={token("glass-muted")} />}>
          <Breathing testID="voice-pulse" size={22} color={token("primary")} accessibilityLabel={t("voice.listening")} />
        </If>
      </View>
      <Input
        testID="search"
        ref={(r) => {
          input = r;
        }}
        class="flex-1 text-glass-fg"
        style={{ fontSize: T.type.field, backgroundColor: "transparent" }}
        value={query()}
        placeholder={hearing() ? t("voice.listening") : t("search.placeholder")}
        accessibilityLabel={t("search.label")}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        submitBehavior="submit"
        onChange={({ value }) => setQuery(value)}
        onSubmit={() => activate()}
        onFocus={() => props.onFocusChange(true)}
        onBlur={() => props.onFocusChange(false)}
      />
      <If when={hearing()}>
        <View class="flex-row items-center" style={{ gap: 12 }}>
          <If when={listeningLang()}>{(lang) => <LanguageTag testID="voice-lang" lang={lang()} surface="glass" />}</If>
          <KeyHint label={t("voice.cancel")} keys={T.keys.esc} />
        </View>
      </If>
      <If when={speechAvailable()}>
        <MicButton
          testID="voice-mic"
          active={hearing()}
          label={hearing() ? t("voice.stop") : t("voice.start")}
          tint={token("glass-muted")}
          hoverClass="hover:bg-glass-hover"
          onPress={() => {
            toggleVoice("field", fieldSink);
            input?.focus();
          }}
        />
      </If>
    </View>
  );
}

/** No notes yet: what to do first. */
function EmptyNotes() {
  return (
    <View testID="empty" class="items-center justify-center" style={{ height: emptyHeight, gap: 6, paddingHorizontal: 32 }}>
      <Text class="font-semibold text-glass-fg" style={{ fontSize: T.type.row }}>
        {t("empty.title")}
      </Text>
      <Text class="text-glass-muted text-center" style={{ fontSize: T.type.snippet }}>
        {t("empty.first", { keys: T.keys.enter.join(" ") })}
      </Text>
      <Text class="text-glass-muted text-center" style={{ fontSize: T.type.snippet }}>
        {t("empty.agent")}
      </Text>
    </View>
  );
}

/**
 * Raycast's footer: on the left how many notes there are and where they live (a notice or "Copied" in their
 * place), on the right what Return does to the row in focus and the action panel's key. While dictating, how it
 * ends; after a note went to the trash, "Moved to the Trash" with Undo.
 */
function Footer() {
  const message = () => folderError() ?? notice();
  const left = computed(() => allTodos().filter((t) => !t.done).length);
  const status = () => flash() ?? (todoMode() ? tn("footer.open", left()) : tn("footer.notes", allNotes().length, { folder: folderShown() }));
  return (
    <View
      testID="footer"
      class={`flex-row items-center border-t border-glass-line ${fade()}`}
      style={{ height: T.size.footer, gap: 12, paddingHorizontal: 18 }}
    >
      <If
        when={listening()}
        else={
          <If
            when={trashed().length > 0}
            else={
              <>
                <If
                  when={message()}
                  else={
                    <Text testID="footer-status" class="text-glass-muted" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
                      {status()}
                    </Text>
                  }
                >
                  {(m) => (
                    <Text testID="notice" class="text-late" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
                      {m()}
                    </Text>
                  )}
                </If>
                <View class="flex-1" />
                <View class="flex-row items-center" style={{ gap: 12, flexShrink: 0 }}>
                  <If when={primaryAction()}>
                    {(primary) => (
                      <>
                        <KeyHint label={primary().label} keys={primary().keys} main />
                        <HintDivider />
                      </>
                    )}
                  </If>
                  <KeyHint label={t("keys.actions")} keys={keyCaps(T.keys.actions)} />
                </View>
              </>
            }
          >
            <TrashBar />
          </If>
        }
      >
        {/* Dictating: how it ends (let go of ⌥, or press the microphone again), and how it is taken back; a failure says why. */}
        <If
          when={message()}
          else={
            <>
              <If
                when={listeningByHold()}
                else={
                  <Text class="text-glass-fg" style={{ fontSize: T.type.meta }}>
                    {t("voice.finish_press")}
                  </Text>
                }
              >
                <KeyHint label={t("voice.finish_release")} keys={[T.keys.summonCaps[0]]} main />
              </If>
              <HintDivider />
              <KeyHint label={t("voice.cancel")} keys={T.keys.esc} />
              <View class="flex-1" />
            </>
          }
        >
          {(m) => (
            <Text testID="notice" class="text-late" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
              {m()}
            </Text>
          )}
        </If>
      </If>
    </View>
  );
}

/**
 * "Moved to the trash" in the footer's place (the design's undo state): the title, Undo with its keys, and a
 * hairline along the bottom that runs out with the time left to undo.
 */
function TrashBar() {
  const last = () => trashed()[trashed().length - 1];
  const left = createAnimatedValue(0);
  // The hairline runs out with the time left; with reduced motion it stays whole (no motion), and the app is
  // quiet meanwhile.
  effect(() => {
    trashCountdown();
    untracked(() => {
      left.set(0);
      if (reduceMotion()) return;
      Animated.timing(left, { toValue: -T.size.panelWidth, duration: T.timing.undoFor, easing: "linear" }).start();
    });
  });
  return (
    <View testID="trash-bar" class="flex-1 flex-row items-center" style={{ gap: 10, height: "100%" }}>
      <Icon name="trash" size={15} tint={token("glass-fg")} opacity={0.7} />
      <Text testID="trash-message" class="text-glass-fg" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
        {tn("trash.moved", trashed().length, { title: last()?.title ?? "", more: trashed().length - 1, bin: binName() })}
      </Text>
      <View class="flex-1" />
      <PushButton testID="trash-undo" label={t("trash.undo")} primary onPress={() => undoTrash()} />
      <Keycaps keys={T.keys.undo} />
      <View
        class="absolute bg-primary"
        style={{ left: -18, bottom: 0, width: T.size.panelWidth, height: 2, transform: [{ translateX: left }], pointerEvents: "none" }}
      />
    </View>
  );
}
