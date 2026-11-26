"""The reminder's chime (assets/reminder.wav): two soft bell notes, G5 then C6, synthesized here.

Each note is a sine with a little of a bell's partials (an octave, and the inharmonic 2.76 and 5.4 that make a bell
sound struck), a quick attack and an exponential decay. The second note starts 120 ms after the first and rings over
it; the end fades to silence. Mono, 16-bit, 22.05 kHz, peaking at -9 dBFS: about 0.55 s and 24 KB.

Run with the standard library alone, from anywhere:

    python3 design/sound/chime.py
"""

import math
import os
import struct
import wave

RATE = 22050
LENGTH = 0.55
# Peak level, well under full scale: the system's notification volume does the rest.
PEAK = 10 ** (-9 / 20)
# (frequency multiple, level, decay in seconds): the higher partials die sooner.
PARTIALS = [(1.0, 1.0, 0.30), (2.0, 0.18, 0.16), (2.76, 0.10, 0.09), (5.4, 0.04, 0.05)]
# (start in seconds, frequency in Hz, level): G5, then C6 a fourth up.
NOTES = [(0.0, 783.99, 0.8), (0.12, 1046.50, 1.0)]
ATTACK = 0.004
FADE = 0.06

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "reminder.wav")


def sample(t):
    value = 0.0
    for start, freq, level in NOTES:
        s = t - start
        if s < 0:
            continue
        attack = min(1.0, s / ATTACK)
        for multiple, partial, decay in PARTIALS:
            value += level * partial * attack * math.exp(-s / decay) * math.sin(2 * math.pi * freq * multiple * s)
    # The tail goes to silence, so it never ends on a click.
    left = LENGTH - t
    if left < FADE:
        value *= max(0.0, left / FADE) ** 2
    return value


def main():
    count = int(RATE * LENGTH)
    raw = [sample(i / RATE) for i in range(count)]
    scale = PEAK / max(abs(v) for v in raw)
    frames = b"".join(struct.pack("<h", round(v * scale * 32767)) for v in raw)
    with wave.open(os.path.normpath(OUT), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(frames)
    print(f"{os.path.normpath(OUT)}: {count / RATE:.2f} s, {len(frames) + 44} bytes")


if __name__ == "__main__":
    main()
