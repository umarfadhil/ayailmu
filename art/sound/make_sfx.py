#!/usr/bin/env python3
"""Draft sound effects for AyaIlmu (docs/content/INTERACTIONS_AUDIO.md §3.2, brief: docs/SOUND_BRIEF.md).

Every sound is synthesised here from scratch: small physical-ish models of a marimba bar, a kalimba tine, a wood
block, a pencil on paper and a turning page, played into a tiny wooden room. No AI generator, no samples. The
results are DRAFTS: a human sound designer may replace any of them under the same file name.

Output: android/core/design/src/main/res/raw/<key>.ogg (Ogg Vorbis, mono, 44.1 kHz, <= 25 KB each).

    python3 art/sound/make_sfx.py                     # all 11 sounds
    python3 art/sound/make_sfx.py --only sfx_tap,sfx_correct
    python3 art/sound/make_sfx.py --wav /tmp/review   # also keep the 16-bit WAVs there
    python3 art/sound/make_sfx.py --out /tmp/try      # write the .ogg files somewhere else

Python 3 + numpy, and ffmpeg built with libvorbis on the PATH. Deterministic: every sound seeds its own random
"hand" from crc32(key), so an unchanged script gives the same audio (and, with the same ffmpeg/libvorbis build,
byte-identical files).

The set lives in one family: C major pentatonic (C D E G A), the same small room, the same wood and mallets.
Loudness is set per sound as a K-weighted momentary maximum (BS.1770 filter, 400 ms window) so the set sounds
even; short ticks sit lower on purpose. Peaks are kept at or below -3 dBFS after encoding.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import wave
import zlib
from pathlib import Path

import numpy as np

SR = 44100
ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "android/core/design/src/main/res/raw"
MAX_BYTES = 25 * 1024
PEAK_CEILING_DB = -3.0  # after encoding
FADE_IN_S = 0.003
LEAD_S = 0.002  # true silence before the fade-in: the codec's pre-echo lands there, not on the first sample
TAIL_S = 0.010  # true silence after the fade-out, for the same reason

# ---------------------------------------------------------------------------------------------------------------
# Pitch: C major pentatonic only
# ---------------------------------------------------------------------------------------------------------------
_SEMI = {"C": 0, "D": 2, "E": 4, "G": 7, "A": 9}


def hz(name: str) -> float:
    """'C5' -> 523.25 Hz. Only the pentatonic notes are allowed, so nothing drifts out of the family."""
    note, octave = name[:-1], int(name[-1])
    midi = 12 * (octave + 1) + _SEMI[note]
    return 440.0 * 2 ** ((midi - 69) / 12)


# ---------------------------------------------------------------------------------------------------------------
# Small DSP toolbox (numpy only)
# ---------------------------------------------------------------------------------------------------------------
def n_of(seconds: float) -> int:
    return int(round(seconds * SR))


def t_axis(seconds: float) -> np.ndarray:
    return np.arange(n_of(seconds)) / SR


def decay(t: np.ndarray, t60: float) -> np.ndarray:
    """Exponential decay reaching -60 dB after t60 seconds."""
    return np.exp(-6.907755 * t / t60)


def onset(t: np.ndarray, ms: float) -> np.ndarray:
    """Smooth 0 -> 1 rise (no click): 1 - exp(-t/tau)."""
    return 1.0 - np.exp(-t / (ms / 1000.0))


def smooth_step(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def spectral_noise(n: int, r: np.random.Generator, lo: float = 0.0, hi: float = SR / 2, order: int = 2) -> np.ndarray:
    """White noise shaped by a smooth band (Butterworth-like magnitude) in the frequency domain. Unit RMS."""
    spec = np.fft.rfft(r.normal(0.0, 1.0, n))
    f = np.fft.rfftfreq(n, 1 / SR)
    mag = np.ones_like(f)
    if lo > 0:
        mag *= 1.0 / np.sqrt(1.0 + (lo / np.maximum(f, 1e-6)) ** (2 * order))
    if hi < SR / 2:
        mag *= 1.0 / np.sqrt(1.0 + (f / hi) ** (2 * order))
    y = np.fft.irfft(spec * mag, n)
    return y / (np.sqrt(np.mean(y**2)) + 1e-12)


def svf(x: np.ndarray, fc, q: float, mode: str = "bp") -> np.ndarray:
    """Topology-preserving state-variable filter; fc may change per sample (sweeps). mode: lp | bp | hp."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    g = np.tan(np.pi * np.minimum(fc, SR * 0.45) / SR)
    k = 1.0 / q
    out = np.empty_like(x)
    ic1 = ic2 = 0.0
    for i in range(len(x)):
        gi = g[i]
        a1 = 1.0 / (1.0 + gi * (gi + k))
        a2 = gi * a1
        a3 = gi * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        out[i] = v2 if mode == "lp" else (v1 if mode == "bp" else x[i] - k * v1 - v2)
    return out


def biquad(x: np.ndarray, b, a) -> np.ndarray:
    b0, b1, b2 = (c / a[0] for c in b)
    _, a1, a2 = (c / a[0] for c in a)
    y = np.empty_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, xi in enumerate(x):
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, xi, y1, yi
        y[i] = yi
    return y


def highpass(x: np.ndarray, fc: float, q: float = 0.7071) -> np.ndarray:
    w = 2 * np.pi * fc / SR
    alpha = np.sin(w) / (2 * q)
    c = np.cos(w)
    return biquad(x, ((1 + c) / 2, -(1 + c), (1 + c) / 2), (1 + alpha, -2 * c, 1 - alpha))


def place(buf: np.ndarray, sig: np.ndarray, at: float) -> None:
    i = max(0, n_of(at))
    j = min(len(buf), i + len(sig))
    if j > i:
        buf[i:j] += sig[: j - i]


# ---------------------------------------------------------------------------------------------------------------
# Instruments
# ---------------------------------------------------------------------------------------------------------------
def marimba(f: float, r: np.random.Generator, vel: float = 1.0, hard: float = 0.6, length: float = 0.8,
            damp: float = 1.0) -> np.ndarray:
    """A rosewood bar: tuned modes near 1 : 4 : 10 (a little off), a tube resonator that rings the fundamental,
    and a soft mallet thump. `hard` = mallet hardness (0 soft yarn .. 1 hard), `damp` < 1 shortens the ring."""
    t = t_axis(length)
    f = f * 2 ** (r.normal(0, 3) / 1200)  # played, not tuned to the cent
    t60 = float(np.clip(0.8 * (523.0 / f) ** 0.6, 0.3, 1.4)) * damp
    modes = [  # (ratio, amplitude, t60)
        (1.0, 1.0, t60),
        (3.98 + r.normal(0, 0.012), 0.32 * hard, t60 * 0.22),
        (9.72 + r.normal(0, 0.04), 0.11 * hard**1.5, t60 * 0.07),
    ]
    y = np.zeros_like(t)
    for ratio, amp, t60m in modes:
        fr = f * ratio
        if fr > SR * 0.42:
            continue
        y += amp * np.sin(2 * np.pi * fr * t + r.uniform(0, 0.3)) * decay(t, t60m)
    # resonator tube: a slightly detuned copy of the fundamental that blooms a little later -> gentle beating
    y += 0.22 * np.sin(2 * np.pi * f * 1.0011 * t) * decay(t, t60 * 1.25) * onset(t, 8)
    # mallet contact: a few ms of low-passed noise, brighter for a harder mallet
    y += 0.05 * (0.4 + hard) * spectral_noise(len(t), r, 80, 900 + 3200 * hard) * decay(t, 0.007)
    return vel * y * onset(t, 0.5)


def kalimba(f: float, r: np.random.Generator, vel: float = 1.0, length: float = 0.7) -> np.ndarray:
    """A steel tine on a small wooden box: cantilever modes near 1 : 5.9 : 16 (decaying fast), a faint box
    octave, and the tiny pitch sag right after the pluck."""
    t = t_axis(length)
    f = f * 2 ** (r.normal(0, 3) / 1200)
    inst_f = f * (1 + 0.0045 * np.exp(-t / 0.025))  # starts a few cents sharp, settles
    phase = 2 * np.pi * np.cumsum(inst_f) / SR
    t60 = float(np.clip(1.1 * (700.0 / f) ** 0.4, 0.35, 1.5))
    y = np.sin(phase) * decay(t, t60)
    upper = min(1.0, (1000.0 / f) ** 0.8)  # short, high tines have weaker upper modes (no whistle)
    for ratio, amp, t60m in ((5.93 + r.normal(0, 0.02), 0.20 * upper, 0.10), (2.0, 0.05, t60 * 0.5),
                             (16.3 + r.normal(0, 0.05), 0.035 * upper, 0.035)):
        if f * ratio < SR * 0.40:
            y += amp * np.sin(phase * ratio + r.uniform(0, 0.5)) * decay(t, t60m)
    y += 0.03 * spectral_noise(len(t), r, 1500, 6000) * decay(t, 0.004)  # thumb on the tine
    return vel * y * onset(t, 0.4)


def wood(f: float, r: np.random.Generator, vel: float = 1.0, length: float = 0.12, ring: float = 0.05,
         bright: float = 0.6) -> np.ndarray:
    """A small hardwood block or tray: four inharmonic modes that die quickly, struck by a felt-tipped stick."""
    t = t_axis(length)
    f = f * 2 ** (r.normal(0, 5) / 1200)
    y = np.zeros_like(t)
    for ratio, amp, k in ((1.0, 1.0, 1.0), (1.52, 0.55 * bright, 0.6), (2.33, 0.3 * bright, 0.42),
                          (3.07, 0.15 * bright**2, 0.3)):
        fr = f * (ratio + r.normal(0, 0.006))
        if fr < SR * 0.42:
            y += amp * np.sin(2 * np.pi * fr * t + r.uniform(0, 0.4)) * decay(t, ring * k)
    y += 0.10 * spectral_noise(len(t), r, 300, 1500 + 4000 * bright) * decay(t, 0.004)
    return vel * y * onset(t, 0.35)


def pencil(length: float, r: np.random.Generator, centre: float = 2600.0, sweep: float = 700.0,
           grit: float = 1.0) -> np.ndarray:
    """Soft graphite on paper: dense random grains (paper tooth) plus a little hiss, through a moving band that
    follows the hand, under a pressure envelope (lands, swells a little, lifts off)."""
    n = n_of(length)
    t = np.arange(n) / SR
    grains = np.zeros(n)
    hits = r.random(n) < 2600 / SR
    grains[hits] = r.lognormal(0, 0.55, hits.sum()) * r.choice((-1.0, 1.0), hits.sum())
    src = grit * grains + 0.45 * r.normal(0, 1, n)
    u = t / length
    fc = centre + sweep * np.sin(np.pi * u) + 120 * np.sin(2 * np.pi * 7.0 * t + r.uniform(0, 6))
    y = svf(src, fc, 1.3, "bp") + 0.45 * svf(src, 1100.0, 0.8, "bp") + 0.12 * svf(src, 7000.0, 1.0, "bp")
    wobble = 1 + 0.18 * spectral_noise(n, r, 0, 25)  # pressure is never perfectly even
    env = smooth_step(t / 0.014) * smooth_step((length - t) / 0.045) * (0.8 + 0.2 * np.sin(np.pi * u)) * wobble
    return svf(y * np.clip(env, 0, None), 5000.0, 0.7, "lp")  # soft lead, not a scratchy nib


def page_turn(length: float, r: np.random.Generator) -> np.ndarray:
    """A book page: a small crinkle as it lifts, the air swish of the sheet crossing over, a soft paper landing."""
    n = n_of(length)
    t = np.arange(n) / SR
    y = np.zeros(n)
    # 1. lift crinkle: sparse crackles in the first ~90 ms
    crack = np.zeros(n)
    m = (t < 0.09) & (r.random(n) < 900 / SR)
    crack[m] = r.lognormal(0, 0.7, m.sum()) * r.choice((-1.0, 1.0), m.sum())
    y += 0.5 * svf(crack, 3800.0, 1.4, "bp") * smooth_step((0.11 - t) / 0.03)
    # 2. swish: noise through a band that rises then falls as the page sweeps, with paper flutter
    u = np.clip((t - 0.03) / 0.30, 0, 1)
    fc = 600 + 2000 * np.sin(np.pi * u) ** 1.5
    sw = svf(r.normal(0, 1, n), fc, 0.75, "bp")
    flutter = 1 + 0.25 * spectral_noise(n, r, 12, 40)
    y += 1.0 * sw * np.sin(np.pi * u) ** 2 * flutter
    # 3. landing: a soft, low paper flap
    land = spectral_noise(n, r, 150, 900) * decay(np.clip(t - 0.33, 0, None), 0.05) * (t >= 0.33)
    y += 0.35 * land * onset(np.clip(t - 0.33, 0, None), 4)
    return svf(y, 6500.0, 0.7, "lp")  # paper, not static


# ---------------------------------------------------------------------------------------------------------------
# The room: one small, soft-walled wooden room shared by every sound (it is what makes them one set)
# ---------------------------------------------------------------------------------------------------------------
def room(x: np.ndarray, wet: float, seed: int = 7) -> np.ndarray:
    r = np.random.default_rng(seed)
    t = t_axis(0.22)
    ir = r.normal(0, 1, len(t)) * decay(t, 0.20)
    ir = svf(ir, 3500.0, 0.7, "lp")  # soft walls swallow the highs
    ir[: n_of(0.004)] = 0.0  # pre-delay
    ir /= np.sqrt(np.sum(ir**2))
    n = len(x) + len(ir) - 1
    nfft = 1 << (n - 1).bit_length()
    tail = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]
    return x + wet * tail


# ---------------------------------------------------------------------------------------------------------------
# The eleven sounds. Each returns (signal, loudness target in LUFS, momentary max).
# ---------------------------------------------------------------------------------------------------------------
def sfx_tap(r):  # card selected (tap-tap): a tiny dry wood tick
    y = np.zeros(n_of(0.064))
    place(y, wood(hz("D6"), r, length=0.064, ring=0.018, bright=0.45), 0)
    return room(y, 0.06), -31.0


def sfx_pick(r):  # card lifted for dragging: a lighter tick with a breath of paper leaving the table
    y = np.zeros(n_of(0.066))
    place(y, wood(hz("G6"), r, vel=0.8, length=0.066, ring=0.014, bright=0.35), 0)
    i = np.arange(len(y))
    lift = svf(spectral_noise(len(y), r, 1500, 4500), 3000.0, 0.9, "bp")
    y += 0.03 * lift * smooth_step(i / n_of(0.02)) * smooth_step((len(y) - i) / n_of(0.035))
    return room(y, 0.06), -32.0


def sfx_drop(r):  # dropped outside a target, slides back: a short paper slide, then a muted low thud
    y = np.zeros(n_of(0.30))
    m = n_of(0.13)
    tt = np.arange(m) / SR
    slide = svf(r.normal(0, 1, m), 1900 - 900 * tt / 0.13, 0.9, "bp")
    place(y, 0.10 * slide * np.sin(np.pi * tt / 0.13) ** 2, 0)
    thud = wood(hz("A4"), r, length=0.17, ring=0.06, bright=0.35)
    thud = svf(thud, 2000.0, 0.7, "lp")  # muted: a palm on the block
    place(y, thud, 0.105)
    return room(y, 0.10), -27.5


def sfx_snap(r):  # settles into a slot: a soft wooden knock and a tiny second settle
    y = np.zeros(n_of(0.20))
    place(y, wood(hz("C5"), r, length=0.16, ring=0.055, bright=0.55), 0)
    place(y, wood(hz("C5"), r, vel=0.16, length=0.10, ring=0.03, bright=0.4), 0.034)
    body = spectral_noise(len(y), r, 90, 380) * decay(t_axis(0.20), 0.025)
    y += 0.10 * body * onset(t_axis(0.20), 1.0)
    return room(y, 0.10), -27.0


def sfx_connect(r):  # a pencil line joins two cards; a quiet wooden tick when it arrives
    y = np.zeros(n_of(0.30))
    place(y, pencil(0.22, r, centre=2000, sweep=800), 0)
    place(y, 2.2 * wood(hz("E6"), r, length=0.07, ring=0.02, bright=0.4), 0.205)
    return room(y, 0.08), -29.0


def sfx_correct(r):  # two rising marimba notes, a fifth: bright, soft mallets
    y = np.zeros(n_of(0.56))
    place(y, marimba(hz("C5"), r, vel=0.9, hard=0.6, length=0.56), 0)
    place(y, marimba(hz("G5"), r, vel=0.95, hard=0.6, length=0.45), 0.11 + r.normal(0, 0.003))
    return room(y, 0.14), -22.0


def sfx_not_yet(r):  # soft, falling minor third on yarn mallets, the mirror of sfx_correct: "hmm, try again"
    y = np.zeros(n_of(0.57))
    place(y, marimba(hz("C5"), r, vel=0.85, hard=0.45, length=0.57, damp=0.5), 0)
    place(y, marimba(hz("A4"), r, vel=0.75, hard=0.42, length=0.41, damp=0.55), 0.16 + r.normal(0, 0.003))
    return room(y, 0.14), -25.0


def sfx_stroke(r):  # one trace stroke done: a short, light pencil stroke
    y = np.zeros(n_of(0.19))
    place(y, pencil(0.17, r, centre=2400, sweep=-500, grit=0.8), 0)
    return room(y, 0.06), -30.0


def sfx_sticker(r):  # three kalimba notes going up, then two tiny high tines as a sparkle
    y = np.zeros(n_of(0.585))
    for i, (note, vel) in enumerate((("G5", 0.75), ("C6", 0.8), ("E6", 0.85))):
        place(y, kalimba(hz(note), r, vel=vel, length=0.585), i * 0.075 + abs(r.normal(0, 0.004)))
    place(y, kalimba(hz("C7"), r, vel=0.16, length=0.35), 0.235)
    place(y, kalimba(hz("G7"), r, vel=0.09, length=0.30), 0.285)
    return room(y, 0.14), -23.0


def sfx_session_done(r):  # a warm little phrase landing on the major third, a soft low C under the last note
    y = np.zeros(n_of(0.885))
    times = (0.0, 0.125, 0.25, 0.41)  # a slight ritardando into the last note
    for (note, vel, hard), at in zip((("G4", 0.75, 0.5), ("C5", 0.8, 0.52), ("D5", 0.8, 0.52), ("E5", 1.0, 0.55)),
                                     times):
        place(y, marimba(hz(note), r, vel=vel, hard=hard, length=0.885), at + r.normal(0, 0.003))
    place(y, marimba(hz("C4"), r, vel=0.55, hard=0.35, length=0.47), times[3] + 0.004)
    place(y, kalimba(hz("E6"), r, vel=0.12, length=0.47), times[3] + 0.012)  # a glint over the last note
    return room(y, 0.16), -22.0


def sfx_page(r):  # a lesson screen turns: a paper page
    y = page_turn(0.45, r)
    return room(y, 0.08), -26.0


# Longest allowed file per key (ms), from the contract: ticks <= 80, the session phrase <= 900, the rest <= 600.
MAX_MS = {"sfx_tap": 80, "sfx_pick": 80, "sfx_session_done": 900}

SOUNDS = {f.__name__: f for f in (sfx_tap, sfx_pick, sfx_drop, sfx_snap, sfx_connect, sfx_correct, sfx_not_yet,
                                  sfx_stroke, sfx_sticker, sfx_session_done, sfx_page)}


# ---------------------------------------------------------------------------------------------------------------
# Mastering and measurement
# ---------------------------------------------------------------------------------------------------------------
def k_weight(x: np.ndarray) -> np.ndarray:
    """ITU-R BS.1770 K-weighting (high shelf + RLB high-pass), designed for SR."""
    # stage 1: high shelf, +4 dB at ~1682 Hz
    gain_db, fc, q = 3.99984385397, 1681.97445095, 0.7071752369554193
    big_a = 10 ** (gain_db / 40)
    w = 2 * np.pi * fc / SR
    alpha = np.sin(w) / (2 * q)
    c = np.cos(w)
    sa = 2 * np.sqrt(big_a) * alpha
    b = (big_a * ((big_a + 1) + (big_a - 1) * c + sa), -2 * big_a * ((big_a - 1) + (big_a + 1) * c),
         big_a * ((big_a + 1) + (big_a - 1) * c - sa))
    a = ((big_a + 1) - (big_a - 1) * c + sa, 2 * ((big_a - 1) - (big_a + 1) * c), (big_a + 1) - (big_a - 1) * c - sa)
    y = biquad(x, b, a)
    # stage 2: high-pass at ~38 Hz
    return highpass(y, 38.13547087613982, 0.5003270373253953)


def momentary_lufs(x: np.ndarray) -> float:
    """Maximum momentary loudness (400 ms window, 10 ms hop). Short sounds are measured padded with silence,
    which is what a listener (and a meter) gets."""
    w = n_of(0.4)
    y = k_weight(np.concatenate([x, np.zeros(w)]))
    c = np.concatenate([[0.0], np.cumsum(y**2)])
    hop = n_of(0.01)
    ms = [(c[i + w] - c[i]) / w for i in range(0, len(y) - w + 1, hop)]
    return -0.691 + 10 * np.log10(max(ms) + 1e-20)


def db(v: float) -> float:
    return 20 * np.log10(max(v, 1e-12))


def master(y: np.ndarray, target_lufs: float) -> np.ndarray:
    y = highpass(y, 35.0)  # no DC, no sub rumble
    y = y - np.mean(y)
    n = len(y)
    fade_out = min(n_of(0.04), n // 3)
    env = np.ones(n)
    fi = n_of(FADE_IN_S)
    env[:fi] = np.sin(0.5 * np.pi * np.arange(fi) / fi) ** 2
    env[n - fade_out:] = np.cos(0.5 * np.pi * np.arange(1, fade_out + 1) / fade_out) ** 2
    y = y * env
    y *= 10 ** ((target_lufs - momentary_lufs(y)) / 20)
    peak_limit = 10 ** ((PEAK_CEILING_DB - 0.6) / 20)  # head-room for the encoder's small overshoot
    if np.max(np.abs(y)) > peak_limit:
        y *= peak_limit / np.max(np.abs(y))
    return np.concatenate([np.zeros(n_of(LEAD_S)), y, np.zeros(n_of(TAIL_S))])


def write_wav(path: Path, y: np.ndarray) -> None:
    pcm = np.clip(np.round(y * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def encode(wav: Path, ogg: Path, quality: float) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-map_metadata", "-1", "-fflags", "+bitexact",
                    "-flags:a", "+bitexact", "-c:a", "libvorbis", "-q:a", f"{quality:g}", "-ac", "1", "-ar",
                    str(SR), "-page_duration", "20000", str(ogg)], check=True)
    # Short Ogg pages (20 ms): with one page per file some decoders (ffmpeg 6) read the end trim as a start trim
    # and eat the fade-in. With several pages every decoder agrees on where the sound starts.


def decode(ogg: Path, n: int) -> np.ndarray:
    """Decoded samples, cut to the n samples that went in (the container's end granule says the same)."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(ogg), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(float)[:n]


def build(key: str, out_dir: Path, wav_dir: Path | None, tmp: Path) -> dict:
    r = np.random.default_rng(zlib.crc32(key.encode()))
    y, target = SOUNDS[key](r)
    y = master(y, target)
    if 1000 * len(y) / SR > MAX_MS.get(key, 600):
        raise SystemExit(f"{key}: {1000 * len(y) / SR:.0f} ms is longer than {MAX_MS.get(key, 600)} ms")
    wav = (wav_dir or tmp) / f"{key}.wav"
    ogg = out_dir / f"{key}.ogg"
    quality = 6.0
    for _ in range(12):
        write_wav(wav, y)
        encode(wav, ogg, quality)
        dec = decode(ogg, len(y))
        over = db(np.max(np.abs(dec))) - PEAK_CEILING_DB
        if over > -0.05:  # encoder overshoot: take it back off and encode again
            y *= 10 ** (-(over + 0.15) / 20)
            continue
        if ogg.stat().st_size > MAX_BYTES and quality > 0:
            quality -= 1.0
            continue
        break
    else:
        raise SystemExit(f"{key}: could not meet the peak/size limits")
    return {
        "key": key, "ms": 1000 * len(dec) / SR, "bytes": ogg.stat().st_size, "q": quality,
        "peak": db(np.max(np.abs(dec))), "rms": db(np.sqrt(np.mean(dec**2))), "lufs": momentary_lufs(dec),
        "dc": float(np.mean(dec)), "first": float(abs(dec[0])), "last": float(abs(dec[-1])),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", help="comma-separated keys (default: all 11)")
    ap.add_argument("--out", type=Path, default=RAW, help=f"where the .ogg files go (default {RAW})")
    ap.add_argument("--wav", type=Path, help="also keep the mastered 16-bit WAVs in this folder")
    args = ap.parse_args()
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg (with libvorbis) is needed on the PATH")
    keys = args.only.split(",") if args.only else list(SOUNDS)
    unknown = [k for k in keys if k not in SOUNDS]
    if unknown:
        sys.exit(f"unknown keys: {', '.join(unknown)} (known: {', '.join(SOUNDS)})")
    args.out.mkdir(parents=True, exist_ok=True)
    if args.wav:
        args.wav.mkdir(parents=True, exist_ok=True)
    print(f"{'key':<18}{'ms':>6}{'bytes':>8}{'q':>4}{'peak dBFS':>11}{'RMS dBFS':>10}{'LUFS(M)':>9}{'DC':>10}")
    with tempfile.TemporaryDirectory() as tmp:
        for key in keys:
            s = build(key, args.out, args.wav, Path(tmp))
            print(f"{s['key']:<18}{s['ms']:6.0f}{s['bytes']:8d}{s['q']:4.0f}{s['peak']:11.2f}{s['rms']:10.2f}"
                  f"{s['lufs']:9.1f}{s['dc']:10.1e}")


if __name__ == "__main__":
    main()
