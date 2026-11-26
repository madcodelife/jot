// The island: a black shape hanging from the top of the screen (from the
// notch where there is one, the menu bar's middle where there is none). It
// grows to say that an AI app is writing a note to Jot, then that it is saved,
// and to show a reminder that can be ticked where it is. A quick note said
// anywhere (the double press of ⌥ held) opens it as dictation: a breathing
// dot and the words as they come, then where they were filed. Everything
// else passes through it: its window takes no clicks unless a reminder (or
// a refused microphone, which opens the settings) shows.
import { Animated, createAnimatedValue, Easing, effect, openUrl, reduceMotion, signal, Text, token, untracked, View, type AnimatedValue, type Bounds, type Keyframe } from "nsh";
import type { SpeechErrorCode } from "nsh-extra";
import { Button } from "nsh/base";
import { displays, Window, type Display, type WindowRef } from "nsh/desktop";
import { t } from "nsh/i18n";
import type { Todo } from "jot/native";
import { errorCode, notes, refresh } from "../store";
import { hm, parseDue } from "../time";
import { Icon } from "./icons";
import { fadeTo, morphNext, springConfig } from "./motion";
import { TodoCheck } from "./parts";
import { T } from "./tokens";
import { listening, listeningLang, PRIVACY_URL } from "../voice";
import { Breathing, LanguageTag } from "./Voice";

/** What the island says. */
type IslandEvent = { kind: "write"; title: string; agent: string } | { kind: "remind"; todo: Todo } | { kind: "dictate" };

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
/** Remind: its note is locked, so the to-do could not be ticked; the island says so instead. */
const refused = signal(false);
/** Write: how much of the title has been "typed". */
const typed = signal(0);

/** An AI app (`agent`, its name: "Claude", "Cursor") wrote a note: the island shows it being written, then saved. */
export function showAgentWrite(title: string, agent: string) {
  enqueue({ kind: "write", title, agent });
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
  refused.set(false);
  typed.set(0);
  isOpen.set(true);
  if (event.kind === "write") {
    // The title types itself in while the mark twinkles and the dots wave, then a check: saved.
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

/** Ticks the reminder's to-do from the island. A locked note keeps it open: the island says it is locked. */
function tick(todo: Todo) {
  if (untracked(done) || untracked(refused)) return;
  try {
    untracked(notes)?.setTodoDone(todo.note, todo.line, todo.text, true);
  } catch (error) {
    if (errorCode(error) === "ERR_JOT_LOCKED") {
      refused.set(true);
      for (const t of timers) clearTimeout(t);
      timers = [];
      later(2400, close);
      return;
    }
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
  const write = () => (props.event.kind === "write" ? props.event : null);
  const remind = () => (props.event.kind === "remind" ? props.event : null);
  const due = () => {
    const r = remind();
    return r ? parseDue(r.todo.due) : null;
  };

  return (
    <>
      <If
        when={write()}
        else={
          <View class="items-center justify-center bg-primary" style={{ width: MARK, height: MARK, borderRadius: MARK / 2 }}>
            <Icon name="bell" size={25} tint={token("on-accent")} />
          </View>
        }
      >
        <WritingMark />
      </If>
      <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <Text class="text-island-muted" style={{ numberOfLines: 1, fontSize: T.type.islandLabel }}>
          {write()
            ? done()
              ? t("island.written", { agent: write()!.agent })
              : t("island.writing", { agent: write()!.agent })
            : refused()
              ? t("island.locked")
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
          <>
            <TypingDots />
            <SavedCheck />
          </>
        </If>
        <If when={remind() && refused()}>
          <View testID="island-locked" class="items-center justify-center">
            <Icon name="lock" size={20} tint={token("island-muted")} />
          </View>
        </If>
        <If when={refused() ? undefined : remind()}>
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

/** The island's mark: the circle at its start, in points across. */
const MARK = 46;

// While an AI app writes, its mark keeps a beat (`T.timing.islandBeat`): the
// spark winds back a touch, flares past its size with a turn and settles,
// like a star catching the light, and two ripples leave the circle on the
// flare and fade; then a rest, so the beat reads as a pulse rather than a
// motor. Offsets are shares of the beat. Each segment eases in and out, so
// the turns at the keyframes are soft, as a spring's would be.
const soft = Easing.inOut(Easing.sin);
const rise = Easing.out(Easing.cubic);

/** The beat starts once the content has begun to grow in (its fade waits 110 ms). */
const BEAT_DELAY = 120;

/** The spark's size through a beat: a small wind-up, the flare, a dip past rest, rest. */
const TWINKLE_SCALE: Keyframe[] = [
  { offset: 0, value: 1, easing: soft },
  { offset: 0.08, value: 0.92, easing: rise },
  { offset: 0.24, value: 1.14, easing: soft },
  { offset: 0.4, value: 0.97, easing: soft },
  { offset: 0.54, value: 1 },
  { offset: 1, value: 1 },
];

/** The spark's turn through a beat, in degrees: back against the flare, past it, home. */
const TWINKLE_TILT: Keyframe[] = [
  { offset: 0, value: 0, easing: soft },
  { offset: 0.08, value: -5, easing: rise },
  { offset: 0.24, value: 13, easing: soft },
  { offset: 0.42, value: -3, easing: soft },
  { offset: 0.58, value: 0 },
  { offset: 1, value: 0 },
];

/** The circle swells a little under the flare, so the spark seems to push it. */
const THUMP: Keyframe[] = [
  { offset: 0, value: 1 },
  { offset: 0.12, value: 1, easing: rise },
  { offset: 0.26, value: 1.04, easing: soft },
  { offset: 0.5, value: 1 },
  { offset: 1, value: 1 },
];

/** A ripple's travel through a beat, from 0 (at the circle's edge) to 1 (spread and gone), leaving at `from`. */
const ripple = (from: number, to: number): Keyframe[] => [
  { offset: 0, value: 0 },
  { offset: from, value: 0, easing: rise },
  { offset: to, value: 1 },
  { offset: 1, value: 1 },
];

/** The halo leaves on the flare, the thin ring a beat's eighth later: two waves, not one. */
const RIPPLES = [ripple(0.2, 0.86), ripple(0.32, 0.98)] as const;

/**
 * How far a ripple spreads: the circle's radius times this. The island clips
 * its content, and its bottom corner comes within a third of the circle's
 * radius at the start; a ripple is all but gone by then (its opacity below),
 * so the clip never shows.
 */
const RIPPLE_REACH = 1.42;

/** Once the note is in: the circle swells this much, then lands on `T.spring.pop`. */
const POP_SWELL = 1.12;
const POP_SWELL_MS = 110;
/** The ripples in flight carry on out while they fade, over these. */
const RIPPLE_OUT_MS = 480;
const RIPPLE_FADE_MS = 260;

/**
 * The writing mark: the agent's circle with its spark, keeping the beat
 * while the note is written, then popping once it is in. With reduced
 * motion it stays still: no beat, no ripples, no pop.
 */
function WritingMark() {
  const scale = createAnimatedValue(1);
  const tilt = createAnimatedValue(0);
  const pop = createAnimatedValue(1);
  const ripples = RIPPLES.map(() => createAnimatedValue(0));
  /** The ripples' opacity on top of their own: 0 fades them all out at once. */
  const shown = createAnimatedValue(1);

  effect(() => {
    const saved = done();
    if (reduceMotion()) {
      for (const v of [scale, pop, shown]) v.set(1);
      tilt.set(0);
      for (const r of ripples) r.set(0);
      return;
    }
    if (!saved) {
      scale.set(1);
      tilt.set(0);
      pop.set(1);
      shown.set(1);
      const beat = { duration: T.timing.islandBeat, delay: BEAT_DELAY, iterations: "infinite" as const };
      const loop = Animated.parallel([
        Animated.keyframes(scale, { keyframes: TWINKLE_SCALE, ...beat }),
        Animated.keyframes(tilt, { keyframes: TWINKLE_TILT, ...beat }),
        Animated.keyframes(pop, { keyframes: THUMP, ...beat }),
        ...ripples.map((r, i) => Animated.keyframes(r, { keyframes: RIPPLES[i], ...beat })),
      ]);
      loop.start();
      return () => loop.stop();
    }
    // Saved: the spark comes home, the ripples drift out and fade, and the circle pops.
    const settle = springConfig(T.spring.drop);
    const finish = Animated.parallel([
      Animated.spring(scale, { toValue: 1, ...settle }),
      Animated.spring(tilt, { toValue: 0, ...settle }),
      Animated.sequence([
        Animated.timing(pop, { toValue: POP_SWELL, duration: POP_SWELL_MS, easing: rise }),
        Animated.spring(pop, { toValue: 1, ...springConfig(T.spring.pop) }),
      ]),
      Animated.timing(shown, { toValue: 0, duration: RIPPLE_FADE_MS, easing: "easeOut" }),
      ...ripples.map((r) => Animated.timing(r, { toValue: 1, duration: RIPPLE_OUT_MS, easing: rise })),
    ]);
    finish.start();
    return () => finish.stop();
  });

  /** A ripple's look: it brightens as it leaves the edge, then thins out well before its reach. */
  const rippleStyle = (r: AnimatedValue, peak: number) => ({
    width: MARK,
    height: MARK,
    borderRadius: MARK / 2,
    opacity: r.interpolate({ inputRange: [0, 0.08, 0.7, 1], outputRange: [0, peak, peak * 0.1, 0] }).mul(shown),
    transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, RIPPLE_REACH] }) }],
  });

  return (
    <View class="items-center justify-center" style={{ width: MARK, height: MARK }}>
      <If when={!reduceMotion()}>
        <View class="absolute" style={{ ...rippleStyle(ripples[0], 0.4), backgroundColor: token("agent-light") }} />
        <View class="absolute" style={{ ...rippleStyle(ripples[1], 0.75), borderWidth: 1.5, borderColor: token("agent-light") }} />
      </If>
      <View
        class="items-center justify-center"
        style={{
          width: MARK,
          height: MARK,
          borderRadius: MARK / 2,
          backgroundImage: `radial-gradient(circle at 35% 30%, ${token("agent-light")}, ${token("agent")} 60%)`,
          transform: reduceMotion() ? undefined : [{ scale: pop }],
        }}
      >
        <View style={{ transform: reduceMotion() ? undefined : [{ scale }, { rotate: tilt }] }}>
          <Icon name="spark" size={25} tint={token("on-accent")} />
        </View>
      </View>
    </View>
  );
}

// The typing dots: three dots rising and brightening one after another in a
// wave (`T.timing.islandTyping`), echoing the title typing itself in. Once
// the note is in they draw together into the middle and go, and the check
// springs out of where they met, turning upright as it lands.
const DOT = 6;
const DOT_GAP = 4.5;
/** How far a dot rises at the wave's crest, in points. */
const DOT_LIFT = 3.5;
/** A dot's opacity at rest: present but quiet, so the crest reads. */
const DOT_REST = 0.35;
/** The wave's shares: each dot leaves this much after the one before, and takes this to rise (and as long to fall). */
const DOT_STAGGER = 0.14;
const DOT_RISE = 0.22;

/** Dot `i`'s wave: still until its turn, up, down, still till the next wave. */
const wave = (i: number): Keyframe[] => [
  ...(i > 0 ? [{ offset: 0, value: 0 }] : []),
  { offset: i * DOT_STAGGER, value: 0, easing: soft },
  { offset: i * DOT_STAGGER + DOT_RISE, value: 1, easing: soft },
  { offset: i * DOT_STAGGER + 2 * DOT_RISE, value: 0 },
  { offset: 1, value: 0 },
];

/** How long the dots take to draw together once the note is in; the check starts this far into it. */
const GATHER_MS = 180;
const CHECK_AFTER = 90;
/** The check's turn as it comes in, in degrees, the size it starts from, and its fade in. */
const CHECK_TURN = -50;
const CHECK_FROM = 0.3;
const CHECK_FADE_MS = 140;
/** With reduced motion the dots fade out and the check fades in over these, and nothing moves. */
const REDUCED_OUT_MS = 140;
const REDUCED_IN_MS = 160;

/** Three dots waving while an AI app writes; with reduced motion they hold still. */
function TypingDots() {
  const lifts = [0, 1, 2].map(() => createAnimatedValue(0));
  /** 1 while writing; 0 once the dots have drawn together and gone. */
  const gather = createAnimatedValue(1);

  effect(() => {
    const saved = done();
    if (reduceMotion()) {
      for (const l of lifts) l.set(0);
      if (saved) void fadeTo(gather, 0, REDUCED_OUT_MS);
      else gather.set(1);
      return;
    }
    if (!saved) {
      gather.set(1);
      const loop = Animated.parallel(
        lifts.map((l, i) => Animated.keyframes(l, { keyframes: wave(i), duration: T.timing.islandTyping, iterations: "infinite" })),
      );
      loop.start();
      return () => loop.stop();
    }
    const finish = Animated.parallel([
      ...lifts.map((l) => Animated.timing(l, { toValue: 0, duration: GATHER_MS, easing: "easeOut" })),
      Animated.timing(gather, { toValue: 0, duration: GATHER_MS, easing: Easing.in(Easing.cubic) }),
    ]);
    finish.start();
    return () => finish.stop();
  });

  return (
    <View
      accessibilityLabel={t("island.writing_label")}
      class="absolute flex-row items-center justify-center"
      style={{ width: 35, height: 35, gap: DOT_GAP }}
    >
      {lifts.map((l, i) => (
        <View
          class="bg-island-fg"
          style={{
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            opacity: l.interpolate({ inputRange: [0, 1], outputRange: [DOT_REST, 1] }).mul(gather),
            transform: reduceMotion()
              ? undefined
              : [
                  // Toward the middle dot as they gather.
                  { translateX: gather.interpolate({ inputRange: [0, 1], outputRange: [(1 - i) * (DOT + DOT_GAP), 0] }) },
                  { translateY: l.interpolate({ inputRange: [0, 1], outputRange: [0, -DOT_LIFT] }) },
                  { scale: gather.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                ],
          }}
        />
      ))}
    </View>
  );
}

/** The check once the note is in: it springs in turning upright; with reduced motion it fades in. */
function SavedCheck() {
  /** Its spring, from 0 to 1, overshooting a little (so its scale and turn do too). */
  const ok = createAnimatedValue(0);
  const shown = createAnimatedValue(0);
  effect(() => {
    if (!done()) {
      ok.set(0);
      shown.set(0);
    } else if (reduceMotion()) {
      ok.set(1);
      void fadeTo(shown, 1, REDUCED_IN_MS);
    } else {
      Animated.parallel([
        Animated.timing(shown, { toValue: 1, duration: CHECK_FADE_MS, delay: CHECK_AFTER, easing: "easeOut" }),
        Animated.sequence([Animated.delay(CHECK_AFTER), Animated.spring(ok, { toValue: 1, ...springConfig(T.spring.drop) })]),
      ]).start();
    }
  });
  return (
    <View
      class="absolute items-center justify-center bg-ok"
      style={{
        width: 30,
        height: 30,
        borderRadius: 15,
        opacity: shown,
        transform: reduceMotion()
          ? undefined
          : [
              { scale: ok.interpolate({ inputRange: [0, 1], outputRange: [CHECK_FROM, 1], extrapolate: "extend" }) },
              { rotate: ok.interpolate({ inputRange: [0, 1], outputRange: [CHECK_TURN, 0], extrapolate: "extend" }) },
            ],
      }}
    >
      <Icon name="check" size={18} tint={token("on-accent")} />
    </View>
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
