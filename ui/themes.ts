// Jot's themes: each a palette with a light and a dark half (`themes.json`,
// over the base in `theme.json`, which is "default"). The appearance (light,
// dark or the system's) picks the half; the theme is applied at run time
// with `setTheme`. A change crossfades: for a moment the surfaces carry a
// colour transition (`fade()`), so the new colours ease in instead of
// snapping, in one frame on the native side.
import { computed, setColorScheme, setTheme, signal, untracked } from "nsh";
import base from "./theme.json";
import palettes from "./themes.json";

/** A theme's name, as the settings store it. */
export type ThemeName = "default" | "paper" | "moss" | "dusk" | "coral" | "contrast";

/** The themes, in the order the settings show them. */
export const THEMES: readonly ThemeName[] = ["default", "paper", "moss", "dusk", "coral", "contrast"];

/** Light, dark, or the system's. */
export type Appearance = "system" | "light" | "dark";

type Vars = Record<string, string>;
interface Palette {
  /** No glass: opaque surfaces (high contrast). */
  solid: boolean;
  /** The theme card's two colours per appearance: its surface and its accent. */
  swatch: { light: [string, string]; dark: [string, string] };
  light: Vars;
  dark: Vars;
}

const PALETTES = palettes as unknown as Record<ThemeName, Palette>;

/** The theme as `setTheme` takes it: the base's tokens with the palette's over them. */
export function themeVars(name: ThemeName) {
  const p = PALETTES[name];
  return {
    cssVars: {
      theme: base.cssVars.theme,
      light: { ...(base.cssVars.light as Vars), ...p.light },
      dark: { ...(base.cssVars.dark as Vars), ...p.dark },
    },
  };
}

/** A theme's colours for its card in the settings: the surface, the accent, the text, and its paper. */
export function swatch(name: ThemeName, dark: boolean) {
  const vars = themeVars(name).cssVars[dark ? "dark" : "light"];
  const [surface, accent] = PALETTES[name].swatch[dark ? "dark" : "light"];
  return { surface, accent, ink: vars["glass-fg"], muted: vars["glass-muted"], paper: vars.paper, line: vars["glass-line"] };
}

/** The theme shown. */
export const activeTheme = signal<ThemeName>("default");

/** The theme draws without glass: opaque surfaces and hard edges. */
export const solidTheme = computed(() => PALETTES[activeTheme()].solid);

/** The theme tints the native glass (its `glass-tint` is not clear). */
export const tintedGlass = computed(() => !/00$/i.test((PALETTES[activeTheme()].light["glass-tint"] ?? "#00000000").slice(-2)));

/** A colour change is under way: surfaces ease into the new colours. */
const fading = signal(false);
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/** The classes a surface takes so a theme or appearance change crossfades on it; none the rest of the time (selection and hover stay instant). */
export const fade = () => (fading() ? "transition-colors duration-200" : "");

/** Runs `change` once the surfaces carry their transition, then takes the transition away. */
function crossfade(change: () => void) {
  fading.set(true);
  clearTimeout(fadeTimer);
  // The transition is mounted in this commit; the colours change in the next, so they animate.
  setTimeout(() => {
    change();
    fadeTimer = setTimeout(() => fading.set(false), 260);
  }, 0);
}

/** Shows theme `name`; `animate: false` at launch, before anything shows. */
export function applyTheme(name: ThemeName, options: { animate?: boolean } = {}) {
  const apply = () => {
    activeTheme.set(name);
    setTheme(name === "default" ? null : themeVars(name));
  };
  if (options.animate === false || untracked(activeTheme) === name) apply();
  else crossfade(apply);
}

/** Shows the app light, dark or as the system is. */
export function applyAppearance(appearance: Appearance, options: { animate?: boolean } = {}) {
  if (options.animate === false) setColorScheme(appearance);
  else crossfade(() => setColorScheme(appearance));
}
