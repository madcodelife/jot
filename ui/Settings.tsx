// The settings window: a macOS settings window, with the pane's name in the
// title bar, icon tabs under it, and grouped rows of a label on the left and
// its control on the right. The window's height follows the pane: each pane
// is measured as it lays out and the window resizes to it, animated as
// macOS animates its settings windows, while the new pane fades in.
//
// Every change applies at once (`app/settings.ts`); nothing waits for a
// Save button.
import {
  appInfo,
  Clipboard,
  colorScheme,
  createAnimatedValue,
  effect,
  localeSettings,
  openUrl,
  platform,
  signal,
  Text,
  token,
  untracked,
  View,
  type Bounds,
  type JSX,
} from "nsh";
import { Button, Radio, RadioGroup, Tab, Tabs } from "nsh/base";
import { Application, displays, Window, type Display, type WindowRef } from "nsh/desktop";
import { t } from "nsh/i18n";
import { Folder, Summon } from "jot/native";
import { LANGUAGES } from "../app/i18n";
import {
  appearance,
  defaultTime,
  holdToTalk,
  islandOn,
  language,
  notificationsOn,
  setAppearance,
  setDefaultTime,
  setHoldToTalk,
  setIsland,
  setLanguage,
  setNotifications,
  setSpeechLanguage,
  setThemeName,
  SPEECH_LANGUAGES,
  speechLanguage,
  theme,
  type LanguageChoice,
  type SpeechLanguageChoice,
} from "../app/settings";
import { PRIVACY_URL, speechAvailable, speechDenied } from "../app/voice";
import { changeFolder, errorMessage, folderPath, folderShown, trusted } from "../app/store";
import { FORM, Hint, MacSwitch, PopupButton, PushButton, Segmented, TimeInput } from "./controls";
import { Icon, type IconName } from "./icons";
import { fadeTo } from "./motion";
import { Keycaps } from "./parts";
import { fade, swatch, THEMES, type Appearance, type ThemeName } from "./themes";
import { T } from "./tokens";

/** The panes, in the toolbar's order. */
export type SettingsTab = "general" | "appearance" | "reminders" | "claude" | "about";

const TABS: readonly { id: SettingsTab; icon: IconName }[] = [
  { id: "general", icon: "gear" },
  { id: "appearance", icon: "appearance" },
  { id: "reminders", icon: "bell" },
  { id: "claude", icon: "spark" },
  { id: "about", icon: "info" },
];

/** The window's width, its title bar (the traffic lights and the pane's name) and the toolbar under it. */
const WIDTH = 600;
const TITLE_BAR = 30;
const TOOLBAR = TITLE_BAR + 56;
/** A pane's height before it was measured: the window opens near its size. */
const GUESS: Record<SettingsTab, number> = { general: 470, appearance: 320, reminders: 220, claude: 300, about: 260 };

/** The window is open, and the pane it shows. */
export const settingsOpen = signal(false);
export const settingsTab = signal<SettingsTab>("general");

let settingsWindow: WindowRef | undefined;

/** Opens the settings (the tray's "Settings…", ⌘, in the panel), or brings them to the front. */
export function openSettings(tab?: SettingsTab) {
  if (tab) settingsTab.set(tab);
  if (untracked(settingsOpen)) settingsWindow?.focus();
  else settingsOpen.set(true);
}

/** The pane heights as laid out, so a pane shown again resizes the window at once. */
const measured = new Map<SettingsTab, number>();

export function SettingsWindow() {
  /** Whether the window has its first size: until then it resizes without animating. */
  let sized = false;

  function fit(tab: SettingsTab, height: number) {
    measured.set(tab, height);
    if (untracked(settingsTab) !== tab || !settingsWindow) return;
    settingsWindow.setBounds({ size: { width: WIDTH, height: Math.ceil(TOOLBAR + height) }, animated: sized });
    sized = true;
  }

  return (
    <Window
      id="settings"
      kind="normal"
      title={t("settings.title")}
      open={settingsOpen()}
      onOpenChange={({ open }) => {
        settingsOpen.set(open);
        if (!open) {
          settingsWindow = undefined;
          sized = false;
        }
      }}
      ref={(r) => {
        settingsWindow = r;
        r?.focus();
      }}
      defaultSize={{ width: WIDTH, height: TOOLBAR + (measured.get(untracked(settingsTab)) ?? GUESS[untracked(settingsTab)]) }}
      defaultPosition="center"
      titleBar={{ style: "hidden", height: TITLE_BAR }}
      resizable={false}
      minimizable={false}
      maximizable={false}
    >
      <View testID="settings" class={`flex-1 bg-window ${fade()}`}>
        <Toolbar />
        <View class="absolute inset-x-0" style={{ top: TOOLBAR }} onLayout={({ bounds }) => fit(untracked(settingsTab), bounds.size.height)}>
          <Pane />
        </View>
      </View>
    </Window>
  );
}

/** The title bar's pane name, and the icon tabs: the selected one on a soft plate in the accent, which springs to the next. */
function Toolbar() {
  return (
    <View desktop={{ windowDrag: true }} class={`border-b border-window-line ${fade()}`} style={{ height: TOOLBAR }}>
      <View class="items-center justify-center" style={{ height: TITLE_BAR }}>
        <Text testID="settings-title" class="font-semibold text-window-fg" style={{ fontSize: 13 }}>
          {t(`settings.tabs.${settingsTab()}`)}
        </Text>
      </View>
      <Tabs
        accessibilityLabel={t("settings.title")}
        class="flex-row self-center"
        style={{ gap: 2 }}
        indicatorClass={`bg-control ${fade()}`}
        indicatorStyle={{ top: 0, bottom: 0, borderRadius: 8, borderCurve: "continuous" }}
      >
        <Each of={[...TABS]} key={(tab) => tab.id}>
          {(tab) => {
            const on = () => settingsTab() === tab().id;
            return (
              <Tab
                testID={`settings-tab:${tab().id}`}
                selected={on()}
                onPress={() => settingsTab.set(tab().id)}
                class="items-center justify-center"
                style={{ minWidth: 70, height: 50, gap: 3, paddingHorizontal: 8 }}
              >
                <Icon name={tab().icon} size={21} tint={on() ? token("accent-ink") : token("window-muted")} />
                <Text class={on() ? "font-medium text-accent-ink" : "text-window-muted"} style={{ fontSize: 11, numberOfLines: 1 }}>
                  {t(`settings.tabs.${tab().id}`)}
                </Text>
              </Tab>
            );
          }}
        </Each>
      </Tabs>
    </View>
  );
}

/** The pane shown; a new one fades in. */
function Pane() {
  const opacity = createAnimatedValue(1);
  effect(() => {
    settingsTab();
    untracked(() => {
      opacity.set(0);
      void fadeTo(opacity, 1, 180, 40);
    });
  });
  return (
    <View testID={`settings-pane:${settingsTab()}`} style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22, gap: 10, opacity }}>
      <If when={settingsTab() === "general"}>
        <GeneralPane />
      </If>
      <If when={settingsTab() === "appearance"}>
        <AppearancePane />
      </If>
      <If when={settingsTab() === "reminders"}>
        <RemindersPane />
      </If>
      <If when={settingsTab() === "claude"}>
        <ClaudePane />
      </If>
      <If when={settingsTab() === "about"}>
        <AboutPane />
      </If>
    </View>
  );
}

// ——— The form ———

/** Rows on one rounded plate, a hairline between them. */
function Group(props: { children: JSX.Element; testID?: string; padded?: boolean }) {
  return (
    <View
      testID={props.testID}
      class={`bg-group border border-group-edge ${fade()}`}
      style={{ borderRadius: 10, borderCurve: "continuous", overflow: "hidden", padding: props.padded ? 14 : 0 }}
    >
      {props.children}
    </View>
  );
}

/** A group's title, above it. */
function SectionTitle(props: { children: string }) {
  return (
    <Text role="header" class="font-semibold text-window-fg" style={{ fontSize: 13, marginTop: 6, marginLeft: 2 }}>
      {props.children}
    </Text>
  );
}

/** A row: its label (and a caption under it) on the left, its control on the right. */
function Row(props: { label: string; hint?: string | null; hintTone?: "muted" | "late"; divider?: boolean; children?: JSX.Element; testID?: string }) {
  return (
    <View testID={props.testID} class="flex-row items-center" style={{ minHeight: 44, paddingVertical: 9, paddingHorizontal: 14, gap: 16 }}>
      <If when={props.divider}>
        <View class={`absolute bg-window-line ${fade()}`} style={{ top: 0, left: 14, right: 14, height: 1 }} />
      </If>
      <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <Text class="text-window-fg" style={{ fontSize: FORM.label }}>
          {props.label}
        </Text>
        <If when={props.hint}>{(hint) => <Hint tone={props.hintTone}>{hint()}</Hint>}</If>
      </View>
      {props.children}
    </View>
  );
}

// ——— General ———

const folderFailed = signal<string | null>(null);

async function chooseFolder() {
  try {
    const picked = await Folder.choose(untracked(folderPath) ?? `~/${T.folder.path}`, t("settings.folder.choose"));
    if (!picked) return;
    changeFolder(picked);
    folderFailed.set(null);
  } catch (error) {
    folderFailed.set(t("settings.folder.failed", { error: errorMessage(error) }));
  }
}

function GeneralPane() {
  // Read when the pane shows: the user may change it in System Settings meanwhile.
  const atLogin = signal(false);
  void Application.launchAtLogin().then((on) => atLogin.set(on));
  async function setAtLogin(on: boolean) {
    atLogin.set(on);
    try {
      await Application.setLaunchAtLogin(on);
    } catch {
      // Not possible here (`nsh run`, a copy the system does not know): the switch shows what the system says.
    }
    atLogin.set(await Application.launchAtLogin());
  }
  const languages = (): { value: LanguageChoice; title: string }[] => [
    { value: "system", title: t("language.system") },
    ...LANGUAGES.map((l) => ({ value: l.value, title: l.name })),
  ];

  return (
    <>
      <Group testID="settings-folder">
        <View class="flex-row items-center" style={{ minHeight: 58, paddingVertical: 11, paddingHorizontal: 14, gap: 12 }}>
          <View class={`items-center justify-center bg-control ${fade()}`} style={{ width: 32, height: 32, borderRadius: 8, borderCurve: "continuous" }}>
            <Icon name="folder" size={18} tint={token("accent-ink")} />
          </View>
          <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
            <Text class="text-window-fg" style={{ fontSize: FORM.label }}>
              {t("settings.folder.label")}
            </Text>
            <Text testID="settings-folder-path" class="text-window-muted" style={{ fontSize: FORM.hint, numberOfLines: 1 }}>
              {folderShown()}
            </Text>
          </View>
          <PushButton testID="settings-reveal" label={t("settings.folder.reveal")} onPress={() => void Folder.reveal(untracked(folderPath) ?? "").catch(() => {})} />
          <PushButton testID="settings-change-folder" label={t("settings.folder.change")} onPress={() => void chooseFolder()} />
        </View>
        <If when={folderFailed()}>
          {(message) => (
            <View style={{ paddingHorizontal: 14, paddingBottom: 10, marginTop: -4 }}>
              <Hint tone="late">{message()}</Hint>
            </View>
          )}
        </If>
      </Group>

      <SectionTitle>{t("settings.summon.label")}</SectionTitle>
      <Group>
        <Row
          label={t("settings.summon.double", { key: T.keys.summonCaps[0] })}
          hint={trusted() ? null : t("settings.summon.grant_hint")}
        >
          <If
            when={trusted()}
            else={<PushButton testID="settings-grant" label={t("settings.summon.grant")} onPress={() => Summon.requestTrust()} />}
          >
            <View testID="settings-summon-on" class="flex-row items-center" style={{ gap: 6 }}>
              <View class="bg-ok" style={{ width: 7, height: 7, borderRadius: 3.5 }} />
              <Text class="text-window-muted" style={{ fontSize: FORM.control }}>
                {t("settings.summon.on")}
              </Text>
            </View>
          </If>
        </Row>
        <Row divider label={t("settings.summon.fallback")} hint={t("settings.summon.fallback_hint")}>
          <Keycaps keys={T.keys.fallbackCaps} />
        </Row>
      </Group>

      <If when={speechAvailable()}>
        <VoiceSettings />
      </If>

      <Group>
        <Row label={t("settings.login.label")} hint={t("settings.login.hint")}>
          <MacSwitch testID="settings-login" label={t("settings.login.label")} checked={atLogin()} onChange={(on) => void setAtLogin(on)} />
        </Row>
        <Row divider label={t("settings.language.label")}>
          <PopupButton
            testID="settings-language"
            label={t("settings.language.label")}
            items={languages()}
            value={language()}
            onChange={setLanguage}
          />
        </Row>
      </Group>
    </>
  );
}

/** Dictation: holding ⌥ to talk, the language listened for, and the permission while it is refused. */
function VoiceSettings() {
  const languages = (): { value: SpeechLanguageChoice; title: string }[] => [
    { value: "auto", title: t("settings.voice.language_auto") },
    ...SPEECH_LANGUAGES.map((l) => ({ value: l.value, title: l.name })),
  ];
  return (
    <>
      <SectionTitle>{t("settings.voice.label")}</SectionTitle>
      <Group testID="settings-voice">
        <Row
          label={t("settings.voice.hold", { key: T.keys.summonCaps[0] })}
          hint={t("settings.voice.hold_hint", { key: T.keys.summonCaps[0] })}
        >
          <MacSwitch
            testID="settings-voice-hold"
            label={t("settings.voice.hold", { key: T.keys.summonCaps[0] })}
            checked={holdToTalk()}
            onChange={setHoldToTalk}
          />
        </Row>
        <Row divider label={t("settings.voice.language")}>
          <PopupButton
            testID="settings-voice-language"
            label={t("settings.voice.language")}
            items={languages()}
            value={speechLanguage()}
            onChange={setSpeechLanguage}
          />
        </Row>
        <Row
          divider
          label={t("settings.voice.permission")}
          hint={speechDenied() ? t("settings.voice.denied_hint") : t("settings.voice.permission_hint")}
          hintTone={speechDenied() ? "late" : "muted"}
        >
          <If when={speechDenied()}>
            <PushButton
              testID="settings-voice-grant"
              label={t("settings.voice.grant")}
              onPress={() => void openUrl(PRIVACY_URL.speech).catch(() => openUrl(PRIVACY_URL.microphone).catch(() => {}))}
            />
          </If>
        </Row>
      </Group>
    </>
  );
}

// ——— Appearance ———

function AppearancePane() {
  const modes = (): { value: Appearance; label: string }[] => [
    { value: "system", label: t("settings.appearance.system") },
    { value: "light", label: t("settings.appearance.light") },
    { value: "dark", label: t("settings.appearance.dark") },
  ];
  return (
    <>
      <Group>
        <Row label={t("settings.appearance.label")}>
          <Segmented testID="settings-appearance" label={t("settings.appearance.label")} options={modes()} value={appearance()} onChange={setAppearance} />
        </Row>
      </Group>
      <SectionTitle>{t("settings.theme.label")}</SectionTitle>
      <RadioGroup accessibilityLabel={t("settings.theme.label")} class="flex-row flex-wrap" style={{ columnGap: 12, rowGap: 12 }}>
        <Each of={[...THEMES]} key={(name) => name}>
          {(name) => <ThemeCard name={name()} />}
        </Each>
      </RadioGroup>
    </>
  );
}

/** The width of a theme card: three to a row. */
const CARD = Math.floor((WIDTH - 40 - 24) / 3);

/** A theme as a card: a small floating panel in its colours on a desktop, its name under it; the chosen one ringed in the accent, with a check. */
function ThemeCard(props: { name: ThemeName }) {
  const dark = () => colorScheme() === "dark";
  const s = () => swatch(props.name, dark());
  const chosen = () => theme() === props.name;
  const solid = props.name === "contrast";
  return (
    <Radio
      testID={`theme:${props.name}`}
      checked={chosen()}
      onChange={() => setThemeName(props.name)}
      accessibilityLabel={t(`theme.${props.name}`)}
      style={{ width: CARD, gap: 6, alignItems: "center" }}
    >
      <View
        class={chosen() ? "border-primary" : "border-transparent"}
        style={{ width: CARD, padding: 2, borderWidth: 2, borderRadius: 13, borderCurve: "continuous" }}
      >
        <View
          class="border border-group-edge"
          style={{
            height: 92,
            borderRadius: 9,
            borderCurve: "continuous",
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "flex-end",
            backgroundImage: dark()
              ? "linear-gradient(135deg, #1d2b4f 0%, #33244f 55%, #123844 100%)"
              : "linear-gradient(135deg, #bcd3fb 0%, #d9ccf6 55%, #fbd9c8 100%)",
          }}
        >
          {/* The panel: the search line, a selected row in the accent, two rows of text. */}
          <View
            style={{
              width: CARD - 36,
              height: 66,
              marginBottom: -6,
              padding: 7,
              gap: 5,
              borderRadius: 8,
              borderCurve: "continuous",
              backgroundColor: s().surface,
              borderWidth: solid ? 1.5 : 1,
              borderColor: solid ? s().ink : s().line,
              boxShadow: solid ? [] : [{ x: 0, y: 4, blur: 10, color: "#00000033" }],
            }}
          >
            <View class="flex-row items-center" style={{ gap: 4, height: 9 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.4, borderColor: s().muted }} />
              <View style={{ width: "46%", height: 4, borderRadius: 2, backgroundColor: s().muted, opacity: 0.6 }} />
            </View>
            <View class="flex-row items-center" style={{ height: 12, gap: 4, paddingHorizontal: 4, borderRadius: 4, backgroundColor: s().accent }}>
              <View style={{ width: "52%", height: 3.5, borderRadius: 2, backgroundColor: solid && dark() ? "#000000" : "#ffffff" }} />
            </View>
            <View class="flex-row items-center" style={{ height: 8, gap: 4, paddingHorizontal: 4 }}>
              <View style={{ width: "40%", height: 3.5, borderRadius: 2, backgroundColor: s().ink }} />
              <View style={{ width: "24%", height: 3.5, borderRadius: 2, backgroundColor: s().muted, opacity: 0.7 }} />
            </View>
            <View class="flex-row items-center" style={{ height: 8, gap: 4, paddingHorizontal: 4 }}>
              <View style={{ width: "30%", height: 3.5, borderRadius: 2, backgroundColor: s().ink }} />
              <View style={{ width: "34%", height: 3.5, borderRadius: 2, backgroundColor: s().muted, opacity: 0.7 }} />
            </View>
          </View>
          <If when={chosen()}>
            <View
              class="absolute items-center justify-center bg-primary"
              style={{ right: 6, top: 6, width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: "#ffffff" }}
            >
              <Icon name="check" size={11} tint={token("on-accent")} />
            </View>
          </If>
        </View>
      </View>
      <Text class={chosen() ? "font-semibold text-window-fg" : "text-window-muted"} style={{ fontSize: 12, numberOfLines: 1 }}>
        {t(`theme.${props.name}`)}
      </Text>
    </Radio>
  );
}

// ——— Reminders ———

/** Whether a display has a notch (a camera housing) for the island to open from. */
const hasNotch = () => displays().some((d) => ((d as Display & { cutouts?: Bounds[] }).cutouts ?? []).length > 0);

function RemindersPane() {
  const twelveHour = () => localeSettings().hourCycle === "h12" || localeSettings().hourCycle === "h11";
  return (
    <Group>
      <Row label={t("settings.reminders.notifications")} hint={t("settings.reminders.notifications_hint")}>
        <MacSwitch
          testID="settings-notifications"
          label={t("settings.reminders.notifications")}
          checked={notificationsOn()}
          onChange={setNotifications}
        />
      </Row>
      <If when={platform.os === "macos"}>
        <Row
          divider
          label={t("settings.reminders.island")}
          hint={hasNotch() ? t("settings.reminders.island_hint") : t("settings.reminders.island_no_notch")}
        >
          <MacSwitch
            testID="settings-island"
            label={t("settings.reminders.island")}
            checked={islandOn() && hasNotch()}
            disabled={!hasNotch()}
            onChange={setIsland}
          />
        </Row>
      </If>
      <Row divider label={t("settings.reminders.default_time")} hint={t("settings.reminders.default_time_hint")}>
        <TimeInput
          testID="settings-default-time"
          label={t("settings.reminders.default_time")}
          value={defaultTime()}
          hourCycle={twelveHour() ? "h12" : "h23"}
          onChange={setDefaultTime}
        />
      </Row>
    </Group>
  );
}

// ——— Claude ———

/** `path` as a shell word: as it is when it is plain, else in single quotes. */
const shellWord = (path: string) => (/^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

function ClaudePane() {
  const copied = signal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const command = () => `claude mcp add jot -- ${t("settings.claude.placeholder")} --dir ${shellWord(folderPath() ?? folderShown())}`;
  async function copy() {
    await Clipboard.writeText(untracked(command));
    copied.set(true);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => copied.set(false), 1600);
  }
  return (
    <>
      <View class="flex-row items-center" style={{ gap: 12, paddingHorizontal: 2, paddingBottom: 4 }}>
        <View class="items-center justify-center bg-claude/15" style={{ width: 34, height: 34, borderRadius: 9, borderCurve: "continuous" }}>
          <Icon name="spark" size={19} tint={token("claude")} />
        </View>
        <Text class="flex-1 font-medium text-window-fg" style={{ fontSize: 13 }}>
          {t("settings.claude.intro")}
        </Text>
      </View>
      <Group padded>
        <View style={{ gap: 10 }}>
          <Text class="text-window-fg" style={{ fontSize: 12 }}>
            {t("settings.claude.how")}
          </Text>
          <View class={`flex-row items-center bg-control border border-window-line ${fade()}`} style={{ gap: 10, paddingVertical: 9, paddingLeft: 12, paddingRight: 6, borderRadius: 8, borderCurve: "continuous" }}>
            <Text testID="settings-claude-command" class="flex-1 font-mono text-window-fg" style={{ fontSize: 11.5, lineHeight: 17, userSelect: "text" }}>
              {command()}
            </Text>
            <PushButton
              testID="settings-copy"
              icon={copied() ? "check" : "copy"}
              label={copied() ? t("settings.claude.copied") : t("settings.claude.copy")}
              onPress={() => void copy()}
            />
          </View>
          <Hint>{t("settings.claude.path_note")}</Hint>
        </View>
      </Group>
      <Text class="text-window-muted" style={{ fontSize: 12, marginLeft: 2 }}>
        {t("settings.claude.then")}
      </Text>
    </>
  );
}

// ——— About ———

const NSH_URL = "https://github.com/longbridge/nsh";

function AboutPane() {
  const info = appInfo();
  return (
    <View class="items-center" style={{ paddingTop: 10, paddingBottom: 6, gap: 4 }}>
      <View
        class="items-center justify-center"
        style={{
          width: 76,
          height: 76,
          marginBottom: 10,
          borderRadius: 18,
          borderCurve: "continuous",
          backgroundImage: `linear-gradient(160deg, ${token("ring")} 0%, ${token("primary")} 100%)`,
          boxShadow: [{ x: 0, y: 6, blur: 16, color: "#00000033" }],
        }}
      >
        <Icon name="pen" size={38} tint={token("on-accent")} />
      </View>
      <Text class="font-bold text-window-fg" style={{ fontSize: 22, letterSpacing: -0.3 }}>
        Jot
      </Text>
      <Text class="text-window-muted" style={{ fontSize: 12 }}>
        {t("settings.about.tagline")}
      </Text>
      <Text testID="settings-version" class="text-window-muted" style={{ fontSize: 11, fontVariant: ["tabular-nums"], marginTop: 2 }}>
        {t("settings.about.version", { version: info.version ?? "1.0.0", build: info.build ?? 1 })}
      </Text>
      <Button
        testID="settings-nsh"
        onPress={() => void openUrl(NSH_URL).catch(() => {})}
        accessibilityLabel={t("settings.about.built_with")}
        class="flex-row items-center hover:opacity-80 active:opacity-60"
        style={{ gap: 4, marginTop: 14, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 }}
      >
        <Text class="text-accent-ink" style={{ fontSize: 12 }}>
          {t("settings.about.built_with")}
        </Text>
        <Icon name="external" size={12} tint={token("accent-ink")} />
      </Button>
    </View>
  );
}
