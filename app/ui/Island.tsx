// The island: a black shape hanging from the top of the screen (from the
// notch where there is one, the menu bar's middle where there is none). It
// grows to say that an AI app is writing a new note to Jot, then that it is
// saved (inside a glow of flowing colors, the app's avatar falling out of the
// notch), or, more lightly, what else an AI app did to a note (appended to
// it, a to-do added, ticked or moved, rewritten, moved to the Trash), which a
// click opens; and to show a reminder that can be ticked where it is (its bell
// falling out of the notch and ringing, a halo pulsing around it while it
// waits). A quick note said
// anywhere (the double press of ⌥ held) opens it as dictation: a breathing
// dot and the words as they come, then where they were filed. Everything
// else passes through it: its window takes no clicks unless an AI app's
// write, a reminder (or a refused microphone, which opens the settings)
// shows.
import { Animated, computed, createAnimatedValue, effect, Image, openUrl, reduceMotion, signal, Text, token, untracked, View, type AnimatedNode, type AnimatedValue, type Bounds, type Easing, type JSX, type Keyframe } from "nsh";
import type { SpeechErrorCode } from "nsh-extra";
import { Button } from "nsh/base";
import { displays, Window, type Display, type WindowRef } from "nsh/desktop";
import { t } from "nsh/i18n";
import { Folder, type AgentAction, type AgentActivity, type Todo } from "jot/native";
import { openHistory } from "../history";
import { inkFrames, playInk } from "../ink";
import { errorCode, errorMessage, notes, open, refresh, summon } from "../store";
import { playDone, playNew } from "../sounds";
import { hm, parseDue } from "../time";
import { Icon } from "./icons";
import { fadeTo, morphNext, springConfig } from "./motion";
import { DRAW, FlipText, StrikeLine, TodoCheck, type Flip } from "./parts";
import { T } from "./tokens";
import { listening, listeningLang, PRIVACY_URL } from "../voice";
import { Breathing, LanguageTag } from "./Voice";

/**
 * An AI app's write: what the app (`agent`, its name: "Claude", "Cursor") did to the note `title`; `inTrash` is where
 * a trashed note went. `last` is when its latest write came (several in a row are one: `showAgentActivity`).
 */
type WriteEvent = { kind: "write"; action: AgentAction; title: string; agent: string; inTrash: string | null; last: number };

/** What the island says. */
type IslandEvent = WriteEvent | { kind: "remind"; todo: Todo } | { kind: "dictate" };

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
/** Write: the title is in and the sheen sweeps it while the note is written. */
const sheen = signal(false);
/** Write: the content lifts out before the island closes. */
const leaving = signal(false);
/** Counts the events shown, so a title's letters are new views (and rise in again) for each note. */
const shown = signal(0);
/** Write: its sound has played (`sound`), once per island however many writes it takes in. */
let sounded = false;

/**
 * An AI app wrote to a note (a line of `jot-mcp`'s activity log): a new note shows being written, then saved; any
 * other write is said more lightly. Writes of one app to one note within `islandMerge` of each other are one: the one
 * showing says the latest and stays longer, one waiting takes it in.
 */
export function showAgentActivity(activity: AgentActivity) {
  const at = Date.now();
  const same = (event: IslandEvent | null | undefined): event is WriteEvent =>
    event?.kind === "write" &&
    event.agent === activity.agent &&
    event.title === activity.title &&
    at - event.last < T.timing.islandMerge;
  const showing = untracked(current);
  if (same(showing) && untracked(isOpen) && !untracked(leaving)) {
    current.set(mergeWrite(showing, activity, at));
    // Its hold starts again; a new note still being written goes on, its hold to come.
    if (untracked(done)) {
      // Its check is in: one that now says a to-do was completed sounds now, unless the island already did.
      sound(untracked(current));
      clearTimers();
      later(holdOf(untracked(current)), close);
    }
    return;
  }
  const waiting = queue.findIndex(same);
  if (waiting >= 0) {
    queue[waiting] = mergeWrite(queue[waiting] as WriteEvent, activity, at);
    return;
  }
  enqueue({
    kind: "write",
    action: activity.action,
    title: activity.title,
    agent: activity.agent,
    inTrash: activity.inTrash ?? null,
    last: at,
  });
}

/** `event` with the app's next write to its note: a note moved to the Trash says so; else a new note stays one (and
 * another write never becomes one: the island does not start writing again), and the latest says what was done. */
function mergeWrite(event: WriteEvent, activity: AgentActivity, at: number): WriteEvent {
  const action =
    activity.action === "trash" ? "trash" : event.action === "create" || activity.action === "create" ? event.action : activity.action;
  return { ...event, action, inTrash: activity.inTrash ?? event.inTrash, last: at };
}

/** How long the island stays once `event` is done: a new note, a rewrite (its label says more), any other write. */
function holdOf(event: IslandEvent | null): number {
  if (event?.kind !== "write" || event.action === "create") return T.timing.islandHold;
  return event.action === "replace" ? T.timing.islandReplaceHold : T.timing.islandLightHold;
}

/**
 * An AI app's write sounds as the island says it, once per island (app/sounds.ts): a new note as the island opens on
 * it, a completed to-do as its check pops in. Any other write is silent, and so is a merged island that played already.
 */
function sound(event: IslandEvent | null) {
  if (sounded || event?.kind !== "write") return;
  if (event.action === "create") playNew();
  else if (event.action === "complete") playDone();
  else return;
  sounded = true;
}

/** A new note: the island shows it being written inside the glow. Other writes are lighter. */
const isCreate = (event: IslandEvent | null | undefined) => event?.kind === "write" && event.action === "create";

/** A click on an AI app's write: the note opens in the panel; a rewritten one with its version history over it (the
 * text it had is there); a trashed one shows in the Trash. */
function openWrite(event: WriteEvent) {
  if (event.action === "trash") {
    void Folder.showInTrash(event.inTrash).catch((error: unknown) => console.warn(`cannot show the Trash: ${errorMessage(error)}`));
  } else {
    summon();
    open(event.title);
    if (event.action === "replace") openHistory(event.title);
  }
  clearTimers();
  close();
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
  morphNext(event.kind === "write" ? T.spring.islandWrite : T.spring.island);
  current.set(event);
  shown.set(untracked(shown) + 1);
  done.set(false);
  refused.set(false);
  sheen.set(false);
  leaving.set(false);
  isOpen.set(true);
  sounded = false;
  if (event.kind === "write" && event.action === "create") {
    sound(event);
    // The avatar falls out of the notch inside the glow and the title rises in; the sheen sweeps the title while the
    // note is written; then the check, and the island holds. Each step waits for the one before, so reduced motion
    // (which shortens every wait) still shows each.
    later(revealMs(titleLetters(event.title).length), () => {
      sheen.set(true);
      later(T.timing.islandSheen, () => {
        sheen.set(false);
        done.set(true);
        later(T.timing.islandHold, close);
      });
    });
  } else if (event.kind === "write") {
    // Any other write is done already: the check once the avatar has landed, then a shorter hold.
    later(landed(), () => {
      done.set(true);
      sound(untracked(current));
      later(holdOf(untracked(current)), close);
    });
  } else if (event.kind === "remind") {
    later(T.timing.remind.hold, close);
  }
  // Dictation stays open until it is settled.
}

/** An AI app's note (and a ticked reminder) lifts its content out over this, and the island starts closing this far
 * into it. */
const LEAVE_MS = 220;
const LEAVE_LIFT = 10;
const COLLAPSE_AFTER = 90;

function close() {
  const event = untracked(current);
  const lifts = event?.kind === "write" || (event?.kind === "remind" && untracked(done));
  if (lifts && !untracked(leaving)) {
    leaving.set(true);
    later(COLLAPSE_AFTER, collapse);
    return;
  }
  collapse();
}

function collapse() {
  morphNext(untracked(current)?.kind === "write" || untracked(leaving) ? T.spring.islandWriteClose : T.spring.collapse);
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
  later(T.timing.remind.doneHold, close);
}

/**
 * Room around the open island in its window, in points: an AI app's note glows past the island's sides and bottom
 * (`GLOW`), and its green flash grows past that while it fades (`FLASH_GROW`); a reminder's halo grows past them too
 * (`HALO_GROW`, well within). Clicks pass through it then; only while an AI app's write or a reminder shows does the
 * window, room and all, take them.
 */
const ROOM = { side: 80, below: 70 };

/** The window's size: the island open, with room around. */
const WINDOW = { width: T.size.islandWidth + 2 * ROOM.side, height: T.size.islandHeight + ROOM.below };

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
  /** An AI app's note lifts its content out before the island closes. */
  const contentLift = createAnimatedValue(0);
  const aurora = useAurora();
  const writing = () => isCreate(current());

  // Clicks pass through unless an AI app's write (which opens the note), a reminder (with its checkbox) or a refused
  // microphone (which opens the settings) shows.
  effect(() => {
    const d = dictation();
    const denied = current()?.kind === "dictate" && d.phase === "failed" && d.error === "not-allowed";
    const kind = current()?.kind;
    const takesClicks = isOpen() && (kind === "remind" || kind === "write" || denied);
    win?.set({ pointerEvents: takesClicks ? "auto" : "none" });
  });
  // Displays change (a lid closed, a monitor plugged in): follow the primary one.
  effect(() => {
    const at = where();
    if (at) win?.setBounds({ origin: at.origin });
  });
  // The content fades and grows in once the shape has started to open, and out at once. An AI app's note and a
  // reminder do not grow in: the avatar or the bell falls into place instead (`useDrop`), so only the content's fade
  // stays.
  effect(() => {
    if (isOpen()) {
      contentOpacity.set(0);
      contentLift.set(0);
      if (reduceMotion()) {
        void fadeTo(contentOpacity, 1, 180, CONTENT_IN);
        contentScale.set(1);
      } else if (untracked(current)?.kind !== "dictate") {
        contentScale.set(1);
        void contentOpacity.timing(1, { duration: 140, delay: CONTENT_IN, easing: "easeOut" });
      } else {
        contentScale.set(0.9);
        Animated.parallel([
          Animated.timing(contentOpacity, { toValue: 1, duration: 140, delay: CONTENT_IN, easing: "easeOut" }),
          Animated.sequence([Animated.delay(CONTENT_IN), Animated.spring(contentScale, { toValue: 1, ...springConfig(T.spring.island) })]),
        ]).start();
      }
    } else if (!untracked(leaving)) {
      void fadeTo(contentOpacity, 0, 120);
    }
  });
  // An AI app's note, a ticked reminder: the content lifts out and fades, and the island starts closing on the way
  // (`close`).
  effect(() => {
    if (!leaving()) return;
    const easing: Easing = [0.4, 0, 1, 1];
    void contentOpacity.timing(0, { duration: LEAVE_MS, easing });
    if (!reduceMotion()) void contentLift.timing(-LEAVE_LIFT, { duration: LEAVE_MS, easing });
  });

  const idle = () => {
    const notch = where()?.notch;
    // Without a notch there is nothing to hang from: the island is out of sight until it opens.
    return notch ? { width: notch.width, height: notch.height } : { width: 105, height: 0 };
  };
  const size = () =>
    isOpen()
      ? { width: T.size.islandWidth, height: T.size.islandHeight }
      : idle();
  const radius = () => (isOpen() ? T.size.islandRadius : T.size.islandIdleRadius);

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
        <If when={writing()}>
          <Aurora aurora={aurora} />
        </If>
        <If when={current()?.kind === "remind"}>
          <Halo />
        </If>
        <View
          testID="island"
          class="bg-island"
          style={{
            width: size().width,
            height: size().height,
            borderBottomLeftRadius: radius(),
            borderBottomRightRadius: radius(),
            borderCurve: "continuous",
            overflow: "hidden",
          }}
        >
          <If when={writing()}>
            <Rim aurora={aurora} radius={radius() - RIM} />
          </If>
          <View
            class="absolute flex-row items-center"
            style={{
              left: 25,
              right: 25,
              bottom: 15,
              height: 46,
              gap: 15,
              opacity: contentOpacity,
              transform: [{ translateY: contentLift }, { scale: contentScale }],
            }}
          >
            <If when={current()}>
              {(event) => (
                <If
                  when={event().kind === "dictate"}
                  else={
                    <If when={writeOf(event())} else={<IslandContent event={event()} />}>
                      {(write) => <WriteContent event={write()} />}
                    </If>
                  }
                >
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

/** The content starts showing this long after the island starts to open, once its shape has made room. */
const CONTENT_IN = 110;

// A reminder. Its bell falls out of the notch as an AI app's avatar does and rings once it lands, swinging about its top
// with two sound waves pulsing out beside it; the label, the title and the checkbox rise in after it. While it waits a
// halo pulses out around the island, the checkbox breathes a ring out and the bell rings again now and then. Ticked,
// the checkbox bursts, a line strikes the title through, the label flips to "Done" and the bell hops; everything that
// loops stops, then the content lifts out and the island closes. With reduced motion things only fade.

/** A reminder waits to be ticked: what loops runs. */
const waiting = () => isOpen() && current()?.kind === "remind" && !done() && !refused();

/** From the island starting to open until the bell (or the avatar) has landed. */
const landed = () => CONTENT_IN + FALL.ms;

/** The label flips to "Done" (or "locked"): out up, in from below. */
const LABEL_FLIP: Flip = { lift: 5, out: T.timing.flip.labelOut, rise: 5, in: T.timing.flip.labelIn };
/** The title dims to this once ticked. */
const TITLE_DONE = 0.55;

/** The island as a reminder: the bell, the to-do and its checkbox. */
function IslandContent(props: { event: IslandEvent }) {
  const remind = () => (props.event.kind === "remind" ? props.event : null);
  const due = () => {
    const r = remind();
    return r ? parseDue(r.todo.due) : null;
  };
  const label = useRise(0);
  const title = useRise(1);
  const check = useRise(2);

  // Ticked: a line strikes the title through and it dims.
  const strike = createAnimatedValue(0);
  const dim = createAnimatedValue(1);
  effect(() => {
    if (!done()) {
      strike.set(0);
      dim.set(1);
      return;
    }
    const tick = T.timing.tick;
    const struck = Animated.parallel([
      Animated.timing(strike, { toValue: 1, duration: tick.strike, delay: tick.strikeAfter, easing: reduceMotion() ? "easeOut" : DRAW }),
      Animated.timing(dim, { toValue: TITLE_DONE, duration: tick.strike, delay: tick.strikeAfter, easing: "easeOut" }),
    ]);
    struck.start();
    return () => struck.stop();
  });

  return (
    <>
      <Bell />
      <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <View style={{ opacity: label.opacity, transform: [{ translateY: label.y }] }}>
          <FlipText
            text={
              refused()
                ? t("island.locked")
                : done()
                  ? t("island.done")
                  : t("island.remind", { time: due() ? hm(due()!) : t("island.now"), note: remind()?.todo.note ?? "" })
            }
            flip={LABEL_FLIP}
            class="text-island-muted"
            style={{ numberOfLines: 1, fontSize: T.type.islandLabel }}
          />
        </View>
        <View style={{ alignSelf: "flex-start", maxWidth: "100%", opacity: title.opacity, transform: [{ translateY: title.y }] }}>
          <Text class="font-semibold text-island-fg" style={{ numberOfLines: 1, fontSize: T.type.island, opacity: dim }}>
            {remind()?.todo.text ?? ""}
          </Text>
          <StrikeLine progress={strike} class="bg-island-fg" opacity={dim} />
        </View>
      </View>
      <View
        class="items-center justify-center"
        style={{ width: 35, height: 35, opacity: check.opacity, transform: [{ translateY: check.y }] }}
      >
        <If when={remind() && refused()}>
          <View testID="island-locked" class="items-center justify-center">
            <Icon name="lock" size={20} tint={token("island-muted")} />
          </View>
        </If>
        <If when={refused() ? undefined : remind()}>
          {(r) => (
            <>
              <Breath />
              <TodoCheck
                testID="island-check"
                checked={done()}
                label={t("todo.tick", { text: r().todo.text })}
                onCheck={() => tick(r().todo)}
                size={26}
                onAccent
              />
            </>
          )}
        </If>
      </View>
    </>
  );
}

/** The reminder's text and checkbox rise this far into place, in points. */
const RISE_FROM = 8;

/** One of the reminder's label, title and checkbox (the `order`th) rising in after the bell as the island opens. */
function useRise(order: number) {
  const opacity = createAnimatedValue(0);
  const y = createAnimatedValue(0);
  effect(() => {
    if (!isOpen()) return;
    const r = T.timing.remind;
    const delay = CONTENT_IN + r.riseAfter + order * r.riseStagger;
    opacity.set(0);
    if (reduceMotion()) {
      y.set(0);
      void fadeTo(opacity, 1, r.riseFade, delay);
      return;
    }
    y.set(RISE_FROM);
    const rising = Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: r.riseFade, easing: "easeOut" }),
        Animated.spring(y, { toValue: 0, ...springConfig(T.spring.remindRise) }),
      ]),
    ]);
    rising.start();
    return () => rising.stop();
  });
  return { opacity, y };
}

/** The bell's swing once it lands, about a point near its top: a pendulum's, `SWING_ANGLE` degrees at first, dying out. */
const SWING_ANGLE = 16;
const SWING = (() => {
  const n = Math.round((T.timing.remind.swing / 1000) * 60);
  return Array.from({ length: n + 1 }, (_, i): Keyframe => {
    const p = i / n;
    const angle = SWING_ANGLE * Math.exp(-4.2 * p) * Math.sin(7 * Math.PI * p);
    return { offset: p, value: Math.round(angle * 100) / 100, easing: "linear" };
  });
})();
/** The bell ringing again while it waits: a short wiggle, ±10 degrees dying out, in the cycle's first `ringShare`. */
const WIGGLE: Keyframe[] = [0, 10, -8, 5, -2, 0].map((value, i) => ({
  offset: (i / 5) * T.timing.remind.ringShare,
  value,
  easing: "easeInOut",
}));
WIGGLE.push({ offset: 1, value: 0 });

/** A sound wave: an arc of a circle `WAVE` points across, `WAVE_ARC` of its width showing, `WAVE_OUT` past the disc. */
const WAVE = 28;
const WAVE_ARC = 0.3;
const WAVE_OUT = 9;
/** Stopped, a loop's values go to rest over this. */
const SETTLE_MS = 180;

/** The reminder's bell: the disc falls out of the notch (and hops once ticked); landed, the bell swings and rings. */
function Bell() {
  const drop = useDrop();
  const swing = createAnimatedValue(0);
  /** The sound waves' pulse, from 0 to 1 (gone at 1). */
  const waves = createAnimatedValue(1);
  effect(() => {
    if (!waiting() || reduceMotion()) return;
    const r = T.timing.remind;
    swing.set(0);
    waves.set(1);
    const ringing = Animated.parallel([
      Animated.sequence([
        Animated.delay(landed()),
        Animated.keyframes(swing, { keyframes: SWING, duration: r.swing, easing: "linear" }),
        Animated.delay(Math.max(0, r.ringAfter - r.swing)),
        Animated.keyframes(swing, { keyframes: WIGGLE, duration: r.ring, iterations: "infinite" }),
      ]),
      Animated.sequence([
        Animated.delay(landed()),
        Animated.keyframes(waves, { keyframes: [{ offset: 0, value: 0, easing: "linear" }, { offset: 1, value: 1 }], duration: r.waves }),
      ]),
    ]);
    ringing.start();
    return () => {
      ringing.stop();
      void swing.timing(0, { duration: SETTLE_MS, easing: "easeOut" });
      void waves.timing(1, { duration: SETTLE_MS, easing: "easeOut" });
    };
  });
  const still = () => reduceMotion();
  return (
    <View style={{ width: MARK, height: MARK }}>
      <If when={!still()}>
        <Wave side="left" pulse={waves} />
        <Wave side="right" pulse={waves} />
      </If>
      <View
        class="items-center justify-center bg-primary"
        style={{ width: MARK, height: MARK, borderRadius: MARK / 2, ...drop.style() }}
      >
        <View style={{ transformOrigin: "50% 18%", transform: still() ? undefined : [{ rotate: swing }] }}>
          <Icon name="bell" size={25} tint={token("on-accent")} />
        </View>
      </View>
    </View>
  );
}

/** One of the bell's sound waves, beside the disc (behind it), growing out and fading as `pulse` goes from 0 to 1. */
function Wave(props: { side: "left" | "right"; pulse: AnimatedValue }) {
  const hidden = `${Math.round((1 - WAVE_ARC) * 100)}%`;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      class="absolute border-primary"
      style={{
        top: (MARK - WAVE) / 2,
        ...(props.side === "left" ? { left: -WAVE_OUT } : { left: MARK + WAVE_OUT - WAVE }),
        width: WAVE,
        height: WAVE,
        borderWidth: 1.5,
        borderRadius: WAVE / 2,
        pointerEvents: "none",
        clipPath: props.side === "left" ? `inset(0 ${hidden} 0 0)` : `inset(0 0 0 ${hidden})`,
        opacity: props.pulse.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.9, 0] }),
        transform: [{ scale: props.pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5], easing: FLY }) }],
      }}
    />
  );
}

/** The checkbox's breath while the reminder waits: a ring growing out of it as it fades, every `remind.breathe`. */
function Breath() {
  const at = createAnimatedValue(1);
  effect(() => {
    if (!waiting() || reduceMotion()) return;
    at.set(1);
    const breathing = Animated.sequence([
      Animated.delay(landed()),
      Animated.keyframes(at, {
        keyframes: [{ offset: 0, value: 0, easing: "easeOut" }, { offset: 1, value: 1 }],
        duration: T.timing.remind.breathe,
        iterations: "infinite",
      }),
    ]);
    breathing.start();
    return () => {
      breathing.stop();
      void at.timing(1, { duration: SETTLE_MS, easing: "easeOut" });
    };
  });
  return (
    <If when={!reduceMotion()}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        class="absolute border-island-fg/70"
        style={{
          left: 4,
          top: 4,
          right: 4,
          bottom: 4,
          borderWidth: 1.5,
          borderRadius: 999,
          pointerEvents: "none",
          opacity: at.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.8, 0] }),
          transform: [{ scale: at.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
        }}
      />
    </If>
  );
}

/** The halo grows this much across and down as it fades, about the island's top middle. */
const HALO_GROW = { x: 1.12, y: 1.4 };
const HALO_PEAK = 0.8;

/**
 * The reminder's halo: an outline of the island in the accent, behind it, pulsing out (it grows past the island's
 * sides and bottom as it fades), twice as the island opens, then once per `remind.ring` while it waits.
 */
function Halo() {
  const first = createAnimatedValue(1);
  const second = createAnimatedValue(1);
  effect(() => {
    if (!waiting() || reduceMotion()) return;
    const r = T.timing.remind;
    first.set(1);
    second.set(1);
    const pulse: Keyframe[] = [
      { offset: 0, value: 0, easing: FLY },
      { offset: 1, value: 1 },
    ];
    const cycle: Keyframe[] = [
      { offset: 0, value: 0, easing: FLY },
      { offset: r.halo / r.ring, value: 1 },
      { offset: 1, value: 1 },
    ];
    const pulsing = Animated.parallel([
      Animated.sequence([
        Animated.delay(r.haloAfter),
        Animated.keyframes(first, { keyframes: pulse, duration: r.halo }),
        Animated.delay(r.ring - r.halo),
        Animated.keyframes(first, { keyframes: cycle, duration: r.ring, iterations: "infinite" }),
      ]),
      Animated.sequence([Animated.delay(r.haloAfter + r.haloGap), Animated.keyframes(second, { keyframes: pulse, duration: r.halo })]),
    ]);
    pulsing.start();
    return () => {
      pulsing.stop();
      for (const v of [first, second]) void v.timing(1, { duration: SETTLE_MS, easing: "easeOut" });
    };
  });
  return (
    <If when={!reduceMotion()}>
      <HaloRing at={first} />
      <HaloRing at={second} />
    </If>
  );
}

function HaloRing(props: { at: AnimatedValue }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      class="absolute border-primary"
      style={{
        top: 0,
        left: (WINDOW.width - T.size.islandWidth) / 2,
        width: T.size.islandWidth,
        height: T.size.islandHeight,
        borderWidth: 2,
        borderTopWidth: 0,
        borderBottomLeftRadius: T.size.islandRadius,
        borderBottomRightRadius: T.size.islandRadius,
        borderCurve: "continuous",
        pointerEvents: "none",
        opacity: props.at.interpolate({ inputRange: [0, 1], outputRange: [HALO_PEAK, 0] }),
        transformOrigin: "50% 0%",
        transform: [
          { scaleX: props.at.interpolate({ inputRange: [0, 1], outputRange: [1, HALO_GROW.x] }) },
          { scaleY: props.at.interpolate({ inputRange: [0, 1], outputRange: [1, HALO_GROW.y] }) },
        ],
      }}
    />
  );
}

/** The island's mark: the circle at its start, in points across. */
const MARK = 46;

/** The width the island's text has, for telling whether the words overflow (its line fades in from the left then). */
const TEXT_ROOM = T.size.islandWidth - 50 - 46 - 35 - 30;

// ---------------------------------------------------------------------------------------------------------------
// An AI app writing a note. The island opens inside a glow of flowing colors with a thin edge of the same colors;
// the app's avatar falls out of the notch, squashes as it lands and bounces to rest; the title's letters rise in one
// after another, then a sheen sweeps the title while the note is written. Once it is in, the colors give way to a
// green flash, the label says it is saved, the avatar hops and the check pops in. Then the content lifts out and the
// island closes. With reduced motion nothing falls, grows, turns, moves or loops: things only fade.

const writeOf = (event: IslandEvent): WriteEvent | null => (event.kind === "write" ? event : null);

/** CSS's `cubic-bezier(.2, .8, .2, 1)`: quick to arrive, long to settle. */
const ARRIVE: Easing = [0.2, 0.8, 0.2, 1];
/** CSS's `cubic-bezier(.22, 1, .36, 1)`: a reminder's waves and halo going out, fast then slow. */
const FLY: Easing = [0.22, 1, 0.36, 1];

// The glow: a box past the island's sides and bottom (and its top, off the screen), blurred. NSH blurs no view on
// macOS (its `filter: blur()` is for images), so the blur is drawn: the light of a blurred box's edge falls off as a
// Gaussian's integral, and a blurred box is the product of its blurs across and down, so the glow is two nested masks
// whose stops follow that curve. Inside them a conic gradient of the aurora's colors turns, centered on the box, so
// the colors flow around the island while the glow itself stays put.

/** How far the glow's box reaches past the island, and its blur's deviation (a CSS `blur(16px)`), in points. */
const GLOW = { side: 12, below: 14, above: 6, soft: 16 };
/** How far the glow's light reaches past its box: three deviations, where it is all but gone. */
const GLOW_REACH = 3 * GLOW.soft;
/** The glow's view: its box with the reach around it, so its center is the box's (it grows from there). */
const GLOW_VIEW = {
  width: T.size.islandWidth + 2 * (GLOW.side + GLOW_REACH),
  height: T.size.islandHeight + GLOW.above + GLOW.below + 2 * GLOW_REACH,
};
/** The turning gradient covers the glow's view at any angle. */
const GLOW_TURNS = Math.ceil(Math.hypot(GLOW_VIEW.width, GLOW_VIEW.height));
/** The glow fades in to this (it never covers the desktop fully) and grows from this share of its size. */
const GLOW_PEAK = 0.9;
const GLOW_FROM = 0.9;
/** The glow comes in as the island opens, the edge a little after. */
const GLOW_IN = { duration: 700, delay: 120 };
const RIM_IN = { duration: 500, delay: 160 };
/** Once the note is in, the colors go over these as the green flash takes their place. */
const GLOW_OUT_MS = 260;
const RIM_OUT_MS = 300;
/** The green flash: brightest a quarter of the way through, then it grows as it fades. */
const FLASH_MS = 900;
const FLASH_GROW = 1.18;
/** The aurora's thin edge on the island, in points, and the gradient turning under it (covering the island at any angle). */
const RIM = 1.5;
const RIM_TURNS = Math.ceil(Math.hypot(T.size.islandWidth, T.size.islandHeight));

/** The share of a blurred edge's light `d` points inside it (outside when negative), for a blur of deviation `soft`. */
function lit(d: number, soft: number): number {
  // Abramowitz and Stegun's erf (7.1.26), within 1.5e-7.
  const x = Math.abs(d) / (soft * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + Math.sign(d) * erf);
}

/** A mask `length` points long whose ends, `GLOW_REACH` in from each, are blurred as the glow's box's edges are. */
function blurredEnds(direction: "to right" | "to bottom", length: number): string {
  const steps = 8;
  const near: string[] = [];
  const far: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (2 * GLOW_REACH * i) / steps;
    const alpha = i === 0 ? 0 : i === steps ? 1 : lit(x - GLOW_REACH, GLOW.soft);
    near.push(`rgba(0, 0, 0, ${alpha.toFixed(3)}) ${x}px`);
    far.unshift(`rgba(0, 0, 0, ${alpha.toFixed(3)}) ${length - x}px`);
  }
  return `linear-gradient(${direction}, ${[...near, ...far].join(", ")})`;
}
const GLOW_ACROSS = blurredEnds("to right", GLOW_VIEW.width);
const GLOW_DOWN = blurredEnds("to bottom", GLOW_VIEW.height);

/** The aurora's colors around a circle, back to the first. */
function auroraGradient() {
  const colors = [token("island-aurora-1"), token("island-aurora-2"), token("island-aurora-3"), token("island-aurora-4"), token("island-aurora-5")];
  return `conic-gradient(${[...colors, colors[0]].join(", ")})`;
}

/** The glow's and the edge's animated values, shared by the glow behind the island and the edge in it. */
interface AuroraValues {
  /** The colors' turn, in degrees. */
  turn: AnimatedValue;
  /** The glow's opacity and size. */
  glow: AnimatedValue;
  grow: AnimatedValue;
  /** The edge's opacity. */
  rim: AnimatedValue;
  /** The green flash's progress, from 0 to 1. */
  flash: AnimatedValue;
}

/** Runs the aurora while an AI app writes: in as the island opens, the colors turning, out with a green flash once the note is in. */
function useAurora(): AuroraValues {
  const a: AuroraValues = {
    turn: createAnimatedValue(0),
    glow: createAnimatedValue(0),
    grow: createAnimatedValue(GLOW_FROM),
    rim: createAnimatedValue(0),
    flash: createAnimatedValue(0),
  };
  const writing = () => isOpen() && isCreate(current());
  // The colors turn while the island is open for the note (they are faded out by the time it closes).
  effect(() => {
    if (!writing() || reduceMotion()) return;
    a.turn.set(0);
    const turning = Animated.keyframes(a.turn, {
      keyframes: [
        { offset: 0, value: 0, easing: "linear" },
        { offset: 1, value: 360 },
      ],
      duration: T.timing.islandGlowTurn,
      iterations: "infinite",
    });
    turning.start();
    return () => turning.stop();
  });
  effect(() => {
    const saved = done();
    if (!writing()) {
      for (const v of [a.glow, a.rim, a.flash]) v.set(0);
      return;
    }
    const still = reduceMotion();
    if (!saved) {
      for (const v of [a.glow, a.rim, a.flash]) v.set(0);
      a.grow.set(still ? 1 : GLOW_FROM);
      const coming = Animated.parallel([
        Animated.timing(a.glow, { toValue: GLOW_PEAK, ...GLOW_IN, easing: ARRIVE }),
        ...(still ? [] : [Animated.timing(a.grow, { toValue: 1, ...GLOW_IN, easing: ARRIVE })]),
        Animated.timing(a.rim, { toValue: 1, ...RIM_IN, easing: "linear" }),
      ]);
      coming.start();
      return () => coming.stop();
    }
    const going = Animated.parallel([
      Animated.timing(a.glow, { toValue: 0, duration: GLOW_OUT_MS, easing: "linear" }),
      Animated.timing(a.rim, { toValue: 0, duration: RIM_OUT_MS, easing: "linear" }),
      Animated.timing(a.flash, { toValue: 1, duration: FLASH_MS, easing: ARRIVE }),
    ]);
    going.start();
    return () => going.stop();
  });
  return a;
}

/** A soft box around the island, as a blur of a box would be: its content shows through two masks, across and down. */
function GlowBox(props: { opacity: AnimatedNode; scale: AnimatedNode | null; children: JSX.Element }) {
  return (
    <View
      class="absolute"
      style={{
        left: (WINDOW.width - GLOW_VIEW.width) / 2,
        top: -(GLOW.above + GLOW_REACH),
        width: GLOW_VIEW.width,
        height: GLOW_VIEW.height,
        opacity: props.opacity,
        transform: props.scale ? [{ scale: props.scale }] : undefined,
        maskImage: GLOW_ACROSS,
      }}
    >
      <View class="flex-1 items-center justify-center" style={{ maskImage: GLOW_DOWN }}>
        {props.children}
      </View>
    </View>
  );
}

/** The glow behind the island: the aurora's colors turning, then the green flash. */
function Aurora(props: { aurora: AuroraValues }) {
  const a = props.aurora;
  const flashAt = (values: number[]) => a.flash.interpolate({ inputRange: [0, 0.25, 1], outputRange: values });
  return (
    <>
      <GlowBox opacity={a.glow} scale={reduceMotion() ? null : a.grow}>
        <View
          style={{
            width: GLOW_TURNS,
            height: GLOW_TURNS,
            flexShrink: 0,
            backgroundImage: auroraGradient(),
            transform: reduceMotion() ? undefined : [{ rotate: a.turn }],
          }}
        />
      </GlowBox>
      <GlowBox opacity={flashAt([0, 1, 0])} scale={reduceMotion() ? null : flashAt([1, 1.02, FLASH_GROW])}>
        <View class="absolute bg-ok" style={{ left: 0, right: 0, top: 0, bottom: 0 }} />
      </GlowBox>
    </>
  );
}

/**
 * The aurora's thin edge on the island: the colors turning (with the glow's) under a cover of the island's black
 * `RIM` in from its sides and bottom. Only the colors fade, so the cover never shows them through.
 */
function Rim(props: { aurora: AuroraValues; radius: number }) {
  return (
    <View class="absolute items-center justify-center" style={{ left: 0, right: 0, top: 0, bottom: 0 }}>
      <View
        style={{
          width: RIM_TURNS,
          height: RIM_TURNS,
          flexShrink: 0,
          opacity: props.aurora.rim,
          backgroundImage: auroraGradient(),
          transform: reduceMotion() ? undefined : [{ rotate: props.aurora.turn }],
        }}
      />
      <View
        class="absolute bg-island"
        style={{
          left: RIM,
          right: RIM,
          top: 0,
          bottom: RIM,
          borderBottomLeftRadius: props.radius,
          borderBottomRightRadius: props.radius,
          borderCurve: "continuous",
        }}
      />
    </View>
  );
}

/**
 * The island as an AI app writes to a note: its avatar, what it does, the note's title, and the check once it is in.
 * A new note's title comes in letter by letter while it is written; any other write says what was done at once. A
 * click opens the note (a rewritten one: its version history; a trashed one: shows it in the Trash).
 */
function WriteContent(props: { event: WriteEvent }) {
  const trashed = () => props.event.action === "trash";
  return (
    <Button
      testID="island-write"
      accessibilityLabel={t(trashed() ? "island.show_trashed" : props.event.action === "replace" ? "island.open_history" : "island.open_note", { title: props.event.title })}
      onPress={() => openWrite(props.event)}
      class="flex-1 flex-row items-center"
      style={{ gap: 15, alignSelf: "stretch" }}
    >
      <Avatar />
      <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <If when={props.event.action === "create"} else={<DoneWrite event={props.event} />}>
          <WriteLabel agent={props.event.agent} />
          <Title title={props.event.title} />
        </If>
      </View>
      <View class="items-center justify-center" style={{ width: 35, height: 35 }}>
        <SavedCheck />
      </View>
    </Button>
  );
}

/** What each write other than a new note says. */
const DONE_LABEL: Record<Exclude<AgentAction, "create">, string> = {
  append: "island.appended",
  todo: "island.todo_added",
  complete: "island.todo_done",
  reschedule: "island.rescheduled",
  replace: "island.replaced",
  trash: "island.trashed",
};

/** A write other than a new note: what the app did, and the note's title, at once. */
function DoneWrite(props: { event: WriteEvent }) {
  const label = () => {
    const action = props.event.action;
    return action === "create" ? t("island.written", { agent: props.event.agent }) : t(DONE_LABEL[action], { agent: props.event.agent });
  };
  return (
    <>
      <Text testID="island-label" class="text-island-muted" style={{ numberOfLines: 1, fontSize: T.type.islandLabel }}>
        {label()}
      </Text>
      <Text testID="island-title" class="font-semibold text-island-fg" style={{ numberOfLines: 1, fontSize: T.type.island }}>
        {props.event.title}
      </Text>
    </>
  );
}

/** Frames of a few values at 60 per second, as keyframes to play natively over `ms`. */
interface Frames {
  ms: number;
  y: Keyframe[];
  sx: Keyframe[];
  sy: Keyframe[];
}

function framesOf(points: { y: number; sx: number; sy: number }[]): Frames {
  const last = points.length - 1;
  const track = (key: "y" | "sx" | "sy"): Keyframe[] =>
    points.map((p, i) => ({ offset: i / last, value: Math.round(p[key] * 1000) / 1000, easing: "linear" }));
  return { ms: (last * 1000) / 60, y: track("y"), sx: track("sx"), sy: track("sy") };
}

/**
 * A fall under gravity (`gravity`, points per second squared) from `height` points above, bouncing back with
 * `bounce` of its speed until it comes to rest: where it is, frame by frame, and how it squashes (wide as it lands,
 * tall as it falls fast), about its bottom.
 */
function fallFrames(height: number, gravity: number, bounce: number): Frames {
  const dt = 1 / 60;
  const points: { y: number; sx: number; sy: number }[] = [];
  let y = -height;
  let v = 0;
  let squash = 0;
  for (let i = 0; i < 400; i++) {
    v += gravity * dt;
    y += v * dt;
    let hit = 0;
    if (y >= 0) {
      y = 0;
      hit = v;
      v = -v * bounce;
    }
    squash = squash * 0.6 + (hit ? Math.min(0.3, hit / 3000) : 0);
    const stretch = y < 0 ? Math.min(0.14, Math.abs(v) / 7000) : 0;
    points.push({ y, sx: 1 + squash - stretch * 0.5, sy: 1 - squash + stretch });
    // Too slow to bounce visibly again: it rests.
    if (hit && Math.abs(v) < 110) break;
  }
  for (let i = 0; i < 10; i++) {
    squash *= 0.55;
    points.push({ y: 0, sx: 1 + squash, sy: 1 - squash });
  }
  points.push({ y: 0, sx: 1, sy: 1 });
  return framesOf(points);
}

/** CSS's `cubic-bezier(x1, y1, x2, y2)` as a function of the time's share (0 to 1). */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t) => {
    if (t <= 0 || t >= 1) return t;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/**
 * The avatar's happy hop once the note is in, over `ms`: it crouches, springs up 8 points stretching, lands squashed
 * and settles. Its keyframes ease over the whole (`cubic-bezier(.2, .7, .35, 1)`) and its fall from the top on its
 * own (`cubic-bezier(.6, 0, .85, .4)`, gathering speed), as the Web Animations API plays them; sampled here at 60
 * frames per second.
 */
function hopFrames(ms: number): Frames {
  const offsets = [0, 0.16, 0.46, 0.74, 1];
  const ys = [0, 0, -8, 0, 0];
  const sxs = [1, 1.1, 0.95, 1.08, 1];
  const sys = [1, 0.9, 1.06, 0.92, 1];
  const whole = cubicBezier(0.2, 0.7, 0.35, 1);
  const fall = cubicBezier(0.6, 0, 0.85, 0.4);
  const n = Math.round((ms / 1000) * 60);
  const points: { y: number; sx: number; sy: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const p = whole(i / n);
    let k = 0;
    while (k < offsets.length - 2 && p > offsets[k + 1]) k++;
    const local = (p - offsets[k]) / (offsets[k + 1] - offsets[k]);
    const u = k === 2 ? fall(local) : local;
    const mix = (v: number[]) => v[k] + (v[k + 1] - v[k]) * u;
    points.push({ y: mix(ys), sx: mix(sxs), sy: mix(sys) });
  }
  return framesOf(points);
}

/** The avatar (and a reminder's bell) falls 66 points (out of the notch, above the island's top) as the content starts
 * to show. */
const FALL = fallFrames(66, 2700, 0.45);
/** It hops a little after the note is in (the reminder ticked), as the label starts to change. */
const HOP = hopFrames(560);
const HOP_AFTER = 60;

/**
 * The island's mark falling out of the notch and bouncing to rest as it opens, then hopping once it is done (the note
 * in, the reminder ticked): the frames are computed once and played natively. With reduced motion it fades in where it
 * rests and stays. Spread `style()` into the mark's style.
 */
function useDrop() {
  const y = createAnimatedValue(0);
  const sx = createAnimatedValue(1);
  const sy = createAnimatedValue(1);
  const seen = createAnimatedValue(1);

  effect(() => {
    const saved = done();
    if (!isOpen()) return;
    if (reduceMotion()) {
      y.set(0);
      sx.set(1);
      sy.set(1);
      if (saved) return;
      seen.set(0);
      void fadeTo(seen, 1, 180, CONTENT_IN);
      return;
    }
    seen.set(1);
    const frames = saved ? HOP : FALL;
    // Before it falls it waits above the island's top, out of sight.
    if (!saved) y.set(FALL.y[0].value as number);
    const timing = { duration: frames.ms, delay: saved ? HOP_AFTER : CONTENT_IN, easing: "linear" as const };
    const motion = Animated.parallel([
      Animated.keyframes(y, { keyframes: frames.y, ...timing }),
      Animated.keyframes(sx, { keyframes: frames.sx, ...timing }),
      Animated.keyframes(sy, { keyframes: frames.sy, ...timing }),
    ]);
    motion.start();
    return () => motion.stop();
  });

  return {
    style: () => ({
      opacity: seen,
      transformOrigin: "50% 100%",
      transform: reduceMotion() ? undefined : [{ translateY: y }, { scaleX: sx }, { scaleY: sy }],
    }),
  };
}

/**
 * The agent's avatar: it falls out of the notch and bounces to rest, then hops once the note is in (`useDrop`), Jot's
 * logo written on it as it falls (`Logo`).
 */
function Avatar() {
  const drop = useDrop();
  return (
    <View
      accessibilityLabel={done() ? undefined : t("island.writing_label")}
      class="items-center justify-center"
      style={{
        width: MARK,
        height: MARK,
        borderRadius: MARK / 2,
        // Jot's mark, in its own colors whatever the theme: white on the brand's indigo.
        backgroundImage: `radial-gradient(circle at 35% 30%, ${token("island-logo-light")}, ${token("island-logo")} 60%)`,
        ...drop.style(),
      }}
    >
      <Logo />
    </View>
  );
}

/** The pen writing the avatar's logo: under half a second from as the avatar starts falling, so the dot is in about as
 * it lands. */
const AVATAR_PEN = { writeMs: 340, dotMs: 140 };
/** The logo's box in the avatar, in points (the strokes fill about four fifths of it). */
const LOGO = 28;

/**
 * Jot's logo on the avatar, white (`island-logo-ink`): written by one pen stroke, then the dot, as the avatar falls
 * (app/ink.ts, the tray's writing at its own pace), and drawn from then on. Its frames are made once and kept, and the
 * logo at rest is their last. With reduced motion it is whole at once. `island-logo` names it whole, `island-ink`
 * while it is written.
 */
function Logo() {
  // Decoded at three times its size, so it stays sharp on any display.
  const frames = () => inkFrames(AVATAR_PEN, token("island-logo-ink"), LOGO * 3);
  /** The frame while the pen writes; null once the logo is whole. */
  const ink = signal<string | null>(null);
  effect(() => {
    const saved = done();
    if (!isOpen()) return;
    if (saved || reduceMotion()) {
      ink.set(null);
      return;
    }
    return playInk(untracked(frames), (frame) => ink.set(frame), { delay: CONTENT_IN, onEnd: () => ink.set(null) });
  });
  return (
    <Image
      testID={ink() ? "island-ink" : "island-logo"}
      src={ink() ?? frames()[frames().length - 1]}
      accessible={false}
      style={{ width: LOGO, height: LOGO, pointerEvents: "none" }}
    />
  );
}

/** The label goes out up over this, then the saved one comes in from below over that, each moving this far. */
const LABEL_OUT_MS = 130;
const LABEL_IN_MS = 260;
const LABEL_SHIFT = 4;

/** What the app does: writing, then (once the note is in) saved, the words swapping out up and in from below. */
function WriteLabel(props: { agent: string }) {
  const saidSaved = signal(false);
  const opacity = createAnimatedValue(1);
  const shift = createAnimatedValue(0);
  effect(() => {
    if (!done()) {
      saidSaved.set(false);
      opacity.set(1);
      shift.set(0);
      return;
    }
    const still = reduceMotion();
    let coming: ReturnType<typeof Animated.parallel> | undefined;
    const going = Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: LABEL_OUT_MS, easing: "easeIn" }),
      ...(still ? [] : [Animated.timing(shift, { toValue: -LABEL_SHIFT, duration: LABEL_OUT_MS, easing: "easeIn" })]),
    ]);
    going.start(({ finished }) => {
      if (!finished) return;
      saidSaved.set(true);
      if (!still) shift.set(LABEL_SHIFT);
      coming = Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: LABEL_IN_MS, easing: ARRIVE }),
        ...(still ? [] : [Animated.timing(shift, { toValue: 0, duration: LABEL_IN_MS, easing: ARRIVE })]),
      ]);
      coming.start();
    });
    return () => {
      going.stop();
      coming?.stop();
    };
  });
  return (
    <Text
      class="text-island-muted"
      style={{ numberOfLines: 1, fontSize: T.type.islandLabel, opacity, transform: [{ translateY: shift }] }}
    >
      {saidSaved() ? t("island.written", { agent: props.agent }) : t("island.writing", { agent: props.agent })}
    </Text>
  );
}

// The title: its letters rise in one after another, from `LETTER_RISE` below and transparent, once the avatar is on
// its way down. Then, while the note is written, a sheen sweeps it: the title dims to `SHEEN_DIM` and a full-white
// copy shows through a band whose mask ramps up to its middle and down again. The band moves across while the copy in
// it moves back as much, so the copy stays on the title's letters and only the light travels.

/** The letters start rising this long after the island starts to open. */
const TITLE_AFTER = CONTENT_IN + 240;
/** Each letter rises this far, over this long, the next starting `LETTER_STAGGER` later; all within `TITLE_SPAN`, so a
 * long title takes no longer to come in. */
const LETTER_RISE = 4;
const LETTER_MS = 420;
const LETTER_STAGGER = 30;
const TITLE_SPAN = 300;
const staggerOf = (letters: number) => Math.min(LETTER_STAGGER, TITLE_SPAN / Math.max(1, letters));

/** From the island starting to open until the last of `letters` letters is in. */
function revealMs(letters: number) {
  return TITLE_AFTER + letters * staggerOf(letters) + LETTER_MS;
}

/**
 * A space between the title's letters: NSH lays out a Text holding only a space (a no-break one too) zero wide, which
 * ran the words together, so a space is a gap of a space's width instead.
 */
const SPACE = "\u00a0";
const SPACE_WIDTH = T.type.island * 0.28;

/** The letters of `title` the island has room for (and the one the edge cuts); a space is `SPACE`. */
function titleLetters(title: string): string[] {
  const letters: string[] = [];
  let width = 0;
  for (const ch of title) {
    if (width > TEXT_ROOM) break;
    letters.push(/\s/.test(ch) ? SPACE : ch);
    width += textWidth(ch);
  }
  return letters;
}

/** A long title fades out at the island's edge. */
const TITLE_FADE = "linear-gradient(to right, black 82%, transparent 100%)";
/** The title's brightness under the sheen, outside its band (the band's middle is full white). */
const SHEEN_DIM = 0.55;
/** The sheen comes and goes over this. */
const SHEEN_FADE_MS = 150;
/** The band: 1.2 titles wide, its middle sweeping from half a title before the title to half a title past it. */
const SHEEN_BAND = 1.2 * TEXT_ROOM;
const SHEEN_FROM = -0.5 * TEXT_ROOM - SHEEN_BAND / 2;
const SHEEN_TO = 1.5 * TEXT_ROOM - SHEEN_BAND / 2;
const SHEEN_MASK = "linear-gradient(100deg, transparent 0%, black 50%, transparent 100%)";

/** The note's title: its letters rising in, then the sheen while the note is written. */
function Title(props: { title: string }) {
  // New letters for each note, even one titled as the last.
  const letters = computed(() => {
    shown();
    const all = titleLetters(props.title);
    return all.map((ch, index) => ({ ch, index, count: all.length }));
  });
  const overflows = () => textWidth(props.title) > TEXT_ROOM;
  const dim = createAnimatedValue(1);
  const band = createAnimatedValue(0);
  const sweep = createAnimatedValue(0);

  effect(() => {
    if (!sheen() || reduceMotion()) {
      const off = Animated.parallel([
        Animated.timing(dim, { toValue: 1, duration: SHEEN_FADE_MS, easing: "easeOut" }),
        Animated.timing(band, { toValue: 0, duration: SHEEN_FADE_MS, easing: "easeOut" }),
      ]);
      off.start();
      return () => off.stop();
    }
    sweep.set(0);
    const on = Animated.parallel([
      Animated.timing(dim, { toValue: SHEEN_DIM, duration: SHEEN_FADE_MS, easing: "easeOut" }),
      Animated.timing(band, { toValue: 1, duration: SHEEN_FADE_MS, easing: "easeOut" }),
      Animated.keyframes(sweep, {
        keyframes: [
          { offset: 0, value: 0, easing: "easeInOut" },
          { offset: 1, value: 1 },
        ],
        duration: T.timing.islandSheenSweep,
        iterations: "infinite",
      }),
    ]);
    on.start();
    return () => on.stop();
  });

  const across = (from: number, to: number) => sweep.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  return (
    <View style={{ overflow: "hidden", maskImage: overflows() ? TITLE_FADE : undefined }}>
      <View class="flex-row" style={{ alignItems: "baseline", opacity: dim }}>
        <Each of={letters()}>{(l) => <Letter ch={l().ch} index={l().index} count={l().count} />}</Each>
      </View>
      <If when={!reduceMotion()}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          class="absolute"
          style={{
            left: 0,
            top: 0,
            bottom: 0,
            width: SHEEN_BAND,
            opacity: band,
            maskImage: SHEEN_MASK,
            transform: [{ translateX: across(SHEEN_FROM, SHEEN_TO) }],
          }}
        >
          <View
            class="absolute flex-row"
            style={{ left: 0, top: 0, width: TEXT_ROOM, alignItems: "baseline", transform: [{ translateX: across(-SHEEN_FROM, -SHEEN_TO) }] }}
          >
            <Each of={letters()}>
              {(l) =>
                l().ch === SPACE ? (
                  <View style={{ width: SPACE_WIDTH }} />
                ) : (
                  <Text class="font-semibold text-island-fg" style={{ fontSize: T.type.island, flexShrink: 0 }}>
                    {l().ch}
                  </Text>
                )
              }
            </Each>
          </View>
        </View>
      </If>
    </View>
  );
}

/** One letter of the title, rising in at its turn; with reduced motion the letters fade in together. */
function Letter(props: { ch: string; index: number; count: number }) {
  const rise = createAnimatedValue(0);
  effect(() => {
    rise.set(0);
    if (reduceMotion()) {
      void fadeTo(rise, 1, 160, TITLE_AFTER);
      return;
    }
    const delay = TITLE_AFTER + untracked(() => props.index * staggerOf(props.count));
    const coming = Animated.timing(rise, { toValue: 1, duration: LETTER_MS, delay, easing: ARRIVE });
    coming.start();
    return () => coming.stop();
  });
  if (props.ch === SPACE) return <View style={{ width: SPACE_WIDTH }} />;
  return (
    <Text
      class="font-semibold text-island-fg"
      style={{
        fontSize: T.type.island,
        flexShrink: 0,
        opacity: rise,
        transform: reduceMotion() ? undefined : [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [LETTER_RISE, 0] }) }],
      }}
    >
      {props.ch}
    </Text>
  );
}

/** The check comes this long after the note is in, fading in over `CHECK_FADE_MS`, springing from `CHECK_FROM` of its
 * size and turning upright from `CHECK_TURN` degrees as it does. */
const CHECK_AFTER = 80;
const CHECK_FADE_MS = 140;
const CHECK_FROM = 0.3;
const CHECK_TURN = -50;

/** The check once the note is in: it springs in turning upright; with reduced motion it fades in. */
function SavedCheck() {
  const pop = createAnimatedValue(CHECK_FROM);
  const seen = createAnimatedValue(0);
  effect(() => {
    if (!done()) {
      pop.set(CHECK_FROM);
      seen.set(0);
      return;
    }
    if (reduceMotion()) {
      pop.set(1);
      void fadeTo(seen, 1, 160);
      return;
    }
    const coming = Animated.parallel([
      Animated.timing(seen, { toValue: 1, duration: CHECK_FADE_MS, delay: CHECK_AFTER, easing: "linear" }),
      Animated.sequence([Animated.delay(CHECK_AFTER), Animated.spring(pop, { toValue: 1, ...springConfig(T.spring.pop) })]),
    ]);
    coming.start();
    return () => coming.stop();
  });
  return (
    <View
      class="absolute items-center justify-center bg-ok"
      style={{
        width: 30,
        height: 30,
        borderRadius: 15,
        opacity: seen,
        transform: reduceMotion()
          ? undefined
          : [{ scale: pop }, { rotate: pop.interpolate({ inputRange: [CHECK_FROM, 1], outputRange: [CHECK_TURN, 0], extrapolate: "extend" }) }],
      }}
    >
      <Icon name="check" size={18} tint={token("on-accent")} />
    </View>
  );
}


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
