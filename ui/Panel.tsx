// The floating panel: a popup window that shows over everything, on every
// desktop, below the top of the screen. It is one glass surface that morphs
// between the summoned capsule (the field alone), the list under it, the
// to-do view, and a note open beside the list, each change a spring.
import { Animated, computed, createAnimatedValue, effect, keymap, reduceMotion, signal, Text, token, untracked, View, type AnimatedValue, type InputRef } from "nsh";
import { Input } from "nsh/base";
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
import { Paper, toggleTaskAtCaret } from "./Paper";
import { HintDivider, KeyHint, SummonKeys } from "./parts";
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
          if (!focused) dismiss();
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
      escape: () => back(),
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

  return (
    <View
      testID="panel"
      class={`${materialFill} border border-glass-edge`}
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
  return (
    <View class="flex-row items-center" style={{ height: T.size.field, gap: 12, paddingHorizontal: 22 }}>
      <Icon name="search" size={20} tint={token("glass-muted")} />
      <Input
        testID="search"
        ref={(r) => {
          input = r;
        }}
        class="flex-1 text-glass-fg"
        style={{ fontSize: T.type.field, backgroundColor: "transparent" }}
        value={query()}
        placeholder="搜索或新建…"
        accessibilityLabel="搜索或新建笔记"
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        submitBehavior="submit"
        onChange={({ value }) => setQuery(value)}
        onSubmit={() => activate()}
        onFocus={() => props.onFocusChange(true)}
        onBlur={() => props.onFocusChange(false)}
      />
      <If when={!query()}>
        <SummonKeys trusted={trusted()} />
      </If>
    </View>
  );
}

/** No notes yet: what to do first. */
function EmptyNotes() {
  return (
    <View testID="empty" class="items-center justify-center" style={{ height: emptyHeight, gap: 6, paddingHorizontal: 32 }}>
      <Text class="font-semibold text-glass-fg" style={{ fontSize: T.type.row }}>
        还没有笔记
      </Text>
      <Text class="text-glass-muted text-center" style={{ fontSize: T.type.snippet }}>
        {`输入一个标题，按 ${T.keys.enter.join(" ")} 就是第一条。`}
      </Text>
      <Text class="text-glass-muted text-center" style={{ fontSize: T.type.snippet }}>
        也可以在 Claude 里说「记到 Jot」。
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
      class="flex-row items-center border-t border-glass-line"
      style={{ height: T.size.footer, gap: 12, paddingHorizontal: 18 }}
    >
      <If
        when={message()}
        else={
          <>
            <If
              when={todoMode()}
              else={
                <>
                  <KeyHint label="打开" keys={T.keys.enter} main />
                  <HintDivider />
                  <KeyHint label="新建" keys={T.keys.create} />
                  <HintDivider />
                  <KeyHint label="收起" keys={T.keys.esc} />
                </>
              }
            >
              <KeyHint label="勾掉" keys={T.keys.create} main />
              <HintDivider />
              <KeyHint label="打开笔记" keys={T.keys.enter} />
              <HintDivider />
              <KeyHint label="返回" keys={T.keys.esc} />
            </If>
            <View class="flex-1" />
            <Text class="text-glass-muted" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
              {todoMode() ? `${left()} 件没勾掉` : `${allNotes().length} 条笔记 · ${T.folder.shown}`}
            </Text>
          </>
        }
      >
        {(m) => (
          <Text testID="notice" class="text-danger" style={{ numberOfLines: 1, fontSize: T.type.meta }}>
            {m()}
          </Text>
        )}
      </If>
    </View>
  );
}
