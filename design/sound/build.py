"""Jot's sounds, synthesized here, one voice for all three: a glass struck lightly. Each note is a sine frequency-modulated at
3.5 times its pitch (an inharmonic ratio, which makes it sound like glass), the modulation dying within tens of
milliseconds so only the first touch is bright, plus a second sine 2 Hz above it, whose beating makes the ring shimmer
as it fades. A 2 ms attack, an exponential decay, the end faded to silence. Mono, 16-bit, 22.05 kHz WAV.

- assets/reminder.wav, the reminders' chime (their notifications' sound): E6, G#6 and B6 rising, 110 ms apart, ringing
  for about half a second each. 1.1 s, peaking at -9 dBFS (the system's notification volume does the rest): 48 KB.
- assets/new.wav, an AI app's new note, as the island opens on it: B6 then E7 a fourth up, 40 ms apart, shorter still
  (100 ms decay). 0.3 s, peaking at -18 dBFS: 13 KB.
- assets/done.wav, a to-do an AI app completed, as the island's check pops in: E6 then B6 a fifth up, 60 ms apart, short
  (120 ms decay). 0.35 s, peaking at -16 dBFS, well under the chime: 15 KB.

Run with the standard library alone, from anywhere (it writes all three):

    python3 design/sound/build.py
"""

import math
import os
import struct
import wave

RATE = 22050
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets")

E6, GS6, B6, E7 = 1318.51, 1661.22, 1975.53, 2637.02

# notes: (start in seconds, frequency in Hz, level); decay in seconds; length and the fade at its end in seconds; the
# peak in dBFS.
SOUNDS = {
    "reminder.wav": {
        "notes": [(0.0, E6, 0.8), (0.11, GS6, 0.9), (0.22, B6, 1.0)],
        "decay": 0.45,
        "length": 1.1,
        "fade": 0.06,
        "peak": -9,
    },
    "new.wav": {
        "notes": [(0.0, B6, 0.6), (0.04, E7, 1.0)],
        "decay": 0.10,
        "length": 0.3,
        "fade": 0.06,
        "peak": -18,
    },
    "done.wav": {
        "notes": [(0.0, E6, 0.7), (0.06, B6, 1.0)],
        "decay": 0.12,
        "length": 0.35,
        "fade": 0.06,
        "peak": -16,
    },
}

ATTACK = 0.002
# The modulator's ratio to the pitch, its depth at the strike, and how fast the brightness goes.
RATIO, DEPTH, BRIGHT = 3.5, 1.6, 0.04
# The shimmering twin: how far above the pitch, and how loud.
TWIN, TWIN_LEVEL = 2.0, 0.5


def glass(s, freq, decay):
    """One note, `s` seconds after it is struck."""
    depth = DEPTH * math.exp(-s / BRIGHT)
    tone = math.sin(2 * math.pi * freq * s + depth * math.sin(2 * math.pi * RATIO * freq * s))
    twin = TWIN_LEVEL * math.sin(2 * math.pi * (freq + TWIN) * s)
    return min(1.0, s / ATTACK) * math.exp(-s / decay) * (tone + twin)


def sample(sound, t):
    value = 0.0
    for start, freq, level in sound["notes"]:
        if t >= start:
            value += level * glass(t - start, freq, sound["decay"])
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
