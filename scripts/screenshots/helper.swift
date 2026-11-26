// What scripts/screenshots.sh needs that the shell cannot do: the permissions and the display, Jot's copies and its
// panel's window, a backdrop behind the panel, typing, the pointer, and the capture cropped around the panel.
// Built at run time: swiftc -swift-version 5 -O helper.swift -o <dir>/jot-shots-helper
//
//   check                         Accessibility and Screen Recording, and a primary display at 2x
//   running                       the bundle path of each running Jot, one a line
//   quit                          quits every running Jot and waits until they are gone
//   settings <in> <out> k=v… -k   <in> (a JSON object; missing or empty: {}) with keys set or removed, to <out>
//   backdrop light|dark           the website's wall over the primary display, below Jot's panel, until killed
//   wait-panel [seconds]          waits until Jot's panel shows, in front of the backdrop
//   type <text>                   types <text> into the app in front (Jot), in an ASCII keyboard layout
//   pointer                       prints where the pointer is: x y
//   warp <x> <y>                  moves the pointer there
//   park                          moves the pointer to the primary display's right edge, away from the panel
//   shoot <out.png>               captures the panel and the backdrop around it, at 1282×1077 px
import AppKit
import Carbon
import CoreGraphics
import Foundation

let jotID = "com.madcodelife.jot"
let backdropTitle = "Jot screenshot backdrop"

/// The panel's window (Panel.tsx: the note-sized panel plus a 24 pt margin each side), the panel's width, and the
/// shot: the panel with 53.5 pt each side and 20 pt above, 641 × 538.5 pt.
let window = CGSize(width: 860, height: 547)
let panelWidth: CGFloat = 534
let shotPoints = CGRect(x: (860 - 534) / 2 - 53.5, y: 24 - 20, width: 641, height: 538.5)
let scale: CGFloat = 2

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(("jot-shots-helper: " + message + "\n").data(using: .utf8)!)
  exit(1)
}

func pause(_ seconds: Double) { Thread.sleep(forTimeInterval: seconds) }

var args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else { fail("no command") }
let command = args.removeFirst()

func windows() -> [[String: Any]] {
  (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
}

func bounds(_ info: [String: Any]) -> CGRect {
  guard let dict = info[kCGWindowBounds as String] as? NSDictionary,
    let rect = CGRect(dictionaryRepresentation: dict)
  else { return .zero }
  return rect
}

/// Jot's panel window, in front-to-back order with the others: its index, info and frame (top-left origin, points).
func panelWindow() -> (index: Int, info: [String: Any], frame: CGRect)? {
  for (i, info) in windows().enumerated() {
    guard info[kCGWindowOwnerName as String] as? String == "Jot" else { continue }
    let frame = bounds(info)
    if frame.size == window { return (i, info, frame) }
  }
  return nil
}

func backdropIndex() -> Int? {
  windows().firstIndex { $0[kCGWindowName as String] as? String == backdropTitle }
}

func runningJots() -> [NSRunningApplication] {
  NSRunningApplication.runningApplications(withBundleIdentifier: jotID)
}

/// The app the user granted (or must grant) the permissions to: the terminal this runs in.
func responsibleApp() -> String {
  let env = ProcessInfo.processInfo.environment
  if let id = env["__CFBundleIdentifier"], let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) {
    return url.deletingPathExtension().lastPathComponent
  }
  return env["TERM_PROGRAM"] ?? "the terminal app running this script"
}

switch command {
case "check":
  var problems: [String] = []
  let app = responsibleApp()
  if !CGPreflightPostEventAccess() {
    problems.append("Accessibility (to type into Jot): System Settings → Privacy & Security → Accessibility → \(app)")
  }
  if !CGPreflightScreenCaptureAccess() {
    problems.append(
      "Screen Recording (to capture the panel): System Settings → Privacy & Security → "
        + "Screen & System Audio Recording → \(app)"
    )
  }
  guard let primary = NSScreen.screens.first else { fail("no display") }
  if primary.backingScaleFactor != scale {
    problems.append(
      "the primary display is at \(primary.backingScaleFactor)x; the shots are taken at 2x (1282×1077 px): "
        + "make a Retina display the primary one"
    )
  }
  let needed = CGSize(width: window.width, height: primary.frame.height * 0.17 + window.height)
  if primary.frame.width < needed.width || primary.frame.height < needed.height {
    let size = "\(Int(primary.frame.width))×\(Int(primary.frame.height)) pt"
    problems.append("the primary display (\(size)) is too small for the panel")
  }
  if !problems.isEmpty {
    fail("cannot take the screenshots:\n  - " + problems.joined(separator: "\n  - "))
  }

case "running":
  for app in runningJots() {
    if let url = app.bundleURL { print(url.path) }
  }

case "quit":
  for app in runningJots() { app.terminate() }
  for _ in 0..<100 where !runningJots().isEmpty { pause(0.1) }
  for app in runningJots() { app.forceTerminate() }
  for _ in 0..<50 where !runningJots().isEmpty { pause(0.1) }
  if !runningJots().isEmpty { fail("Jot did not quit") }

case "settings":
  guard args.count >= 2 else { fail("settings <in> <out> key=value… -key…") }
  let input = args.removeFirst()
  let output = args.removeFirst()
  var object: [String: Any] = [:]
  if let data = FileManager.default.contents(atPath: input), !data.isEmpty {
    guard let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      fail("\(input) is not a JSON object")
    }
    object = parsed
  }
  for arg in args {
    if arg.hasPrefix("-") {
      object.removeValue(forKey: String(arg.dropFirst()))
    } else if let eq = arg.firstIndex(of: "=") {
      object[String(arg[..<eq])] = String(arg[arg.index(after: eq)...])
    } else {
      fail("'\(arg)' is neither key=value nor -key")
    }
  }
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  do {
    try data.write(to: URL(fileURLWithPath: output), options: .atomic)
  } catch {
    fail("cannot write \(output): \(error)")
  }

case "backdrop":
  let dark = args.first == "dark"
  NSApplication.shared.setActivationPolicy(.accessory)
  guard let screen = NSScreen.screens.first else { fail("no display") }
  let panel = NSPanel(
    contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  panel.title = backdropTitle
  panel.isOpaque = true
  panel.hasShadow = false
  panel.ignoresMouseEvents = true
  panel.becomesKeyOnlyIfNeeded = true
  panel.hidesOnDeactivate = false
  panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
  panel.level = .floating
  // The wall is laid out over the shot, where Jot places its panel (Panel.tsx `placement`), as the website lays it out
  // around its panel; beyond it the glows fade out to the base color.
  let display = screen.frame
  let placed = CGPoint(
    x: ((display.width - window.width) / 2).rounded(), y: (display.height * 0.17 - 24).rounded())
  panel.contentView = Wall(dark: dark, area: shotPoints.offsetBy(dx: placed.x, dy: placed.y))
  panel.setFrame(screen.frame, display: true)
  panel.orderFrontRegardless()
  let follower = Follower(panel)
  Timer.scheduledTimer(
    timeInterval: 0.2, target: follower, selector: #selector(Follower.tick), userInfo: nil, repeats: true)
  signal(SIGTERM) { _ in exit(0) }
  signal(SIGINT) { _ in exit(0) }
  NSApplication.shared.run()

case "wait-panel":
  let timeout = Double(args.first ?? "") ?? 20
  let start = Date()
  while Date().timeIntervalSince(start) < timeout {
    if let jot = panelWindow(), let mine = backdropIndex(), jot.index < mine { exit(0) }
    pause(0.2)
  }
  if panelWindow() == nil { fail("Jot's panel did not show within \(Int(timeout)) s") }
  fail("Jot's panel stayed behind the backdrop")

case "type":
  let text = args.joined(separator: " ")
  let front = NSWorkspace.shared.frontmostApplication
  guard front?.bundleIdentifier == jotID else {
    fail("Jot is not the app in front (\(front?.localizedName ?? "none") is): it would not get the keys")
  }
  // An input method (Pinyin, Kana) would compose the letters: an ASCII keyboard layout while typing, then back.
  let current = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
  let ascii = TISCopyCurrentASCIICapableKeyboardLayoutInputSource().takeRetainedValue()
  func kind(_ source: TISInputSource) -> String {
    guard let raw = TISGetInputSourceProperty(source, kTISPropertyInputSourceType) else { return "" }
    return Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue() as String
  }
  let switched = kind(current) != (kTISTypeKeyboardLayout as String)
  if switched {
    TISSelectInputSource(ascii)
    pause(0.4)
  }
  // US layout key codes, so the app sees the key it expects; the characters are set too.
  let codes: [Character: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
    "e": 14, "r": 15, "y": 16, "t": 17, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45,
    "m": 46, " ": 49,
  ]
  let source = CGEventSource(stateID: .hidSystemState)
  for character in text {
    let code = codes[character] ?? 0
    var units = Array(String(character).utf16)
    for down in [true, false] {
      guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else {
        fail("cannot make a key event")
      }
      event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
      event.post(tap: .cghidEventTap)
      pause(0.03)
    }
    pause(0.08)
  }
  if switched {
    pause(0.3)
    TISSelectInputSource(current)
  }

case "pointer":
  let at = CGEvent(source: nil)?.location ?? .zero
  print("\(Int(at.x)) \(Int(at.y))")

case "warp":
  guard args.count == 2, let x = Double(args[0]), let y = Double(args[1]) else { fail("warp <x> <y>") }
  CGWarpMouseCursorPosition(CGPoint(x: x, y: y))
  CGAssociateMouseAndMouseCursorPosition(1)

case "park":
  let display = CGDisplayBounds(CGMainDisplayID())
  CGWarpMouseCursorPosition(CGPoint(x: display.maxX - 8, y: display.midY))
  CGAssociateMouseAndMouseCursorPosition(1)

case "shoot":
  guard let out = args.first else { fail("shoot <out.png>") }
  // The panel hides as soon as Jot loses the focus (Panel.tsx): in front before and after, or the shot may have caught
  // it fading out.
  func showing() -> Bool { NSWorkspace.shared.frontmostApplication?.bundleIdentifier == jotID && panelWindow() != nil }
  guard showing(), let jot = panelWindow() else { fail("Jot's panel is not showing (something took the focus)") }
  // screencapture takes whole points: the region around the shot, then the shot cut out of it in pixels.
  let shot = shotPoints.offsetBy(dx: jot.frame.minX, dy: jot.frame.minY)
  let region = shot.integral
  let raw = NSTemporaryDirectory() + "jot-shot-\(getpid()).png"
  let capture = Process()
  capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  capture.arguments = [
    "-x", "-t", "png",
    "-R", "\(Int(region.minX)),\(Int(region.minY)),\(Int(region.width)),\(Int(region.height))", raw,
  ]
  try! capture.run()
  capture.waitUntilExit()
  defer { try? FileManager.default.removeItem(atPath: raw) }
  guard capture.terminationStatus == 0,
    let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: raw) as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else { fail("screencapture failed") }
  guard CGFloat(image.width) == region.width * scale else {
    fail("the capture is \(image.width) px wide for \(Int(region.width)) pt: the display is not at 2x")
  }
  let cut = CGRect(
    x: (shot.minX - region.minX) * scale, y: (shot.minY - region.minY) * scale,
    width: shot.width * scale, height: shot.height * scale)
  guard showing() else { fail("Jot's panel hid while it was captured (something took the focus)") }
  guard let cropped = image.cropping(to: cut),
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil)
  else { fail("cannot crop the capture") }
  CGImageDestinationAddImage(dest, cropped, nil)
  guard CGImageDestinationFinalize(dest) else { fail("cannot write \(out)") }
  print("\(out): \(cropped.width)×\(cropped.height) px")

default:
  fail("unknown command \(command)")
}

/// Keeps the backdrop right behind Jot's panel once it shows, at its level, whatever level NSH gives a popup.
final class Follower: NSObject {
  let panel: NSPanel
  init(_ panel: NSPanel) { self.panel = panel }
  @objc func tick() {
    guard let jot = panelWindow(),
      let layer = jot.info[kCGWindowLayer as String] as? Int,
      let number = jot.info[kCGWindowNumber as String] as? Int
    else { return }
    if panel.level.rawValue != layer { panel.level = NSWindow.Level(rawValue: layer) }
    if let mine = backdropIndex(), mine < jot.index { panel.order(.below, relativeTo: number) }
  }
}

/// The website's wall (`--wall` in site/style.css): soft radial glows over a base color, in sRGB.
final class Wall: NSView {
  let dark: Bool
  /// What the wall's percentages are of, in the view (top-left origin).
  let area: CGRect
  init(dark: Bool, area: CGRect) {
    self.dark = dark
    self.area = area
    super.init(frame: .zero)
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }

  /// A CSS `radial-gradient(rx% ry% at cx% cy%, color 0%, transparent stop%)`.
  struct Glow {
    let rx, ry, cx, cy: CGFloat
    let color: UInt32
    let stop: CGFloat
  }

  // CSS paints the first layer on top: these are listed bottom first.
  var glows: [Glow] {
    dark
      ? [
        Glow(rx: 0.40, ry: 0.50, cx: 0.00, cy: 1.00, color: 0x102a66, stop: 0.60),
        Glow(rx: 0.60, ry: 0.70, cx: 1.00, cy: 1.00, color: 0x0b5a7a, stop: 0.62),
        Glow(rx: 0.50, ry: 0.60, cx: 0.55, cy: 0.30, color: 0x0c2a6b, stop: 0.62),
        Glow(rx: 0.60, ry: 0.70, cx: 0.00, cy: 0.00, color: 0x1550b8, stop: 0.62),
      ]
      : [
        Glow(rx: 0.50, ry: 0.60, cx: 0.00, cy: 1.00, color: 0xd9e4ff, stop: 0.60),
        Glow(rx: 0.60, ry: 0.70, cx: 1.00, cy: 1.00, color: 0xbfeaff, stop: 0.60),
        Glow(rx: 0.50, ry: 0.60, cx: 0.62, cy: 0.18, color: 0xd3e6ff, stop: 0.62),
        Glow(rx: 0.60, ry: 0.70, cx: 0.08, cy: 0.00, color: 0xa9cbff, stop: 0.60),
      ]
  }
  var base: UInt32 { dark ? 0x0b1530 : 0xe7eef9 }

  func rgb(_ hex: UInt32, _ alpha: CGFloat) -> CGColor {
    CGColor(
      srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
      blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    let size = area.size
    ctx.setFillColor(rgb(base, 1))
    ctx.fill(bounds)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    for glow in glows {
      guard
        let gradient = CGGradient(
          colorsSpace: space, colors: [rgb(glow.color, 1), rgb(glow.color, 0)] as CFArray,
          locations: [0, glow.stop])
      else { continue }
      ctx.saveGState()
      ctx.translateBy(x: area.minX + glow.cx * size.width, y: area.minY + glow.cy * size.height)
      ctx.scaleBy(x: glow.rx * size.width, y: glow.ry * size.height)
      ctx.drawRadialGradient(
        gradient, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 1, options: [])
      ctx.restoreGState()
    }
  }
}
