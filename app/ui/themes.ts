// Jot's themes: each a palette with a light and a dark half (`themes.json`,
// over the base in `theme.json`, which is "default"). Besides the default (macOS
// system blue) and the high-contrast one, they take their colours from popular VS Code
// themes (GitHub, One Dark Pro and Atom One Light, Dracula and Alucard, Tokyo
// Night, Catppuccin, Gruvbox; all MIT), picked for a notes panel rather than
// an editor and held to WCAG AA. The appearance (light,
// dark or the system's) picks the half; the theme is applied at run time
// with `setTheme`. A change crossfades: for a moment the surfaces carry a
// colour transition (`fade()`), so the new colours ease in instead of
// snapping, in one frame on the native side.
import { computed, setColorScheme, setTheme, signal, untracked } from "nsh";
import base from "./theme.json";
import palettes from "./themes.json";

/** A theme's name, as the settings store it. */
export type ThemeName = "default" | "github" | "one" | "dracula" | "tokyo" | "catppuccin" | "gruvbox" | "contrast";

/** The themes, in the order the settings show them. */
export const THEMES: readonly ThemeName[] = ["default", "github", "one", "dracula", "tokyo", "catppuccin", "gruvbox", "contrast"];

/** The themes earlier versions had, each with the one that took its place. */
export const RETIRED: Readonly<Record<string, ThemeName>> = { paper: "gruvbox", dusk: "dracula", coral: "catppuccin", moss: "default" };

/** The theme a stored name means: itself, a retired theme's successor, else the default. */
export function themeFromStored(stored: string | null): ThemeName {
  if (stored === null) return "default";
  if (THEMES.includes(stored as ThemeName)) return stored as ThemeName;
  return Object.prototype.hasOwnProperty.call(RETIRED, stored) ? RETIRED[stored] : "default";
}

/** Light, dark, or the system's. */
export type Appearance = "system" | "light" | "dark";

type Vars = Record<string, string>;
interface Palette {
  /** No glass: opaque surfaces (high contrast). */
  solid: boolean;
  /** The theme card's surface per appearance: the panel's colour, opaque. */
  swatch: { light: string; dark: string };
  light: Vars;
  dark: Vars;
}

const PALETTES = palettes as unknown as Record<ThemeName, Palette>;

/**
 * The selected row's words (on its light accent fill), and the colours each is by default. A palette names one only
 * where its default reads below WCAG AA on the fill (a deeper shade); else it is the palette's own default, never the
 * base's.
 */
const SELECTED: Readonly<Record<string, string>> = {
  "selected-ink": "accent-ink",
  "selected-muted": "glass-muted",
  "selected-agent": "agent-ink",
  "selected-late": "late",
};

/** A half of the theme: the base's tokens with the palette's over them, the selected row's words following the palette's. */
function half(baseVars: Vars, own: Vars): Vars {
  const vars = { ...baseVars, ...own };
  for (const [token, from] of Object.entries(SELECTED)) {
    if (own[token] === undefined && own[from] !== undefined) vars[token] = own[from];
  }
  return vars;
}

/** The theme as `setTheme` takes it: the base's tokens with the palette's over them. */
export function themeVars(name: ThemeName) {
  const p = PALETTES[name];
  return {
    cssVars: {
      theme: base.cssVars.theme,
      light: half(base.cssVars.light as Vars, p.light),
      dark: half(base.cssVars.dark as Vars, p.dark),
    },
  };
}

/** A theme's colours for its card in the settings, a small panel drawn in them: the surface, the selected row and its words, the text, the paper and its text, a reminder's and an AI app's colours. */
export function swatch(name: ThemeName, dark: boolean) {
  const vars = themeVars(name).cssVars[dark ? "dark" : "light"];
  return {
    surface: PALETTES[name].swatch[dark ? "dark" : "light"],
    /** The selected row's fill, as the list draws it (`bg-primary/12`: the accent at 12%, `1f`), and its title. */
    selected: `${vars.primary.slice(0, 7)}1f`,
    selectedInk: vars["selected-ink"],
    ink: vars["glass-fg"],
    muted: vars["glass-muted"],
    line: vars["glass-line"],
    paper: vars.paper,
    paperInk: vars["paper-fg"],
    paperMuted: vars["paper-muted"],
    box: vars["accent-ink"],
    due: vars.due,
    agent: vars.agent,
  };
}

/** The theme shown. */
export const activeTheme = signal<ThemeName>("default");

/** The theme draws without glass: opaque surfaces and hard edges. */
export const solidTheme = computed(() => PALETTES[activeTheme()].solid);

/** Theme `name` tints the glass (its `glass-tint` is not clear). */
const tints = (name: ThemeName) => !/00$/i.test((PALETTES[name].light["glass-tint"] ?? "#00000000").slice(-2));

/**
 * Theme `name` draws its own surface (`glass-fill`) on the floating layer: always without native glass, and over it
 * for a solid theme or one that tints it. The tint alone comes out all but grey on Liquid Glass, so a coloured theme
 * without its fill changed nothing but the accent. Only the default theme lets the glass be its surface.
 */
export const drawsSurface = (name: ThemeName, nativeGlass: boolean) => !nativeGlass || PALETTES[name].solid || tints(name);

/** The theme tints the native glass. */
export const tintedGlass = computed(() => tints(activeTheme()));

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
