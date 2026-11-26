// The settings window, shaped as macOS's System Settings: a fixed window with
// a sidebar on the left (the app's card, then the pages, each behind a
// coloured tile) over the system's sidebar material, and on the right the
// page's title over a grouped form, a group's title above it and its
// explanation under it.
//
// The window draws in the `sys-*` tokens, which no Jot theme overrides: it
// follows the appearance and takes the system's accent, as macOS's own
// settings do; a theme only recolours the panel.
//
// Every change applies at once (`app/settings.ts`); nothing waits for a
// Save button.
import {
  Clipboard,
  colorScheme,
  createAnimatedValue,
  effect,
  Image,
  localeSettings,
  openUrl,
  platform,
  Scroll,
  signal,
  Text,
  untracked,
  View,
  type Bounds,
  type JSX,
} from "nsh";
import { AlertDialog, Radio, RadioGroup, Tab, Tabs } from "nsh/base";
import { Application, displays, Window, type Display, type WindowRef } from "nsh/desktop";
import { t } from "nsh/i18n";
import { AppleNotes, Connections, Folder, Summon, type AiClient, type MovedNotes } from "jot/native";
import { aiBusy, aiClients, aiErrors, refreshClients, toggleClient } from "../connections";
import { LANGUAGES, tn } from "../i18n";
import {
  aiTrashAndRewrite,
  appearance,
  defaultTime,
  holdToTalk,
  islandOn,
  language,
  notificationsOn,
  setAiTrashAndRewrite,
  setAppearance,
  setDefaultTime,
  setHoldToTalk,
  setIsland,
  setLanguage,
  setNotifications,
  setSoundEffects,
  setSpeechLanguage,
  setThemeName,
  soundEffectsOn,
  SPEECH_LANGUAGES,
  speechLanguage,
  theme,
  type LanguageChoice,
  type SpeechLanguageChoice,
} from "../settings";
import { PRIVACY_URL, speechAvailable, speechDenied } from "../voice";
import { changeFolder, errorMessage, folderPath, folderShown, moveNotesTo, trusted } from "../store";
import { AUTOMATION_URL, importAppleNotes, importing, importReport } from "../importing";
import { checkForUpdates, downloading, manualUpdate, readyUpdate, restartToUpdate, runningVersion, updatePhase } from "../updates";
import appIcon from "./app-icon.svg";
import { FORM, Hint, MacSwitch, PopupButton, PushButton, TimeInput } from "./controls";
import { Icon, type IconName } from "./icons";
import { fadeTo } from "./motion";
import { fade, swatch, THEMES, type Appearance, type ThemeName } from "./themes";
import { T } from "./tokens";

/** The pages: the sidebar's, in its order, and the app card's "about". */
export type SettingsTab = "general" | "summon" | "voice" | "reminders" | "appearance" | "ai" | "about";

type Page = { id: Exclude<SettingsTab, "about">; icon: IconName; tile: string };

/** The sidebar's pages, each on a tile of its colour (System Settings' own, by kind). The AI apps stand apart, after a gap. */
const PAGES: readonly Page[] = [
  { id: "general", icon: "gear", tile: "#8e8e93" },
  { id: "summon", icon: "option", tile: "#5e5ce6" },
  { id: "voice", icon: "mic", tile: "#ff375f" },
  { id: "reminders", icon: "bell", tile: "#ff3b30" },
  { id: "appearance", icon: "appearance", tile: "#1c1c1e" },
];
const AI: Page = { id: "ai", icon: "spark", tile: "#af52de" };

/** The window's size (fixed), the sidebar's width, and the strip the traffic lights and the page's title share. */
const WIDTH = 715;
const HEIGHT = 540;
const SIDEBAR = 216;
const TITLE_BAR = 52;

/** The window is open, and the page it shows. */
export const settingsOpen = signal(false);
export const settingsTab = signal<SettingsTab>("general");

/** The page shown: dictation's falls back to General where there is none. */
const shownTab = (): SettingsTab => (settingsTab() === "voice" && !speechAvailable() ? "general" : settingsTab());

let settingsWindow: WindowRef | undefined;

/** The window has the focus: the sidebar's selection is in the accent then, gray otherwise, as macOS's is. */
const settingsFocused = signal(true);

/** Opens the settings (the tray's "Settings…", ⌘, in the panel), or brings them to the front. */
export function openSettings(tab?: SettingsTab) {
  if (tab) settingsTab.set(tab);
  if (untracked(settingsOpen)) settingsWindow?.focus();
  else settingsOpen.set(true);
}

export function SettingsWindow() {
  return (
    <Window
      id="settings"
      kind="normal"
      title={t("settings.title")}
      open={settingsOpen()}
      onOpenChange={({ open }) => {
        settingsOpen.set(open);
        if (!open) settingsWindow = undefined;
      }}
      onFocusChange={({ focused }) => settingsFocused.set(focused)}
      ref={(r) => {
        settingsWindow = r;
        r?.focus();
      }}
      defaultSize={{ width: WIDTH, height: HEIGHT }}
      defaultPosition="center"
      titleBar={{ style: "hidden", height: TITLE_BAR }}
      backdrop="sidebar"
      resizable={false}
      minimizable={false}
      maximizable={false}
    >
      <View testID="settings" class="flex-1 flex-row">
        <Sidebar />
        <View class={`flex-1 bg-sys-bg ${fade()}`} style={{ minWidth: 0 }}>
          <View desktop={{ windowDrag: true }} class="flex-row items-center" style={{ height: TITLE_BAR, paddingHorizontal: 20 }}>
            <Text testID="settings-title" role="header" class="font-bold text-sys-fg" style={{ fontSize: 15, numberOfLines: 1 }}>
              {shownTab() === "about" ? t("settings.about.title") : t(`settings.tabs.${shownTab()}`)}
            </Text>
          </View>
          <Scroll class="flex-1">
            <Pane />
          </Scroll>
        </View>
      </View>
    </Window>
  );
}

// ——— The sidebar ———

/** The app's card, then the pages; the selection is one soft plate that springs to the next. */
function Sidebar() {
  const info = runningVersion();
  const select = (id: SettingsTab) => settingsTab.set(id);
  return (
    <View
      desktop={{ windowDrag: true }}
      class={`bg-sys-sidebar ${fade()}`}
      style={{ width: SIDEBAR, paddingTop: TITLE_BAR, paddingHorizontal: 10 }}
    >
      <Tabs
        accessibilityLabel={t("settings.title")}
        class="flex-col"
        style={{ gap: 1 }}
        indicatorClass={`${settingsFocused() ? "bg-sys-sidebar-selection" : "bg-sys-selection"} ${fade()}`}
        indicatorStyle={{ left: 0, right: 0, borderRadius: 7, borderCurve: "continuous" }}
      >
        <Tab
          testID="settings-tab:about"
          selected={shownTab() === "about"}
          onPress={() => select("about")}
          accessibilityLabel={t("settings.about.title")}
          class="flex-row items-center"
          style={{ gap: 10, paddingVertical: 7, paddingHorizontal: 8, marginBottom: 10, borderRadius: 8 }}
        >
          <Image src={appIcon} accessible={false} style={{ width: 36, height: 36, pointerEvents: "none" }} />
          <View style={{ minWidth: 0, gap: 1 }}>
            <Text class={`font-semibold ${onAccent("about") ? "text-sys-on-accent" : "text-sys-fg"}`} style={{ fontSize: 13 }}>
              Jot
            </Text>
            <Text
              class={onAccent("about") ? "text-sys-on-accent" : "text-sys-muted"}
              style={{ fontSize: 11, numberOfLines: 1, fontVariant: ["tabular-nums"], opacity: onAccent("about") ? 0.8 : 1 }}
            >
              {t("settings.about.version", info)}
            </Text>
          </View>
        </Tab>
        <Each of={PAGES.filter((p) => p.id !== "voice" || speechAvailable())} key={(page) => page.id}>
          {(page) => <SidebarRow page={page()} onPress={() => select(page().id)} />}
        </Each>
        <View style={{ height: 10 }} />
        <SidebarRow page={AI} onPress={() => select("ai")} />
      </Tabs>
    </View>
  );
}

/** The sidebar's selected row while the window has the focus: on the accent, its text white. */
const onAccent = (id: SettingsTab) => settingsFocused() && shownTab() === id;

/** A page in the sidebar: its tile, white glyph on its colour, and its name. */
function SidebarRow(props: { page: Page; onPress: () => void }) {
  return (
    <Tab
      testID={`settings-tab:${props.page.id}`}
      selected={shownTab() === props.page.id}
      onPress={props.onPress}
      class="flex-row items-center"
      style={{ height: 28, gap: 8, paddingHorizontal: 6, borderRadius: 7 }}
    >
      <View
        class="items-center justify-center"
        style={{
          width: 20,
          height: 20,
          borderRadius: 5,
          borderCurve: "continuous",
          backgroundColor: props.page.tile,
          boxShadow: [{ x: 0, y: 0.5, blur: 1, color: "#00000026" }],
        }}
      >
        <Icon name={props.page.icon} size={14} tint="#ffffff" />
      </View>
      <Text class={onAccent(props.page.id) ? "text-sys-on-accent" : "text-sys-fg"} style={{ fontSize: 13, numberOfLines: 1 }}>
        {t(`settings.tabs.${props.page.id}`)}
      </Text>
    </Tab>
  );
}

/** The page shown; a new one fades in. */
function Pane() {
  const opacity = createAnimatedValue(1);
  effect(() => {
    shownTab();
    untracked(() => {
      opacity.set(0);
      void fadeTo(opacity, 1, 180, 40);
    });
  });
  return (
    <View testID={`settings-pane:${shownTab()}`} style={{ paddingHorizontal: 20, paddingTop: 2, paddingBottom: 24, opacity }}>
      <If when={shownTab() === "general"}>
        <GeneralPane />
      </If>
      <If when={shownTab() === "summon"}>
        <SummonPane />
      </If>
      <If when={shownTab() === "voice"}>
        <VoicePane />
      </If>
      <If when={shownTab() === "reminders"}>
        <RemindersPane />
      </If>
      <If when={shownTab() === "appearance"}>
        <AppearancePane />
      </If>
      <If when={shownTab() === "ai"}>
        <AiPane />
      </If>
      <If when={shownTab() === "about"}>
        <AboutPane />
      </If>
    </View>
  );
}

// ——— The form ———

/** Rows on one rounded plate (no edge, a 12-point corner, as macOS 26's), a hairline between them; `gap` spaces it from a group right above. */
function Group(props: { children: JSX.Element; testID?: string; gap?: boolean }) {
  return (
    <View
      testID={props.testID}
      class={`bg-sys-group ${fade()}`}
      style={{ borderRadius: 12, overflow: "hidden", marginTop: props.gap ? 12 : 0 }}
    >
      {props.children}
    </View>
  );
}

/** A group's title, above it. */
function SectionTitle(props: { children: string }) {
  return (
    <Text role="header" class="font-semibold text-sys-fg" style={{ fontSize: 13, marginTop: 18, marginBottom: 7, marginLeft: 2 }}>
      {props.children}
    </Text>
  );
}

/** What a group is for, under it. */
function Footnote(props: { children: JSX.Element; tone?: "muted" | "late"; testID?: string }) {
  return (
    <Text
      testID={props.testID}
      class={props.tone === "late" ? "text-sys-red" : "text-sys-muted"}
      style={{ fontSize: FORM.hint, lineHeight: 15, marginTop: 6, marginHorizontal: 10 }}
    >
      {props.children}
    </Text>
  );
}

/** A row: its label (and a short caption under it) on the left, its control on the right. */
function Row(props: { label: string; hint?: string | null; hintTone?: "muted" | "late"; divider?: boolean; children?: JSX.Element; testID?: string }) {
  return (
    <View testID={props.testID} class="flex-row items-center" style={{ minHeight: 40, paddingVertical: 8, paddingHorizontal: 10, gap: 12 }}>
      <If when={props.divider}>
        <View class={`absolute bg-sys-line ${fade()}`} style={{ top: 0, left: 10, right: 10, height: 0.5 }} />
      </If>
      <View class="flex-1" style={{ minWidth: 0, gap: 1 }}>
        <Text class="text-sys-fg" style={{ fontSize: FORM.label }}>
          {props.label}
        </Text>
        <If when={props.hint}>{(hint) => <Hint tone={props.hintTone}>{hint()}</Hint>}</If>
      </View>
      {props.children}
    </View>
  );
}

/** A status: a coloured dot and a word, for a permission that is on. */
function Status(props: { label: string; testID?: string }) {
  return (
    <View testID={props.testID} class="flex-row items-center" style={{ gap: 6 }}>
      <View class="bg-sys-ok" style={{ width: 8, height: 8, borderRadius: 4 }} />
      <Text class="text-sys-muted" style={{ fontSize: FORM.control }}>
        {props.label}
      </Text>
    </View>
  );
}

/** A shortcut's keys as macOS's Keyboard Shortcuts list them: the symbols run together in the label color (`⌃⌥J`); words (Ctrl, Alt) joined with `+`. */
function Keys(props: { keys: readonly string[] }) {
  const symbols = () => props.keys.every((key) => [...key].length === 1);
  return (
    <Text class="text-sys-fg" style={{ fontSize: FORM.control, numberOfLines: 1 }} accessibilityLabel={props.keys.join(" ")}>
      {props.keys.join(symbols() ? "" : "+")}
    </Text>
  );
}

// ——— General ———

/** A Finder folder, in its own blues (not a template icon). */
const FOLDER_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M3 9a3 3 0 0 1 3-3h6l3 3h11a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" fill="#5ac8fa"/><path d="M3 12a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" fill="#7fd3fb"/></svg>',
)}`;

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

/** The move to iCloud Drive: under way, and what it last did (or why it failed). */
const moving = signal(false);
const moveReport = signal<{ text: string; failed: boolean } | null>(null);

/** Whether `dir` is in iCloud Drive (the folder holding Jot's, `root`). */
const inDrive = (dir: string | null, root: string) => !!dir && (dir === root || dir.startsWith(`${root}/`));

/** What the move did, in a sentence or a few. */
function movedText(moved: MovedNotes, from: string): string {
  const parts = [tn("settings.icloud.moved", moved.moved.length + moved.renamed.length)];
  if (moved.renamed.length) parts.push(tn("settings.icloud.renamed", moved.renamed.length, { from: moved.renamed[0].from, to: moved.renamed[0].to }));
  if (moved.same.length) parts.push(tn("settings.icloud.same", moved.same.length, { folder: from }));
  if (moved.failed.length) parts.push(tn("settings.icloud.failed_some", moved.failed.length, { folder: from, error: moved.failed[0].error }));
  return parts.join(" ");
}

/** "Move to iCloud Drive": asks first, then moves the notes there and makes it the notes folder. */
async function moveToDrive(to: string) {
  const from = untracked(folderShown);
  const { action } = await AlertDialog.show({
    title: t("settings.icloud.confirm_title"),
    description: t("settings.icloud.confirm", { from, to: Folder.shown(to) }),
    actions: [
      { id: "move", label: t("settings.icloud.confirm_move") },
      { id: "cancel", label: t("settings.icloud.cancel"), role: "cancel" },
    ],
    closeOnEscape: true,
  });
  if (action !== "move") return;
  moving.set(true);
  moveReport.set(null);
  try {
    const moved = await moveNotesTo(to);
    moveReport.set({ text: movedText(moved, from), failed: moved.failed.length > 0 });
    folderFailed.set(null);
  } catch (error) {
    moveReport.set({ text: t("settings.icloud.failed", { error: errorMessage(error) }), failed: true });
  } finally {
    moving.set(false);
  }
}

/** The notes folder's iCloud Drive row: where it is, or the button that moves it there (off, with why, while iCloud Drive is). */
function DriveRow() {
  const drive = Folder.icloud();
  const path = drive.path;
  if (!path) return null;
  const root = path.slice(0, path.lastIndexOf("/"));
  const there = () => inDrive(folderPath(), root);
  const hint = () => (there() ? t("settings.icloud.on") : drive.available ? t("settings.icloud.hint") : t("settings.icloud.off"));
  return (
    <Row divider testID="settings-icloud" label={t("settings.icloud.label")} hint={hint()}>
      <If
        when={there()}
        else={
          <PushButton
            testID="settings-icloud-move"
            label={moving() ? t("settings.icloud.moving") : t("settings.icloud.move")}
            disabled={!drive.available || moving()}
            onPress={() => void moveToDrive(path)}
          />
        }
      >
        <Status testID="settings-icloud-on" label={t("settings.icloud.synced")} />
      </If>
    </Row>
  );
}

/** Settings › General › Import: Apple Notes, where the platform has it (macOS). */
function ImportGroup() {
  if (!AppleNotes.available()) return null;
  return (
    <>
      <SectionTitle>{t("settings.import.label")}</SectionTitle>
      <Group testID="settings-import">
        <Row label={t("settings.import.apple_notes")} hint={t("settings.import.hint")}>
          <If when={importReport()?.denied}>
            <PushButton
              testID="settings-import-allow"
              label={t("settings.import.open_settings")}
              onPress={() => void openUrl(AUTOMATION_URL).catch(() => {})}
            />
          </If>
          <PushButton
            testID="settings-import-apple-notes"
            label={importing() ? t("settings.import.importing") : t("settings.import.button")}
            disabled={importing() || !folderPath()}
            onPress={() => void importAppleNotes()}
          />
        </Row>
      </Group>
      <If when={importReport()} else={<Footnote>{t("settings.import.footnote")}</Footnote>}>
        {(report) => (
          <Footnote testID="settings-import-report" tone={report().failed ? "late" : "muted"}>
            {report().text}
          </Footnote>
        )}
      </If>
    </>
  );
}

function GeneralPane() {
  // Read when the page shows: the user may change it in System Settings meanwhile.
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
        <View class="flex-row items-center" style={{ minHeight: 52, paddingVertical: 9, paddingHorizontal: 10, gap: 10 }}>
          <Image src={FOLDER_ICON} accessible={false} style={{ width: 32, height: 32, pointerEvents: "none" }} />
          <View class="flex-1" style={{ minWidth: 0, gap: 1 }}>
            <Text class="text-sys-fg" style={{ fontSize: FORM.label }}>
              {t("settings.folder.label")}
            </Text>
            <Text testID="settings-folder-path" class="text-sys-muted" style={{ fontSize: FORM.hint, numberOfLines: 1 }}>
              {folderShown()}
            </Text>
          </View>
          <PushButton testID="settings-reveal" label={t("settings.folder.reveal")} onPress={() => void Folder.reveal(untracked(folderPath) ?? "").catch(() => {})} />
          <PushButton testID="settings-change-folder" label={t("settings.folder.change")} onPress={() => void chooseFolder()} />
        </View>
        <DriveRow />
      </Group>
      <If when={folderFailed()} else={<Footnote>{t("settings.folder.hint")}</Footnote>}>
        {(message) => <Footnote tone="late">{message()}</Footnote>}
      </If>
      <If when={moveReport()}>
        {(report) => (
          <Footnote testID="settings-icloud-report" tone={report().failed ? "late" : "muted"}>
            {report().text}
          </Footnote>
        )}
      </If>

      <SectionTitle>{t("settings.startup.label")}</SectionTitle>
      <Group>
        <Row label={t("settings.login.label")} hint={t("settings.login.hint")}>
          <MacSwitch testID="settings-login" label={t("settings.login.label")} checked={atLogin()} onChange={(on) => void setAtLogin(on)} />
        </Row>
      </Group>

      <SectionTitle>{t("settings.sound.label")}</SectionTitle>
      <Group>
        <Row label={t("settings.sound.effects")} hint={t("settings.sound.effects_hint")}>
          <MacSwitch testID="settings-sound-effects" label={t("settings.sound.effects")} checked={soundEffectsOn()} onChange={setSoundEffects} />
        </Row>
      </Group>

      <SectionTitle>{t("settings.language.label")}</SectionTitle>
      <Group>
        <Row label={t("settings.language.interface")}>
          <PopupButton
            testID="settings-language"
            label={t("settings.language.interface")}
            items={languages()}
            value={language()}
            onChange={setLanguage}
          />
        </Row>
      </Group>

      <ImportGroup />
    </>
  );
}

// ——— Summon & shortcuts ———

function SummonPane() {
  const key = T.keys.summonCaps[0];
  return (
    <>
      <Group>
        <Row label={t("settings.summon.double", { key })}>
          <If
            when={trusted()}
            else={<PushButton testID="settings-grant" label={t("settings.summon.grant")} onPress={() => Summon.requestTrust()} />}
          >
            <Status testID="settings-summon-on" label={t("settings.summon.on")} />
          </If>
        </Row>
        <Row divider label={t("settings.summon.fallback")}>
          <Keys keys={T.keys.fallbackCaps} />
        </Row>
      </Group>
      <Footnote>{t("settings.summon.footnote", { key })}</Footnote>
    </>
  );
}

// ——— Voice ———

/** Dictation: holding ⌥ to talk, the language listened for, and the permission (a button while it is refused). */
function VoicePane() {
  const key = T.keys.summonCaps[0];
  const languages = (): { value: SpeechLanguageChoice; title: string }[] => [
    { value: "auto", title: t("settings.voice.language_auto") },
    ...SPEECH_LANGUAGES.map((l) => ({ value: l.value, title: l.name })),
  ];
  return (
    <>
      <Group testID="settings-voice">
        <Row label={t("settings.voice.hold", { key })}>
          <MacSwitch testID="settings-voice-hold" label={t("settings.voice.hold", { key })} checked={holdToTalk()} onChange={setHoldToTalk} />
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
      </Group>
      <Footnote>{t("settings.voice.hold_hint", { key })}</Footnote>

      <SectionTitle>{t("settings.voice.permissions")}</SectionTitle>
      <Group>
        <Row
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

// ——— Reminders ———

/** Whether a display has a notch (a camera housing) for the island to open from. */
const hasNotch = () => displays().some((d) => ((d as Display & { cutouts?: Bounds[] }).cutouts ?? []).length > 0);

function RemindersPane() {
  const twelveHour = () => localeSettings().hourCycle === "h12" || localeSettings().hourCycle === "h11";
  return (
    <>
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
      </Group>

      <SectionTitle>{t("settings.reminders.time")}</SectionTitle>
      <Group>
        <Row label={t("settings.reminders.default_time")}>
          <TimeInput
            testID="settings-default-time"
            label={t("settings.reminders.default_time")}
            value={defaultTime()}
            hourCycle={twelveHour() ? "h12" : "h23"}
            onChange={setDefaultTime}
          />
        </Row>
      </Group>
      <Footnote>{t("settings.reminders.default_time_hint")}</Footnote>
    </>
  );
}

// ——— Appearance ———

/** The appearances' thumbnails: a sliver of a window in each, the automatic one half light and half dark. */
const THUMB = { light: "#f2f2f4", dark: "#2a2a2d", lightBar: "#d8d8dc", darkBar: "#47474b" } as const;

function AppearancePane() {
  const modes = (): { value: Appearance; label: string }[] => [
    { value: "system", label: t("settings.appearance.system") },
    { value: "light", label: t("settings.appearance.light") },
    { value: "dark", label: t("settings.appearance.dark") },
  ];
  return (
    <>
      <Group>
        <RadioGroup
          testID="settings-appearance"
          accessibilityLabel={t("settings.appearance.label")}
          class="flex-row justify-center"
          style={{ gap: 16, paddingTop: 14, paddingBottom: 12, paddingHorizontal: 12 }}
        >
          <Each of={modes()} key={(m) => m.value}>
            {(mode) => <AppearanceThumb value={mode().value} label={mode().label} />}
          </Each>
        </RadioGroup>
      </Group>

      <SectionTitle>{t("settings.theme.label")}</SectionTitle>
      <Group>
        <RadioGroup
          testID="settings-theme"
          accessibilityLabel={t("settings.theme.label")}
          class="flex-row flex-wrap"
          style={{ rowGap: 10, columnGap: CARD.gap, paddingTop: 12, paddingBottom: 10, paddingHorizontal: CARD.inset }}
        >
          <Each of={[...THEMES]} key={(name) => name}>
            {(name) => <ThemeCard name={name()} />}
          </Each>
        </RadioGroup>
      </Group>
      <Footnote>{t("settings.theme.footnote")}</Footnote>
    </>
  );
}

/** One appearance: its thumbnail, ringed in the accent when chosen, and its name. */
function AppearanceThumb(props: { value: Appearance; label: string }) {
  const chosen = () => appearance() === props.value;
  const half = (dark: boolean) => (
    <View class="flex-1" style={{ backgroundColor: dark ? THUMB.dark : THUMB.light, paddingTop: 8, paddingLeft: dark ? 0 : 8, paddingRight: dark ? 8 : 0 }}>
      <View
        style={{
          flex: 1,
          backgroundColor: dark ? "#1c1c1e" : "#ffffff",
          borderTopLeftRadius: dark ? 0 : 4,
          borderTopRightRadius: dark ? 4 : 0,
        }}
      >
        <View style={{ height: 7, backgroundColor: dark ? THUMB.darkBar : THUMB.lightBar, borderTopLeftRadius: dark ? 0 : 4, borderTopRightRadius: dark ? 4 : 0 }} />
      </View>
    </View>
  );
  return (
    <Radio
      testID={`settings-appearance:${props.value}`}
      checked={chosen()}
      onChange={() => setAppearance(props.value)}
      accessibilityLabel={props.label}
      style={{ alignItems: "center", gap: 6 }}
    >
      <View
        class={chosen() ? "border-sys-accent" : "border-transparent"}
        style={{ padding: 0, borderWidth: 3, borderRadius: 10, borderCurve: "continuous" }}
      >
        <View
          class="flex-row border-sys-button-edge"
          style={{ width: 86, height: 54, borderWidth: 0.5, borderRadius: 7, borderCurve: "continuous", overflow: "hidden" }}
        >
          <If when={props.value !== "dark"}>{half(false)}</If>
          <If when={props.value !== "light"}>{half(true)}</If>
        </View>
      </View>
      <Text class={chosen() ? "font-medium text-sys-fg" : "text-sys-muted"} style={{ fontSize: 11, numberOfLines: 1 }}>
        {props.label}
      </Text>
    </Radio>
  );
}

/** The theme cards: three to a row across the group. */
const CARD = { width: 133, height: 78, gap: 12, inset: 12 } as const;

/**
 * A theme as a small panel drawn in its colours for the appearance shown (its surface, a selected row in its accent,
 * the list's text, a note's paper with a to-do, its reminder and an AI app's mark), ringed in the system's accent when
 * chosen, its name under it. The panel itself hides while the settings have the focus, so the cards are where a
 * theme shows as it is chosen.
 */
function ThemeCard(props: { name: ThemeName }) {
  const c = () => swatch(props.name, colorScheme() === "dark");
  const chosen = () => theme() === props.name;
  const bar = (color: string, width: number | `${number}%`, height = 3) => (
    <View style={{ width, height, borderRadius: height / 2, backgroundColor: color }} />
  );
  return (
    <Radio
      testID={`theme:${props.name}`}
      checked={chosen()}
      onChange={() => setThemeName(props.name)}
      accessibilityLabel={t(`theme.${props.name}`)}
      style={{ width: CARD.width, alignItems: "center", gap: 5 }}
    >
      <View
        class={chosen() ? "border-sys-accent" : "border-transparent"}
        style={{ alignSelf: "stretch", padding: 0, borderWidth: 2.5, borderRadius: 10, borderCurve: "continuous" }}
      >
        <View
          testID={`theme-card:${props.name}`}
          class="flex-row border-sys-button-edge"
          style={{
            height: CARD.height,
            gap: 5,
            padding: 6,
            borderWidth: 0.5,
            borderRadius: 7,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: c().surface,
          }}
        >
          <View style={{ width: "40%", gap: 6 }}>
            <View style={{ height: 13, borderRadius: 3, justifyContent: "center", paddingHorizontal: 4, backgroundColor: c().accent }}>
              {bar(c().onAccent, "75%")}
            </View>
            <View style={{ gap: 3, paddingHorizontal: 4 }}>
              {bar(c().ink, "80%")}
              {bar(c().muted, "55%", 2)}
            </View>
            <View style={{ gap: 3, paddingHorizontal: 4 }}>
              <View class="flex-row items-center" style={{ gap: 3 }}>
                {bar(c().ink, "60%")}
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c().agent }} />
              </View>
              {bar(c().muted, "45%", 2)}
            </View>
          </View>
          <View style={{ flex: 1, gap: 5, padding: 6, borderRadius: 4, backgroundColor: c().paper }}>
            {bar(c().paperInk, "70%", 4)}
            {bar(c().paperMuted, "45%", 2)}
            <View class="flex-row items-center" style={{ gap: 3, marginTop: 2 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: c().box }} />
              {bar(c().paperInk, "35%")}
              <View style={{ width: 16, height: 6, borderRadius: 2, backgroundColor: `${c().due.slice(0, 7)}26`, justifyContent: "center", paddingHorizontal: 2 }}>
                {bar(c().due, "100%", 2)}
              </View>
            </View>
            <View class="flex-row items-center" style={{ gap: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: c().box }} />
              {bar(c().paperInk, "50%")}
            </View>
          </View>
        </View>
      </View>
      <Text class={chosen() ? "font-medium text-sys-fg" : "text-sys-muted"} style={{ fontSize: 11, numberOfLines: 1 }}>
        {t(`theme.${props.name}`)}
      </Text>
    </Radio>
  );
}

// ——— AI apps ———

/** A copy button: "Copied" for a moment after a press. */
function CopyButton(props: { text: () => string; testID: string; label?: string }) {
  const copied = signal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function copy() {
    await Clipboard.writeText(untracked(props.text));
    copied.set(true);
    clearTimeout(timer);
    timer = setTimeout(() => copied.set(false), 1600);
  }
  return (
    <PushButton
      testID={props.testID}
      icon={copied() ? "check" : "copy"}
      label={copied() ? t("settings.ai.copied") : (props.label ?? t("settings.ai.copy"))}
      onPress={() => void copy()}
    />
  );
}

/** Text to copy, in a monospaced well with its copy button. */
function CodeWell(props: { text: string; testID: string }) {
  return (
    <View class={`flex-row items-center bg-sys-field ${fade()}`} style={{ gap: 8, paddingVertical: 7, paddingLeft: 10, paddingRight: 6, borderRadius: 7, borderCurve: "continuous" }}>
      <Text testID={props.testID} class="flex-1 font-mono text-sys-fg" style={{ fontSize: 11.5, lineHeight: 17, userSelect: "text" }}>
        {props.text}
      </Text>
      <CopyButton testID={`${props.testID}-copy`} text={() => props.text} />
    </View>
  );
}

/** How an app stands, in words, and the dot's colour. */
function aiState(client: AiClient): { label: string; tone: "ok" | "warn" | "off" } {
  if (client.connected && client.current) return { label: t("settings.ai.connected"), tone: "ok" };
  if (client.connected) return { label: t("settings.ai.elsewhere"), tone: "warn" };
  if (client.manual) return { label: t("settings.ai.manual"), tone: "off" };
  return { label: t("settings.ai.not_connected"), tone: "off" };
}

/** Why an app is set up by hand, and how; first that it stayed on its old folder when it is connected to one. */
function manualHint(client: AiClient): string | null {
  const why = (() => {
    switch (client.manual) {
      case "no-cli":
        return t("settings.ai.no_cli");
      case "unreadable":
        return t("settings.ai.unreadable", { file: client.config });
      case "unsupported":
        return t("settings.ai.unsupported", { file: client.config });
      default:
        return null;
    }
  })();
  if (why === null) return null;
  return client.connected && !client.current ? `${t("settings.ai.not_moved")} ${why}` : why;
}

/** An installed app: its name, its state, and what can be done (connect, disconnect, update, or copy the setup). */
function AiRow(props: { client: AiClient; divider: boolean; server: boolean; dir: string }) {
  const c = () => props.client;
  const state = () => aiState(c());
  const busy = () => aiBusy()[c().id] === true;
  const error = () => aiErrors()[c().id] ?? null;
  const hint = () => error() ?? manualHint(c()) ?? (c().connected && c().current ? t("settings.ai.restart", { app: c().name }) : c().config);
  return (
    <View testID={`settings-ai:${c().id}`} class="flex-row items-center" style={{ minHeight: 44, paddingVertical: 8, paddingHorizontal: 10, gap: 12 }}>
      <If when={props.divider}>
        <View class={`absolute bg-sys-line ${fade()}`} style={{ top: 0, left: 10, right: 10, height: 0.5 }} />
      </If>
      <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <View class="flex-row items-center" style={{ gap: 8 }}>
          <Text class="text-sys-fg" style={{ fontSize: FORM.label }}>
            {c().name}
          </Text>
          <View testID={`settings-ai-state:${c().id}`} class="flex-row items-center" style={{ gap: 5 }}>
            <View
              class={state().tone === "ok" ? "bg-sys-ok" : state().tone === "warn" ? "bg-sys-warn" : "bg-sys-muted"}
              style={{ width: 7, height: 7, borderRadius: 3.5, opacity: state().tone === "off" ? 0.5 : 1 }}
            />
            <Text class="text-sys-muted" style={{ fontSize: FORM.hint }}>
              {state().label}
            </Text>
          </View>
        </View>
        <Hint tone={error() ? "late" : undefined}>{hint()}</Hint>
      </View>
      <If
        when={!c().manual}
        else={<CopyButton testID={`settings-ai-copy:${c().id}`} text={() => props.client.snippet} label={t("settings.ai.copy_setup")} />}
      >
        <View class="flex-row items-center" style={{ gap: 6 }}>
          <If when={c().connected && !c().current}>
            <PushButton
              testID={`settings-ai-update:${c().id}`}
              label={t("settings.ai.update")}
              disabled={busy() || !props.server}
              onPress={() => void toggleClient(c().id, props.dir, true)}
            />
          </If>
          <PushButton
            testID={`settings-ai-toggle:${c().id}`}
            label={c().connected ? t("settings.ai.disconnect") : t("settings.ai.connect")}
            primary={!c().connected}
            disabled={busy() || (!c().connected && !props.server)}
            onPress={() => void toggleClient(c().id, props.dir, !c().connected)}
          />
        </View>
      </If>
    </View>
  );
}

/** What AI apps may do beyond reading and adding: move notes to the Trash and rewrite them (off by default). */
function AiAccessGroup() {
  const failed = signal<string | null>(null);
  return (
    <Group testID="settings-ai-access">
      <Row label={t("settings.ai.trash_rewrite")} hint={failed() ?? t("settings.ai.trash_rewrite_hint")} hintTone={failed() ? "late" : "muted"}>
        <MacSwitch
          testID="settings-ai-trash-rewrite"
          label={t("settings.ai.trash_rewrite")}
          checked={aiTrashAndRewrite()}
          onChange={(on) => {
            try {
              setAiTrashAndRewrite(on);
              failed.set(null);
            } catch (error) {
              failed.set(t("settings.ai.trash_rewrite_failed", { error: errorMessage(error) }));
            }
          }}
        />
      </Row>
    </Group>
  );
}

function AiPane() {
  const dir = () => folderPath() ?? folderShown();
  // From App Translocation's temporary path nothing is connected (Jot must be in Applications first).
  const translocated = Connections.translocated();
  const server = Connections.server() !== null && !translocated;
  const generic = () => Connections.generic(dir());
  // Read again whenever the page shows or the folder changes.
  effect(() => {
    const folder = dir();
    untracked(() => void refreshClients(folder));
  });
  const installed = () => (aiClients() ?? []).filter((c) => c.installed);
  return (
    <>
      <Text class="text-sys-muted" style={{ fontSize: FORM.hint, lineHeight: 15, marginBottom: 2, marginHorizontal: 2 }}>
        {t("settings.ai.intro")}
      </Text>
      <If
        when={translocated}
        else={
          <If when={!server}>
            <Footnote tone="late" testID="settings-ai-no-server">
              {t("settings.ai.no_server")}
            </Footnote>
          </If>
        }
      >
        <Footnote tone="late" testID="settings-ai-translocated">
          {t("settings.ai.translocated")}
        </Footnote>
      </If>
      <SectionTitle>{t("settings.ai.apps")}</SectionTitle>
      <Group testID="settings-ai-apps">
        <If when={aiClients() !== null} else={<Row label={t("settings.ai.looking")} />}>
          <If when={installed().length > 0} else={<Row testID="settings-ai-none" label={t("settings.ai.none")} />}>
            <Each of={installed()} key={(c) => c.id}>
              {(client, index) => <AiRow client={client()} divider={index() > 0} server={server} dir={dir()} />}
            </Each>
          </If>
        </If>
      </Group>
      <SectionTitle>{t("settings.ai.access")}</SectionTitle>
      <AiAccessGroup />
      <SectionTitle>{t("settings.ai.other")}</SectionTitle>
      <Group testID="settings-ai-other">
        <View style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, gap: 8 }}>
          <Text class="text-sys-fg" style={{ fontSize: FORM.label }}>
            {t("settings.ai.command")}
          </Text>
          <CodeWell testID="settings-ai-command" text={generic().command} />
          <Text class="text-sys-fg" style={{ fontSize: FORM.label, marginTop: 4 }}>
            {t("settings.ai.json")}
          </Text>
          <CodeWell testID="settings-ai-json" text={generic().json} />
        </View>
      </Group>
      <Footnote>{t("settings.ai.then")}</Footnote>
    </>
  );
}

// ——— About ———

/** Where the updates stand, in a caption: a restart waiting, a download, the last check's outcome. */
function updateHint(): string {
  const ready = readyUpdate();
  if (ready) return t(ready.kind === "package" ? "update.ready_package" : "update.ready_app", { version: ready.version });
  const manual = manualUpdate();
  if (manual) return t("update.manual", { version: manual.version });
  switch (updatePhase()) {
    case "unavailable":
      return t("update.unavailable");
    case "checking":
      return t("update.checking");
    case "downloading":
      return t("update.downloading", { version: downloading() ?? "" });
    case "current":
      return t("update.current");
    case "failed":
      return t("update.failed");
    default:
      return t("update.auto");
  }
}

/** Software updates: what they are doing, and the one button that fits (restart into one, get one by hand, or check now). */
function UpdatesGroup() {
  const busy = () => updatePhase() === "checking" || updatePhase() === "downloading";
  return (
    <Group testID="settings-updates">
      <Row label={t("update.label")} hint={updateHint()}>
        <If
          when={readyUpdate()}
          else={
            <If
              when={manualUpdate()}
              else={
                <PushButton
                  testID="settings-update-check"
                  label={t("update.check")}
                  disabled={busy() || updatePhase() === "unavailable"}
                  onPress={() => void checkForUpdates()}
                />
              }
            >
              {(manual) => (
                <PushButton testID="settings-update-download" icon="external" label={t("update.download")} onPress={() => void openUrl(manual().url).catch(() => {})} />
              )}
            </If>
          }
        >
          <PushButton testID="settings-update-restart" primary label={t("update.restart")} onPress={() => void restartToUpdate()} />
        </If>
      </Row>
    </Group>
  );
}

const NSH_URL = "https://github.com/longbridge/nsh";

function AboutPane() {
  const info = runningVersion();
  return (
    <>
      <View class="items-center" style={{ paddingTop: 22, paddingBottom: 18, gap: 3 }}>
        <Image
          src={appIcon}
          accessibilityLabel="Jot"
          style={{ width: 84, height: 84, marginBottom: 10, boxShadow: [{ x: 0, y: 6, blur: 16, color: "#00000033" }], borderRadius: 19 }}
        />
        <Text class="font-bold text-sys-fg" style={{ fontSize: 20, letterSpacing: -0.3 }}>
          Jot
        </Text>
        <Text class="text-sys-muted" style={{ fontSize: 12 }}>
          {t("settings.about.tagline")}
        </Text>
        <Text testID="settings-version" class="text-sys-muted" style={{ fontSize: 11, fontVariant: ["tabular-nums"], marginTop: 2 }}>
          {t("settings.about.version", info)}
        </Text>
      </View>
      <UpdatesGroup />
      <Group gap>
        <Row label={t("settings.about.built_with")}>
          <PushButton
            testID="settings-nsh"
            icon="external"
            label={t("settings.about.open")}
            accessibilityLabel={t("settings.about.built_with")}
            onPress={() => void openUrl(NSH_URL).catch(() => {})}
          />
        </Row>
      </Group>
      <Footnote testID="settings-themes-credit">{t("settings.about.themes_credit")}</Footnote>
    </>
  );
}
