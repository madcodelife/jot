//! macOS: the Accessibility permission, AppKit's event monitors, the
//! main dispatch queue for the hold's timer, and the keyboard input source
//! (Carbon's Text Input Sources).

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::ptr::NonNull;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType, NSWorkspace};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

use crate::summon::{HOLD, Modifiers, SummonKey, Summoner};

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

/// A Core Foundation object (`CFTypeRef`).
type CfRef = *const c_void;

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    /// The selected keyboard input source, retained (the Create Rule).
    fn TISCopyCurrentKeyboardInputSource() -> CfRef;
    /// One of a source's properties, not retained (the Get Rule).
    fn TISGetInputSourceProperty(source: CfRef, key: CfRef) -> CfRef;
    /// The key of a source's languages: a CFArray of CFStrings, BCP 47 tags,
    /// the one it is most used for first.
    static kTISPropertyInputSourceLanguages: CfRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(object: CfRef);
    fn CFGetTypeID(object: CfRef) -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFArrayGetCount(array: CfRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CfRef, index: isize) -> CfRef;
}

// libdispatch, part of libSystem.
unsafe extern "C" {
    /// The main queue (`dispatch_get_main_queue()` is a macro for its
    /// address).
    static _dispatch_main_q: c_void;
    fn dispatch_time(when: u64, delta: i64) -> u64;
    fn dispatch_after_f(
        when: u64,
        queue: *const c_void,
        context: *mut c_void,
        work: extern "C" fn(*mut c_void),
    );
}

/// `DISPATCH_TIME_NOW`.
const DISPATCH_TIME_NOW: u64 = 0;

/// The Accessibility pane of System Settings.
const ACCESSIBILITY_PANE: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

thread_local! {
    /// The event monitors, installed by the first listener and kept (main
    /// thread).
    static MONITORS: RefCell<Vec<Retained<AnyObject>>> = const { RefCell::new(Vec::new()) };
    /// The gestures' recognizers and listeners (main thread).
    static SUMMONER: RefCell<Option<Summoner>> = const { RefCell::new(None) };
    /// Whether this run asked for the permission already (main thread).
    static PROMPTED: Cell<bool> = const { Cell::new(false) };
}

/// Whether the app has the Accessibility permission.
pub(crate) fn is_trusted() -> bool {
    // SAFETY: a plain query without arguments, callable from any thread.
    unsafe { AXIsProcessTrusted() != 0 }
}

/// Asks for the Accessibility permission (main thread): the system's prompt,
/// which also lists the app in the pane; the pane itself when this run
/// asked before (the system prompts once per app, so a second request
/// would show nothing).
pub(crate) fn request_trust() {
    if is_trusted() {
        return;
    }
    if PROMPTED.replace(true) {
        open_accessibility_pane();
        return;
    }
    // SAFETY: the framework's constant, a CFString, which is toll-free
    // bridged to NSString and lives as long as the process.
    let key = unsafe { &*kAXTrustedCheckOptionPrompt.cast::<NSString>() };
    let yes = NSNumber::new_bool(true);
    let options = NSDictionary::from_slices(&[key], &[&*yes]);
    // SAFETY: `options` is a valid NSDictionary (a CFDictionary, toll-free
    // bridged) that outlives the call.
    unsafe { AXIsProcessTrustedWithOptions(Retained::as_ptr(&options).cast()) };
}

fn open_accessibility_pane() {
    if let Some(url) = NSURL::URLWithString(&NSString::from_str(ACCESSIBILITY_PANE)) {
        NSWorkspace::sharedWorkspace().openURL(&url);
    }
}

/// Calls `on_tap` (on the main thread) when `key` is tapped twice, in any
/// app; replaces the earlier listener. Main thread only.
pub(crate) fn watch_double_tap(key: SummonKey, on_tap: Box<dyn Fn() + Send>) {
    with_summoner(|summoner| summoner.set_tap(key, on_tap));
}

/// Calls `on_start` (on the main thread) when `key` is tapped, then pressed
/// again and held, in any app, and `on_end` when the hold ends (cancelled
/// or not); replaces the earlier listeners. Main thread only.
pub(crate) fn watch_double_tap_hold(
    key: SummonKey,
    on_start: Box<dyn Fn() + Send>,
    on_end: Box<dyn Fn(bool) + Send>,
) {
    with_summoner(|summoner| summoner.set_hold(key, on_start, on_end));
}

/// Runs `f` on the summoner, installing the event monitors the first time.
fn with_summoner(f: impl FnOnce(&mut Summoner)) {
    SUMMONER.with_borrow_mut(|summoner| f(summoner.get_or_insert_with(Summoner::new)));
    if MONITORS.with_borrow(Vec::is_empty) {
        install_monitors();
    }
}

/// Feeds the keyboard's and mouse's events to the summoner.
///
/// A global monitor hears the events sent to other apps (with the
/// Accessibility permission), a local one those sent to this app's own
/// windows, which the global one never gets. A modifier's release is a
/// `FlagsChanged` event like its press, so no key-up events are needed.
fn install_monitors() {
    let handle: Rc<dyn Fn(&NSEvent)> = Rc::new(|event: &NSEvent| {
        let kind = event.r#type();
        let armed = SUMMONER.with_borrow_mut(|summoner| {
            let summoner = summoner.as_mut()?;
            if kind == NSEventType::FlagsChanged {
                summoner.modifiers(modifiers(event.modifierFlags()), event.timestamp())
            } else if kind == NSEventType::KeyDown {
                summoner.key_down();
                None
            } else {
                summoner.button_down();
                None
            }
        });
        if let Some(press) = armed {
            after_hold(press);
        }
    });
    let mask = NSEventMask::FlagsChanged
        | NSEventMask::KeyDown
        | NSEventMask::LeftMouseDown
        | NSEventMask::RightMouseDown
        | NSEventMask::OtherMouseDown;
    let global = {
        let handle = handle.clone();
        // SAFETY (deref): AppKit passes a valid event for the call.
        RcBlock::new(move |event: NonNull<NSEvent>| handle(unsafe { event.as_ref() }))
    };
    let local = {
        let handle = handle.clone();
        RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            // SAFETY: AppKit passes a valid event for the call.
            handle(unsafe { event.as_ref() });
            // Passed on unchanged: the app's windows still get every key.
            event.as_ptr()
        })
    };
    let mut installed = Vec::new();
    if let Some(monitor) = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global) {
        installed.push(monitor);
    }
    // SAFETY: the block returns the event it got, a valid pointer.
    if let Some(monitor) =
        unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) }
    {
        installed.push(monitor);
    }
    MONITORS.with_borrow_mut(|monitors| *monitors = installed);
}

/// Calls the summoner's `tick` with `press` on the main thread `HOLD`
/// later. The press's time travels as the context pointer's bits, so
/// nothing is allocated; a timer whose press was released or followed by
/// other input finds nothing to start.
fn after_hold(press: f64) {
    extern "C" fn fire(context: *mut c_void) {
        let press = f64::from_bits(context as usize as u64);
        SUMMONER.with_borrow_mut(|summoner| {
            if let Some(summoner) = summoner {
                summoner.tick(press);
            }
        });
    }
    // Pointers are 64 bits on every Mac.
    let context = press.to_bits() as usize as *mut c_void;
    // SAFETY: plain libdispatch calls: `dispatch_time` takes any values;
    // `_dispatch_main_q` is the main queue, which lives as long as the
    // process; `fire` takes the context as a number and never dereferences it.
    unsafe {
        let when = dispatch_time(DISPATCH_TIME_NOW, (HOLD * 1e9) as i64);
        dispatch_after_f(when, &raw const _dispatch_main_q, context, fire);
    }
}

fn modifiers(flags: NSEventModifierFlags) -> Modifiers {
    Modifiers {
        shift: flags.contains(NSEventModifierFlags::Shift),
        control: flags.contains(NSEventModifierFlags::Control),
        alt: flags.contains(NSEventModifierFlags::Option),
        command: flags.contains(NSEventModifierFlags::Command),
    }
}

/// The first language of the keyboard input source selected now (`zh-Hans`
/// for Pinyin, `ja` for Kana, `en` for ABC), `None` for a source naming
/// none. Main thread: Text Input Sources belong to it in an AppKit app
/// (`InputSource.language` hops there).
pub(crate) fn input_language() -> Option<String> {
    // SAFETY: a plain query; the source it returns is retained for us and
    // released below, after the last use of what it holds.
    let source = unsafe { TISCopyCurrentKeyboardInputSource() };
    if source.is_null() {
        return None;
    }
    // SAFETY: `source` is a valid input source; the key is the framework's
    // constant, which lives as long as the process.
    let languages = unsafe { TISGetInputSourceProperty(source, kTISPropertyInputSourceLanguages) };
    let first = first_string(languages);
    // SAFETY: `source` came from a Copy function, so it is ours to release,
    // once; `languages` (owned by it) is not used after.
    unsafe { CFRelease(source) };
    first
}

/// `array`'s first element as a string, when `array` is a non-empty CFArray
/// whose first element is a CFString.
fn first_string(array: CfRef) -> Option<String> {
    // SAFETY: `array` is null or a valid CF object (a property of a live
    // source), so its type may be asked, and an array's count and elements
    // read; its elements are valid CF objects, not retained (the Get Rule),
    // and live as long as the array.
    unsafe {
        if array.is_null() || CFGetTypeID(array) != CFArrayGetTypeID() || CFArrayGetCount(array) < 1
        {
            return None;
        }
        let first = CFArrayGetValueAtIndex(array, 0);
        if first.is_null() || CFGetTypeID(first) != CFStringGetTypeID() {
            return None;
        }
        // A CFString is toll-free bridged to NSString; borrowed for the copy.
        let tag = (*first.cast::<NSString>()).to_string();
        (!tag.is_empty()).then_some(tag)
    }
}
