// Dictation's marks: a breathing dot while the recognizer listens, and the
// microphone button that starts and stops it. The dot breathes on a steady
// rhythm, a halo swelling out of it and fading: NSH reports no input level,
// so nothing here pretends to follow the voice.
import { Animated, createAnimatedValue, effect, reduceMotion, token, View } from "nsh";
import { Button } from "nsh/base";
import { Icon } from "./icons";

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
