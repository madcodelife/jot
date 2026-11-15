// The island: a black shape hanging from the top of the screen (from the
// notch where there is one, the menu bar's middle where there is none). It
// grows to say that Claude is writing a note to Jot, then that it is saved,
// and to show a reminder that can be ticked where it is. A quick note said
// anywhere (the double press of ⌥ held) opens it as dictation: a breathing
// dot and the words as they come, then where they were filed. Everything
// else passes through it: its window takes no clicks unless a reminder (or
// a refused microphone, which opens the settings) shows.
import { Animated, createAnimatedValue, effect, openUrl, reduceMotion, signal, Text, token, untracked, View, type Bounds, type SpeechErrorCode } from "nsh";
import { Button } from "nsh/base";
import { displays, Window, type Display, type WindowRef } from "nsh/desktop";
import { t } from "nsh/i18n";
import type { Todo } from "jot/native";
import { errorCode, notes, refresh } from "../app/store";
import { hm, parseDue } from "../app/time";
import { Icon } from "./icons";
import { fadeTo, morphNext, springConfig } from "./motion";
import { TodoCheck } from "./parts";
import { T } from "./tokens";
import { listening, listeningLang, PRIVACY_URL } from "../app/voice";
import { Breathing, LanguageTag } from "./Voice";

/** What the island says. */
type IslandEvent = { kind: "write"; title: string } | { kind: "remind"; todo: Todo } | { kind: "dictate" };

/** A quick note's dictation: listening (the words so far), filed, or failed. */
export type Dictation =
  | { phase: "listening"; text: string }
  | { phase: "filed"; text: string; where: "inbox"; note: string }
  | { phase: "filed"; text: string; where: "todo"; label: string }
  | { phase: "failed"; error: SpeechErrorCode | "empty" };

const dictation = signal<Dictation>({ phase: "listening", text: "" });

/** How long the island stays once a quick note is filed, and after a failure. */
const FILED_FOR = 1600;
const FAILED_FOR = 2000;
/** A refused microphone stays longer: the island is what opens the settings. */
const DENIED_FOR = 4000;

const queue: IslandEvent[] = [];
const current = signal<IslandEvent | null>(null);
/** The island is grown (its content shows). */
const isOpen = signal(false);
/** Write: the note is saved. Remind: the to-do is ticked. */
const done = signal(false);
/** Write: how much of the title has been "typed". */
const typed = signal(0);

/** Claude wrote a note: the island shows it being written, then saved. */
export function showClaudeWrite(title: string) {
  enqueue({ kind: "write", title });
}

/** A to-do is due: the island shows it, with its checkbox. */
export function showReminder(todo: Todo) {
  enqueue({ kind: "remind", todo });
}

/**
 * A quick note: the island opens at once as dictation, over whatever it
 * showed (a reminder showing comes back after).
 */
export function showDictation() {
  const showing = untracked(current);
  if (showing && showing.kind !== "dictate") queue.unshift(showing);
  dictation.set({ phase: "listening", text: "" });
  if (showing?.kind === "dictate") {
    clearTimers();
    return;
  }
  queue.unshift({ kind: "dictate" });
  next();
}

/** The words so far. */
export function updateDictation(text: string) {
  dictation.set({ phase: "listening", text });
}

/** The quick note was filed (or failed): the island says where (or why), then closes. */
export function settleDictation(result: Exclude<Dictation, { phase: "listening" }>) {
  if (untracked(current)?.kind !== "dictate") return;
  morphNext(T.spring.drop);
  dictation.set(result);
  done.set(result.phase === "filed");
  clearTimers();
  later(result.phase === "filed" ? FILED_FOR : result.error === "not-allowed" ? DENIED_FOR : FAILED_FOR, close);
}

/** The quick note was dropped (another key pressed while ⌥ was held): the island closes, saying nothing. */
export function dismissDictation() {
  if (untracked(current)?.kind !== "dictate") return;
  clearTimers();
  close();
}

function enqueue(event: IslandEvent) {
  queue.push(event);
  if (!untracked(current)) next();
}

let timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, reduceMotion() ? Math.min(ms, 600) : ms));
function clearTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

function next() {
  clearTimers();
  const event = queue.shift() ?? null;
  if (!event) {
    current.set(null);
    return;
  }
  morphNext(T.spring.island);
  current.set(event);
  done.set(false);
  typed.set(0);
  isOpen.set(true);
  if (event.kind === "write") {
    // The title types itself in, the ring spins, then a check: saved.
    const steps = Math.max(1, event.title.length);
    const each = Math.min(60, 700 / steps);
    for (let i = 1; i <= steps; i++) later(200 + i * each, () => typed.set(i));
    later(200 + steps * each + 350, () => done.set(true));
    later(200 + steps * each + 350 + T.timing.islandHold, close);
  } else if (event.kind === "remind") {
    later(8000, close);
  }
  // Dictation stays open until it is settled.
}

function close() {
  morphNext(T.spring.collapse);
  isOpen.set(false);
  later(420, next);
}

/** Ticks the reminder's to-do from the island. */
function tick(todo: Todo) {
  if (untracked(done)) return;
  try {
    untracked(notes)?.setTodoDone(todo.note, todo.line, todo.text, true);
  } catch (error) {
    // The line changed since the reminder was due (`ERR_JOT_CHANGED`): the note has the user's latest.
    if (errorCode(error) !== "ERR_JOT_CHANGED") throw error;
  }
  refresh();
  done.set(true);
  for (const t of timers) clearTimeout(t);
  timers = [];
  later(900, close);
}

/** The window's size: the island open, with room around. */
const WINDOW = { width: T.size.islandWidth + 24, height: T.size.islandHeight + 12 };

/** The notch of the primary display (the built-in one's), when it has one. */
function notchOf(display: Display): Bounds | null {
  const cutouts = (display as Display & { cutouts?: Bounds[] }).cutouts ?? [];
  return cutouts[0] ?? null;
}

function placement(list: readonly Display[]) {
  const display = list.find((d) => d.primary) ?? list[0];
  if (!display) return null;
  const notch = notchOf(display);
  const center = notch ? notch.origin.x + notch.size.width / 2 : display.bounds.origin.x + display.bounds.size.width / 2;
  return {
    origin: { x: Math.round(center - WINDOW.width / 2), y: display.bounds.origin.y },
    notch: notch ? { width: notch.size.width, height: notch.size.height } : null,
  };
}

/** The island's window (macOS: it lives at the notch, or under the menu bar's middle). */
export function IslandWindow() {
  let win: WindowRef | undefined;
  const where = () => placement(displays());
  const contentOpacity = createAnimatedValue(0);
  const contentScale = createAnimatedValue(0.9);

  // Clicks pass through unless a reminder (with its checkbox) or a refused microphone (which opens the settings) shows.
  effect(() => {
    const d = dictation();
    const denied = current()?.kind === "dictate" && d.phase === "failed" && d.error === "not-allowed";
    const takesClicks = isOpen() && (current()?.kind === "remind" || denied);
    win?.set({ pointerEvents: takesClicks ? "auto" : "none" });
  });
  // Displays change (a lid closed, a monitor plugged in): follow the primary one.
  effect(() => {
    const at = where();
    if (at) win?.setBounds({ origin: at.origin });
  });
  // The content fades and grows in once the shape has started to open, and out at once.
  effect(() => {
    if (isOpen()) {
      contentOpacity.set(0);
      if (reduceMotion()) {
        void fadeTo(contentOpacity, 1, 180, 110);
        contentScale.set(1);
      } else {
        contentScale.set(0.9);
        Animated.parallel([
          Animated.timing(contentOpacity, { toValue: 1, duration: 140, delay: 110, easing: "easeOut" }),
          Animated.sequence([Animated.delay(110), Animated.spring(contentScale, { toValue: 1, ...springConfig(T.spring.island) })]),
        ]).start();
      }
    } else {
      void fadeTo(contentOpacity, 0, 120);
    }
  });

  const idle = () => {
    const notch = where()?.notch;
    // Without a notch there is nothing to hang from: the island is out of sight until it opens.
    return notch ? { width: notch.width, height: notch.height } : { width: 105, height: 0 };
  };
  const size = () =>
    isOpen()
      ? { width: current()?.kind === "remind" ? T.size.islandRemindWidth : T.size.islandWidth, height: T.size.islandHeight }
      : idle();

  return (
    <Window
      id="island"
      kind="overlay"
      title="Jot"
      ref={(r) => {
        win = r;
      }}
      defaultSize={{ width: WINDOW.width, height: WINDOW.height }}
      defaultPosition={untracked(where)?.origin ?? "center"}
      transparent
      shadow={false}
      pointerEvents="none"
    >
      <View class="flex-1 items-center" style={{ backgroundColor: "transparent" }}>
        <View
          testID="island"
          class="bg-island"
          style={{
            width: size().width,
            height: size().height,
            borderBottomLeftRadius: isOpen() ? T.size.islandRadius : T.size.islandIdleRadius,
            borderBottomRightRadius: isOpen() ? T.size.islandRadius : T.size.islandIdleRadius,
            borderCurve: "continuous",
            overflow: "hidden",
          }}
        >
          <View
            class="absolute flex-row items-center"
            style={{ left: 25, right: 25, bottom: 15, height: 46, gap: 15, opacity: contentOpacity, transform: [{ scale: contentScale }] }}
          >
            <If when={current()}>
              {(event) => (
                <If when={event().kind === "dictate"} else={<IslandContent event={event()} />}>
                  <DictationContent />
                </If>
              )}
            </If>
          </View>
        </View>
      </View>
    </Window>
  );
}

function IslandContent(props: { event: IslandEvent }) {
  const spin = createAnimatedValue(0);
  const ok = createAnimatedValue(0);
  effect(() => {
    if (props.event.kind !== "write" || reduceMotion()) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 360, duration: 2400, easing: "linear" }), { resetBeforeIteration: true });
    loop.start();
    return () => loop.stop();
  });
  effect(() => {
    if (!done()) {
      ok.set(0);
    } else if (reduceMotion()) {
      void fadeTo(ok, 1, 160);
    } else {
      ok.set(0.4);
      void Animated.spring(ok, { toValue: 1, ...springConfig(T.spring.drop) }).start();
    }
  });

  const write = () => (props.event.kind === "write" ? props.event : null);
  const remind = () => (props.event.kind === "remind" ? props.event : null);
  const due = () => {
    const r = remind();
    return r ? parseDue(r.todo.due) : null;
  };

  return (
    <>
      <View
        class="items-center justify-center"
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundImage: write()
            ? `radial-gradient(circle at 35% 30%, ${token("claude-light")}, ${token("claude")} 60%)`
            : `radial-gradient(circle at 35% 30%, ${token("primary")}, ${token("primary")})`,
        }}
      >
        <View style={{ transform: [{ rotate: spin }] }}>
          <Icon name={write() ? "spark" : "bell"} size={25} tint={token("on-accent")} />
        </View>
      </View>
      <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <Text class="text-island-muted" style={{ numberOfLines: 1, fontSize: T.type.islandLabel }}>
          {write()
            ? done()
              ? t("island.written")
              : t("island.writing")
            : done()
              ? t("island.done")
              : t("island.remind", { time: due() ? hm(due()!) : t("island.now"), note: remind()?.todo.note ?? "" })}
        </Text>
        <Text class="font-semibold text-island-fg" style={{ numberOfLines: 1, fontSize: T.type.island }}>
          {write() ? write()!.title.slice(0, done() ? undefined : typed()) : remind()!.todo.text}
        </Text>
      </View>
      <View class="items-center justify-center" style={{ width: 35, height: 35 }}>
        <If when={write()}>
          <If
            when={done()}
            else={<Spinner />}
          >
            <View class="items-center justify-center bg-ok" style={{ width: 30, height: 30, borderRadius: 15, transform: [{ scale: ok }], opacity: ok }}>
              <Icon name="check" size={18} tint={token("on-accent")} />
            </View>
          </If>
        </If>
        <If when={remind()}>
          {(r) => (
            <TodoCheck
              testID="island-check"
              checked={done()}
              label={t("todo.tick", { text: r().todo.text })}
              onCheck={() => tick(r().todo)}
              size={26}
              onAccent
            />
          )}
        </If>
      </View>
    </>
  );
}

/** A ring turning while Claude writes. */
function Spinner() {
  const turn = createAnimatedValue(0);
  effect(() => {
    if (reduceMotion()) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 360, duration: 800, easing: "linear" }), { resetBeforeIteration: true });
    loop.start();
    return () => loop.stop();
  });
  return (
    <View
      accessibilityLabel={t("island.writing_label")}
      class="border-island-line"
      style={{ width: 25, height: 25, borderRadius: 12.5, borderWidth: 3, borderTopColor: token("island-fg"), transform: [{ rotate: turn }] }}
    />
  );
}

/** The width the island's text has, for telling whether the words overflow (its line fades in from the left then). */
const TEXT_ROOM = T.size.islandWidth - 50 - 46 - 35 - 30;

/** About how wide `text` sets at the island's size: CJK a full em, the rest about half. */
function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? T.type.island : T.type.island * 0.55;
  return w;
}

/** The island as dictation: the breathing dot and the words, then where they went (a check) or why not. */
function DictationContent() {
  const ok = createAnimatedValue(0);
  const d = dictation;
  effect(() => {
    if (d().phase !== "filed") {
      ok.set(0);
    } else if (reduceMotion()) {
      void fadeTo(ok, 1, 160);
    } else {
      ok.set(0.4);
      void Animated.spring(ok, { toValue: 1, ...springConfig(T.spring.drop) }).start();
    }
  });
  const failed = () => {
    const now = d();
    return now.phase === "failed" ? now.error : null;
  };
  const words = () => {
    const now = d();
    return now.phase === "failed" ? "" : now.text;
  };
  const label = () => {
    const now = d();
    if (now.phase === "listening") return t("voice.island.listening");
    if (now.phase === "failed") return t(now.error === "empty" ? "voice.error.empty" : `voice.error.${now.error}`);
    return now.where === "todo" ? t("voice.island.todo") : t("voice.island.inbox", { note: now.note });
  };
  const overflows = () => d().phase === "listening" && textWidth(words()) > TEXT_ROOM;

  const Body = () => (
    <>
      <View
        class="items-center justify-center"
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundImage: failed()
            ? undefined
            : `radial-gradient(circle at 35% 30%, ${token("ring")}, ${token("primary")} 70%)`,
        }}
      >
        <If when={failed()} else={<If when={d().phase === "listening"} else={<Icon name="mic" size={23} tint={token("on-accent")} />}>
          <Breathing testID="island-pulse" size={30} color={token("on-accent")} accessibilityLabel={t("voice.listening")} />
        </If>}>
          <View class="items-center justify-center bg-island-fill" style={{ width: 46, height: 46, borderRadius: 23 }}>
            <Icon name="mic" size={23} tint={token("island-muted")} />
          </View>
        </If>
      </View>
      <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <View class="flex-row items-center" style={{ gap: 6 }}>
          <Text testID="island-label" class={failed() ? "text-island-fg" : "text-island-muted"} style={{ numberOfLines: 1, fontSize: T.type.islandLabel, flexShrink: 1 }}>
            {label()}
          </Text>
          <If when={d().phase === "listening" && listening() === "quick" ? listeningLang() : null}>
            {(lang) => <LanguageTag testID="island-lang" lang={lang()} surface="island" />}
          </If>
          <If when={(() => { const now = d(); return now.phase === "filed" && now.where === "todo" ? now.label : null; })()}>
            {(when) => (
              <View class="flex-row items-center bg-due/25" style={{ gap: 3, paddingHorizontal: 6, height: 17, borderRadius: 8.5 }}>
                <Icon name="alarm" size={11} tint={token("due")} />
                <Text testID="island-due" class="font-semibold text-due" style={{ numberOfLines: 1, fontSize: 11 }}>
                  {when()}
                </Text>
              </View>
            )}
          </If>
        </View>
        <Text
          testID="island-words"
          class={failed() ? "text-island-muted" : "font-semibold text-island-fg"}
          style={{
            numberOfLines: 1,
            fontSize: failed() ? T.type.islandLabel + 1 : T.type.island,
            // Long words keep their newest end in view: the start goes, fading out at the left.
            textOverflow: overflows() ? "ellipsis-start" : "ellipsis",
            maskImage: overflows() ? "linear-gradient(to right, transparent 0%, black 22%)" : undefined,
          }}
        >
          {failed() ? (failed() === "not-allowed" ? t("voice.island.open_settings") : t("voice.island.try_again")) : words() || " "}
        </Text>
      </View>
      <View class="items-center justify-center" style={{ width: 35, height: 35 }}>
        <If when={d().phase === "filed"}>
          <View class="items-center justify-center bg-ok" style={{ width: 30, height: 30, borderRadius: 15, transform: [{ scale: ok }], opacity: ok }}>
            <Icon name="check" size={18} tint={token("on-accent")} />
          </View>
        </If>
      </View>
    </>
  );
  return (
    <If when={failed() === "not-allowed"} else={<Body />}>
      <Button
        testID="island-settings"
        accessibilityLabel={t("voice.island.open_settings")}
        onPress={() => void openUrl(PRIVACY_URL.speech).catch(() => openUrl(PRIVACY_URL.microphone).catch(() => {}))}
        class="flex-1 flex-row items-center"
        style={{ gap: 15, alignSelf: "stretch" }}
      >
        <Body />
      </Button>
    </If>
  );
}
