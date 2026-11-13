//! macOS: the Accessibility permission and AppKit's event monitors.

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::ptr::NonNull;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType, NSWorkspace};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

use crate::summon::{DoubleTap, Modifiers, SummonKey};

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

/// The Accessibility pane of System Settings.
const ACCESSIBILITY_PANE: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

thread_local! {
    /// The event monitors `watch_double_tap` installed (main thread).
    static MONITORS: RefCell<Vec<Retained<AnyObject>>> = const { RefCell::new(Vec::new()) };
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
/// app; replaces what an earlier call installed. Main thread only.
///
/// A global monitor hears the events sent to other apps (with the
/// Accessibility permission), a local one those sent to this app's own
/// windows, which the global one never gets.
pub(crate) fn watch_double_tap(key: SummonKey, on_tap: Box<dyn Fn() + Send>) {
    MONITORS.with_borrow_mut(|monitors| {
        for monitor in monitors.drain(..) {
            // SAFETY: `monitor` is what `add…Monitor…` returned, removed once.
            unsafe { NSEvent::removeMonitor(&monitor) };
        }
    });
    let tap = RefCell::new(DoubleTap::new(key));
    let handle: Rc<dyn Fn(&NSEvent)> = Rc::new(move |event: &NSEvent| {
        let fired = if event.r#type() == NSEventType::FlagsChanged {
            tap.borrow_mut()
                .modifiers(modifiers(event.modifierFlags()), event.timestamp())
        } else {
            tap.borrow_mut().other_input();
            false
        };
        if fired {
            on_tap();
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

fn modifiers(flags: NSEventModifierFlags) -> Modifiers {
    Modifiers {
        shift: flags.contains(NSEventModifierFlags::Shift),
        control: flags.contains(NSEventModifierFlags::Control),
        alt: flags.contains(NSEventModifierFlags::Option),
        command: flags.contains(NSEventModifierFlags::Command),
    }
}
