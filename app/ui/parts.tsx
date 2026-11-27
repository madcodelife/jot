// Small pieces the panel's rows share: a title or snippet with the query's
// terms highlighted, key hints, the to-do checkbox (and the burst of its
// tick), a label that flips to its new words, and the field a title is
// renamed in (in its row, or at the head of the open note).
import { Animated, computed, createAnimatedValue, effect, keymap, reduceMotion, signal, Text, untracked, View, type AnimatedNode, type CompositeAnimation, type Easing, type InputRef, type TextStyle } from "nsh";
import { Checkbox, Input } from "nsh/base";
import { finishRename } from "../store";
import { Icon } from "./icons";
import { springConfig } from "./motion";
import { T, type Spring } from "./tokens";
import { token } from "nsh";
import { t } from "nsh/i18n";

interface Segment {
  text: string;
  hit: boolean;
}

/** `text` cut into runs that match one of `terms` (case-insensitive) and runs that do not. */
function segments(text: string, terms: readonly string[]): Segment[] {
  const wanted = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (!wanted.length) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: Segment[] = [];
  let at = 0;
  while (at < text.length) {
    let best = -1;
    let length = 0;
    for (const t of wanted) {
      const i = lower.indexOf(t, at);
      if (i >= 0 && (best < 0 || i < best || (i === best && t.length > length))) {
        best = i;
        length = t.length;
      }
    }
    if (best < 0) break;
    if (best > at) out.push({ text: text.slice(at, best), hit: false });
    out.push({ text: text.slice(best, best + length), hit: true });
    at = best + length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** One line of text with the query's terms marked in highlighter yellow (on a selected row too: its light fill keeps the mark clear). */
export function Highlight(props: {
  text: string;
  terms: readonly string[];
  class?: string;
  size: number;
  testID?: string;
  /** Shown before the text, never highlighted: a note's emoji. */
  prefix?: string | null;
}) {
  const parts = computed(() => segments(props.text, props.terms));
  return (
    <Text testID={props.testID} class={props.class} style={{ numberOfLines: 1, fontSize: props.size }}>
      {props.prefix ? `${props.prefix} ` : ""}
      {parts().map((p) => (p.hit ? <Text class="bg-mark text-mark-fg">{p.text}</Text> : p.text))}
    </Text>
  );
}

/** One key as a keycap: a small rounded square with a faint fill and a hairline edge (Raycast's footer keys). */
export function Keycap(props: { label: string; onAccent?: boolean }) {
  return (
    <View
      class={`items-center justify-center border ${props.onAccent ? "bg-on-accent/15 border-on-accent/25" : "bg-glass-fg/7 border-glass-fg/10"}`}
      style={{ height: 20, minWidth: 20, paddingHorizontal: 5, borderRadius: 5, borderCurve: "continuous" }}
    >
      <Text class={props.onAccent ? "text-on-accent-muted" : "text-glass-muted"} style={{ fontSize: T.type.meta, lineHeight: 14 }}>
        {props.label}
      </Text>
    </View>
  );
}

/** A combination's keys, a keycap each, side by side. */
export function Keycaps(props: { keys: readonly string[]; onAccent?: boolean }) {
  return (
    <View class="flex-row items-center" style={{ gap: 3 }} accessibilityLabel={props.keys.join(" ")}>
      <Each of={[...props.keys]} key="index">
        {(key) => <Keycap label={key()} onAccent={props.onAccent} />}
      </Each>
    </View>
  );
}

/** A footer action: what it does, then its keys (`打开 [↩]`); the main action's name in the primary text color. */
export function KeyHint(props: { label: string; keys: readonly string[]; main?: boolean }) {
  return (
    <View class="flex-row items-center" style={{ gap: 6 }}>
      <Text class={props.main ? "text-glass-fg" : "text-glass-muted"} style={{ fontSize: T.type.meta }}>
        {props.label}
      </Text>
      <Keycaps keys={props.keys} />
    </View>
  );
}

/** The short line between two footer actions. */
export function HintDivider() {
  return <View class="bg-glass-line" style={{ width: 1, height: 12 }} />;
}

/** CSS's `cubic-bezier(.65, 0, .35, 1)`: the check drawn and the line struck, slow at both ends. */
export const DRAW: Easing = [0.65, 0, 0.35, 1];
/** CSS's `cubic-bezier(.22, 1, .36, 1)`: the burst flying out, fast then slow. */
const FLY: Easing = [0.22, 1, 0.36, 1];

/**
 * A to-do's checkbox: a circle on Apple platforms (a rounded square elsewhere), filled with the accent once checked;
 * on a selected row (and in the island), white with the check in the accent. Checked while it shows, it ticks: pressed
 * in and back, its fill growing from the center, the check drawn from the left, and a ring and a few sparks bursting
 * out of it (past the row: nothing clips them). With reduced motion the fill and the check only fade in.
 */
export function TodoCheck(props: { checked: boolean; label: string; onCheck: () => void; size: number; onAccent?: boolean; testID?: string }) {
  const radius = () => T.radius.checkbox ?? props.size / 2;
  const initially = untracked(() => props.checked);
  const press = createAnimatedValue(1);
  const fill = createAnimatedValue(initially ? 1 : 0);
  const drawn = createAnimatedValue(initially ? 1 : 0);
  /** Counts the ticks while shown: each one bursts (a new `Burst`). */
  const bursts = signal(0);
  let was = initially;
  effect(() => {
    const on = props.checked;
    if (on === was) return;
    was = on;
    fill.set(0);
    drawn.set(0);
    press.set(1);
    if (!on) return;
    const tick = T.timing.tick;
    if (reduceMotion()) {
      const fading = Animated.parallel([
        Animated.timing(fill, { toValue: 1, duration: 160, easing: "easeOut" }),
        Animated.timing(drawn, { toValue: 1, duration: tick.check, delay: tick.checkAfter, easing: "easeOut" }),
      ]);
      fading.start();
      return () => fading.stop();
    }
    press.set(0.82);
    const ticking = Animated.parallel([
      Animated.spring(press, { toValue: 1, ...springConfig(T.spring.tickPress) }),
      Animated.spring(fill, { toValue: 1, ...springConfig(T.spring.tickFill) }),
      Animated.timing(drawn, { toValue: 1, duration: tick.check, delay: tick.checkAfter, easing: DRAW }),
    ]);
    ticking.start();
    bursts.set(untracked(bursts) + 1);
    return () => ticking.stop();
  });

  const still = () => reduceMotion();
  const mark = () => props.size * 0.72;
  // The check is drawn through a window that slides in from the left over it while the check inside slides back as
  // much: the check stays put and shows from its left edge on (NSH draws no strokes in part).
  const across = (from: number) => drawn.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
  return (
    <View style={{ width: props.size, height: props.size }}>
      <View style={{ transform: still() ? undefined : [{ scale: press }] }}>
        <Checkbox
          testID={props.testID}
          checked={props.checked}
          accessibilityLabel={props.label}
          hitSlop={6}
          onChange={({ checked }) => checked && props.onCheck()}
          indicatorStyle={{ width: props.size, height: props.size, borderRadius: radius(), borderWidth: 1.5 }}
          indicatorClass={`items-center justify-center ${props.onAccent ? "border-on-accent-muted" : "border-glass-fg/40"}`}
          indicator={
            <>
              <View
                class={`absolute ${props.onAccent ? "bg-on-accent" : "bg-primary"}`}
                style={{
                  left: -1.5,
                  top: -1.5,
                  right: -1.5,
                  bottom: -1.5,
                  borderRadius: radius(),
                  borderCurve: "continuous",
                  opacity: still() ? fill : 1,
                  transform: still() ? undefined : [{ scale: fill }],
                }}
              />
              <View
                style={{
                  width: mark(),
                  height: mark(),
                  overflow: "hidden",
                  opacity: still() ? drawn : 1,
                  transform: still() ? undefined : [{ translateX: across(-mark()) }],
                }}
              >
                <View style={{ transform: still() ? undefined : [{ translateX: across(mark()) }] }}>
                  <Icon name="check" size={mark()} tint={props.onAccent ? token("primary") : token("on-accent")} />
                </View>
              </View>
            </>
          }
        />
      </View>
      <Each of={bursts() ? [bursts()] : []} key={(n) => n}>
        {() => <Burst size={props.size} radius={radius()} onAccent={!!props.onAccent} />}
      </Each>
    </View>
  );
}

/** How many sparks a tick bursts, and how far they fly from the checkbox's center (up to `SPARK_REACH` further). */
const SPARKS = 10;
const SPARK_FROM = 18;
const SPARK_REACH = 10;
const SPARK = 4;

/**
 * A tick's burst: a ring the checkbox's size growing out of it while it fades, and sparks flying out from its center,
 * shrinking and fading. Drawn over the checkbox and past it, for the eye only.
 */
function Burst(props: { size: number; radius: number; onAccent: boolean }) {
  const ring = createAnimatedValue(0);
  const sparks = Array.from({ length: SPARKS }, (_, i) => {
    const angle = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.4;
    const reach = SPARK_FROM + Math.random() * SPARK_REACH;
    return {
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      ms: T.timing.tick.spark + Math.random() * T.timing.tick.sparkSpread,
      at: createAnimatedValue(0),
    };
  });
  effect(() => {
    const burst = Animated.parallel([
      Animated.timing(ring, { toValue: 1, duration: T.timing.tick.ring, easing: FLY }),
      ...sparks.map((s) => Animated.timing(s.at, { toValue: 1, duration: s.ms, easing: FLY })),
    ]);
    burst.start();
    return () => burst.stop();
  });
  const color = props.onAccent ? "bg-on-accent" : "bg-primary";
  const fade = (node: typeof ring, from: number) => node.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      class="absolute items-center justify-center"
      style={{ left: 0, top: 0, width: props.size, height: props.size, pointerEvents: "none" }}
    >
      <View
        class={`absolute ${props.onAccent ? "border-on-accent" : "border-primary"}`}
        style={{
          left: 0,
          top: 0,
          width: props.size,
          height: props.size,
          borderWidth: 1.5,
          borderRadius: props.radius,
          borderCurve: "continuous",
          opacity: fade(ring, 0.9),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.9, 2.4] }) }],
        }}
      />
      {sparks.map((s) => (
        <View
          class={`absolute ${color}`}
          style={{
            left: (props.size - SPARK) / 2,
            top: (props.size - SPARK) / 2,
            width: SPARK,
            height: SPARK,
            borderRadius: SPARK / 2,
            opacity: fade(s.at, 1),
            transform: [
              { translateX: s.at.interpolate({ inputRange: [0, 1], outputRange: [0, s.x] }) },
              { translateY: s.at.interpolate({ inputRange: [0, 1], outputRange: [0, s.y] }) },
              { scale: s.at.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

/**
 * A line struck through a text from its left as `progress` goes from 0 to 1 (with reduced motion it fades in whole),
 * in the text's ink; `opacity` dims it with the text. Put it in a view around the text alone.
 */
export function StrikeLine(props: { progress: AnimatedNode; class: string; opacity?: AnimatedNode }) {
  const still = () => reduceMotion();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      class={`absolute ${props.class}`}
      style={{
        left: -2,
        right: -2,
        top: "52%",
        height: 1.5,
        borderRadius: 1,
        pointerEvents: "none",
        opacity: still() ? (props.opacity ? props.progress.mul(props.opacity) : props.progress) : (props.opacity ?? 1),
        transformOrigin: "0% 50%",
        transform: still() ? undefined : [{ scaleX: props.progress }],
      }}
    />
  );
}

/** How a label flips: the old words lift `lift` points out over `out` ms, fading; the new ones come from `rise` points
 * below, fading in over `in` ms, on `spring` (else over `in`, quick to arrive and long to settle). */
export interface Flip {
  lift: number;
  out: number;
  rise: number;
  in: number;
  spring?: Spring;
}

/** CSS's `cubic-bezier(.2, .8, .2, 1)`. */
const ARRIVE: Easing = [0.2, 0.8, 0.2, 1];

/**
 * A line of text that flips to its new words as `text` changes: the old ones lift out, the new ones come up from
 * below. With reduced motion they only fade. The words it shows at first come in as they are.
 */
export function FlipText(props: { text: string; flip: Flip; class?: string; style?: TextStyle; testID?: string }) {
  const shown = signal(untracked(() => props.text));
  const opacity = createAnimatedValue(1);
  const shift = createAnimatedValue(0);
  let flipping = false;
  effect(() => {
    const text = props.text;
    const flip = untracked(() => props.flip);
    if (text === untracked(shown)) {
      // Back to the words it shows, halfway through a flip: they come back.
      if (flipping) {
        flipping = false;
        void opacity.timing(1, { duration: flip.in, easing: "easeOut" });
        shift.set(0);
      }
      return;
    }
    flipping = true;
    const still = reduceMotion();
    let coming: CompositeAnimation | undefined;
    const going = Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: flip.out, easing: "easeIn" }),
      ...(still ? [] : [Animated.timing(shift, { toValue: -flip.lift, duration: flip.out, easing: "easeIn" })]),
    ]);
    going.start(({ finished }) => {
      if (!finished) return;
      shown.set(text);
      flipping = false;
      if (!still) shift.set(flip.rise);
      coming = Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: flip.in, easing: flip.spring ? "easeOut" : ARRIVE }),
        ...(still
          ? []
          : [
              flip.spring
                ? Animated.spring(shift, { toValue: 0, ...springConfig(flip.spring) })
                : Animated.timing(shift, { toValue: 0, duration: flip.in, easing: ARRIVE }),
            ]),
      ]);
      coming.start();
    });
    return () => {
      going.stop();
      coming?.stop();
    };
  });
  return (
    <Text testID={props.testID} class={props.class} style={{ ...props.style, opacity, transform: [{ translateY: shift }] }}>
      {shown()}
    </Text>
  );
}

/**
 * A note's title being renamed, in place (its row, the open note's head), selected: Return or leaving the field
 * renames, Escape keeps the old title. `onDone` says where the keys go next.
 */
export function RenameField(props: { title: string; class: string; style: TextStyle; onDone: () => void }) {
  const value = signal(props.title);
  let finished = false;
  const finish = (to: string | null) => {
    if (finished) return;
    finished = true;
    finishRename(to);
    props.onDone();
  };
  // Newer than the panel's Escape (which steps back): this one only leaves the field.
  keymap.bind("escape", () => finish(null), { when: "always" });
  return (
    <Input
      testID="rename"
      ref={(r: InputRef | undefined) => {
        r?.focus();
        r?.setSelection(0, props.title.length);
      }}
      class={props.class}
      style={{ ...props.style, backgroundColor: "transparent", padding: 0 }}
      value={value()}
      accessibilityLabel={t("actions.rename_label", { title: props.title })}
      autoCorrect={false}
      autoCapitalize="none"
      submitBehavior="submit"
      onChange={({ value: next }) => value.set(next)}
      onSubmit={() => finish(untracked(value))}
      onBlur={() => finish(untracked(value))}
    />
  );
}
