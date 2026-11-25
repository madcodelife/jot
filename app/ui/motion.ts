// The app's motion: springs given as SwiftUI's response and damping, run by
// NSH's native animation graph (on the main thread, never through JS each
// frame), and layout morphs through `LayoutAnimation`. With reduced motion,
// nothing moves or scales: values land where they go and only opacity fades.
import { Animated, type AnimatedValue, LayoutAnimation, reduceMotion } from "nsh";
import type { Spring } from "./tokens";

/** `spring` as the native driver's stiffness and damping (mass 1). */
export function springConfig(spring: Spring) {
  const stiffness = (2 * Math.PI / spring.response) ** 2;
  const damping = (4 * Math.PI * spring.damping) / spring.response;
  return { stiffness, damping, mass: 1 };
}

const settleCache = new Map<string, number>();

/** How long `spring` takes to come to rest, in milliseconds: the curve the native driver runs, sampled once. */
export function settleMs(spring: Spring): number {
  const key = `${spring.response}/${spring.damping}`;
  let ms = settleCache.get(key);
  if (ms === undefined) {
    const frames = Animated.sampleSpring({ toValue: 1, ...springConfig(spring) }, 60).length;
    ms = Math.max(120, Math.round((frames * 1000) / 60));
    settleCache.set(key, ms);
  }
  return ms;
}

/** Springs `value` to `to`; with reduced motion it lands there at once. */
export function springTo(value: AnimatedValue, to: number, spring: Spring) {
  if (reduceMotion()) {
    value.set(to);
    return Promise.resolve({ finished: true });
  }
  return value.spring(to, springConfig(spring));
}

/** Fades `value` (an opacity) to `to`: fades stay with reduced motion. */
export function fadeTo(value: AnimatedValue, to: number, duration = 180, delay = 0) {
  return value.timing(to, { duration, delay, easing: "easeOut" });
}

/**
 * Animates the frames the next commit changes (the panel growing, the list
 * narrowing) with `spring`; views coming and going fade. With reduced motion
 * frames change at once and only the fades stay.
 */
export function morphNext(spring: Spring) {
  if (reduceMotion()) {
    LayoutAnimation.configureNext({
      duration: 200,
      create: { type: "easeInEaseOut", property: "opacity" },
      delete: { type: "easeInEaseOut", property: "opacity" },
    });
    return;
  }
  LayoutAnimation.configureNext({
    duration: settleMs(spring),
    update: { type: "spring", springDamping: spring.damping },
    create: { type: "easeInEaseOut", property: "opacity", duration: 200 },
    delete: { type: "easeInEaseOut", property: "opacity", duration: 160 },
  });
}
