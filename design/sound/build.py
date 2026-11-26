"""Jot's sounds, synthesized here: sines with a quick attack and an exponential decay, the end faded to silence. Mono,
16-bit, 22.05 kHz WAV.

- assets/reminder.wav, the reminders' chime (their notifications' sound): two soft bell notes, G5 then C6 a fourth up,
  120 ms apart. A bell's partials: an octave, and the inharmonic 2.76 and 5.4 that make it sound struck. About 0.55 s,
  peaking at -9 dBFS (the system's notification volume does the rest): 24 KB.
- assets/done.wav, a to-do ticked in the app: a water drop and its ripples. The drop is a sine whose pitch rises fast,
  600 to 1400 Hz in 25 ms, then rings out (70 ms decay); it echoes three times, 90 ms apart, each softer (0.45, 0.22,
  0.1) and a little higher (x1.06, x1.12, x1.19), like rings spreading on water. 0.55 s, peaking at -14 dBFS, under
  the chime: 24 KB.

Run with the standard library alone, from anywhere (it writes both):

    python3 design/sound/build.py
"""

import math
import os
import struct
import wave

RATE = 22050
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets")

# A struck or plucked sound: notes: (start in seconds, frequency in Hz, level); partials: (frequency multiple, level,
# decay in seconds), the higher ones dying sooner. A drop: drop: (from Hz, to Hz, glide in seconds, decay in seconds);
# echoes: (start in seconds, level, pitch multiple). Both: length and the fade at its end in seconds; the peak in dBFS.
SOUNDS = {
    "reminder.wav": {
        "notes": [(0.0, 783.99, 0.8), (0.12, 1046.50, 1.0)],
        "partials": [(1.0, 1.0, 0.30), (2.0, 0.18, 0.16), (2.76, 0.10, 0.09), (5.4, 0.04, 0.05)],
        "attack": 0.004,
        "length": 0.55,
        "fade": 0.06,
        "peak": -9,
    },
    "done.wav": {
        "drop": (600.0, 1400.0, 0.025, 0.07),
        "echoes": [(0.0, 1.0, 1.0), (0.09, 0.45, 1.06), (0.18, 0.22, 1.12), (0.27, 0.1, 1.19)],
        "attack": 0.003,
        "length": 0.55,
        "fade": 0.05,
        "peak": -14,
    },
}


def drop(sound, s, up):
    """One drop, `s` seconds in, its pitch `up` times the sound's: an exponential glide up, then a ring that decays."""
    low, high, glide, decay = sound["drop"]
    low, high = low * up, high * up
    rate = math.log(high / low) / glide
    if s < glide:
        cycles = low * (math.exp(rate * s) - 1) / rate
    else:
        cycles = (high - low) / rate + high * (s - glide)
    return min(1.0, s / sound["attack"]) * math.exp(-s / decay) * math.sin(2 * math.pi * cycles)


def sample(sound, t):
    value = 0.0
    for start, level, up in sound.get("echoes", []):
        if t >= start:
            value += level * drop(sound, t - start, up)
    for start, freq, level in sound.get("notes", []):
        s = t - start
        if s < 0:
            continue
        attack = min(1.0, s / sound["attack"])
        for multiple, partial, decay in sound["partials"]:
            value += level * partial * attack * math.exp(-s / decay) * math.sin(2 * math.pi * freq * multiple * s)
    # The tail goes to silence, so it never ends on a click.
    left = sound["length"] - t
    if left < sound["fade"]:
        value *= max(0.0, left / sound["fade"]) ** 2
    return value


def build(name, sound):
    out = os.path.normpath(os.path.join(ASSETS, name))
    count = int(RATE * sound["length"])
    raw = [sample(sound, i / RATE) for i in range(count)]
    scale = 10 ** (sound["peak"] / 20) / max(abs(v) for v in raw)
    frames = b"".join(struct.pack("<h", round(v * scale * 32767)) for v in raw)
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(frames)
    print(f"{out}: {count / RATE:.2f} s, {len(frames) + 44} bytes")


def main():
    for name, sound in SOUNDS.items():
        build(name, sound)


if __name__ == "__main__":
    main()
