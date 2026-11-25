// Dictation's marks: a breathing dot while the recognizer listens, the
// microphone button that starts and stops it, and the language tag that
// switches what it listens for. The dot breathes on a steady
// rhythm, a halo swelling out of it and fading: NSH reports no input level,
// so nothing here pretends to follow the voice.
import { Animated, createAnimatedValue, effect, reduceMotion, Text, token, View } from "nsh";
import { Button } from "nsh/base";
import { t } from "nsh/i18n";
import { speechLangMark, speechLangName } from "../app/speechlang";
import { switchVoiceLanguage } from "../app/voice";
import { Icon } from "./icons";
import { T } from "./tokens";

/** One breath, in milliseconds: slow enough to read as calm, quick enough to read as live. */
const BREATH = 1400;

/**
 * A dot `size` points across in `color`, breathing: it swells a little and a
 * halo spreads from it and fades. With reduced motion only its opacity
 * breathes.
 */
export function Breathing(props: { size: number; color: string; testID?: string; accessibilityLabel?: string }) {
  const swell = createAnimatedValue(0.82);
  const halo = createAnimatedValue(0);
  const glow = createAnimatedValue(1);
  effect(() => {
    if (reduceMotion()) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 0.45, duration: BREATH / 2, easing: "easeInOut" }),
          Animated.timing(glow, { toValue: 1, duration: BREATH / 2, easing: "easeInOut" }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(swell, { toValue: 1, duration: BREATH / 2, easing: "easeInOut" }),
          Animated.timing(swell, { toValue: 0.82, duration: BREATH / 2, easing: "easeInOut" }),
        ]),
        Animated.timing(halo, { toValue: 1, duration: BREATH, easing: "easeOut" }),
      ]),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  });
  const dot = props.size * 0.5;
  return (
    <View
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
      class="items-center justify-center"
      style={{ width: props.size, height: props.size }}
    >
      <View
        class="absolute"
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: props.color,
          opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
          transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }],
        }}
      />
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: props.color, opacity: glow, transform: [{ scale: swell }] }} />
    </View>
  );
}

/**
 * The microphone: a quiet glyph at rest (hover gives it a soft plate), a
 * filled accent circle while it listens, which a press stops.
 */
export function MicButton(props: {
  active: boolean;
  onPress: () => void;
  label: string;
  size?: number;
  /** The glyph's color at rest: the surface's muted text. */
  tint: string;
  /** The soft plate under it on hover, as a class (`hover:bg-glass-hover`). */
  hoverClass: string;
  testID?: string;
}) {
  const size = props.size ?? 30;
  return (
    <Button
      testID={props.testID}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      class={`items-center justify-center ${props.active ? "bg-primary" : `bg-transparent ${props.hoverClass}`} active:opacity-70`}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    >
      <Icon name="mic" size={size * 0.6} tint={props.active ? token("on-accent") : props.tint} />
    </Button>
  );
}

/** The language tag's look on each surface: a keycap of that surface's ink. */
const TAG_LOOK = {
  glass: { box: "bg-glass-fg/7 border-glass-fg/10 hover:bg-glass-fg/12", text: "text-glass-muted" },
  paper: { box: "bg-paper-fg/7 border-paper-fg/10 hover:bg-paper-fg/12", text: "text-paper-muted" },
  island: { box: "bg-island-fg/10 border-island-fg/15 hover:bg-island-fg/18", text: "text-island-muted" },
} as const;

/**
 * The language the session listens for, as a keycap (`中`, `EN`, `日`,
 * `繁`): a press (or ⌘L) switches to the next, keeping what was heard.
 */
export function LanguageTag(props: { lang: string; surface: keyof typeof TAG_LOOK; testID?: string }) {
  const look = () => TAG_LOOK[props.surface];
  return (
    <Button
      testID={props.testID}
      accessibilityLabel={t("voice.language_tag", { language: speechLangName(props.lang) })}
      onPress={() => void switchVoiceLanguage()}
      hitSlop={6}
      class={`items-center justify-center border ${look().box} active:opacity-70`}
      style={{ height: 20, minWidth: 22, paddingHorizontal: 5, borderRadius: 5, borderCurve: "continuous" }}
    >
      <Text class={`font-semibold ${look().text}`} style={{ fontSize: T.type.meta - 1, lineHeight: 14 }}>
        {speechLangMark(props.lang)}
      </Text>
    </Button>
  );
}
