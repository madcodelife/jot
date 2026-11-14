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
  trusted,
} from "../app/store";
import { Icon } from "./icons";
import { fadeTo, springConfig } from "./motion";
import { NoteList } from "./NoteList";
import { dictateIntoNote, Paper, toggleTaskAtCaret } from "./Paper";
import { HintDivider, KeyHint, SummonKeys } from "./parts";
import {
  cancelVoice,
  fieldSink,
  forgetHold,
  holdKeyDown,
  holdKeyUp,
  listening,
  listeningByHold,
  speechAvailable,
  startVoice,
  toggleVoice,
} from "../app/voice";
import { Breathing, MicButton } from "./Voice";
import { openSettings } from "./Settings";
import { fade } from "./themes";
import { tn } from "../app/i18n";
import { T, materialFill, materialStyle } from "./tokens";
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
          win = r;
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
      "mod+enter": () => {
        if (untracked(stage) === "editor" && !untracked(fieldFocused)) toggleTaskAtCaret();
        else if (untracked(todoMode)) checkSelected();
        else createFromQuery();
      },
    },
    { when: "always" },
  );
  // The arrow keys move the selection, except in the note's text, where they move the caret.
  effect(() => {
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
      <If
        when={hearing()}
        else={
          <If when={!query()}>
            <SummonKeys trusted={trusted()} />
          </If>
        }
      >
        <KeyHint label={t("voice.cancel")} keys={T.keys.esc} />
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
        {t("empty.claude")}
      </Text>
    </View>
  );
}

/** The keys, how many notes there are and where they live; a notice in their place when there is one. */
function Footer() {
  const message = () => folderError() ?? notice();
  const left = computed(() => allTodos().filter((t) => !t.done).length);
  return (
    <View
      testID="footer"
      class={`flex-row items-center border-t border-glass-line ${fade()}`}
      style={{ height: T.size.footer, gap: 12, paddingHorizontal: 18 }}
    >
      <If
        when={message()}
        else={
          <>
            <If
              when={listening()}
              else={
                <If
                  when={todoMode()}
                  else={
                    <>
                      <KeyHint label={t("keys.open")} keys={T.keys.enter} main />
                      <HintDivider />
                      <KeyHint label={t("keys.create")} keys={T.keys.create} />
                      <HintDivider />
                      <KeyHint label={t("keys.dismiss")} keys={T.keys.esc} />
                    </>
                  }
                >
                  <KeyHint label={t("keys.tick")} keys={T.keys.create} main />
                  <HintDivider />
                  <KeyHint label={t("keys.open_note")} keys={T.keys.enter} />
                  <HintDivider />
                  <KeyHint label={t("keys.back")} keys={T.keys.esc} />
                </If>
              }
            >
              {/* Dictating: how it ends (let go of ⌥, or press the microphone again), and how it is taken back. */}
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
            </If>
            <View class="flex-1" />
            <Text class="text-glass-muted" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
              {todoMode() ? tn("footer.open", left()) : tn("footer.notes", allNotes().length, { folder: folderShown() })}
            </Text>
          </>
        }
      >
        {(m) => (
          <Text testID="notice" class="text-late" style={{ numberOfLines: 1, fontSize: T.type.meta }}>
            {m()}
          </Text>
        )}
      </If>
    </View>
  );
}
