#!/usr/bin/env python3
"""AyaIlmu DRAFT illustration tool (ART_DIRECTION §6).

Every picture key in docs/ART_CATALOG.md is authored here as hand-placed vector code: no image generator, no
tracing, no network. One run writes, per key:

  art/preview/<key>.svg                                        preview, literal light palette
  android/core/design/src/main/res/drawable/art_<key>.xml      VectorDrawable, @color/art_* references only

plus android/content/src/main/assets/art/index.json (keys + tap regions), ArtRegistry.kt (key -> drawable id),
the learning colours of the pic_color_* daubs (res/values(-night)/art_learn_colors.xml, from LEARN) and the review
contact sheets art/preview/sheet_*.png (light and night).

Everything produced is DRAFT: it ships only as a placeholder until a human illustrator redraws or approves it
against ART_DIRECTION §7.

Usage:
  python3 art/tools/draw.py                      write everything
  python3 art/tools/draw.py --no-sheets          skip the PNG contact sheets
  python3 art/tools/draw.py --only k1,k2 --png DIR [--night]
                                                 review helper: render only these keys as PNGs into DIR
                                                 (does not touch index.json, ArtRegistry.kt or the sheets)

Determinism: each key seeds its own random.Random from crc32(key), so re-runs are byte-identical.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import zlib
from pathlib import Path as FsPath

REPO = FsPath(__file__).resolve().parents[2]
PREVIEW_DIR = REPO / "art" / "preview"
DRAWABLE_DIR = REPO / "android/core/design/src/main/res/drawable"
INDEX_JSON = REPO / "android/content/src/main/assets/art/index.json"
REGISTRY_KT = REPO / "android/core/design/src/main/java/id/petalytix/ayailmu/core/design/art/ArtRegistry.kt"

TAU = math.tau

# Colour roles. The VectorDrawables only ever reference @color/art_<role>; these hex values are for previews
# and must match android/core/design/src/main/res/values(-night)/art_colors.xml.
LIGHT = {
    "paper": "#F6F1E7",
    "ink": "#2B2A28",
    "clay": "#C4613A",
    "ochre": "#D9A441",
    "sage": "#8A9A77",
    "slate": "#5B6B80",
    "blush": "#E3A99A",
}
NIGHT = {
    "paper": "#2A2724",
    "ink": "#E6DED0",
    "clay": "#B8654A",
    "ochre": "#AD884B",
    "sage": "#7E8C6B",
    "slate": "#6F7F98",
    "blush": "#B4857B",
}
LIGHT_BG = "#F6F1E7"  # app paper behind question pictures
NIGHT_BG = "#1F1D1A"  # night paper

# Learning colours: only the pic_color_* paint daubs use them (INTERACTIONS_AUDIO §5), the one place a picture leaves
# the muted palette for a colour a child names without doubt. Flat, no gloss. Night values stay the same named colour
# (black keeps a light ink edge on night paper). draw.py writes them to values(-night)/art_learn_colors.xml.
LEARN = {
    #               light      night
    "learn_red": ("#D63A2F", "#D24B3E"),
    "learn_blue": ("#2F66B8", "#4C80CE"),
    "learn_yellow": ("#F3C631", "#E6BE3E"),
    "learn_green": ("#3D9B4B", "#4EA75B"),
    "learn_black": ("#1C1B1A", "#0C0B0A"),
    "learn_white": ("#FFFFFF", "#F5F2EC"),
    "learn_orange": ("#EE8B26", "#E8913A"),
    "learn_purple": ("#7E4BA3", "#9668BC"),
    "learn_brown": ("#7B4E2C", "#916240"),
    "learn_pink": ("#F29CBB", "#E9A0BA"),
}
LIGHT.update({k: v[0] for k, v in LEARN.items()})
NIGHT.update({k: v[1] for k, v in LEARN.items()})
LEARN_XML = {
    False: REPO / "android/core/design/src/main/res/values/art_learn_colors.xml",
    True: REPO / "android/core/design/src/main/res/values-night/art_learn_colors.xml",
}

# Line weights for a 240-unit viewport; Art.k scales them for larger viewports.
LW = 3.0  # main contour
MW = 1.9  # inner detail, second pass
FW = 1.1  # hatching, fine detail


# --------------------------------------------------------------------------------------------- geometry


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def mul(a, s):
    return (a[0] * s, a[1] * s)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def vlen(v):
    return math.hypot(v[0], v[1])


def unit(v):
    n = vlen(v) or 1.0
    return (v[0] / n, v[1] / n)


def perp(v):
    return (-v[1], v[0])


def rotp(p, deg, c=(0.0, 0.0)):
    a = math.radians(deg)
    s, co = math.sin(a), math.cos(a)
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * co - y * s, c[1] + x * s + y * co)


def polar(c, r, deg, ry=None):
    """Point on a circle/ellipse; degrees in screen space (0 = right, 90 = down)."""
    a = math.radians(deg)
    return (c[0] + r * math.cos(a), c[1] + (r if ry is None else ry) * math.sin(a))


def dirv(deg):
    a = math.radians(deg)
    return (math.cos(a), math.sin(a))


def ellipse(c, rx, ry, rot=0.0, n=24, a0=0.0, sweep=360.0):
    full = sweep >= 360.0
    pts = []
    for i in range(n if full else n + 1):
        p = polar(c, rx, a0 + sweep * i / n, ry)
        pts.append(rotp(p, rot, c) if rot else p)
    return pts


def rect(x, y, w, h):
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def signed_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        s += x0 * y1 - x1 * y0
    return s / 2


def orient(pts):
    """All fills are wound the same way, so same-style fills can be merged under the nonZero rule."""
    return list(pts) if signed_area(pts) >= 0 else list(reversed(pts))


def inside(p, poly):
    x, y = p
    ins = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xc = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if xc > x:
                ins = not ins
    return ins


def clip_half(poly, p0, nrm):
    """Sutherland-Hodgman: keep the part of poly on the side nrm points to."""
    out = []
    n = len(poly)

    def side(q):
        return (q[0] - p0[0]) * nrm[0] + (q[1] - p0[1]) * nrm[1]

    for i in range(n):
        cur, nxt = poly[i], poly[(i + 1) % n]
        sc, sn = side(cur), side(nxt)
        if sc >= 0:
            out.append(cur)
        if (sc >= 0) != (sn >= 0):
            out.append(lerp(cur, nxt, sc / (sc - sn)))
    return out


def clip_convex(poly, convex):
    convex = orient(convex)
    out = poly
    n = len(convex)
    for i in range(n):
        a, b = convex[i], convex[(i + 1) % n]
        e = sub(b, a)
        # with positive (screen) winding the inside is to the right of each edge in math terms
        out = clip_half(out, a, (-e[1], e[0]))
        if not out:
            break
    return out


def bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def subdivide(pts, step, closed=True):
    out = []
    n = len(pts)
    for i in range(n if closed else n - 1):
        a, b = pts[i], pts[(i + 1) % n]
        k = max(1, int(vlen(sub(b, a)) / step))
        for s in range(k):
            out.append(lerp(a, b, s / k))
    if not closed:
        out.append(pts[-1])
    return out


def spline(pts, closed=True, steps=4):
    """Sample a Catmull-Rom curve (used for clipping hatch to a smooth shape)."""
    n = len(pts)
    if n < 3:
        return list(pts)
    if closed:
        g = lambda i: pts[i % n]  # noqa: E731
        idx = range(n)
    else:
        g = lambda i: pts[max(0, min(n - 1, i))]  # noqa: E731
        idx = range(n - 1)
    out = []
    for i in idx:
        p0, p1, p2, p3 = g(i - 1), g(i), g(i + 1), g(i + 2)
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(
                tuple(
                    0.5
                    * (
                        2 * p1[k]
                        + (-p0[k] + p2[k]) * t
                        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
                    )
                    for k in (0, 1)
                )
            )
    if not closed:
        out.append(pts[-1])
    return out


def capsule(p0, p1, r0, r1=None, n=5):
    r1 = r0 if r1 is None else r1
    d = unit(sub(p1, p0))
    ang = math.degrees(math.atan2(d[1], d[0]))
    pts = [polar(p1, r1, ang - 90 + 180 * i / n) for i in range(n + 1)]
    pts += [polar(p0, r0, ang + 90 + 180 * i / n) for i in range(n + 1)]
    return pts


def leaf_pts(base, tip, width, asym=0.8, n=6, belly=0.85):
    d = sub(tip, base)
    nrm = perp(unit(d))
    left, right = [], []
    for i in range(1, n):
        t = i / n
        w = width * math.sin(math.pi * (t**belly))
        p = add(base, mul(d, t))
        left.append(add(p, mul(nrm, w)))
        right.append(add(p, mul(nrm, -w * asym)))
    return [base] + left + [tip] + right[::-1]


def hatch_segments(poly, angle, spacing, rng, inset=(0.6, 2.4), skip=0.06):
    """Parallel hatch lines clipped to poly by plain geometry (even-odd scanlines; VectorDrawable has no clip)."""
    if len(poly) < 3:
        return []
    rp = [rotp(p, -angle) for p in poly]
    ys = [p[1] for p in rp]
    y, y1 = min(ys) + spacing * rng.uniform(0.3, 0.8), max(ys)
    segs = []
    n = len(rp)
    while y < y1:
        xs = []
        for i in range(n):
            a, b = rp[i], rp[(i + 1) % n]
            if (a[1] <= y < b[1]) or (b[1] <= y < a[1]):
                xs.append(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]))
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            xa = xs[k] + rng.uniform(*inset)
            xb = xs[k + 1] - rng.uniform(*inset)
            if xb - xa > 1.6 and rng.random() > skip:
                ya, yb = y + rng.uniform(-0.5, 0.5), y + rng.uniform(-0.5, 0.5)
                segs.append((rotp((xa, ya), angle), rotp((xb, yb), angle)))
        y += spacing * rng.uniform(0.85, 1.15)
    return segs


class Tf:
    """Local drawing frame: scale, rotate (deg), optional horizontal flip, then translate to c."""

    def __init__(self, c=(0.0, 0.0), s=1.0, rot=0.0, flip=False):
        self.c, self.s, self.rot, self.flip = c, s, rot, flip

    def __call__(self, p):
        x, y = p
        if self.flip:
            x = -x
        x, y = x * self.s, y * self.s
        if self.rot:
            x, y = rotp((x, y), self.rot)
        return (self.c[0] + x, self.c[1] + y)

    def pts(self, ps):
        return [self(p) for p in ps]

    def v(self, vec):
        x, y = vec
        if self.flip:
            x = -x
        return rotp((x, y), self.rot) if self.rot else (x, y)

    def ang(self, deg):
        """A hatch/line angle expressed in the local frame."""
        a = 180 - deg if self.flip else deg
        return a + self.rot


# --------------------------------------------------------------------------------------------- paths


def f1(v):
    s = f"{round(v, 1):.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    if s == "-0":
        s = "0"
    return s


class Path:
    __slots__ = ("cmds",)

    def __init__(self):
        self.cmds = []

    def M(self, p):
        self.cmds.append(("M", (p,)))
        return self

    def L(self, p):
        self.cmds.append(("L", (p,)))
        return self

    def C(self, a, b, p):
        self.cmds.append(("C", (a, b, p)))
        return self

    def Q(self, a, p):
        self.cmds.append(("Q", (a, p)))
        return self

    def Z(self):
        self.cmds.append(("Z", ()))
        return self

    def extend(self, other):
        self.cmds.extend(other.cmds)
        return self

    def empty(self):
        return not self.cmds

    def d(self):
        out = []
        for op, pts in self.cmds:
            out.append(op + " ".join(f"{f1(p[0])} {f1(p[1])}" for p in pts))
        return "".join(out)


def qsmooth(path, pts, closed=False):
    """Quadratic B-spline through the midpoints (Q commands: 4 numbers per segment, a third lighter than C)."""
    n = len(pts)
    if n < 3:
        path.M(pts[0])
        for p in pts[1:]:
            path.L(p)
        return path.Z() if closed and n > 2 else path
    if closed:
        mids = [lerp(pts[i], pts[(i + 1) % n], 0.5) for i in range(n)]
        path.M(mids[-1])
        for i in range(n):
            path.Q(pts[i], mids[i])
        return path.Z()
    path.M(pts[0])
    for i in range(1, n - 2):
        path.Q(pts[i], lerp(pts[i], pts[i + 1], 0.5))
    return path.Q(pts[n - 2], pts[n - 1])


def smooth(path, pts, closed=False):
    """Few points: Catmull-Rom (passes through them, keeps small shapes); many points: lighter quadratic spline."""
    if (closed and len(pts) >= 8) or (not closed and len(pts) >= 5):
        return qsmooth(path, pts, closed)
    return catmull(path, pts, closed)


def catmull(path, pts, closed=False, move=True):
    n = len(pts)
    if n < 2:
        return path
    if move:
        path.M(pts[0])
    if n == 2 and not closed:
        return path.L(pts[1])
    if closed:
        g = lambda i: pts[i % n]  # noqa: E731
        idx = range(n)
    else:
        g = lambda i: pts[max(0, min(n - 1, i))]  # noqa: E731
        idx = range(n - 1)
    for i in idx:
        p0, p1, p2, p3 = g(i - 1), g(i), g(i + 1), g(i + 2)
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        path.C(c1, c2, p2)
    if closed:
        path.Z()
    return path


# --------------------------------------------------------------------------------------------- the hand


class Art:
    """One picture: a list of stroke/fill items in draw order, plus the per-key random hand."""

    def __init__(self, key, vw, vh, k=1.0):
        self.key, self.vw, self.vh, self.k = key, vw, vh, k
        self.rng = random.Random(zlib.crc32(key.encode("utf-8")))
        self.items = []
        self.layer = 0  # repeated, non-overlapping objects draw stage by stage so same-style paths merge
        self._reg = {}

    # ---- randomness
    def u(self, lo, hi):
        return self.rng.uniform(lo, hi)

    def j(self, a):
        return self.rng.uniform(-a, a)

    def jit(self, p, a):
        return (p[0] + self.j(a), p[1] + self.j(a))

    def reg(self, color):
        """Print mis-registration: each colour plate of a picture sits a little off the ink plate."""
        if color not in self._reg:
            if color == "paper":
                self._reg[color] = (0.0, 0.0)
            else:
                ang = self.u(0, TAU)
                m = self.u(1.0, 2.2) * self.k
                self._reg[color] = (m * math.cos(ang), m * math.sin(ang))
        return self._reg[color]

    # ---- emit
    def stroke(self, path, w=LW, color="ink", alpha=1.0):
        if not path.empty():
            self.items.append((self.layer, "s", color, round(w * self.k, 2), round(alpha, 2), path.d()))

    def fill(self, path, color, alpha=1.0):
        if not path.empty():
            self.items.append((self.layer, "f", color, 0, round(alpha, 2), path.d()))

    # ---- path builders
    def seg(self, p0, p1, amp=0.8, path=None, over=(0.0, 0.0)):
        path = path if path is not None else Path()
        dv = unit(sub(p1, p0))
        a = self.jit(sub(p0, mul(dv, over[0])), amp * 0.35)
        b = self.jit(add(p1, mul(dv, over[1])), amp * 0.35)
        n = perp(dv)
        L = vlen(sub(b, a))
        bow = self.j(amp) * min(1.0, L / 50)
        if L > 150:
            m = add(lerp(a, b, 0.5), mul(n, bow + self.j(amp * 0.5)))
            path.M(a)
            for s, e in ((a, m), (m, b)):
                path.C(
                    add(lerp(s, e, 0.33), mul(n, self.j(amp * 0.6))),
                    add(lerp(s, e, 0.67), mul(n, self.j(amp * 0.6))),
                    e,
                )
            return path
        path.M(a).C(
            add(lerp(a, b, 0.33), mul(n, bow + self.j(amp * 0.4))),
            add(lerp(a, b, 0.67), mul(n, bow * 0.8 + self.j(amp * 0.4))),
            b,
        )
        return path

    def sketch_poly(self, pts, closed=True, amp=0.9, over=2.4, gap=1.8):
        """Each edge its own stroke: corners overshoot or stop short, like a quick pen."""
        path = Path()
        n = len(pts)
        for i in range(n if closed else n - 1):
            self.seg(pts[i], pts[(i + 1) % n], amp, path, over=(self.u(-gap, over), self.u(-gap, over)))
        return path

    def open_curve(self, pts, jit=0.5):
        return smooth(Path(), [self.jit(p, jit) for p in pts])

    def closed_curve(self, pts, jit=0.5):
        """A smooth closed outline that never quite closes: it stops short or runs a little past its start."""
        n = len(pts)
        s = self.rng.randrange(n)
        seq = [self.jit(p, jit) for p in (pts[s:] + pts[:s])]
        if self.rng.random() < 0.5:
            seq.append(add(seq[0], mul(unit(sub(seq[1], seq[0])), self.u(1.5, 4.5) * self.k)))
        else:
            seq.append(lerp(seq[-1], seq[0], self.u(0.72, 0.9)))
        return smooth(Path(), seq)

    def ell_path(self, c, rx, ry, rot=0.0, a0=None, sweep=None, wob=0.03, jit=0.35):
        if a0 is None:
            a0 = self.u(0, 360)
        if sweep is None:
            sweep = self.u(342, 374)
        per = math.pi * (rx + ry) * sweep / 360
        n = max(5, min(20, int(per / 18) + 3))
        ph1, ph2 = self.u(0, TAU), self.u(0, TAU)
        A1, A2 = self.u(0.4, 1.0) * wob, self.u(0.3, 1.0) * wob * 0.6
        pts = []
        for i in range(n + 1):
            t = math.radians(a0 + sweep * i / n)
            f = 1 + A1 * math.sin(2 * t + ph1) + A2 * math.sin(3 * t + ph2)
            p = (c[0] + rx * f * math.cos(t), c[1] + ry * f * math.sin(t))
            if rot:
                p = rotp(p, rot, c)
            pts.append(self.jit(p, jit))
        return smooth(Path(), pts)

    # ---- composite marks
    def line(self, p0, p1, w=LW, color="ink", alpha=1.0, amp=0.8, over=(0.0, 0.0)):
        self.stroke(self.seg(p0, p1, amp, over=over), w, color, alpha)

    def lines(self, segs, w=FW, color="ink", alpha=1.0, amp=0.5):
        p = Path()
        for s0, s1 in segs:
            self.seg(s0, s1, amp, p)
        self.stroke(p, w, color, alpha)

    def curve(self, pts, w=LW, color="ink", alpha=1.0, jit=0.5):
        self.stroke(self.open_curve(pts, jit), w, color, alpha)

    def zig(self, pts, w=MW, color="ink", alpha=1.0, jit=0.4):
        p = Path().M(self.jit(pts[0], jit))
        for q in pts[1:]:
            p.L(self.jit(q, jit))
        self.stroke(p, w, color, alpha)

    def arc(self, c, r, a0, a1, w=MW, color="ink", alpha=1.0, ry=None, rot=0.0, n=None, jit=0.3):
        n = n or max(3, int(abs(a1 - a0) / 25) + 2)
        pts = [polar(c, r, a0 + (a1 - a0) * i / n, ry) for i in range(n + 1)]
        if rot:
            pts = [rotp(p, rot, c) for p in pts]
        self.curve(pts, w, color, alpha, jit)

    def dots(self, pts, w=3.0, color="ink", alpha=1.0):
        p = Path()
        for q in pts:
            q = self.jit(q, 0.2)
            p.M(q).L((q[0] + 0.3, q[1] + 0.15))
        self.stroke(p, w, color, alpha)

    def stipple(self, poly, n, w=1.6, color="ink", alpha=0.6):
        x0, y0, x1, y1 = bbox(poly)
        pts, tries = [], 0
        while len(pts) < n and tries < n * 40:
            tries += 1
            q = (self.u(x0, x1), self.u(y0, y1))
            if inside(q, poly):
                pts.append(q)
        if pts:
            self.dots(pts, w, color, alpha)

    def hatch(self, poly, angle=45.0, spacing=5.0, w=FW, color="ink", alpha=0.55, inset=(0.6, 2.4), skip=0.06):
        segs = hatch_segments(poly, angle, spacing, self.rng, inset, skip)
        p = Path()
        for s0, s1 in segs:
            p.M(s0).L(s1)
        self.stroke(p, w, color, alpha)

    def fill_smooth(self, pts, color, alpha=1.0, off=None, jit=0.5):
        off = self.reg(color) if off is None else off
        q = [add(self.jit(p, jit), off) for p in orient(pts)]
        self.fill(smooth(Path(), q, closed=True), color, alpha)

    def fill_poly(self, pts, color, alpha=1.0, off=None, jit=0.5, step=16):
        off = self.reg(color) if off is None else off
        q = [add(self.jit(p, jit), off) for p in subdivide(orient(pts), step)]
        p = Path().M(q[0])
        for r in q[1:]:
            p.L(r)
        self.fill(p.Z(), color, alpha)

    def outline(self, pts, w=LW, color="ink", alpha=1.0, second=0.5, jit=0.5):
        """Smooth closed contour with a gap or overrun, plus a partial lighter second pass."""
        self.stroke(self.closed_curve(pts, jit), w, color, alpha)
        if second:
            n = len(pts)
            k = max(3, int(n * self.u(0.25, 0.45)))
            s = self.rng.randrange(n)
            part = [self.jit(pts[(s + i) % n], 0.9) for i in range(k)]
            self.stroke(smooth(Path(), part), w * second, color, alpha)

    def outline_poly(self, pts, w=LW, color="ink", alpha=1.0, closed=True, second=0.5, over=2.4, gap=1.8):
        self.stroke(self.sketch_poly(pts, closed, over=over, gap=gap), w, color, alpha)
        if second:
            n = len(pts)
            i = self.rng.randrange(n if closed else n - 1)
            a, b = pts[i], pts[(i + 1) % n]
            p = self.seg(self.jit(lerp(a, b, self.u(0.0, 0.3)), 0.8), self.jit(lerp(a, b, self.u(0.6, 1.0)), 0.8), 0.8)
            self.stroke(p, w * second, color, alpha)

    def ell_outline(self, c, rx, ry, rot=0.0, w=LW, color="ink", alpha=1.0, second=0.5, wob=0.03):
        self.stroke(self.ell_path(c, rx, ry, rot, wob=wob), w, color, alpha)
        if second and max(rx, ry) > 7:
            c2 = self.jit(c, 0.8)
            p = self.ell_path(c2, rx * self.u(0.98, 1.02), ry * self.u(0.98, 1.02), rot, sweep=self.u(70, 190), wob=wob)
            self.stroke(p, w * second, color, alpha)

    def blob(self, pts, color, alpha=1.0, w=LW, second=0.5, line=True):
        """Smooth filled shape: offset colour plate + hand contour."""
        self.fill_smooth(pts, color, alpha)
        if line:
            self.outline(pts, w, second=second)

    def block(self, pts, color, alpha=1.0, w=LW, second=0.5, line=True):
        """Angular filled shape: offset colour plate + open-cornered contour."""
        self.fill_poly(pts, color, alpha)
        if line:
            self.outline_poly(pts, w, second=second)

    def ell(self, c, rx, ry, color=None, alpha=1.0, rot=0.0, w=LW, second=0.5, n=None, line=True):
        n = n or max(10, min(20, int((rx + ry) / 6)))
        if color:
            self.fill_smooth(ellipse(c, rx, ry, rot, n=n), color, alpha)
        if line:
            self.ell_outline(c, rx, ry, rot, w, second=second)

    def skin(self, pts, smooth=True):
        """Skin = opaque ochre plate + thin clay and slate tints: a warm sawo matang brown from the palette alone.
        No paper in the recipe, so the tone stays close in light and night (paper flips dark at night)."""
        self.skin_many([pts], smooth)

    def skin_many(self, shapes, smooth=True):
        """Skin for several non-overlapping parts, plate by plate, so each plate merges into one path."""
        f = self.fill_smooth if smooth else self.fill_poly
        off = self.reg("ochre")
        for color, alpha in (("ochre", 1.0), ("clay", 0.3), ("slate", 0.26)):
            for pts in shapes:
                f(pts, color, alpha, off=off)

    def hair(self, pts, spacing=3.0):
        """Dark hair = slate plate + ink tint + ink hatch: near-black by day. Known limit: at night ink turns light, so
        hair reads light grey (no palette role is dark in both themes); the illustrator's night pass should fix it."""
        off = self.reg("slate")
        self.fill_smooth(pts, "slate", 1.0, off=off)
        self.fill_smooth(pts, "ink", 0.5, off=off)
        self.hatch(pts, 62, spacing, color="ink", alpha=0.4, inset=(0.4, 1.4), skip=0.0)


# --------------------------------------------------------------------------------------------- registry

ART = {}  # key -> (viewport w, viewport h, stroke scale k, draw fn)


def art_key(key, vw=240, vh=240, k=1.0):
    def deco(fn):
        ART[key] = (vw, vh, k, fn)
        return fn

    return deco


def ground(a, x0, x1, y, marks=4, w=FW * 1.3):
    """A short drawn ground line with a few hatch ticks under it (no shadows)."""
    a.line((x0, y + a.j(1)), (x1, y + a.j(1)), w * 1.2, amp=0.8)
    segs = []
    for i in range(marks):
        x = x0 + (x1 - x0) * (i + 0.5 + a.j(0.3)) / marks
        segs.append(((x, y + 4), (x - 5, y + 9)))
    a.lines(segs, FW, alpha=0.6)


def tint_patch(a, c, rx, ry, color="ochre", alpha=0.16, n=14):
    a.fill_smooth([a.jit(p, min(rx, ry) * 0.06) for p in ellipse(c, rx, ry, a.j(3), n=n)], color, alpha, off=(0, 0))


# --------------------------------------------------------------------------------------------- Aya


def aya_body_local(squash=1.0):
    pts = []
    n = 20
    for i in range(n):
        t = TAU * i / n
        y = -math.cos(t) * 50
        yr = (y + 50) / 100
        x = math.sin(t) * 46 * (0.74 + 0.30 * yr)
        if y > 0:
            y *= 0.93
        x += -3 * (y / 50)
        pts.append((x, y * squash))
    return pts


AYA_POSES = {
    #        arms (local)                                        leaf tips (L, R)           tilt  eyes     mouth
    "idle": ([((-40, 10), (-50, 21)), ((40, 9), (49, 19))], ((-31, -86), (31, -94)), -3, "dot", "small"),
    "wave": ([((-40, 10), (-50, 21)), ((40, 2), (51, -19))], ((-30, -88), (32, -96)), 4, "dot", "smile"),
    "happy": ([((-40, 3), (-53, -9)), ((40, 2), (52, -10))], ((-34, -100), (33, -106)), 0, "happy", "open"),
    "think": ([((-40, 10), (-50, 21))], ((-27, -90), (33, -90)), 14, "up", "flat"),
    "sleep": ([((-38, 15), (-44, 23)), ((38, 15), (43, 22))], ((-33, -58), (29, -61)), -8, "closed", "o"),
}


def draw_aya(a, c, s=1.0, pose="idle", rot=0.0, groundline=True, blush=True, sil=False):
    arms, (ltip, rtip), tilt, eyes, mouth = AYA_POSES[pose]
    if pose == "sleep":
        rot += -9
    T = Tf(c, s, rot)
    squash = 0.93 if pose == "sleep" else 1.0
    if groundline:
        ground(a, T((-40, 54))[0], T((44, 54))[0], T((0, 54))[1] + 2, marks=3)
    # feet, arms (behind the body)
    for fx in (-16, 15):
        a.ell(T((fx, 46 * squash)), 10 * s, 6 * s, "sage", rot=rot, w=MW * 1.2, second=0)
    for p0, p1 in arms:
        a.blob(T.pts(capsule(p0, p1, 7.5, 7)), "sage", w=MW * 1.2, second=0)
    body = T.pts(aya_body_local(squash))
    a.fill_smooth(body, "sage", 0.82)
    if not sil:
        dense = spline(body, True, 3)
        a.hatch(clip_half(dense, T((14, 10)), T.v((0.55, 0.85))), T.ang(62), 4.2 * s, alpha=0.38)
        a.stipple(clip_half(dense, T((0, 30)), T.v((0, 1))), 9, 1.5, alpha=0.45)
    a.outline(body, LW, second=0.45)
    # sprout: stem + two leaves, rotated around the top of the head
    top = (0, -48 * squash)

    def S(p):
        return T(rotp(p, tilt, top))

    stem_top = (1.5, -69)
    a.curve([S(top), S((-2.5, -58)), S(stem_top)], MW * 1.25)
    for tip, wdt in ((ltip, 9.5), (rtip, 10.5)):
        base = S(stem_top)
        lp = leaf_pts(base, S(tip), wdt * s, asym=0.75)
        a.fill_smooth(lp, "sage", 1.0)
        a.outline(lp, MW * 1.3, second=0)
        a.curve([base, lerp(base, S(tip), 0.5), lerp(base, S(tip), 0.8)], FW, jit=0.3)
    if sil:
        return
    # face
    el, er = (-14, -4), (13, -5)
    if eyes == "dot":
        a.dots([T(el), T(er)], 6.4 * s)
    elif eyes == "up":
        a.dots([T((-12, -9)), T((15, -10))], 6.4 * s)
    elif eyes == "happy":
        for e in (el, er):
            a.curve([T((e[0] - 5, e[1] + 2)), T((e[0], e[1] - 4)), T((e[0] + 5, e[1] + 2))], MW * 1.25, jit=0.2)
    elif eyes == "closed":
        for e in (el, er):
            a.curve([T((e[0] - 5, e[1] - 1)), T((e[0], e[1] + 3)), T((e[0] + 5, e[1] - 1))], MW * 1.2, jit=0.2)
    if mouth == "small":
        a.curve([T((-5, 8)), T((0, 11.5)), T((5, 8.5))], MW, jit=0.2)
    elif mouth == "smile":
        a.curve([T((-8, 7)), T((-1, 13)), T((8, 7.5))], MW * 1.1, jit=0.2)
    elif mouth == "open":
        m = T.pts([(-8, 6), (0, 6.5), (8, 5.5), (5, 12), (0, 14.5), (-5, 12)])
        a.fill_smooth(m, "clay", 0.9)
        a.outline(m, MW, second=0, jit=0.2)
    elif mouth == "flat":
        a.curve([T((-7, 10)), T((-1, 10.5)), T((3, 9.5))], MW, jit=0.2)
    elif mouth == "o":
        a.ell(T((1, 10)), 2.4 * s, 2.0 * s, w=FW * 1.3, second=0)
    if blush:
        for bx, by in ((-25, 6), (24, 5)):
            a.fill_smooth(ellipse(T((bx, by)), 6 * s, 3.4 * s, rot, n=8), "blush", 0.85)
    # pose extras
    if pose == "wave":
        h = T((51, -19))
        for r in (11, 16):
            a.arc(h, r * s, -75 + rot, 0 + rot, FW * 1.2)
    if pose == "think":
        a.blob(T.pts(capsule((36, 10), (13, 18), 7.5, 7)), "sage", 0.95, w=MW * 1.2, second=0)
        cc = T((48, -66))
        spiral = [polar(cc, (12 - 8.5 * i / 14) * s, -150 + rot + 34 * i) for i in range(15)]
        a.curve(spiral, MW * 1.2, jit=0.25)
        a.ell(T((34, -40)), 2.0 * s, 2.0 * s, w=FW * 1.2, second=0)
        a.ell(T((39, -48)), 3.0 * s, 3.0 * s, w=FW * 1.2, second=0)
    if pose == "sleep":
        for zx, zy, zs in ((48, -70, 11), (64, -88, 7.5)):
            a.zig([T((zx, zy)), T((zx + zs, zy - 0.5)), T((zx + 0.5, zy + zs)), T((zx + zs + 1, zy + zs))], MW, jit=0.3)


for _pose in AYA_POSES:
    art_key(f"aya_{_pose}")(lambda a, p=_pose: draw_aya(a, (118 + a.j(3), 142), 1.08, p))


# --------------------------------------------------------------------------------------------- counting


MANGO = [
    (0.02, -0.96), (0.42, -0.84), (0.68, -0.45), (0.72, 0.05), (0.6, 0.5), (0.32, 0.86),
    (-0.06, 0.98), (-0.42, 0.82), (-0.6, 0.42), (-0.62, -0.08), (-0.5, -0.55), (-0.26, -0.88),
]


def stage(a, base, k):
    """Put the next marks on draw layer base+k (only for repeated objects that never overlap)."""
    if base is not None:
        a.layer = base + k


MANGO_SMALL = [(0.02, -0.96), (0.56, -0.7), (0.74, -0.08), (0.52, 0.62), (-0.04, 0.98), (-0.52, 0.66),
               (-0.64, 0.02), (-0.44, -0.66)]


def draw_mango(a, c, size, rot=0.0, flip=False, blush=True, w=LW, leaf=True, hatch=True, lay=None):
    T = Tf(c, size / 2, rot, flip)
    small = size < 60
    blush = blush and size >= 45
    body = T.pts(MANGO_SMALL if small else MANGO)
    stage(a, lay, 0)
    a.fill_smooth(body, "ochre")
    if blush:
        stage(a, lay, 1)
        a.fill_smooth(T.pts(ellipse((0.3, -0.42), 0.3, 0.22, -30, n=6 if small else 9)), "clay", 0.42)
    if hatch:
        stage(a, lay, 2)
        dense = spline(body, True, 3)
        a.hatch(clip_half(dense, T((-0.12, 0.25)), T.v((-0.65, 0.75))), T.ang(65), max(2.8, size * 0.07), alpha=0.5)
    stage(a, lay, 3)
    a.outline(body, w, second=0 if small else 0.45)
    a.line(T((0.02, -0.93)), T((0.12, -1.14)), w * 0.8, amp=0.3)
    if leaf:
        lp = leaf_pts(T((0.1, -1.05)), T((0.86, -1.32)), size * 0.13, asym=0.7, n=3 if small else 6)
        stage(a, lay, 4)
        a.fill_smooth(lp, "sage")
        stage(a, lay, 5)
        a.outline(lp, w * 0.6, second=0, jit=0.3)
        stage(a, lay, 6)
        a.line(T((0.12, -1.06)), T((0.62, -1.24)), FW * 0.9, amp=0.3)


def egg_local(n=16):
    pts = []
    for i in range(n):
        t = TAU * i / n
        pts.append((0.72 * math.sin(t) * (1 - 0.13 * math.cos(t)), -math.cos(t) * 0.98 + 0.04))
    return pts


def draw_egg(a, c, size, rot=0.0, w=LW, lay=None):
    T = Tf(c, size / 2, rot)
    pts = T.pts(egg_local(10 if size < 60 else 16))
    stage(a, lay, 0)
    a.fill_smooth(pts, "paper", off=(0, 0))
    stage(a, lay, 1)
    dense = spline(pts, True, 3)
    a.hatch(clip_half(dense, T((0.2, 0.15)), T.v((0.55, 0.8))), T.ang(40), max(2.6, size * 0.065), alpha=0.5)
    stage(a, lay, 2)
    a.outline(pts, w, second=0.45 if size > 60 else 0)


def draw_marble(a, c, r, color, w=LW, lay=None):
    stage(a, lay, 0 if color == "slate" else 1)
    a.fill_smooth(ellipse(c, r, r, n=8 if r < 20 else 12), color)
    hl = [polar(c, r * 0.58, d) for d in (196, 222, 248)]
    stage(a, lay, 2)
    a.curve(hl, max(1.5, r * 0.17), "paper", 0.95, jit=0.2)
    stage(a, lay, 3)
    a.ell_outline(c, r, r, w=w, second=0.45 if r > 20 else 0)


def count_positions(a, n):
    rows = (n + 4) // 5
    cw = {1: min(116, 230 / n), 2: 46, 3: 44, 4: 44}[rows]
    rh = {1: 0, 2: 66, 3: 58, 4: 50}[rows]
    size = {1: max(42, min(100, cw * 0.86)), 2: 42, 3: 38, 4: 35}[rows]
    y0 = 122 - (rows - 1) * rh / 2
    out = []
    for i in range(n):
        r, col = divmod(i, 5)
        x0 = 120 - (min(n, 5) - 1) * cw / 2 if rows == 1 else 120 - 2 * cw
        out.append(((x0 + col * cw + a.j(2.5), y0 + r * rh + a.j(3)), size))
    return out


def draw_count(a, kind, n):
    marble_cols = ["slate", "clay"]
    for c, size in count_positions(a, n):
        if kind == "mango":
            draw_mango(a, (c[0] - 2, c[1] + 2), size * 0.92, a.j(16), flip=a.rng.random() < 0.3, w=LW * 0.85, lay=0)
        elif kind == "egg":
            draw_egg(a, c, size * 0.95, a.j(12), w=LW * 0.85, lay=0)
        else:
            draw_marble(a, c, size * 0.38, marble_cols[a.rng.random() < 0.45], w=LW * 0.85, lay=0)


for _kind in ("mango", "egg", "marble"):
    for _n in range(1, 21):
        art_key(f"count_{_kind}_{_n}")(lambda a, k=_kind, n=_n: draw_count(a, k, n))


GROUP_CENTRES = {
    2: ([(64, 122), (176, 118)], 52),
    3: ([(62, 82), (178, 86), (118, 172)], 44),
    4: ([(66, 68), (174, 72), (64, 174), (172, 170)], 46),
    5: ([(44, 78), (120, 70), (196, 80), (80, 166), (160, 170)], 33),
}
MARBLE_SPOTS = {
    2: [(-0.4, 0.02), (0.4, -0.02)],
    3: [(-0.42, 0.25), (0.42, 0.22), (0.0, -0.42)],
    4: [(-0.38, -0.36), (0.38, -0.38), (-0.36, 0.38), (0.4, 0.36)],
    5: [(-0.44, -0.42), (0.44, -0.44), (0.0, 0.02), (-0.42, 0.46), (0.46, 0.42)],
}


def draw_groups(a, g, n):
    centres, R = GROUP_CENTRES[g]
    mr = R * (0.26 if n <= 4 else 0.23)
    col = "clay" if (g + n) % 2 else "slate"
    for c in centres:
        c = a.jit(c, 2)
        rr = R * a.u(0.96, 1.04)
        a.layer = 0
        a.fill_smooth(ellipse(c, rr, rr * a.u(0.92, 1.0), a.j(20), n=12), "sage", 0.22)
        a.layer = 1
        a.ell_outline(c, rr, rr * 0.97, w=MW * 1.1, second=0.6)
        rot = a.j(25)
        for sp in MARBLE_SPOTS[n]:
            p = add(c, rotp(mul(sp, R * 0.95), rot))
            draw_marble(a, a.jit(p, 1.2), mr, col, w=LW * 0.8, lay=2)


for _g in (2, 3, 4, 5):
    for _n in (2, 3, 4, 5):
        art_key(f"groups_{_g}x{_n}")(lambda a, g=_g, n=_n: draw_groups(a, g, n))


# --------------------------------------------------------------------------------------------- shapes & solids


@art_key("shape_circle")
def shape_circle(a):
    c, r = (116, 122), 80
    a.fill_smooth(ellipse(c, r, r, n=18), "clay")
    a.hatch(clip_half(ellipse(c, r - 6, r - 6, n=30), (150, 160), (0.6, 0.8)), 50, 5.5, alpha=0.45)
    a.ell_outline(c, r, r, w=LW)


@art_key("shape_square")
def shape_square(a):
    pts = [rotp(p, 3, (120, 120)) for p in rect(50, 52, 138, 138)]
    a.block(pts, "ochre")
    a.hatch(clip_half(pts, lerp(pts[1], pts[2], 0.55), unit(sub(pts[2], pts[3]))), -35, 5.5, alpha=0.45)


@art_key("shape_triangle")
def shape_triangle(a):
    pts = [(122, 34), (210, 196), (30, 190)]
    a.block(pts, "sage")
    a.hatch(clip_half(pts, (150, 0), (1, 0.15)), 30, 5.5, alpha=0.45)


@art_key("shape_rectangle")
def shape_rectangle(a):
    pts = [rotp(p, -2, (120, 120)) for p in rect(28, 70, 186, 104)]
    a.block(pts, "slate")
    a.hatch(clip_half(pts, (0, 148), (0, 1)), 25, 5.5, alpha=0.5)


@art_key("shape_oval")
def shape_oval(a):
    c = (120, 122)
    a.fill_smooth(ellipse(c, 96, 60, -4, n=18), "ochre")
    a.hatch(clip_half(ellipse(c, 90, 54, -4, n=30), (130, 150), (0.25, 1)), -40, 5.5, alpha=0.45)
    a.ell_outline(c, 96, 60, -4)


@art_key("shape_rhombus")
def shape_rhombus(a):
    pts = [(124, 26), (200, 122), (118, 214), (42, 116)]
    a.block(pts, "clay")
    a.hatch(clip_half(pts, (130, 150), (0.5, 0.85)), 60, 5.5, alpha=0.45)


def box3d(a, x, y, w, h, d, color):
    """Oblique box: front face, top face, hatched side; edges drawn one by one (open corners)."""
    f = rect(x, y, w, h)
    top = [f[0], f[1], add(f[1], d), add(f[0], d)]
    side = [f[1], add(f[1], d), add(f[2], d), f[2]]
    a.fill_poly(top, color, 0.45)
    a.fill_poly(side, color, 0.95)
    a.fill_poly(f, color, 0.8)
    a.hatch(side, 70, 4.2, alpha=0.55)
    a.stroke(a.sketch_poly(f), LW)
    a.stroke(a.sketch_poly([f[0], add(f[0], d), add(f[1], d), add(f[2], d), f[2]], closed=False), LW)
    a.line(f[1], add(f[1], d), MW)
    a.lines([(lerp(add(f[0], d), add(f[1], d), 0.2), lerp(add(f[0], d), add(f[1], d), 0.7))], MW * 0.6)


@art_key("solid_cube")
def solid_cube(a):
    box3d(a, 50, 90, 104, 104, (48, -40), "ochre")


@art_key("solid_cuboid")
def solid_cuboid(a):
    box3d(a, 28, 112, 150, 78, (46, -38), "sage")


@art_key("solid_cylinder")
def solid_cylinder(a):
    cx, top, bot, rx, ry = 118, 58, 186, 62, 19
    body =[(cx - rx, top), (cx - rx, bot)] + ellipse((cx, bot), rx, ry, n=12, a0=180, sweep=-180) + [(cx + rx, top)]
    a.fill_poly(body, "slate", 0.85, step=10)
    a.fill_smooth(ellipse((cx, top), rx, ry, n=14), "slate", 0.4)
    a.hatch(clip_half(body, (cx + 22, 0), (1, 0)), 75, 4.2, alpha=0.55)
    a.ell_outline((cx, top), rx, ry)
    a.line((cx - rx, top), (cx - rx + a.j(1), bot), LW, over=(1, 2))
    a.line((cx + rx, top), (cx + rx + a.j(1), bot), LW, over=(1, 2))
    a.arc((cx, bot), rx, 178, 2, LW, ry=ry, n=8)
    a.arc((cx, bot), rx, 200, 340, FW, alpha=0.4, ry=ry, n=6)


@art_key("solid_cone")
def solid_cone(a):
    apex, cb, rx, ry = (124, 30), (118, 186), 74, 22
    body = [apex] + ellipse(cb, rx, ry, n=14, a0=0, sweep=180)
    a.fill_poly(body, "clay", 0.85, step=10)
    d = sub((cb[0] + 18, cb[1] + ry), apex)
    a.hatch(clip_half(body, apex, unit((d[1], -d[0]))), 70, 4.2, alpha=0.5)
    a.line(apex, polar(cb, rx, 180, ry), LW, over=(1, 0))
    a.line(apex, polar(cb, rx, 0, ry), LW, over=(2, 1))
    a.arc(cb, rx, 182, -2, LW, ry=ry, n=8)
    a.arc(cb, rx, 205, 335, FW, alpha=0.4, ry=ry, n=6)


@art_key("solid_sphere")
def solid_sphere(a):
    c, r = (118, 124), 82
    a.fill_smooth(ellipse(c, r, r, n=18), "ochre", 0.9)
    c2 = (c[0] - r * 0.24, c[1] - r * 0.24)
    cres = [polar(c, r - 3, t) for t in range(-35, 170, 12)] + [polar(c2, r * 0.98, t) for t in range(166, -36, -12)]
    a.hatch(clip_convex(cres, ellipse(c, r - 3, r - 3, n=36)), 55, 4.2, alpha=0.5)
    a.arc(c, r, 3, 177, MW, ry=r * 0.28, n=8)
    a.ell_outline(c, r, r)


@art_key("solid_pyramid")
def solid_pyramid(a):
    apex = (130, 32)
    b1, b2, b3, b4 = (36, 182), (150, 202), (210, 158), (98, 146)
    front, right = [b1, b2, apex], [b2, b3, apex]
    a.fill_poly(front, "sage", 0.75)
    a.fill_poly(right, "sage", 1.0)
    a.hatch(right, 78, 4.2, alpha=0.55)
    a.stroke(a.sketch_poly([apex, b1, b2, b3], closed=False), LW)
    a.line(apex, b3, LW, over=(1, 2))
    a.line(apex, b2, MW * 1.2, over=(0, 1))
    a.lines([(b1, lerp(b1, b4, 0.85)), (b3, lerp(b3, b4, 0.85))], FW, alpha=0.35)


# --------------------------------------------------------------------------------------------- clocks & fractions


def cpt(c, r, deg):
    a = math.radians(deg)
    return (c[0] + r * math.sin(a), c[1] - r * math.cos(a))


def draw_clock(a, h, mm):
    c, R = (120 + a.j(1.5), 122 + a.j(1.5)), 88
    a.fill_smooth(ellipse(c, R, R, n=18), "ochre", 0.14, off=(0, 0))
    ring = a.ell_path(add(c, a.reg("clay")), R + 5, R + 5, sweep=362, wob=0.012)
    a.stroke(ring, 9, "clay", 0.9)
    a.ell_outline(c, R + 10, R + 10, w=LW, wob=0.015)
    a.ell_outline(c, R - 1, R - 1, w=MW * 0.8, second=0, wob=0.015)
    big, small = Path(), Path()
    for i in range(12):
        ang = i * 30 + a.j(1.5)
        if i % 3 == 0:
            a.seg(cpt(c, R - 7, ang), cpt(c, R - 22, ang), 0.3, big)
        else:
            a.seg(cpt(c, R - 7, ang), cpt(c, R - 14, ang), 0.3, small)
    a.stroke(big, LW * 1.15)
    a.stroke(small, MW)
    ha = (h % 12 + mm / 60) * 30
    ma = mm * 6
    a.line(cpt(c, -9, ha), cpt(c, 48, ha), 7.0, amp=0.4)
    a.line(cpt(c, -12, ma), cpt(c, 72, ma), 3.4, amp=0.5)
    a.dots([add(c, a.reg("clay"))], 11, "clay")
    a.dots([c], 3.2)


for _h in range(1, 13):
    for _m in (0, 30):
        art_key(f"clock_{_h}_{_m:02d}")(lambda a, h=_h, m=_m: draw_clock(a, h, m))


def draw_frac(a, num, den):
    c, R = (118 + a.j(2), 124 + a.j(2)), 84
    a.fill_smooth(ellipse(c, R + 16, R + 10, a.j(3), n=18), "slate", 0.14, off=(0, 0))
    a.ell_outline(c, R + 16, R + 10, w=MW, second=0.5)
    a.fill_smooth(ellipse(c, R, R, n=18), "ochre", 0.5)
    start = -90 + a.j(4)
    step = 360 / den
    for k in range(num):
        t0, t1 = start + k * step, start + (k + 1) * step
        n = max(2, int(step / 10))
        sl = [c] + [polar(c, R - 1.5, t0 + (t1 - t0) * i / n) for i in range(n + 1)]
        a.fill_poly(sl, "clay", 0.92, step=12)
        a.hatch(sl, 30 + k * 20, 4.4, alpha=0.5)
    cuts = Path()
    for k in range(den):
        t = start + k * step
        a.seg(a.jit(c, 1.0), polar(c, R + 2, t), 0.4, cuts)
    a.stroke(cuts, MW * 1.15)
    a.ell_outline(c, R, R, w=LW)
    a.dots([polar(c, R - 7, start + step * (i + 0.5) / 2 + 6) for i in range(den * 2)], 2.4, "paper", 0.9)


for _num, _den in ((1, 2), (1, 3), (2, 3), (1, 4), (3, 4), (1, 8)):
    art_key(f"frac_{_num}_{_den}")(lambda a, n=_num, d=_den: draw_frac(a, n, d))


def ribbon(pts, w0, w1=None, steps=2):
    """Closed outline around a curve whose width tapers from w0 to w1 (tails, stems, handles)."""
    w1 = w0 if w1 is None else w1
    sp = spline(pts, closed=False, steps=steps)
    n = len(sp)
    left, right = [], []
    for i, p in enumerate(sp):
        nrm = perp(unit(sub(sp[min(n - 1, i + 1)], sp[max(0, i - 1)])))
        w = (w0 + (w1 - w0) * i / (n - 1)) / 2
        left.append(add(p, mul(nrm, w)))
        right.append(add(p, mul(nrm, -w)))
    return left + right[::-1]


def crescent(c, r, c2, r2, n=48):
    """The lune of circle (c, r) that lies outside circle (c2, r2), as one closed point list."""

    def run(centre, rad, other, orad, outside):
        pts = [polar(centre, rad, 360 * i / n) for i in range(n)]
        keep = [(vlen(sub(p, other)) > orad) == outside for p in pts]
        start = next(i for i in range(n) if keep[i] and not keep[i - 1])
        out, i = [], start
        while keep[i % n] and len(out) < n:
            out.append(pts[i % n])
            i += 1
        return out

    arc1 = run(c, r, c2, r2, True)
    arc2 = run(c2, r2, c, r, False)
    if vlen(sub(arc2[0], arc1[-1])) > vlen(sub(arc2[-1], arc1[-1])):
        arc2 = arc2[::-1]
    return arc1 + arc2


def round_ball(a, c, r, color, hatch=True, w=LW):
    pts = ellipse(c, r, r * 0.96, n=12)
    a.fill_smooth(pts, color)
    if hatch:
        a.hatch(clip_half(ellipse(c, r - 2, r - 2, n=20), add(c, (r * 0.15, r * 0.2)), (0.6, 0.8)), 50, 3.6, alpha=0.5)
    a.ell_outline(c, r, r * 0.96, w=w, second=0.4 if r > 14 else 0)


# --------------------------------------------------------------------------------------------- balance, length


def draw_balance(a, tilt, left, right):
    piv = (120, 56)
    a.block([(78, 216), (164, 216), (150, 200), (92, 200)], "slate", 0.9)
    a.fill_poly(rect(115, 60, 10, 140), "ochre", 0.9)
    a.line((115, 62), (115, 200), LW * 0.9)
    a.line((125, 64), (125, 200), MW)
    L, R = rotp((42, 56), tilt, piv), rotp((198, 56), tilt, piv)
    for end, obj in ((L, left), (R, right)):
        rim = end[1] + 72
        a.lines([(end, (end[0] - 29, rim)), (end, (end[0] + 29, rim))], FW * 1.2)
        bowl = ellipse((end[0], rim), 33, 15, n=8, a0=0, sweep=180)
        a.fill_poly(bowl, "slate", 0.75, step=10)
        a.curve(bowl, LW)
        a.line((end[0] - 34, rim), (end[0] + 34, rim), MW)
        if obj == "melon":
            c, r = (end[0] + 1, rim - 25), 27
            a.fill_smooth(ellipse(c, r, r * 0.92, n=12), "sage")
            for dx in (-14, -2, 11):
                a.curve([(c[0] + dx * 0.6, c[1] - r * 0.85), (c[0] + dx * 1.15, c[1]), (c[0] + dx * 0.7, c[1] + r * 0.82)],
                        MW * 1.4, "ink", 0.45)
            a.ell_outline(c, r, r * 0.92)
        elif obj == "small":
            round_ball(a, (end[0] + 2, rim - 9), 10, "ochre", hatch=False)
            a.line((end[0] + 3, rim - 19), (end[0] + 6, rim - 24), FW * 1.4)
        else:
            round_ball(a, (end[0] - 1, rim - 16), 17, "clay")
    beam = capsule(L, R, 4.5)
    a.blob(beam, "ochre", w=MW * 1.3, second=0)
    a.dots([L, R], 5)
    a.ell(piv, 7, 7, "clay", w=MW, second=0)


art_key("balance_left_heavy")(lambda a: draw_balance(a, -11, "melon", "small"))
art_key("balance_right_heavy")(lambda a: draw_balance(a, 11, "small", "melon"))
art_key("balance_even")(lambda a: draw_balance(a, 0, "mid", "mid"))


def draw_pencil(a, x0, y, L, h=22):
    x1 = x0 + L
    xb = x1 - 26
    top, bot = y - h / 2, y + h / 2
    a.fill_poly(rect(x0, top, 13, h), "clay", 0.9)
    a.fill_poly(rect(x0 + 13, top, 9, h), "slate", 0.9)
    a.fill_poly(rect(x0 + 22, top, xb - x0 - 22, h), "ochre")
    a.fill_poly([(xb, top), (x1 - 2, y + 0.5), (xb, bot)], "paper", off=(0, 0))
    a.fill_poly([(x1 - 9, y - 3.4), (x1, y + 0.3), (x1 - 9, y + 3.8)], "ink", 0.9, off=(0, 0))
    a.hatch(rect(x0 + 13, top, 9, h), 90, 3.0, alpha=0.6, inset=(0.3, 0.8))
    a.lines([((x0 + 25, y - 3.5), (xb - 3, y - 3.5)), ((x0 + 25, y + 4), (xb - 3, y + 4))], FW, alpha=0.5, amp=0.3)
    a.outline_poly([(x0, top), (xb, top), (x1, y), (xb, bot), (x0, bot)], LW, second=0)
    a.lines([((x0 + 13, top), (x0 + 13, bot)), ((x0 + 22, top), (x0 + 22, bot)), ((xb, top), (xb, bot))], MW, amp=0.3)
    a.zig([(xb, top + 3), (xb + 4, y - 2), (xb, y + 2), (xb + 4, bot - 3)], FW, jit=0.3)


def draw_length(a, L):
    x0, y = 22, 126
    base = 156
    a.line((14, base), (226, base + a.j(1)), LW, amp=0.6)
    ticks = Path()
    for i in range(14):
        x = 22 + i * 15.5
        a.seg((x, base), (x, base + (9 if i % 2 == 0 else 5)), 0.2, ticks)
    a.stroke(ticks, MW)
    a.line((x0, 96), (x0, base - 2), FW * 1.2, alpha=0.6, amp=0.3)
    draw_pencil(a, x0, y, L)


art_key("length_short")(lambda a: draw_length(a, 76))
art_key("length_medium")(lambda a: draw_length(a, 130))
art_key("length_long")(lambda a: draw_length(a, 196))


# --------------------------------------------------------------------------------------------- cat and box

CAT_BODY = [(-24, 0), (-27, -14), (-22, -32), (-12, -42), (0, -45), (12, -42), (22, -32), (26, -14), (24, 0),
            (12, 2.5), (0, 3), (-12, 2.5)]


def cat_head(a, T, hc, s, look=(0, 0), eyes="open"):
    h = T(hc)
    for ear in (((-16, -8), (-14, -25), (-4, -14)), ((6, -15), (17, -26), (19, -8))):
        ep = T.pts([add(hc, p) for p in ear])
        a.fill_poly(ep, "ochre")
        a.outline_poly(ep, MW * 1.2, second=0, over=1.0, gap=1.0)
    head = T.pts(ellipse(hc, 19, 16, n=12))
    a.fill_smooth(head, "ochre")
    a.lines([(T(add(hc, (dx, -15))), T(add(hc, (dx * 1.1, -9)))) for dx in (-4, 1, 6)], MW, "clay", 0.9, amp=0.3)
    a.outline(head, LW, second=0)
    ex = [add(hc, (-6 + look[0], -1 + look[1])), add(hc, (8 + look[0], -1.5 + look[1]))]
    if eyes == "open":
        a.dots(T.pts(ex), 4.2 * s)
    else:
        for e in ex:
            a.curve(T.pts([add(e, (-3.5, 0)), add(e, (0, 2)), add(e, (3.5, 0))]), FW * 1.3, jit=0.1)
    nose = add(hc, (1, 4.5))
    a.fill_poly(T.pts([add(nose, (-2.6, -1.5)), add(nose, (2.6, -1.5)), add(nose, (0, 1.8))]), "clay", off=(0, 0))
    a.curve(T.pts([add(nose, (-4, 4)), add(nose, (-1.5, 5.5)), add(nose, (0, 3)), add(nose, (1.8, 5.5)), add(nose, (4.2, 4))]),
            FW * 1.1, jit=0.1)
    wh = []
    for sx in (-1, 1):
        for dy in (-1, 2.5):
            wh.append((T(add(hc, (sx * 11, 4 + dy * 0.4))), T(add(hc, (sx * 25, 2 + dy * 1.6)))))
    a.lines(wh, FW * 0.9, alpha=0.8, amp=0.3)
    return h


def draw_cat_sit(a, c, s=1.0, flip=False):
    T = Tf(c, s, 0, flip)
    tail = ribbon(T.pts([(20, -4), (38, -6), (46, -20), (40, -34), (34, -38)]), 8 * s, 5 * s)
    a.blob(tail, "ochre", w=MW * 1.3, second=0)
    body = T.pts(CAT_BODY)
    a.fill_smooth(body, "ochre")
    a.lines([(T((sx * 14, -30 + k * 9)), T((sx * 24, -26 + k * 9))) for sx in (-1, 1) for k in range(3)], MW, "clay", 0.9)
    a.outline(body, LW, second=0.4)
    for px in (-9, 9):
        a.ell(T((px, -2)), 6.5 * s, 4.2 * s, "ochre", w=MW * 1.2, second=0)
    cat_head(a, T, (2, -58), s)


def draw_cat_lie(a, c, s=1.0):
    T = Tf(c, s)
    tail = ribbon(T.pts([(30, -6), (46, -4), (58, -6), (64, -12)]), 7 * s, 5 * s)
    a.blob(tail, "ochre", w=MW * 1.3, second=0)
    body = T.pts(ellipse((0, -13), 36, 14, n=14))
    a.fill_smooth(body, "ochre")
    a.lines([(T((x, -25)), T((x + 3, -14))) for x in (-6, 6, 18)], MW, "clay", 0.9)
    a.outline(body, LW, second=0.4)
    for px in (-36, -24):
        a.ell(T((px, -2)), 6.5 * s, 4 * s, "ochre", w=MW * 1.2, second=0)
    cat_head(a, T, (-36, -24), s, look=(-2, 1))


def draw_box(a, x, y, w, h, d=(15, -13), open_=False, cat_inside=None):
    f = rect(x, y, w, h)
    side = [f[1], add(f[1], d), add(f[2], d), f[2]]
    top = [f[0], f[1], add(f[1], d), add(f[0], d)]
    a.fill_poly(side, "slate", 0.95)
    a.hatch(side, 75, 3.8, alpha=0.55)
    if open_:
        a.fill_poly(top, "ink", 0.55, off=(0, 0))
        back = [add(f[0], d), add(f[1], d), add(f[1], (d[0] + 6, d[1] - 16)), add(f[0], (d[0] - 4, d[1] - 18))]
        a.block(back, "slate", 0.7, w=MW * 1.3, second=0)
        if cat_inside:
            cat_inside()
        lf = [f[0], add(f[0], d), add(f[0], (d[0] - 26, d[1] - 4)), (x - 28, y + 6)]
        rf = [f[1], add(f[1], d), add(f[1], (d[0] + 22, d[1] + 10)), (x + w + 20, y + 14)]
        for fl in (lf, rf):
            a.block(fl, "slate", 0.6, w=MW * 1.3, second=0)
    else:
        a.fill_poly(top, "slate", 0.5)
        a.fill_poly([lerp(top[0], top[3], 0.4), lerp(top[1], top[2], 0.4), lerp(top[1], top[2], 0.62),
                     lerp(top[0], top[3], 0.62)], "ochre", 0.8)
        a.line(lerp(top[0], top[3], 0.5), lerp(top[1], top[2], 0.5), FW, alpha=0.7)
    a.fill_poly(f, "slate", 0.85)
    a.stroke(a.sketch_poly(f), LW)
    a.stroke(a.sketch_poly([f[0], add(f[0], d), add(f[1], d), add(f[2], d), f[2]], closed=False), LW * 0.9)
    a.line(f[1], add(f[1], d), MW)
    if not open_:
        a.fill_poly(rect(x + w * 0.4, y, w * 0.22, h * 0.32), "ochre", 0.8)


@art_key("pos_cat_left")
def pos_cat_left(a):
    ground(a, 18, 226, 208, marks=5)
    draw_box(a, 120, 140, 86, 66)
    draw_cat_sit(a, (62, 206), 1.05)


@art_key("pos_cat_right")
def pos_cat_right(a):
    ground(a, 14, 222, 208, marks=5)
    draw_box(a, 22, 140, 86, 66)
    draw_cat_sit(a, (180, 206), 1.05, flip=True)


@art_key("pos_cat_above")
def pos_cat_above(a):
    ground(a, 30, 214, 208, marks=4)
    draw_box(a, 74, 142, 92, 64)
    draw_cat_sit(a, (126, 138), 1.0)


@art_key("pos_cat_below")
def pos_cat_below(a):
    ground(a, 16, 226, 208, marks=5)
    for lx in (52, 186):
        leg = rect(lx, 116, 8, 90)
        a.fill_poly(leg, "ochre", 0.9)
        a.outline_poly(leg, MW * 1.3, second=0)
    plank = rect(36, 104, 172, 13)
    a.fill_poly(plank, "ochre")
    a.hatch(plank, 0, 4, alpha=0.4)
    a.outline_poly(plank, LW, second=0.4)
    draw_box(a, 76, 47, 84, 57)
    draw_cat_lie(a, (126, 206), 1.05)


@art_key("pos_cat_inside")
def pos_cat_inside(a):
    ground(a, 24, 220, 208, marks=4)

    def cat():
        cat_head(a, Tf((118, 104), 1.55), (0, 0), 1.45)

    draw_box(a, 62, 134, 108, 72, (16, -14), open_=True, cat_inside=cat)
    for px in (96, 140):
        a.ell((px, 135), 8.5, 5.2, "ochre", w=MW * 1.2, second=0)
        a.lines([((px - 3, 132), (px - 3, 137)), ((px + 2, 132), (px + 2, 137))], FW, alpha=0.7, amp=0.1)


# --------------------------------------------------------------------------------------------- senses, habits


@art_key("sense_eye")
def sense_eye(a):
    up = [(30, 128), (62, 92), (120, 74), (178, 88), (210, 124)]
    lo = [(30, 128), (68, 156), (122, 166), (176, 152), (210, 124)]
    eye = spline(up, False, 3) + spline(lo, False, 3)[::-1]
    a.fill_poly(eye, "paper", off=(0, 0), step=30)
    ic = (124, 121)
    iris = clip_convex(ellipse(ic, 35, 35, n=24), spline(up, False, 3) + spline(lo, False, 3)[::-1])
    a.fill_poly(iris, "slate", 0.95, step=40)
    a.lines([(polar(ic, 16, t), polar(ic, 29, t + 4)) for t in range(0, 360, 30)], FW, "ink", 0.35, amp=0.3)
    a.fill_smooth(ellipse(ic, 14, 14, n=10), "ink", 0.92, off=(0, 0))
    a.dots([(113, 111)], 7.5, "paper")
    a.curve(up, LW * 1.35)
    a.curve(lo, MW * 1.1)
    lash = []
    for t in (0.18, 0.32, 0.47, 0.62, 0.76):
        sp = spline(up, False, 6)
        p = sp[int(t * (len(sp) - 1))]
        q = sp[int(t * (len(sp) - 1)) + 1]
        nrm = perp(unit(sub(q, p)))
        lash.append((p, add(add(p, mul(nrm, 12)), mul(unit(sub(q, p)), 4))))
    a.lines(lash, MW, amp=0.5)
    a.curve([(54, 64), (108, 44), (174, 50), (192, 60)], 4.8, jit=0.6)
    a.curve([(64, 60), (120, 46), (170, 52)], FW, alpha=0.6)


@art_key("sense_ear")
def sense_ear(a):
    ear = [(96, 40), (134, 34), (162, 52), (172, 88), (164, 122), (146, 148), (132, 174), (118, 200), (98, 208),
           (82, 196), (84, 172), (96, 156), (92, 132), (80, 104), (76, 70)]
    a.skin(ear)
    concha = [(104, 70), (134, 66), (146, 92), (132, 118), (116, 132), (104, 114)]
    a.hatch(concha, 60, 4, alpha=0.4)
    a.outline(ear, LW, second=0.45)
    a.curve([(100, 60), (132, 56), (150, 78), (148, 108), (130, 128), (118, 148), (116, 170)], MW * 1.1)
    a.curve([(108, 118), (100, 126), (106, 136)], MW)
    for r in (68, 86, 104):
        a.arc((118, 120), r, -38, 38, MW * 1.15, "slate", 0.9, n=5)


@art_key("sense_nose")
def sense_nose(a):
    hc = (176, 118)
    head = ([polar(hc, 56, t) for t in range(-100, 121, 20)]
            + [(150, 176), (126, 168), (118, 154), (124, 146), (112, 140), (90, 130), (94, 122), (116, 96), (126, 66)])
    a.skin(head)
    hair = [polar(hc, 59, t) for t in range(-112, 51, 18)] + [(204, 154), (200, 126), (188, 102), (166, 84), (140, 72),
                                                              (126, 66)]
    a.hair(hair, 3.2)
    a.outline(head, LW, second=0.4)
    ear = ellipse((186, 126), 10, 14, n=8)
    a.skin(ear)
    a.outline(ear, MW * 1.2, second=0, jit=0.2)
    a.arc((186, 126), 5, 140, 300, FW * 1.2)
    a.curve([(130, 98), (138, 104), (146, 99)], MW * 1.1, jit=0.2)
    a.curve([(110, 134), (116, 138), (114, 130)], MW, jit=0.2)
    a.fill_smooth(ellipse((152, 134), 10, 6, n=8), "blush", 0.8)
    a.curve([(120, 155), (128, 158), (135, 154)], MW, jit=0.2)
    fc = (52, 158)
    for t in range(-80, 280, 72):
        pet = ellipse(polar(fc, 12, t), 11, 7.5, t, n=8)
        a.fill_smooth(pet, "paper", off=(0, 0))
        a.outline(pet, MW, second=0, jit=0.3)
    a.dots([fc], 9, "ochre")
    a.curve([(54, 172), (58, 196), (54, 226)], MW * 1.2, "ink")
    lf = leaf_pts((56, 204), (82, 192), 6)
    a.fill_smooth(lf, "sage")
    a.outline(lf, MW, second=0, jit=0.3)
    for k in range(3):
        y0 = 138 - k * 13
        pts = [(66 + i * 7, y0 - i * 0.6 + 4 * math.sin(i * 1.4 + k)) for i in range(5)]
        a.curve(pts, MW * 1.1, "slate", 0.9, jit=0.3)


@art_key("sense_tongue")
def sense_tongue(a):
    lips = [(36, 112), (70, 92), (104, 90), (120, 96), (138, 90), (172, 92), (206, 110), (178, 156), (122, 176),
            (66, 158)]
    a.skin(lips)
    a.fill_smooth(lips, "clay", 0.35)
    mouth = [(54, 112), (90, 106), (120, 110), (152, 106), (188, 110), (168, 142), (122, 156), (74, 144)]
    a.fill_smooth(mouth, "slate", 0.95)
    a.fill_smooth([(70, 110), (120, 114), (172, 110), (166, 122), (120, 126), (74, 121)], "paper", off=(0, 0))
    tongue = [(90, 138), (122, 132), (154, 138), (158, 170), (146, 196), (122, 204), (98, 196), (86, 170)]
    a.fill_smooth(tongue, "clay")
    a.hatch(clip_half(tongue, (126, 0), (1, 0.1)), 70, 4, alpha=0.4)
    a.outline(tongue, LW, second=0.4)
    a.curve([(122, 142), (121, 166), (123, 184)], MW, alpha=0.8)
    a.outline(mouth, MW * 1.1, second=0)
    a.outline(lips, LW, second=0.4)
    a.curve([(26, 116), (34, 110), (30, 102)], MW, jit=0.2)
    a.curve([(214, 114), (206, 108), (212, 100)], MW, jit=0.2)


@art_key("sense_hand")
def sense_hand(a):
    hand = [(96, 222), (88, 186), (82, 164), (66, 152), (52, 128), (58, 116), (72, 124), (88, 140), (90, 112),
            (88, 72), (93, 58), (103, 58), (108, 72), (110, 100), (112, 60), (117, 42), (127, 40), (131, 56),
            (131, 98), (135, 60), (141, 48), (151, 50), (153, 64), (150, 104), (158, 82), (166, 74), (174, 80),
            (170, 112), (164, 150), (152, 186), (148, 222)]
    a.skin(hand)
    a.hatch(clip_half(hand, (150, 0), (1, 0.2)), 65, 4.2, alpha=0.35)
    a.curve(hand, LW, jit=0.4)
    a.curve([(96, 150), (118, 160), (140, 150)], MW, alpha=0.7)
    a.curve([(104, 130), (124, 136), (146, 126)], FW * 1.2, alpha=0.6)
    for tip in ((98, 64), (122, 46), (146, 55), (169, 80)):
        a.arc(tip, 4, 200, 340, FW, alpha=0.6)
    cuff = [(84, 206), (160, 206), (164, 236), (80, 236)]
    a.block(cuff, "sage", second=0)
    a.hatch(cuff, -60, 4.4, alpha=0.4)


@art_key("wash_hands")
def wash_hands(a):
    tap = [(26, 40), (112, 40), (120, 46), (120, 62), (106, 62), (106, 54), (26, 54)]
    a.block(tap, "slate", 0.9)
    a.block(rect(56, 26, 8, 14), "slate", w=MW)
    a.line((44, 24), (76, 24), LW)
    for dx in (-5, 0, 5):
        a.curve([(113 + dx, 66), (114 + dx + a.j(2), 82), (112 + dx, 100)], MW, "slate", 0.85)
    a.dots([(104, 108), (124, 112), (116, 118)], 3.6, "slate")
    for rot, c in ((-28, (100, 160)), (24, (138, 158))):
        T = Tf(c, 1, rot)
        mit = T.pts([(-15, 30), (-17, -6), (-14, -30), (-4, -38), (8, -36), (15, -24), (16, 8), (14, 30)])
        thumb = T.pts(capsule((-14, 6), (-26, -10), 6.5, 5.5))
        a.skin(thumb)
        a.outline(thumb, MW * 1.3, second=0, jit=0.3)
        a.skin(mit)
        a.outline(mit, LW, second=0.4)
        a.lines([(T((x, -36 + abs(x) * 0.2)), T((x * 1.05, -18))) for x in (-6, 1, 8)], FW * 1.3, amp=0.3)
        a.arc(T((0, -30)), 7, 200, 340, FW, alpha=0.6)
    for c, r in (((70, 132), 9), ((82, 112), 5), ((164, 124), 7), ((176, 142), 4.5), ((150, 106), 4), ((60, 156), 5)):
        a.ell(c, r, r, w=MW, second=0)
    a.curve([(36, 214), (120, 226), (206, 212)], LW)
    soap = [(168, 192), (206, 188), (210, 206), (172, 210)]
    a.blob(soap, "ochre", w=MW * 1.3, second=0)


@art_key("sleep_moon")
def sleep_moon(a):
    moon = crescent((180, 62), 34, (197, 49), 30, n=40)[::2]
    a.fill_smooth(moon, "ochre")
    a.hatch(moon, 40, 4.2, alpha=0.4)
    a.outline(moon, LW, second=0.4)
    a.dots([(128, 40), (214, 118), (140, 70)], 4.2, "ochre")
    a.dots([(118, 52), (222, 96)], 2.6, "ochre")
    pillow = [(30, 134), (90, 126), (100, 150), (36, 158)]
    a.blob(pillow, "paper", w=MW * 1.4, second=0)
    head = ellipse((70, 128), 22, 21, n=12)
    a.skin(head)
    a.hair([polar((70, 128), 23, t) for t in range(150, 361, 30)] + [(84, 118), (64, 112), (50, 122)], 2.6)
    a.outline(head, LW, second=0)
    for ex in (66, 80):
        a.curve([(ex - 4, 134), (ex, 137), (ex + 4, 134)], FW * 1.4, jit=0.1)
    a.fill_smooth(ellipse((60, 140), 5, 3, n=6), "blush", 0.8)
    blanket = [(54, 150), (120, 136), (196, 138), (216, 176), (206, 196), (60, 198), (46, 176)]
    a.fill_smooth(blanket, "slate", 0.9)
    a.hatch(blanket, 80, 9, w=MW, color="paper", alpha=0.35)
    a.outline(blanket, LW, second=0.4)
    a.curve([(60, 160), (110, 150), (160, 152)], MW, alpha=0.7)
    a.block(rect(26, 196, 196, 12), "ochre", second=0)
    a.lines([((34, 208), (34, 224)), ((214, 208), (214, 224))], LW)


@art_key("drink_water")
def drink_water(a):
    g = [(140, 88), (204, 88), (196, 210), (148, 210)]
    water = [(143, 118), (201, 118), (196, 208), (148, 208)]
    a.fill_poly(water, "slate", 0.5)
    a.hatch(water, -60, 6, alpha=0.3)
    a.curve([(144, 118), (160, 115), (176, 120), (200, 116)], MW, "slate")
    a.outline_poly(g, LW, closed=False, second=0)
    a.line((140, 88), (204, 88), MW, over=(1, 2))
    a.line((150, 100), (156, 190), FW * 1.4, "paper", 0.9)
    kc = (76, 152)
    body = ellipse(kc, 44, 40, n=14)
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(ellipse(kc, 40, 36, n=20), (90, 160), (0.6, 0.8)), 55, 4.2, alpha=0.5)
    a.zig([(42, 140), (50, 132), (58, 140), (66, 132), (74, 140), (82, 132), (90, 140), (98, 132), (106, 140)], MW, "paper", 0.8)
    a.outline(body, LW, second=0.4)
    neck = [(62, 116), (90, 116), (88, 84), (64, 84)]
    a.block(neck, "clay", second=0)
    a.ell((76, 84), 16, 5, "clay", w=MW * 1.3, second=0)
    spout = ribbon([(108, 140), (122, 124), (130, 108)], 12, 7)
    a.blob(spout, "clay", w=MW * 1.3, second=0)
    a.curve([(30, 196), (110, 196)], MW, alpha=0.6)
    a.curve([(176, 70), (172, 62), (176, 54), (180, 62), (176, 70)], MW, "slate", jit=0.2)


@art_key("toothbrush")
def toothbrush(a):
    cup = [(140, 140), (196, 140), (190, 214), (146, 214)]
    a.block(cup, "sage", 0.9)
    a.hatch(clip_half(cup, (176, 0), (1, 0)), 75, 4, alpha=0.5)
    handle = capsule((84, 200), (164, 70), 7.5, 6)
    a.blob(handle, "clay", w=LW)
    a.line((92, 186), (150, 92), FW * 1.4, "paper", 0.8)
    T = Tf((172, 58), 1, -58)
    head = T.pts(rect(-14, -6, 40, 12))
    a.block(head, "clay", w=MW * 1.3, second=0)
    bristles = T.pts(rect(-10, -24, 32, 18))
    a.fill_poly(bristles, "paper", off=(0, 0))
    a.lines([(T((x, -6)), T((x + a.j(1), -23))) for x in range(-8, 22, 4)], FW, amp=0.3)
    a.outline_poly(bristles, MW, second=0)
    paste = T.pts([(-12, -26), (-2, -34), (8, -28), (16, -36), (24, -27), (18, -22), (-6, -22)])
    a.blob(paste, "paper", w=MW * 1.2, second=0)
    a.curve(T.pts([(-4, -29), (6, -31), (16, -30)]), FW, "sage")
    for c in ((60, 60), (48, 92), (76, 40)):
        a.ell(c, 4, 4, w=FW * 1.4, second=0)


# --------------------------------------------------------------------------------------------- family


def face(a, cx, hy, r, old=False, smile=1.0, blush=True, glasses=False, moustache=False):
    ew = max(3.6, r * 0.2)
    el, er = (cx - r * 0.37, hy + r * 0.02), (cx + r * 0.33, hy - r * 0.02)
    a.dots([el, er], ew)
    a.curve([(cx - r * 0.22, hy + r * 0.38), (cx - r * 0.02, hy + r * (0.42 + 0.14 * smile)), (cx + r * 0.2, hy + r * 0.36)],
            MW * 0.95, jit=0.15)
    a.curve([(cx + r * 0.02, hy + r * 0.08), (cx - r * 0.06, hy + r * 0.22), (cx + r * 0.05, hy + r * 0.25)], FW * 1.2, jit=0.1)
    if blush:
        for bx in (cx - r * 0.58, cx + r * 0.55):
            a.fill_smooth(ellipse((bx, hy + r * 0.26), r * 0.17, r * 0.1, n=7), "blush", 0.8)
    if old:
        a.lines([((el[0] - r * 0.3, el[1] - r * 0.05), (el[0] - r * 0.42, el[1] - r * 0.14)),
                 ((er[0] + r * 0.3, er[1] - r * 0.05), (er[0] + r * 0.42, er[1] - r * 0.14)),
                 ((cx - r * 0.5, hy - r * 0.32), (cx - r * 0.2, hy - r * 0.36)),
                 ((cx + r * 0.16, hy - r * 0.36), (cx + r * 0.46, hy - r * 0.32))], FW, alpha=0.8, amp=0.3)
    if glasses:
        for e in (el, er):
            a.ell(e, r * 0.23, r * 0.2, w=FW * 1.2, second=0)
        a.line((el[0] + r * 0.23, el[1]), (er[0] - r * 0.23, er[1]), FW * 1.2, amp=0.2)
    if moustache:
        m = [(cx - r * 0.3, hy + r * 0.33), (cx - r * 0.02, hy + r * 0.25), (cx + r * 0.28, hy + r * 0.3),
             (cx + r * 0.2, hy + r * 0.4), (cx, hy + r * 0.35), (cx - r * 0.22, hy + r * 0.42)]
        a.fill_smooth(m, "paper", off=(0, 0))
        a.outline(m, FW * 1.3, second=0, jit=0.2)


def hair_cap(a, cx, hy, r, dark=True, low=0.0):
    cap = [polar((cx, hy), r * 1.08, t) for t in range(192, 349, 26)] + [
        (cx + r * 0.95, hy - r * (0.15 - low)), (cx + r * 0.5, hy - r * 0.5), (cx + r * 0.1, hy - r * 0.4),
        (cx - r * 0.35, hy - r * 0.56), (cx - r * 0.97, hy - r * (0.1 - low))]
    if dark:
        a.hair(cap)
    return cap


def draw_person(a, cx, H, r, top, top_col, bottom, bottom_col, hair="short", kid=False, sleeve="long",
                shoes="slate", old=False, extras=(), hands=None, ground_y=222):
    top_y = ground_y - H
    hy = top_y + r
    sh_y = hy + r * 1.18
    foot_h = r * 0.34
    ank = ground_y - foot_h * 0.8
    waist = sh_y + (ank - sh_y) * (0.40 if kid else 0.42)
    sw = r * (1.0 if kid else 1.24)
    ground(a, cx - 50, cx + 52, ground_y + 3, marks=3)
    # legs and lower garment
    skin_legs = bottom in ("shorts", "none")
    if bottom == "trousers":
        for leg in ([(cx - sw * 0.92, waist), (cx - 1, waist), (cx - 3, ank), (cx - sw * 0.82, ank)],
                    [(cx + 1, waist), (cx + sw * 0.92, waist), (cx + sw * 0.84, ank), (cx + 3, ank)]):
            a.block(leg, bottom_col, second=0)
    elif bottom in ("sarung", "kain"):
        sk = [(cx - sw * 0.98, waist), (cx + sw * 0.98, waist), (cx + sw * 0.9, ank), (cx - sw * 0.92, ank)]
        a.fill_poly(sk, bottom_col)
        if bottom == "sarung":
            a.hatch(sk, 0, 8, w=MW, alpha=0.3)
            a.hatch(sk, 90, 8, w=MW, alpha=0.3)
        else:
            a.hatch(sk, -50, 7, w=MW * 1.1, color="clay", alpha=0.85)
            a.line(lerp(sk[0], sk[1], 0.7), lerp(sk[3], sk[2], 0.78), MW)
        a.outline_poly(sk, LW, second=0.4)
    elif bottom == "shorts":
        short_y = waist + (ank - waist) * 0.38
        legs = [capsule((cx + sx * sw * 0.45, short_y - 4), (cx + sx * sw * 0.5, ank - 2), r * 0.21, n=4) for sx in (-1, 1)]
        a.skin_many(legs)
        for leg in legs:
            a.outline(leg, MW * 1.2, second=0, jit=0.3)
        sh = [(cx - sw * 0.95, waist - 2), (cx + sw * 0.95, waist - 2), (cx + sw * 1.02, short_y), (cx + 3, short_y),
              (cx, waist + r * 0.4), (cx - 3, short_y), (cx - sw * 1.02, short_y)]
        a.block(sh, bottom_col, second=0)
    elif bottom == "none":
        knee = waist + (ank - waist) * 0.45
        legs = [capsule((cx + sx * sw * 0.42, knee - 6), (cx + sx * sw * 0.46, ank - 2), r * 0.2, n=4) for sx in (-1, 1)]
        a.skin_many(legs)
        for leg in legs:
            a.outline(leg, MW * 1.2, second=0, jit=0.3)
    # feet
    for sx in (-1, 1):
        fc = (cx + sx * (sw * 0.52 + r * 0.1), ground_y - foot_h * 0.45)
        a.ell(fc, r * 0.38, foot_h * 0.62, shoes, rot=sx * 4, w=MW * 1.3, second=0)
    # neck
    neck = rect(cx - r * 0.24, hy + r * 0.7, r * 0.48, sh_y - hy - r * 0.6)
    a.skin(neck, smooth=False)
    # arm geometry
    shl = [(cx - sw * 0.9, sh_y + r * 0.32), (cx + sw * 0.9, sh_y + r * 0.32)]
    if hands == "clasp":
        hd = [(cx - r * 0.36, waist + r * 0.1), (cx + r * 0.4, waist + r * 0.18)]
    else:
        hd = hands or [(cx - sw - r * 0.22, waist + r * 0.4), (cx + sw + r * 0.22, waist + r * 0.38)]
    ar = r * (0.25 if kid else 0.27)
    # torso / dress
    length = {"dress_long": ank - 2, "dress": waist + (ank - waist) * 0.5}.get(top, waist + r * 0.22)
    flare = {"dress_long": 1.28, "dress": 1.25}.get(top, 0.98)
    torso = [(cx - r * 0.3, sh_y - r * 0.1), (cx - sw * 0.72, sh_y - r * 0.02), (cx - sw, sh_y + r * 0.26),
             (cx - sw * flare, length), (cx + sw * flare, length), (cx + sw, sh_y + r * 0.24),
             (cx + sw * 0.72, sh_y - r * 0.03), (cx + r * 0.3, sh_y - r * 0.1)]
    if "cane" in extras:
        cane = [(hd[1][0] + 1, hd[1][1] - r * 0.5), (hd[1][0] + 4, ground_y)]
        a.blob(capsule(cane[0], cane[1], 2.6), "ochre", w=MW, second=0)
        a.curve([(hd[1][0] + 1, hd[1][1] - r * 0.5), (hd[1][0] - 4, hd[1][1] - r * 0.85), (hd[1][0] - 10, hd[1][1] - r * 0.6)],
                LW * 1.4, "ochre")
        a.curve([(hd[1][0] + 1, hd[1][1] - r * 0.5), (hd[1][0] - 4, hd[1][1] - r * 0.85), (hd[1][0] - 10, hd[1][1] - r * 0.6)],
                FW, "ink")
    a.fill_poly(torso, top_col)
    if "batik" in extras:
        x0, y0, x1, y1 = bbox(torso)
        pts = []
        yy, row = y0 + 7, 0
        while yy < y1 - 3:
            xx = x0 + 6 + (row % 2) * 6
            while xx < x1 - 3:
                if inside((xx, yy), torso):
                    pts += [(xx - 2.4, yy), (xx + 2.4, yy), (xx, yy - 2.4), (xx, yy + 2.4)]
                xx += 12
            yy += 10
            row += 1
        a.dots(pts, 2.2, "clay", 0.9)
    if "stripe" in extras:
        band = clip_half(clip_half(torso, (0, sh_y + r * 0.9), (0, 1)), (0, sh_y + r * 1.25), (0, -1))
        a.fill_poly(band, "ochre", 0.95)
    if "placket" in extras:
        a.line((cx + 1, sh_y), (cx + 2, length - 2), FW * 1.3)
        a.dots([(cx + 5, sh_y + r * (0.4 + 0.4 * k)) for k in range(3)], 2.8, "paper")
    if "brooch" in extras:
        a.lines([((cx - 1, sh_y + r * 0.1), (cx + 3, length - 3))], FW * 1.2, alpha=0.8)
        a.dots([(cx + 1, sh_y + r * 0.55), (cx + 2, sh_y + r * 1.05), (cx + 2.5, sh_y + r * 1.55)], 4.4, "ochre")
        a.dots([(cx - sw * 0.7 + k * 7, length - 3) for k in range(7)], 2.6, "paper", 0.9)
    if "collar" in extras:
        for sx in (-1, 1):
            col = [(cx, sh_y + r * 0.3), (cx + sx * r * 0.5, sh_y - r * 0.12), (cx + sx * r * 0.62, sh_y + r * 0.26)]
            a.block(col, "paper", w=MW, second=0)
    if top in ("dress_long", "dress"):
        a.lines([((cx - sw * 0.4, waist + r * 0.4), (cx - sw * 0.55, length - 4)),
                 ((cx + sw * 0.35, waist + r * 0.5), (cx + sw * 0.5, length - 6))], FW, alpha=0.6)
    a.outline_poly(torso, LW, second=0.45)
    # arms
    for i, sx in enumerate((-1, 1)):
        s0, h = shl[i], hd[i]
        if sleeve == "long":
            arm = capsule(s0, lerp(s0, h, 0.86), ar)
            a.blob(arm, top_col, w=MW * 1.4, second=0)
        else:
            fore = capsule(lerp(s0, h, 0.3), lerp(s0, h, 0.9), ar * 0.82)
            a.skin(fore)
            a.outline(fore, MW * 1.3, second=0, jit=0.3)
            slv = capsule(s0, lerp(s0, h, 0.4), ar * 1.18)
            a.blob(slv, top_col, w=MW * 1.4, second=0)
        hand = ellipse(h, r * 0.23, r * 0.25, n=8)
        a.skin(hand)
        a.outline(hand, MW * 1.2, second=0, jit=0.2)
    # kerudung, head, hair
    if "kerudung" in extras:
        kc = extras["kerudung"] if isinstance(extras, dict) else "sage"
        ker = [(cx, hy - r * 1.22), (cx + r * 0.9, hy - r * 0.95), (cx + r * 1.2, hy - r * 0.2), (cx + r * 1.24, hy + r * 0.6),
               (cx + r * 1.78, hy + r * 1.6), (cx + r * 1.58, hy + r * 2.25), (cx + r * 0.5, hy + r * 2.55),
               (cx - r * 0.6, hy + r * 2.5), (cx - r * 1.52, hy + r * 2.2), (cx - r * 1.74, hy + r * 1.55),
               (cx - r * 1.22, hy + r * 0.55), (cx - r * 1.18, hy - r * 0.25), (cx - r * 0.88, hy - r * 0.98)]
        a.fill_smooth(ker, kc)
        a.hatch(clip_half(ker, (cx + r * 0.6, 0), (1, 0.2)), 70, 4.6, alpha=0.4)
        a.outline(ker, LW, second=0.4)
        a.curve([(cx - r * 1.0, hy + r * 1.3), (cx - r * 0.4, hy + r * 1.8), (cx + r * 0.3, hy + r * 1.9)], FW * 1.2,
                alpha=0.7)
        fc = (cx, hy + r * 0.1)
        fpts = ellipse(fc, r * 0.8, r * 0.88, n=12)
        a.skin(fpts)
        a.outline(fpts, MW * 1.3, second=0)
        face(a, cx, hy + r * 0.12, r * 0.92)
        return
    ears = [ellipse((cx + sx * r * 0.94, hy + r * 0.1), r * 0.17, r * 0.25, n=7) for sx in (-1, 1)]
    a.skin_many(ears)
    for e in ears:
        a.outline(e, MW * 1.1, second=0, jit=0.2)
    head = ellipse((cx, hy), r * 0.96, r, n=14)
    a.skin(head)
    if hair == "short":
        hair_cap(a, cx, hy, r)
    elif hair == "pigtails":
        for sx in (-1, 1):
            bun = ellipse((cx + sx * r * 1.12, hy - r * 0.08), r * 0.3, r * 0.42, sx * 20, n=9)
            a.hair(bun)
        hair_cap(a, cx, hy, r, low=0.12)
        for sx in (-1, 1):
            b = (cx + sx * r * 0.9, hy - r * 0.48)
            bow = [b, add(b, (sx * 5, -7)), add(b, (sx * 8, 1)), b, add(b, (sx * -4, -7)), add(b, (sx * -6, 2))]
            a.fill_poly(bow[:3], "ochre")
            a.fill_poly(bow[3:], "ochre")
            a.dots([b], 3, "ochre")
    elif hair == "bun_grey":
        bun = ellipse((cx + r * 0.12, hy - r * 1.1), r * 0.38, r * 0.32, n=9)
        a.fill_smooth(bun, "paper", off=(0, 0))
        a.hatch(bun, 30, 3.2, alpha=0.5)
        a.outline(bun, MW * 1.2, second=0)
        cap = hair_cap(a, cx, hy, r, dark=False)
        a.fill_smooth(cap, "paper", off=(0, 0))
        a.hatch(cap, 60, 3.0, alpha=0.5)
        a.outline(cap, MW * 1.2, second=0)
    elif hair == "peci":
        for sx in (-1, 1):
            g = ellipse((cx + sx * r * 0.82, hy - r * 0.32), r * 0.2, r * 0.2, n=6)
            a.fill_smooth(g, "paper", off=(0, 0))
            a.hatch(g, 60, 2.6, alpha=0.5)
        peci = [(cx - r * 0.88, hy - r * 0.42), (cx + r * 0.9, hy - r * 0.5), (cx + r * 0.82, hy - r * 1.2),
                (cx - r * 0.8, hy - r * 1.12)]
        a.fill_poly(peci, "slate", off=(0, 0))
        a.hatch(peci, 62, 2.6, alpha=0.6, inset=(0.4, 1.2), skip=0.0)
        a.outline_poly(peci, MW * 1.2, second=0)
        a.line((cx - r * 0.7, hy - r * 0.62), (cx + r * 0.72, hy - r * 0.68), FW, "paper", 0.5)
    a.outline(head, LW, second=0.35)
    face(a, cx, hy, r, old=old, glasses="glasses" in extras, moustache="moustache" in extras)


@art_key("fam_grandmother")
def fam_grandmother(a):
    draw_person(a, 118, 166, 23, "kebaya", "clay", "kain", "ochre", hair="bun_grey", old=True,
                extras=("glasses", "brooch"))


@art_key("fam_grandfather")
def fam_grandfather(a):
    draw_person(a, 112, 182, 23, "koko", "sage", "sarung", "slate", hair="peci", old=True,
                extras=("cane", "moustache", "placket"))


@art_key("fam_mother")
def fam_mother(a):
    draw_person(a, 120, 178, 22.5, "dress_long", "slate", "none", "slate", hair="none", shoes="clay",
                extras={"kerudung": "sage"})


@art_key("fam_father")
def fam_father(a):
    draw_person(a, 118, 196, 23, "shirt", "ochre", "trousers", "slate", hair="short", sleeve="short",
                shoes="clay", extras=("batik",))


@art_key("fam_sister")
def fam_sister(a):
    draw_person(a, 122, 142, 21, "dress", "clay", "none", "clay", hair="pigtails", kid=True, sleeve="short",
                extras=("collar",))


@art_key("fam_brother")
def fam_brother(a):
    draw_person(a, 118, 124, 20, "tshirt", "sage", "shorts", "slate", hair="short", kid=True, sleeve="short",
                shoes="clay", extras=("stripe",))


@art_key("fam_baby")
def fam_baby(a):
    ground(a, 66, 176, 224, marks=3)
    for p0, p1 in (((100, 206), (80, 214)), ((140, 206), (160, 213))):
        leg = capsule(p0, p1, 10)
        a.blob(leg, "sage", w=MW * 1.4, second=0)
        ft = ellipse(add(p1, (sub(p1, p0)[0] * 0.3, -2)), 8, 7, n=7)
        a.skin(ft)
        a.outline(ft, MW * 1.2, second=0, jit=0.2)
    body = ellipse((120, 186), 36, 32, n=14)
    a.fill_smooth(body, "sage")
    pocket = rect(108, 186, 22, 16)
    a.fill_poly(pocket, "ochre", 0.9)
    a.outline_poly(pocket, MW, second=0)
    a.outline(body, LW, second=0.4)
    for p0, p1 in (((92, 170), (72, 154)), ((148, 170), (168, 156))):
        arm = capsule(p0, p1, 8)
        a.blob(arm, "sage", w=MW * 1.4, second=0)
        hnd = ellipse(p1, 7.5, 7.5, n=7)
        a.skin(hnd)
        a.outline(hnd, MW * 1.2, second=0, jit=0.2)
    for sx in (-1, 1):
        e = ellipse((120 + sx * 29, 136), 5, 8, n=7)
        a.skin(e)
        a.outline(e, MW, second=0, jit=0.2)
    head = ellipse((120, 132), 30, 29, n=14)
    a.skin(head)
    a.outline(head, LW, second=0.35)
    spiral = [polar((122, 101), 7 - 5 * i / 9, -90 + 50 * i) for i in range(10)]
    a.curve([(118, 104)] + spiral, MW * 1.3, jit=0.2)
    face(a, 120, 136, 26, smile=1.4)


# --------------------------------------------------------------------------------------------- fruit, money


@art_key("fruit_mango")
def fruit_mango(a):
    draw_mango(a, (116, 132), 168, -18)


def banana(a, c, R, a0, a1, thick, rot=0.0):
    outer = [polar(c, R, a0 + (a1 - a0) * i / 8) for i in range(9)]
    inner = [polar(c, R - 3 - thick * math.sin(math.pi * i / 8) ** 0.35, a0 + (a1 - a0) * i / 8) for i in range(9)]
    pts = outer + inner[::-1]
    if rot:
        pts = [rotp(p, rot, c) for p in pts]
    a.fill_smooth(pts, "ochre")
    a.hatch(clip_half(pts, polar(c, R - thick * 0.45, (a0 + a1) / 2), unit(sub(c, polar(c, R, (a0 + a1) / 2)))),
            (a0 + a1) / 2 + 90 + 20, 4, alpha=0.5)
    a.outline(pts, LW, second=0.4)
    a.curve([polar(c, R - thick * 0.45, a0 + (a1 - a0) * i / 6) for i in range(1, 6)], FW, alpha=0.5)
    return pts[0], pts[8]


@art_key("fruit_banana")
def fruit_banana(a):
    tips = []
    for c, R, a0, a1, th, rot in (((112, -6), 130, 142, 46, 27, -6), ((118, 22), 128, 140, 48, 28, 4)):
        s, e = banana(a, c, R, a0, a1, th, rot)
        tips.append((s, e))
    for s, e in tips:
        a.dots([s], 7)
    stem = [(200, 106), (210, 88), (216, 72)]
    a.blob(ribbon(stem, 13, 10), "sage", w=MW * 1.4, second=0)
    a.hatch(ribbon(stem, 13, 10), 20, 3.4, alpha=0.4)


@art_key("fruit_rambutan")
def fruit_rambutan(a):
    def hairy(c, r, a0=0, a1=360):
        hairs = Path()
        for t in range(a0, a1, 13):
            b = polar(c, r - 2, t)
            m = polar(c, r + 6, t + 6)
            e = polar(c, r + 11, t + 16)
            hairs.M(b).Q(a.jit(m, 1), a.jit(e, 1))
        a.stroke(hairs, MW * 1.2, "clay")
        tips = [polar(c, r + 11, t + 16) for t in range(a0, a1, 26)]
        a.dots(tips, 3, "sage")

    c = (86, 132)
    a.fill_smooth(ellipse(c, 44, 42, n=14), "clay")
    a.hatch(clip_half(ellipse(c, 40, 38, n=20), (100, 140), (0.6, 0.8)), 50, 4.2, alpha=0.5)
    a.ell_outline(c, 44, 42)
    hairy(c, 44)
    c2 = (170, 154)
    shell = ellipse(c2, 38, 36, n=12, a0=-10, sweep=200)
    a.fill_poly(shell, "clay", step=12)
    a.curve(shell, LW)
    hairy(c2, 37, -10, 190)
    flesh = ellipse((c2[0], c2[1] - 12), 28, 30, n=12)
    a.fill_smooth(flesh, "paper", off=(0, 0))
    a.hatch(clip_half(flesh, (c2[0] + 6, 0), (1, 0.3)), 70, 4, color="slate", alpha=0.4)
    a.outline(flesh, MW * 1.4, second=0.5)
    a.arc((c2[0] - 8, c2[1] - 26), 8, 200, 260, FW * 1.4, "slate", 0.6)


@art_key("fruit_papaya")
def fruit_papaya(a):
    T = Tf((120, 124), 1, -22)
    skin = T.pts([(-100, 0), (-88, -36), (-40, -58), (30, -56), (88, -40), (104, -6), (90, 34), (30, 56), (-40, 54),
                  (-90, 30)])
    a.fill_smooth(skin, "sage")
    flesh = T.pts([(-88, 0), (-78, -28), (-38, -46), (28, -46), (80, -32), (92, -4), (80, 26), (28, 44), (-38, 44),
                   (-80, 24)])
    a.fill_smooth(flesh, "ochre", off=(0, 0))
    a.fill_smooth(flesh, "clay", 0.5)
    cav = T.pts(ellipse((14, -1), 50, 22, n=12))
    a.fill_smooth(cav, "paper", 0.55, off=(0, 0))
    a.outline(cav, MW, second=0)
    seeds = []
    for i in range(22):
        t = TAU * i / 22
        rr = 0.55 + 0.3 * ((i * 7) % 5) / 5
        seeds.append(T((14 + 44 * rr * math.cos(t) + a.j(2), -1 + 18 * rr * math.sin(t) + a.j(2))))
    a.dots(seeds, 6.2, "ink", 0.9)
    a.outline(flesh, MW, second=0)
    a.outline(skin, LW, second=0.4)


@art_key("coin_generic")
def coin_generic(a):
    for i, y in enumerate((202, 192, 182)):
        a.fill_smooth(ellipse((176, y), 44, 13, n=12), "ochre", 0.95)
        a.arc((176, y), 44, 180, 0, LW * 0.9, ry=13, n=6)
        a.lines([((176 + dx, y + 11), (176 + dx, y + 14)) for dx in range(-36, 40, 8)], FW, alpha=0.6, amp=0.1)
    a.ell_outline((176, 182), 44, 13, w=LW * 0.9)
    c, r = (96, 112), 72
    a.fill_smooth(ellipse(c, r, r, n=18), "ochre")
    a.hatch(clip_convex([polar(c, r - 3, t) for t in range(-30, 170, 12)]
                        + [polar((c[0] - 18, c[1] - 18), r * 0.97, t) for t in range(166, -34, -12)],
                        ellipse(c, r - 3, r - 3, n=30)), 55, 4.2, alpha=0.45)
    a.ell_outline(c, r, r)
    a.ell_outline(c, r - 13, r - 13, w=MW, second=0)
    a.lines([(polar(c, r - 2, t), polar(c, r - 8, t)) for t in range(0, 360, 9)], FW, alpha=0.55, amp=0.1)
    a.dots([polar(c, r - 22, t) for t in range(5, 360, 24)], 3.0, "ink", 0.7)
    lf = leaf_pts((c[0] - 22, c[1] + 18), (c[0] + 22, c[1] - 20), 13)
    a.fill_smooth(lf, "clay", 0.8)
    a.outline(lf, MW * 1.2, second=0, jit=0.3)
    a.line((c[0] - 18, c[1] + 14), (c[0] + 14, c[1] - 12), FW * 1.2, amp=0.3)


@art_key("note_generic")
def note_generic(a):
    back = [rotp(p, 7, (120, 120)) for p in rect(44, 62, 168, 100)]
    a.block(back, "slate", 0.75, w=MW * 1.4, second=0)
    note = [rotp(p, -6, (120, 120)) for p in rect(30, 74, 172, 102)]
    a.fill_poly(note, "sage", 0.95)
    T = Tf((120, 120), 1, -6)
    inner = T.pts(rect(-77, -37, 154, 82))
    a.outline_poly(inner, FW * 1.2, second=0)
    for k in range(3):
        a.curve(T.pts([(-70 + i * 12, -12 + k * 12 + 4 * math.sin(i * 1.1 + k)) for i in range(8)]), FW * 1.2, alpha=0.6)
    mc = T((52, 4))
    a.fill_smooth(ellipse(mc, 24, 24, n=10), "paper", 0.6, off=(0, 0))
    a.ell_outline(mc, 24, 24, w=MW)
    lf = leaf_pts(add(mc, (-12, 10)), add(mc, (12, -12)), 8)
    a.fill_smooth(lf, "ochre")
    a.outline(lf, FW * 1.3, second=0, jit=0.2)
    fold = [T((86, 51)), T((70, 51)), T((86, 35))]
    a.fill_poly(fold, "paper", 0.9, off=(0, 0))
    a.outline_poly(note, LW, second=0.4)
    a.outline_poly(fold, MW, closed=False, second=0)


# --------------------------------------------------------------------------------------------- shared props


def intersect(p1, p2, p3, p4):
    d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
    t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d
    return lerp(p1, p2, t)


def draw_kite(a, top, right, bot, left, tail_end, string_end=None, s=1.0):
    X = intersect(top, bot, left, right)
    for i, q in enumerate(([top, right, X], [right, bot, X], [bot, left, X], [left, top, X])):
        a.fill_poly(q, "clay" if i % 2 == 0 else "ochre", 0.95)
    a.hatch([right, bot, X], 70, 4.0 * s, alpha=0.45)
    a.lines([(top, bot), (left, right)], MW * s, amp=0.6)
    a.outline_poly([top, right, bot, left], LW * s, second=0.45)
    mid = lerp(bot, tail_end, 0.5)
    tail = [bot, add(lerp(bot, mid, 0.5), (8 * s, 0)), add(mid, (-8 * s, 0)), add(lerp(mid, tail_end, 0.5), (8 * s, 0)), tail_end]
    a.curve(tail, MW * s)
    for t in (0.3, 0.6, 0.88):
        p = spline(tail, False, 4)[int(t * 16)]
        bow_l = [p, add(p, (-9 * s, -5 * s)), add(p, (-9 * s, 5 * s))]
        bow_r = [p, add(p, (9 * s, -5 * s)), add(p, (9 * s, 5 * s))]
        for b in (bow_l, bow_r):
            a.fill_poly(b, "clay")
            a.outline_poly(b, FW * 1.3 * s, second=0, over=0.5, gap=0.5)
    if string_end:
        a.curve([X, lerp(X, string_end, 0.5), string_end], FW * s, alpha=0.8, jit=1.0)


def draw_angklung(a, c, s=1.0):
    """Two bamboo tubes cut to a tongue at the back, hanging in a frame over a slotted base tube."""
    T = Tf(c, s)
    for px in (-54, 48):
        post = T.pts(rect(px, -80, 6, 142))
        a.fill_poly(post, "clay", 0.9)
        a.outline_poly(post, MW * 1.3, second=0)
        a.ell(T((px + 3, -84)), 5 * s, 5 * s, "clay", w=MW, second=0)
        a.lines([(T((px, -30)), T((px + 6, -30))), (T((px, 20)), T((px + 6, 20)))], FW * 1.2, amp=0.1)
    for y0, h in ((-74, 7), (-16, 6)):
        bar = T.pts(rect(-60, y0, 120, h))
        a.fill_poly(bar, "clay", 0.9)
        a.outline_poly(bar, MW * 1.3, second=0)
    for x0, x1, yt, ym, yb in ((-36, -8, -64, -24, 60), (4, 30, -40, -8, 60)):
        cx = (x0 + x1) / 2
        tongue = T.pts([(x0 + 5, ym), (x0 + 6, yt + 10), (x0 + 10, yt + 2), (cx, yt), (x1 - 10, yt + 2), (x1 - 6, yt + 10),
                        (x1 - 5, ym)])
        a.fill_smooth(tongue, "ochre", 0.85)
        a.stroke(a.open_curve(tongue, 0.3), MW * 1.2)
        tube = T.pts([(x0, ym), (x1, ym), (x1, yb - 5), (cx + 6, yb), (cx - 6, yb), (x0, yb - 5)])
        a.fill_poly(tube, "ochre")
        a.hatch(clip_half(tube, T((x1 - 8, 0)), (1, 0)), 75, 3.4 * s, alpha=0.5)
        a.outline_poly(tube, LW, second=0.4, over=1.2, gap=1.2)
        a.ell(T((cx, ym)), (x1 - x0) / 2 * s, 4 * s, "slate", 0.6, w=MW, second=0)
        a.curve(T.pts([(x0 + 1, yb - 22), (cx, yb - 20), (x1 - 1, yb - 22)]), MW, jit=0.2)
    base = T.pts(rect(-64, 56, 128, 20))
    a.fill_poly(base, "clay")
    a.hatch(base, 0, 4.0 * s, alpha=0.45)
    a.outline_poly(base, LW, second=0.4)
    for ex in (-64, 64):
        a.ell(T((ex, 66)), 4 * s, 10 * s, "clay", w=MW, second=0)


def draw_open_book(a, T, lines=True):
    cover = T.pts([(-110, -46), (-4, -60), (4, -60), (108, -50), (112, 38), (4, 50), (-4, 50), (-112, 42)])
    a.block(cover, "clay", second=0)
    for side in (-1, 1):
        page = T.pts([(0, -58), (side * 30, -70), (side * 70, -71), (side * 100, -58), (side * 102, 30),
                      (side * 62, 23), (side * 26, 28), (0, 42)])
        a.fill_poly(page, "paper", off=(0, 0), step=12)
        a.outline_poly(page, MW * 1.4, second=0)
        a.curve(T.pts([(side * 101, 34), (side * 60, 28), (side * 24, 33), (0, 46)]), FW * 1.2)
        if lines:
            for k in range(5):
                y = -46 + k * 13
                a.curve(T.pts([(side * 88, y + 1), (side * 52, y - 3), (side * 14, y + 2)]), FW * 1.2, alpha=0.45, jit=0.4)
    a.line(T((0, -58)), T((0, 42)), MW, amp=0.4)


def sticker_bg(a, color, alpha=0.18):
    tint_patch(a, (120 + a.j(4), 122 + a.j(4)), 104, 100, color, alpha)


# --------------------------------------------------------------------------------------------- stickers


@art_key("sticker_mango")
def sticker_mango(a):
    sticker_bg(a, "sage")
    draw_mango(a, (116, 130), 140, 14)


@art_key("sticker_kite")
def sticker_kite(a):
    sticker_bg(a, "slate", 0.14)
    draw_kite(a, (112, 30), (180, 90), (128, 172), (54, 104), (196, 224), (24, 222))


@art_key("sticker_angklung")
def sticker_angklung(a):
    sticker_bg(a, "sage")
    draw_angklung(a, (118, 126), 1.15)


@art_key("sticker_bicycle")
def sticker_bicycle(a):
    sticker_bg(a, "ochre", 0.16)
    rh, fh, bb, seat, head = (66, 154), (178, 154), (116, 156), (106, 104), (164, 100)
    for c in (rh, fh):
        a.stroke(a.ell_path(c, 40, 40, wob=0.015), 5.2)
        a.ell_outline(c, 33, 33, w=FW * 1.2, second=0, wob=0.015)
        a.lines([(polar(c, 4, t), polar(c, 32, t)) for t in range(0, 360, 45)], FW, alpha=0.7, amp=0.2)
        a.dots([c], 6, "ochre")
    frame = [(rh, bb), (bb, seat), (seat, rh), (seat, head), (head, bb), (head, fh)]
    p = Path()
    for s0, s1 in frame:
        a.seg(add(s0, a.reg("clay")), add(s1, a.reg("clay")), 0.6, p)
    a.stroke(p, 6.0, "clay")
    a.lines(frame, MW, amp=0.6)
    a.ell((104, 98), 13, 4.5, "ink", 0.85, w=MW, second=0)
    a.curve([head, (160, 86), (174, 82), (182, 88)], LW)
    a.ell(bb, 8, 8, "ochre", w=MW, second=0)
    a.line(bb, (126, 170), LW, amp=0.2)
    a.line((118, 170), (134, 170), LW, amp=0.2)


@art_key("sticker_teapot")
def sticker_teapot(a):
    sticker_bg(a, "sage")
    handle = ribbon([(64, 118), (38, 122), (30, 146), (40, 168), (64, 172)], 11)
    a.blob(handle, "clay", w=MW * 1.4, second=0)
    spout = ribbon([(160, 144), (182, 124), (198, 98)], 20, 9)
    a.blob(spout, "clay", w=MW * 1.4, second=0)
    body = ellipse((112, 148), 58, 46, n=16)
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(ellipse((112, 148), 54, 42, n=24), (130, 160), (0.5, 0.86)), 55, 4.2, alpha=0.5)
    a.zig([(60, 146), (72, 136), (84, 146), (96, 136), (108, 146), (120, 136), (132, 146), (144, 136), (158, 146)],
          MW, "paper", 0.85)
    a.outline(body, LW, second=0.4)
    lid = ellipse((112, 104), 32, 13, n=10, a0=180, sweep=180)
    a.fill_poly(lid, "clay", 0.9, step=10)
    a.curve(lid, LW)
    a.line((78, 105), (146, 104), MW)
    a.ell((112, 88), 7, 6, "ochre", w=MW * 1.2, second=0)
    for k in range(2):
        a.curve([(186 + k * 12, 84), (180 + k * 12, 70), (188 + k * 12, 58), (182 + k * 12, 44)], MW, alpha=0.6, jit=0.4)
    cup = [(166, 182), (206, 182), (200, 210), (172, 210)]
    a.block(cup, "ochre", second=0)
    a.ell((186, 182), 20, 5, w=MW, second=0)


@art_key("sticker_cat")
def sticker_cat(a):
    sticker_bg(a, "slate", 0.14)
    ground(a, 60, 186, 204, marks=3)
    draw_cat_sit(a, (114, 202), 1.85)


@art_key("sticker_star_fruit")
def sticker_star_fruit(a):
    sticker_bg(a, "sage")
    T = Tf((96, 112), 1, -30)
    whole = T.pts([(36 * math.sin(t) * (1 + 0.06 * math.cos(5 * t)) * (0.85 + 0.15 * math.cos(t)),
                    -78 * math.cos(t)) for t in [TAU * i / 16 for i in range(16)]])
    a.fill_smooth(whole, "ochre")
    a.hatch(clip_half(whole, T((12, 0)), T.v((1, 0))), T.ang(80), 4.2, alpha=0.45)
    for dx in (-16, 2, 18):
        a.curve(T.pts([(dx * 0.5, -72), (dx * 1.05, 0), (dx * 0.5, 72)]), MW, alpha=0.8)
    a.outline(whole, LW, second=0.4)
    a.curve(T.pts([(0, -76), (2, -88), (8, -94)]), LW, "sage")
    c = (172, 174)
    star = [polar(c, 40 if i % 2 == 0 else 17, -90 + 36 * i + 8) for i in range(10)]
    a.fill_smooth(star, "ochre", 0.9)
    a.curve([polar(c, 22 if i % 2 == 0 else 9, -90 + 36 * i + 8) for i in range(11)], FW * 1.2, alpha=0.7)
    a.dots([polar(c, 7, -90 + 72 * i + 8) for i in range(5)], 3.6)
    a.outline(star, LW, second=0.3)


@art_key("sticker_boat")
def sticker_boat(a):
    sticker_bg(a, "slate", 0.14)
    a.line((118, 152), (114, 40), LW, amp=0.5)
    sail = [(118, 44), (184, 134), (120, 140)]
    a.fill_poly(sail, "ochre")
    a.hatch(clip_half(sail, (150, 0), (1, 0)), 60, 4.2, alpha=0.45)
    a.outline_poly(sail, LW, second=0.4)
    hull = [(28, 128), (54, 150), (120, 156), (190, 150), (216, 124), (200, 168), (120, 184), (46, 172)]
    a.fill_smooth(hull, "clay")
    a.curve([(44, 152), (120, 162), (198, 152)], 3.2, "paper", 0.85)
    a.outline(hull, LW, second=0.4)
    a.dots([(64, 160), (180, 158)], 5.5, "ochre")
    for k, y in enumerate((196, 208, 220)):
        x0 = 40 + k * 22
        a.curve([(x0 + i * 16, y + 3 * math.sin(i * 1.6 + k)) for i in range(9 - 2 * k)], MW, "slate", 0.9)


@art_key("sticker_lantern")
def sticker_lantern(a):
    sticker_bg(a, "ochre", 0.15)
    a.arc((120, 54), 28, 196, 344, MW * 1.2)
    a.ell((120, 22), 8, 8, w=MW, second=0)
    a.line((120, 30), (120, 46), MW, amp=0.2)
    cap = [(96, 50), (144, 50), (154, 70), (86, 70)]
    a.block(cap, "slate", second=0)
    a.hatch(cap, 75, 3.6, alpha=0.5)
    flame = [(120, 96), (130, 120), (132, 138), (120, 150), (108, 138), (110, 118)]
    a.fill_smooth(flame, "ochre")
    a.fill_smooth([(120, 116), (126, 132), (120, 144), (114, 132)], "clay", 0.9)
    a.outline(flame, MW, second=0, jit=0.2)
    a.line((120, 150), (120, 164), MW, amp=0.2)
    a.lines([((92, 70), (92, 172)), ((148, 70), (148, 172))], LW, amp=0.6)
    a.lines([((106, 72), (104, 170)), ((134, 72), (136, 170))], FW, alpha=0.5, amp=0.4)
    a.line((98, 84), (100, 112), FW * 1.4, alpha=0.5)
    base = [(84, 172), (156, 172), (148, 194), (92, 194)]
    a.block(base, "slate", second=0.4)


@art_key("sticker_leaf")
def sticker_leaf(a):
    sticker_bg(a, "ochre", 0.15)
    base, tip = (62, 196), (196, 42)
    lp = leaf_pts(base, tip, 56, asym=0.85, n=8, belly=0.9)
    a.fill_smooth(lp, "sage")
    a.hatch(clip_half(lp, base, unit(perp(sub(tip, base)))), -20, 4.4, alpha=0.4)
    a.outline(lp, LW, second=0.45)
    a.curve([base, lerp(base, tip, 0.5), lerp(base, tip, 0.92)], MW * 1.2)
    vein = []
    for t in (0.2, 0.35, 0.5, 0.65, 0.8):
        p = lerp(base, tip, t)
        for side in (1, -1):
            nrm = mul(perp(unit(sub(tip, base))), side)
            vein.append((p, add(add(p, mul(nrm, 30 * (1 - t) + 10)), mul(unit(sub(tip, base)), 16))))
    a.lines(vein, FW * 1.2, alpha=0.8)
    a.curve([base, (50, 210), (40, 226)], LW)
    drop = [(150, 112), (156, 124), (150, 132), (144, 124)]
    a.fill_smooth(drop, "paper", 0.9, off=(0, 0))
    a.outline(drop, MW, second=0, jit=0.2)


@art_key("sticker_shell")
def sticker_shell(a):
    sticker_bg(a, "slate", 0.13)
    hinge = (120, 192)
    angs = [212 + i * 116 / 8 for i in range(9)]
    edge = []
    for i, t in enumerate(angs):
        edge.append(polar(hinge, 116, t))
        if i < 8:
            edge.append(polar(hinge, 108, t + 116 / 16))
    shell = [(98, 188)] + edge + [(142, 188)]
    a.fill_smooth(shell, "clay", 0.6)
    a.hatch(clip_half(shell, (150, 0), (1, 0.3)), 60, 4.4, alpha=0.4)
    a.lines([(lerp(hinge, polar(hinge, 116, t), 0.12), polar(hinge, 112, t)) for t in angs[1:-1]], MW, alpha=0.8)
    a.outline(shell, LW, second=0.4)
    ears = [(84, 180), (156, 180), (150, 206), (90, 206)]
    a.block(ears, "ochre", second=0)


@art_key("sticker_rice_field")
def sticker_rice_field(a):
    c = (120, 122)
    win = ellipse(c, 98, 96, n=36)
    a.fill_smooth(win, "ochre", 0.14, off=(0, 0))
    cols = [("sage", 0.9), ("ochre", 0.8), ("sage", 0.7)]
    for k in range(3):
        y0 = 84 + k * 42
        top = [(x, y0 + 9 * math.sin(x / 38 + k * 1.3)) for x in range(10, 241, 23)]
        bot = [(x, y0 + 38 + 9 * math.sin(x / 38 + (k + 1) * 1.3)) for x in range(230, 9, -23)]
        band = clip_convex(top + bot, win)
        col, al = cols[k]
        a.fill_poly(band, col, al, step=20)
        if k == 2:
            a.lines([((x, y0 + 26 + a.j(4)), (x + 18, y0 + 26 + a.j(4))) for x in range(56, 180, 34)], MW, "slate", 0.8)
        tufts = []
        for x in range(44 + k * 6, 200, 18):
            yb = y0 + 30 + 9 * math.sin(x / 38 + (k + 1) * 1.3) - 6
            if inside((x, yb), win) and inside((x, yb - 14), win):
                tufts += [((x, yb), (x - 5, yb - 10)), ((x, yb), (x + 1, yb - 13)), ((x, yb), (x + 6, yb - 10))]
        a.lines(tufts, FW * 1.3, alpha=0.85, amp=0.3)
        a.curve([p for p in top if inside(p, win)], MW * 1.2)
    a.ell_outline(c, 98, 96, w=LW)
    a.ell((180, 56), 13, 13, "ochre", w=MW, second=0)


@art_key("sticker_drum")
def sticker_drum(a):
    sticker_bg(a, "ochre", 0.15)
    body = [(52, 78), (88, 70), (124, 68), (160, 76), (192, 92), (192, 164), (160, 178), (124, 184), (88, 182),
            (52, 170)]
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(body, (0, 150), (0, 1)), 20, 4.2, alpha=0.45)
    zz = [(64 + i * 15.5, 78 if i % 2 == 0 else 172) for i in range(9)]
    a.zig(zz, FW * 1.4, alpha=0.9)
    a.zig([(p[0] + 7, p[1]) for p in zz][:-1], FW, alpha=0.5)
    a.outline(body, LW, second=0.4)
    a.fill_smooth(ellipse((52, 124), 16, 46, n=12), "ochre", 0.8)
    a.ell_outline((52, 124), 16, 46)
    a.ell_outline((52, 124), 10, 38, w=FW * 1.2, second=0)
    a.fill_smooth(ellipse((192, 128), 11, 36, n=10), "ochre", 0.8)
    a.ell_outline((192, 128), 11, 36, w=LW * 0.9)
    a.lines([((50, 178), (36, 206)), ((190, 172), (204, 200))], LW, amp=0.4)
    a.line((26, 206), (214, 204), MW)


@art_key("sticker_umbrella")
def sticker_umbrella(a):
    sticker_bg(a, "sage", 0.16)
    top, cy = (120, 40), 126
    xs = [30, 75, 120, 165, 210]
    dome = [polar((120, cy), 90, t, 86) for t in range(180, 361, 15)]
    left_arc = [polar((120, cy), 90, t, 86) for t in range(180, 271, 15)]
    right_arc = [polar((120, cy), 90, t, 86) for t in range(270, 361, 15)]
    wedge = [
        left_arc + [(75, cy), (52.5, cy - 12)],
        [top, (75, cy), (97.5, cy - 12), (120, cy)],
        [top, (120, cy), (142.5, cy - 12), (165, cy)],
        right_arc + [(187.5, cy - 12), (165, cy)],
    ]
    for i, wpts in enumerate(wedge):
        a.fill_poly(wpts, "slate" if i % 2 == 0 else "clay", 0.9, step=12)
    a.hatch(wedge[1], 70, 4.2, alpha=0.45)
    a.curve(dome, LW)
    scal = []
    for i in range(4):
        x0, x1 = xs[i], xs[i + 1]
        scal += [(x0, cy), ((x0 + x1) / 2, cy - 12)]
    scal.append((xs[-1], cy))
    a.curve(scal, MW * 1.3)
    a.lines([(top, (x, cy)) for x in xs[1:-1]], MW)
    a.line((120, 40), (120, 28), LW, amp=0.2)
    a.line((120, 118), (121, 200), LW * 1.1, amp=0.5)
    a.curve([(121, 198), (121, 212), (110, 218), (101, 208)], LW * 1.1)
    a.lines([((40 + i * 37, 24 + (i % 2) * 14), (36 + i * 37, 34 + (i % 2) * 14)) for i in range(5) if i != 2],
            MW, "slate", amp=0.2)


@art_key("sticker_book")
def sticker_book(a):
    sticker_bg(a, "sage", 0.16)
    a.blob([(118, 160), (128, 160), (128, 212), (123, 204), (118, 212)], "ochre", w=MW * 1.2, second=0)
    draw_open_book(a, Tf((120, 126), 0.98))


@art_key("sticker_compass")
def sticker_compass(a):
    sticker_bg(a, "slate", 0.13)
    c = (120, 128)
    a.ell((120, 40), 9, 9, w=MW * 1.2, second=0)
    a.block(rect(113, 46, 14, 10), "ochre", w=MW, second=0)
    a.fill_smooth(ellipse(c, 76, 76, n=18), "ochre")
    a.hatch(clip_half(ellipse(c, 74, 74, n=30), (140, 150), (0.6, 0.8)), 50, 4.2, alpha=0.45)
    a.fill_smooth(ellipse(c, 60, 60, n=16), "paper", off=(0, 0))
    a.ell_outline(c, 76, 76)
    a.ell_outline(c, 60, 60, w=MW, second=0)
    big, small = Path(), Path()
    for i in range(16):
        t = i * 22.5
        a.seg(polar(c, 56, t), polar(c, 46 if i % 4 == 0 else 51, t), 0.2, big if i % 4 == 0 else small)
    a.stroke(big, MW * 1.3)
    a.stroke(small, FW)
    ang = -70
    tipn, tips = polar(c, 44, ang), polar(c, 44, ang + 180)
    sl, sr = polar(c, 10, ang - 90), polar(c, 10, ang + 90)
    a.block([tipn, sr, sl], "clay", w=MW * 1.2, second=0)
    a.block([tips, sl, sr], "slate", w=MW * 1.2, second=0)
    a.dots([c], 7, "ochre")
    a.dots([c], 2.4)


# --------------------------------------------------------------------------------------------- covers (4:3)


def cover_ground(a, color="ochre"):
    tint_patch(a, (204 + a.j(6), 246), 178, 40, color, 0.18)


@art_key("cover_bahasa", 400, 300, 1.35)
def cover_bahasa(a):
    cover_ground(a)
    draw_open_book(a, Tf((172, 214), 1.22))
    bc = (292, 94)
    bub = [polar(bc, 66, t, 44) for t in range(150, 481, 30)] + [(222, 156)]
    a.fill_smooth(bub, "sage", 0.6)
    a.outline(bub, LW, second=0.4)
    for k, ln in enumerate((70, 92, 54)):
        y = 78 + k * 16
        a.curve([(258 + i * ln / 4, y + 2.5 * math.sin(i * 1.7 + k)) for i in range(5)], MW, alpha=0.75)
    a.curve([(214, 150), (206, 138), (214, 130), (222, 140)], MW, alpha=0.8, jit=0.3)


@art_key("cover_matematika", 400, 300, 1.35)
def cover_matematika(a):
    cover_ground(a, "sage")
    for px in (60, 330):
        post = rect(px, 64, 12, 152)
        a.fill_poly(post, "ochre", 0.9)
        a.outline_poly(post, MW * 1.3, second=0)
    foot = rect(48, 208, 306, 14)
    a.fill_poly(foot, "ochre")
    a.hatch(foot, 0, 4, alpha=0.4)
    a.outline_poly(foot, LW, second=0.4)
    for y, layout in ((106, [("clay", 5, 84), ("ochre", 5, 84 + 5 * 22)]),
                      (160, [("clay", 3, 84), ("clay", 2, 210), ("ochre", 5, 254)])):
        a.line((70, y), (332, y + a.j(1)), LW, amp=0.5)
        for col, n, x0 in layout:
            for i in range(n):
                c = (x0 + i * 21 + a.j(1), y + a.j(1))
                a.fill_smooth(ellipse(c, 10, 14, n=8), col)
                a.ell_outline(c, 10, 14, w=MW * 1.3, second=0)
                a.curve([polar(c, 6, 200, 9), polar(c, 6, 230, 9), polar(c, 6, 255, 9)], 2.0, "paper", 0.9, jit=0.1)
    T = Tf((206, 258), 1, -4)
    ruler = T.pts(rect(-130, -15, 260, 30))
    a.fill_poly(ruler, "sage", 0.9)
    ticks = [(T((x, -15)), T((x, -15 + (12 if (x + 120) % 50 == 0 else 6)))) for x in range(-120, 121, 10)]
    a.lines(ticks, FW * 1.3, amp=0.1)
    a.outline_poly(ruler, LW, second=0.4)


@art_key("cover_sains", 400, 300, 1.35)
def cover_sains(a):
    cover_ground(a, "ochre")
    mound = [(96, 248), (124, 222), (164, 214), (204, 222), (232, 248)]
    a.fill_smooth(mound + [(164, 252)], "clay", 0.55)
    a.stipple(mound + [(164, 250)], 26, 2.0, alpha=0.6)
    a.curve(mound, LW)
    stem = [(164, 220), (160, 186), (166, 150)]
    a.curve(stem, LW * 1.1)
    for base, tip, w in (((162, 184), (106, 152), 22), ((165, 164), (222, 124), 24), ((166, 152), (176, 118), 9)):
        lp = leaf_pts(base, tip, w, asym=0.75)
        a.fill_smooth(lp, "sage")
        a.outline(lp, LW * 0.9, second=0.4)
        a.curve([base, lerp(base, tip, 0.55), lerp(base, tip, 0.85)], FW * 1.2)
    lc, lr = (276, 128), 50
    handle = capsule((312, 166), (356, 228), 9, 8)
    a.blob(handle, "ochre", second=0)
    a.hatch(clip_half(handle, (334, 197), (0.8, -0.6)), 30, 4, alpha=0.5)
    a.block([(304, 158), (318, 172), (326, 164), (312, 150)], "slate", w=MW * 1.3, second=0)
    a.stroke(a.ell_path(add(lc, a.reg("slate")), lr, lr, sweep=362, wob=0.01), 10, "slate", 0.9)
    a.ell_outline(lc, lr + 6, lr + 6, wob=0.015)
    a.ell_outline(lc, lr - 5, lr - 5, w=MW, second=0, wob=0.015)
    a.lines([((250, 112), (262, 98)), ((252, 126), (272, 104))], MW, "slate", 0.6)


@art_key("cover_sosial_seni", 400, 300, 1.35)
def cover_sosial_seni(a):
    cover_ground(a, "sage")
    a.stroke(a.open_curve([(214, 258), (260, 238), (316, 246), (366, 222)], 1.5), 18, "clay", 0.5)
    draw_angklung(a, (150, 160), 1.18)
    handle = ribbon([(244, 262), (278, 208), (304, 160)], 12, 8)
    a.blob(handle, "ochre", second=0)
    a.hatch(handle, 35, 4, alpha=0.4)
    fer = ribbon([(304, 160), (314, 142)], 11, 12)
    a.blob(fer, "slate", w=MW * 1.4, second=0)
    tip = [(306, 144), (322, 138), (328, 118), (330, 96), (316, 116), (308, 132)]
    a.fill_smooth(tip, "clay")
    a.outline(tip, LW, second=0)
    a.lines([((316, 136), (326, 108)), ((311, 136), (318, 116))], FW, alpha=0.6)


# --------------------------------------------------------------------------------------------- glyphs, states, gems


@art_key("glyph_correct")
def glyph_correct(a):
    pts = [(46, 128), (72, 152), (98, 180), (146, 120), (196, 56)]
    off = a.reg("sage")
    a.stroke(a.open_curve([add(p, off) for p in pts], 1.0), 18, "sage", 0.9)
    a.curve(pts, 4.4, jit=0.8)
    a.curve([(104, 168), (148, 114), (190, 64)], 1.6, jit=0.8)


@art_key("glyph_not_yet")
def glyph_not_yet(a):
    pts = [(36, 176), (78, 166), (116, 142), (136, 106), (126, 80), (102, 82), (96, 108), (118, 132), (158, 142),
           (198, 128)]
    off = a.reg("ochre")
    a.stroke(a.open_curve([add(p, off) for p in pts], 1.0), 15, "ochre", 0.85)
    a.curve(pts, 4.0, jit=0.6)
    end = pts[-1]
    d = unit(sub(end, pts[-2]))
    a.zig([add(end, mul(rotp(d, 150), 22)), end, add(end, mul(rotp(d, -150), 22))], 4.0, jit=0.5)


@art_key("glyph_saved")
def glyph_saved(a):
    T = Tf((120, 122), 1, -6)
    pages = T.pts(rect(-52, -70, 112, 144))
    a.block(pages, "paper", w=MW * 1.2, second=0)
    a.lines([(T((56 + k * 2.5, -66)), T((56 + k * 2.5, 70))) for k in range(2)], FW, alpha=0.6, amp=0.2)
    cover = T.pts(rect(-58, -74, 112, 146))
    a.fill_poly(cover, "ochre")
    spine = T.pts(rect(-58, -74, 20, 146))
    a.fill_poly(spine, "clay", 0.95)
    a.hatch(spine, T.ang(80), 3.8, alpha=0.45)
    label = T.pts(rect(-24, -46, 60, 30))
    a.block(label, "paper", w=MW * 1.2, second=0)
    a.outline_poly(cover, LW, second=0.45)
    a.line(T((34, -76)), T((34, 74)), 3.6, amp=0.4)
    rib = T.pts([(4, 70), (16, 70), (16, 98), (10, 90), (4, 98)])
    a.block(rib, "clay", w=MW * 1.2, second=0)


@art_key("state_error")
def state_error(a):
    c, s = (122, 112), 23
    pts = []
    for i in range(37):
        t = 0.35 + (TAU - 0.7) * i / 36
        pts.append((c[0] + s * (math.sin(t) + 2 * math.sin(2 * t)), c[1] + s * (math.cos(t) - 2 * math.cos(2 * t))))
    loose = [(36, 210), (60, 196), (78, 176)] + pts + [(178, 176), (204, 196), (214, 222)]
    off = a.reg("clay")
    a.stroke(a.open_curve([add(p, off) for p in loose], 0.8), 4.6, "clay", 0.95)
    a.curve(loose[::2], 1.2, jit=0.9)
    a.dots([(36, 210), (214, 222)], 6, "clay")


@art_key("state_seedling")
def state_seedling(a):
    T = Tf((120, 150), 1.4)

    def S(pts):
        return [T((x - 120, y - 150)) for x, y in pts]

    pot = S([(80, 150), (160, 150), (150, 214), (90, 214)])
    a.fill_poly(pot, "clay")
    a.hatch(clip_half(pot, T((16, 0)), (1, 0)), 70, 4.4, alpha=0.5)
    a.outline_poly(pot, LW, second=0.4)
    rim = S(rect(70, 132, 100, 20))
    a.fill_poly(rim, "clay", 0.95)
    a.zig(S([(78, 148), (88, 137), (98, 148), (108, 137), (118, 148), (128, 137), (138, 148), (148, 137), (158, 148)]),
          MW, "paper", 0.8)
    a.outline_poly(rim, LW, second=0.4)
    soil = S(ellipse((120, 133), 46, 7, n=12))
    a.fill_smooth(soil, "slate", 0.7, off=(0, 0))
    a.stipple(soil, 12, 2.2, alpha=0.7)
    seed = S(ellipse((118, 126), 11, 7.5, -24, n=10))
    a.blob(seed, "ochre", w=MW * 1.4, second=0)
    a.curve(S([(122, 120), (124, 108), (130, 98)]), MW * 1.4)
    for tip in ((116, 92), (142, 94)):
        lp = S(leaf_pts((130, 99), tip, 5.5))
        a.fill_smooth(lp, "sage")
        a.outline(lp, MW, second=0, jit=0.2)


@art_key("plot_seed")
def plot_seed(a):
    """An unfinished unit's bed: one small soil pile with a two-leaf sprout just breaking through at its top. Heavy
    contour and big leaves so it still reads at 40 dp; it sits low in the frame, over the scene's bed."""
    cx, base, rx, h = 120 + a.j(2), 208, 90, 56
    lean = a.j(6)
    pile = []
    for i in range(11):
        t = math.pi * i / 10
        lift = math.sin(t) ** 1.35
        pile.append((cx - rx * math.cos(t) + lean * lift, base - h * lift))
    sag = [(cx + rx * 0.5, base + 5), (cx, base + 7), (cx - rx * 0.5, base + 5)]
    a.fill_smooth(pile + sag, "clay", 0.6)
    a.hatch(clip_half(spline(pile + sag, True, 3), (cx + 26, 0), (1, 0)), 62, 6.0, alpha=0.42)
    a.stipple(clip_half(pile + sag, (cx + 12, 0), (-1, 0)), 13, 2.8, alpha=0.6)
    a.curve(pile, LW * 1.8)
    a.line((cx - rx - 7, base + 2), (cx + rx + 5, base + 3), MW * 1.1, amp=0.8, over=(1, 3))
    root = (cx + lean, base - h + 4)
    a.lines([(add(root, (-5, 1)), add(root, (-21, 8))), (add(root, (5, 1)), add(root, (20, 7)))], MW * 1.5, amp=0.4)
    a.dots([add(root, (-29, 3)), add(root, (28, 1)), add(root, (14, -6))], 6.5, "clay", 0.9)
    stem_top = (root[0] + 3, root[1] - 36)
    a.curve([root, (root[0] - 6, root[1] - 17), stem_top], LW * 1.6)
    for tip, wdt in (((stem_top[0] - 54, stem_top[1] - 27), 19.5), ((stem_top[0] + 56, stem_top[1] - 39), 22)):
        lp = leaf_pts(stem_top, tip, wdt, asym=0.75)
        a.fill_smooth(lp, "sage")
        a.outline(lp, LW * 1.3, second=0, jit=0.3)
        a.curve([stem_top, lerp(stem_top, tip, 0.5), lerp(stem_top, tip, 0.82)], MW * 1.1, jit=0.3)


@art_key("state_survey")
def state_survey(a):
    """Trial survey header: a clipboard with three tick boxes (two ticked, one empty) and a pencil pointing at the empty
    one. Squiggles stand in for the questions: no letters, no digits."""
    T = Tf((114, 122), 1, -4)
    board = T.pts(rect(-66, -92, 132, 184))
    a.fill_poly(board, "ochre")
    a.hatch(clip_half(board, T((52, 0)), T.v((1, 0))), T.ang(76), 4.0, alpha=0.45)
    a.outline_poly(board, LW, second=0.4)
    sheet = T.pts([(-54, -74), (54, -75), (55, 80), (-53, 81)])
    a.fill_poly(sheet, "paper", off=(0, 0), step=20)
    a.outline_poly(sheet, MW * 1.1, second=0, over=1.2, gap=1.6)
    clip = T.pts([(-28, -104), (28, -104), (32, -80), (-32, -80)])
    a.block(clip, "slate", w=MW * 1.4, second=0)
    a.ell(T((0, -95)), 6, 4, "paper", w=MW, second=0)
    a.line(T((-24, -84)), T((24, -84)), FW * 1.2, alpha=0.6, amp=0.2)
    rows = (-46, -6, 34)
    boxes = Path()
    for k, y in enumerate(rows):
        x0 = -40 + a.j(1.5)
        a.seg(T((x0, y - 10)), T((x0 + 20, y - 11)), 0.5, boxes, over=(a.u(-1, 2), a.u(-1, 2)))
        a.seg(T((x0 + 20, y - 11)), T((x0 + 21, y + 9)), 0.5, boxes, over=(a.u(-1, 2), a.u(-1, 2)))
        a.seg(T((x0 + 21, y + 9)), T((x0, y + 10)), 0.5, boxes, over=(a.u(-1, 2), a.u(-1, 2)))
        a.seg(T((x0, y + 10)), T((x0, y - 10)), 0.5, boxes, over=(a.u(-1, 2), a.u(-1, 2)))
    a.stroke(boxes, MW * 1.3)
    for k, y in enumerate(rows):
        ln = (52, 40, 46)[k]
        a.curve([T((-8 + i * ln / 5, y + 2.2 * math.sin(i * 1.9 + k))) for i in range(6)], MW, alpha=0.55, jit=0.3)
        if k < 2:
            tick = T.pts([(-37, y - 1), (-30, y + 7), (-14, y - 17)])
            off = a.reg("sage")
            a.stroke(a.open_curve([add(p, off) for p in tick], 0.6), 8, "sage", 0.9)
            a.curve(tick, LW * 1.1, jit=0.6)
    P = Tf(T((-10, 46)), 1, 24)  # pencil frame: tip at the origin, body to the right
    body = P.pts([(15, -7), (96, -7), (96, 7), (15, 7)])
    a.fill_poly(body, "clay", 0.95)
    a.hatch(P.pts([(15, 1), (96, 1), (96, 7), (15, 7)]), P.ang(0), 3.2, alpha=0.4, inset=(0.4, 1.2))
    a.fill_poly(P.pts([(96, -7), (106, -7), (106, 7), (96, 7)]), "slate", 0.9)
    a.fill_poly(P.pts([(106, -7), (114, -6), (116, 0), (114, 6), (106, 7)]), "clay", 0.6)
    a.fill_poly(P.pts([(0, 0), (15, -7), (15, 7)]), "paper", off=(0, 0))
    a.fill_poly(P.pts([(0, 0), (5, -2.5), (5, 2.5)]), "ink", 0.95, off=(0, 0))
    a.outline_poly(P.pts([(0, 0), (15, -7), (114, -6), (116, 0), (114, 6), (15, 7)]), LW, second=0, over=1.2, gap=1.2)
    a.lines([(P((15, -7)), P((15, 7))), (P((96, -7)), P((96, 7))), (P((106, -7)), P((106, 7)))], MW, amp=0.2)


@art_key("gem")
def gem(a):
    g = [(40, 96), (80, 96), (120, 96), (160, 96), (200, 96)]
    t = [(84, 60), (108, 58), (132, 58), (156, 60)]
    culet = (122, 202)
    crown = [t[0], t[-1], g[-1], g[0]]
    pav = [g[0], g[-1], culet]
    a.fill_poly(pav, "slate", 0.95)
    a.fill_poly(crown, "slate", 0.6)
    a.fill_poly([g[0], t[0], g[1]], "paper", 0.5, off=(0, 0))
    a.fill_poly([t[1], t[2], g[2]], "paper", 0.35, off=(0, 0))
    a.hatch(clip_half(pav, culet, (1, -0.15)), 70, 4, alpha=0.5)
    a.zig([g[0], t[0], g[1], t[1], g[2], t[2], g[3], t[3], g[4]], MW, jit=0.5)
    a.lines([(culet, g[1]), (culet, g[2]), (culet, g[3])], MW, amp=0.4)
    a.outline_poly([t[0], t[-1], g[-1], culet, g[0]], LW, second=0.45)
    a.line(g[0], g[-1], MW * 1.2)
    a.line((92, 70), (104, 68), 2.4, "paper", 0.9, amp=0.2)


@art_key("gem_box")
def gem_box(a):
    x, y, w, h, d = 54, 120, 128, 78, (26, -28)
    f = rect(x, y, w, h)
    top = [f[0], f[1], add(f[1], d), add(f[0], d)]
    side = [f[1], add(f[1], d), add(f[2], d), f[2]]
    a.fill_poly(top, "clay", 0.6)
    a.fill_poly(side, "clay", 0.95)
    a.hatch(side, 72, 3.8, alpha=0.55)
    a.fill_poly(f, "clay", 0.85)
    for k in range(3):
        yy = y + 30 + k * 14
        a.curve([(x + 8 + i * 22, yy + 2 * math.sin(i * 1.3 + k)) for i in range(6)], FW, alpha=0.4)
    a.curve([(x + 30, y - 12), (x + 70, y - 16), (x + 110, y - 10)], FW, alpha=0.4)
    a.stroke(a.sketch_poly(f), LW)
    a.stroke(a.sketch_poly([f[0], add(f[0], d), add(f[1], d), add(f[2], d), f[2]], closed=False), LW)
    a.line(f[1], add(f[1], d), MW)
    a.line((x, y + 20), (x + w, y + 20), MW)
    a.line((x + w, y + 20), (x + w + d[0], y + 20 + d[1]), MW)
    clasp = rect(x + w / 2 - 9, y + 12, 18, 20)
    a.block(clasp, "ochre", w=MW * 1.3, second=0)
    a.dots([(x + w / 2, y + 24)], 3.2)


@art_key("app_icon_draft")
def app_icon_draft(a):
    sq = []
    for cx, cy, a0 in ((190, 50, -90), (190, 190, 0), (50, 190, 90), (50, 50, 180)):
        sq += [polar((cx, cy), 42, a0 + 30 * i) for i in range(4)]
    a.fill_smooth([a.jit(p, 1.2) for p in sq], "paper", off=(0, 0))
    a.stipple(sq, 70, 1.4, alpha=0.18)
    draw_aya(a, (120, 140), 1.4, "idle", groundline=False, blush=False)


@art_key("app_icon_mono")
def app_icon_mono(a):
    """Monochrome (themed) launcher layer: Aya's idle silhouette as one flat ink shape, because the launcher keeps only
    the alpha and tints it. No paper, no grain, no second colour, every mark opaque; the two eyes are holes (reverse
    winding under nonZero), so the face still reads. About 70% of the height, inside the safe zone after a 16% inset."""
    arms, (ltip, rtip), tilt, _, _ = AYA_POSES["idle"]
    T = Tf((120 + a.j(1.5), 144), 1.16)
    s = T.s
    solid = (0.0, 0.0)  # one plate only: no mis-registration offset
    for fx in (-16, 15):
        a.fill_smooth(ellipse(T((fx, 46)), 10.5 * s, 6.5 * s, n=10), "ink", off=solid)
    for p0, p1 in arms:
        a.fill_smooth(T.pts(capsule(p0, p1, 8, 7.5)), "ink", off=solid)
    body = T.pts(aya_body_local())
    shape = smooth(Path(), [a.jit(p, 0.5) for p in orient(body)], closed=True)
    for e in ((-14, -5), (13, -6)):
        eye = list(reversed(orient(ellipse(T(e), 4.6 * s, 5.4 * s, a.j(8), n=8))))
        smooth(shape, eye, closed=True)
    a.fill(shape, "ink")
    a.outline(body, LW, second=0.45)
    top = (0, -48)

    def S(p):
        return T(rotp(p, tilt, top))

    stem_top = (1.5, -69)
    a.curve([S(top), S((-2.5, -58)), S(stem_top)], LW * 1.25)
    for tip, wdt in ((ltip, 10.5), (rtip, 11.5)):
        lp = leaf_pts(S(stem_top), S(tip), wdt * s, asym=0.75)
        a.fill_smooth(lp, "ink", off=solid)
        a.outline(lp, MW * 1.3, second=0)


# --------------------------------------------------------------------------------------------- scenes with regions


@art_key("scene_kampung_shapes", 400, 300, 1.3)
def scene_kampung_shapes(a):
    gnd = [(0, 254)] + [(x, 252 + 4 * math.sin(x / 31)) for x in range(20, 401, 40)] + [(400, 300), (0, 300)]
    a.fill_poly(gnd, "sage", 0.2, off=(0, 0), step=40)
    a.curve([(10, 256), (120, 252), (200, 258), (300, 252), (392, 256)], MW * 1.2)
    tufts = []
    for x in (30, 72, 110, 262, 330, 380):
        tufts += [((x, 256), (x - 4, 246)), ((x, 256), (x + 1, 244)), ((x, 256), (x + 5, 247))]
    a.lines(tufts, FW * 1.3, amp=0.3)
    # sun (circle) in 24..96 x 18..90
    sc = (60, 54)
    a.lines([(polar(sc, 30, t), polar(sc, 35, t)) for t in range(10, 360, 45)], MW, "ochre", amp=0.2)
    a.fill_smooth(ellipse(sc, 25, 25, n=12), "ochre")
    a.ell_outline(sc, 25, 25)
    # house: roof (triangle) in 120..264 x 60..126; wall (square) in 136..248 x 132..243
    wall = [(142, 134), (242, 134), (242, 238), (142, 238)]
    a.fill_poly(wall, "ochre", 0.75)
    a.hatch(clip_half(wall, (226, 0), (1, 0)), 75, 4.4, alpha=0.4)
    door = rect(178, 186, 28, 52)
    a.block(door, "slate", w=MW * 1.4, second=0)
    a.dots([(200, 214)], 3.6, "ochre")
    win = rect(152, 152, 20, 20)
    a.block(win, "paper", w=MW * 1.2, second=0)
    a.lines([((162, 152), (162, 172)), ((152, 162), (172, 162))], FW * 1.2, amp=0.2)
    a.outline_poly(wall, LW, second=0.4)
    roof = [(192, 62), (262, 126), (122, 126)]
    a.fill_poly(roof, "clay")
    a.hatch(roof, 0, 6, alpha=0.4)
    a.outline_poly(roof, LW, second=0.4)
    a.curve([(178, 240), (164, 268), (150, 296)], FW * 1.4, alpha=0.7)
    a.curve([(206, 240), (226, 268), (244, 296)], FW * 1.4, alpha=0.7)
    # kite (rhombus) in 296..360 x 18..96, tail and string outside the region
    draw_kite(a, (326, 20), (358, 52), (330, 94), (298, 58), (356, 150), (250, 236), s=0.8)
    # noticeboard (rectangle) in 288..376 x 168..222, legs below
    a.lines([((304, 220), (302, 256)), ((362, 220), (364, 256))], LW, amp=0.4)
    board = [(292, 172), (372, 171), (372, 219), (292, 220)]
    a.fill_poly(board, "sage", 0.9)
    for nx, ny, nw, nh in ((302, 180, 24, 28), (334, 182, 28, 20)):
        note = rect(nx, ny, nw, nh)
        a.fill_poly(note, "paper", 0.95, off=(0, 0))
        a.outline_poly(note, FW * 1.2, second=0)
        a.lines([((nx + 4, ny + 7 + k * 6), (nx + nw - 5, ny + 7 + k * 6)) for k in range(int(nh / 8))], FW, alpha=0.4,
                amp=0.1)
        a.dots([(nx + nw / 2, ny + 2)], 3.2, "clay")
    a.outline_poly(board, LW, second=0.4)


@art_key("body_child", 300, 400, 1.25)
def body_child(a):
    a.line((40, 388), (262, 388), MW * 1.1, amp=0.8)
    a.lines([((70 + k * 40, 392), (64 + k * 40, 398)) for k in range(5)], FW, alpha=0.6)
    # legs and shoes; right foot (viewer's right) sits in the foot region 162..222 x 356..388
    legs = [capsule(p0, p1, 11, n=4) for p0, p1 in (((128, 294), (122, 362)), ((172, 294), (182, 362)))]
    a.skin_many(legs)
    for leg in legs:
        a.outline(leg, MW * 1.3, second=0, jit=0.3)
    for c, rot in (((108, 371), -6), ((192, 371), 6)):
        shoe = ellipse(c, 27, 11, rot, n=12)
        a.fill_smooth(shoe, "clay")
        a.outline(shoe, LW, second=0.4)
        a.line((c[0] - 14, c[1] - 4), (c[0] + 10, c[1] - 6), FW, "paper", 0.8)
    shorts = [(106, 252), (194, 252), (200, 300), (156, 302), (150, 278), (144, 302), (100, 300)]
    a.block(shorts, "slate", second=0.4)
    # arms: left hand (viewer's left) in the hand region 18..60 x 184..224
    neck = rect(138, 118, 24, 26)
    a.skin(neck, smooth=False)
    shirt = [(124, 138), (106, 144), (100, 160), (102, 262), (198, 262), (200, 160), (194, 144), (176, 138), (150, 150)]
    mitten = [(-13, -10), (2, -11), (12, -9), (18, -3), (18, 4), (12, 9), (6, 11), (8, 16), (4, 21), (-2, 19), (-3, 12),
              (-13, 10)]
    arms = []
    for s0, s1, h, side in (((108, 152), (52, 196), (40, 204), 1), ((192, 152), (246, 202), (258, 210), -1)):
        ang = math.degrees(math.atan2(h[1] - s0[1], h[0] - s0[0]))
        T = Tf(h, 1.05, ang)
        arms.append((capsule(lerp(s0, s1, 0.35), s1, 10, n=4), T.pts([(x, y * side) for x, y in mitten]), T, side, s0, s1))
    a.skin_many([fore for fore, *_ in arms])
    for fore, *_ in arms:
        a.outline(fore, MW * 1.3, second=0, jit=0.3)
    a.skin_many([hand for _, hand, *_ in arms])
    for _, hand, T, side, s0, s1 in arms:
        a.outline(hand, LW * 0.9, second=0, jit=0.3)
        a.lines([(T((17, -3.5 * side)), T((9, -3.5 * side))), (T((17, 2.5 * side)), T((9, 2.5 * side)))], FW * 1.2, amp=0.2)
        sleeve = capsule(s0, lerp(s0, s1, 0.4), 15)
        a.blob(sleeve, "sage", w=MW * 1.4, second=0)
    a.fill_poly(shirt, "sage")
    a.fill_poly(clip_half(clip_half(shirt, (0, 196), (0, 1)), (0, 212), (0, -1)), "clay", 0.85)
    a.outline_poly(shirt[:-1], LW, closed=False, second=0.4)
    a.curve([(124, 138), (150, 152), (176, 138)], MW * 1.3)
    # head: ears in 72..99 x 44..84 (left), eyes 108..192 x 40..68, nose 135..165 x 70..90, mouth 126..174 x 94..114
    ears = [ellipse(c, 10, 16, n=8) for c in ((90, 66), (210, 65))]
    a.skin_many(ears)
    for c, ear in zip(((90, 66), (210, 65)), ears):
        a.outline(ear, MW * 1.4, second=0, jit=0.3)
        a.arc(c, 5, 120 if c[0] < 150 else -60, 260 if c[0] < 150 else 80, FW * 1.2)
    head = ellipse((150, 70), 56, 58, n=16)
    a.skin(head)
    hair = [polar((150, 70), 61, t) for t in range(190, 351, 20)] + [(206, 50), (186, 36), (164, 40), (142, 32), (118, 40),
                                                                      (96, 52)]
    a.hair(hair, 3.4)
    a.outline(head, LW, second=0.35)
    a.dots([(128, 55), (172, 54)], 9.5)
    a.lines([((119, 43), (135, 42)), ((165, 41), (181, 43))], MW, amp=0.3)
    a.curve([(150, 72), (146, 82), (152, 85)], MW * 1.2, jit=0.2)
    a.curve([(134, 101), (150, 110), (166, 100)], MW * 1.3, jit=0.3)
    for bx in (118, 183):
        a.fill_smooth(ellipse((bx, 88), 9, 5.5, n=8), "blush", 0.85)


ISLANDS = {
    "sumatra": [(16, 18), (24, 14), (34, 24), (46, 40), (60, 58), (74, 76), (86, 94), (94, 108), (90, 116), (80, 114),
                (66, 100), (50, 82), (36, 64), (24, 46), (14, 30)],
    "jawa": [(100, 130), (112, 127), (128, 129), (144, 133), (160, 137), (172, 141), (170, 147), (156, 148), (140, 145),
             (124, 142), (108, 140), (99, 137)],
    "kalimantan": [(120, 58), (124, 40), (136, 28), (150, 20), (166, 18), (178, 26), (187, 38), (184, 52), (178, 64),
                   (174, 78), (164, 90), (148, 94), (134, 90), (124, 78)],
    "sulawesi": [(222, 44), (240, 43), (254, 46), (252, 51), (234, 53), (220, 57), (217, 65), (230, 70), (245, 72), (245, 77),
                 (228, 79), (221, 85), (230, 96), (241, 110), (237, 114), (225, 104), (217, 97), (215, 106), (212, 118),
                 (206, 116), (206, 100), (206, 84), (208, 70), (206, 58), (210, 48)],
    "halmahera": [(284, 56), (290, 60), (288, 70), (296, 74), (294, 78), (286, 76), (288, 86), (282, 88), (282, 74),
                  (276, 70), (282, 64)],
    "papua": [(312, 66), (318, 58), (330, 56), (340, 62), (336, 70), (346, 74), (358, 80), (374, 84), (392, 88), (394, 104),
              (394, 126), (386, 134), (374, 128), (362, 118), (350, 112), (342, 104), (334, 96), (336, 86), (326, 80),
              (316, 78)],
}
SMALL_ISLANDS = [
    ((188, 163), 6, 3.5, 0), ((201, 164), 4.5, 3.5, 0), ((217, 164), 10, 3.5, 2), ((243, 166), 14, 3.2, 3),
    ((228, 175), 7, 3, 0), ((260, 173), 7, 3, -20),  # Bali, Lombok, Sumbawa, Flores, Sumba, Timor
    ((288, 104), 13, 3.5, -5), ((271, 100), 5, 4, 0), ((296, 92), 2.4, 2, 0), ((274, 80), 2.4, 2, 0),
    ((300, 112), 2.8, 2.2, 0), ((279, 116), 2.2, 2, 0),  # Maluku
    ((16, 62), 3, 2, 30), ((26, 86), 4, 2.2, 40), ((160, 128), 5, 2.4, 0),  # Nias, Mentawai, Madura
]


@art_key("map_indonesia", 400, 200, 1.15)
def map_indonesia(a):
    shapes = [pts for pts in ISLANDS.values()] + [ellipse(c, rx, ry, rot, n=8) for c, rx, ry, rot in SMALL_ISLANDS]
    sea = []
    y = 10
    row = 0
    while y < 196:
        x = 6 + (row % 2) * 13 + a.j(4)
        while x < 392:
            L = a.u(7, 12)
            seg = ((x, y + a.j(2)), (x + L, y + a.j(2)))
            probe = [seg[0], seg[1], lerp(seg[0], seg[1], 0.5)]
            if not any(inside(add(p, (dx, dy)), s) for s in shapes for p in probe for dx, dy in
                       ((0, 0), (0, 5), (0, -5), (5, 0), (-5, 0))):
                sea.append(seg)
            x += a.u(22, 30)
        y += a.u(11, 14)
        row += 1
    a.lines(sea, FW * 1.1, "slate", 0.5, amp=0.3)
    for name, pts in ISLANDS.items():
        a.fill_smooth(pts, "sage", jit=0.4)
        if name in ("sumatra", "kalimantan", "papua", "sulawesi"):
            a.stipple(pts, 6, 1.8, alpha=0.5)
        a.outline(pts, LW * 0.8, second=0.4, jit=0.4)
    for c, rx, ry, rot in SMALL_ISLANDS:
        e = ellipse(c, rx, ry, rot, n=8)
        a.fill_smooth(e, "sage", jit=0.2)
        a.outline(e, MW, second=0, jit=0.2)


def garden_bed(a, x, y, w, h, lay):
    """A low tilled soil bed (bedengan) drawn in the bottom third of the region (x, y, w, h), in viewport units: a lumpy
    soil patch with rows of furrow dashes and crumbs, a darker front lip, and a contour only along the back. Stage by
    stage, so the ten beds merge into a handful of paths."""
    bt = h / 3
    cx, cy = x + w / 2 + a.j(1), y + h - bt * 0.56 + a.j(0.4)
    rx, ry, fh = w * 0.44, bt * 0.34, bt * 0.15
    rot = a.j(1.5)
    top = []
    for i in range(16):
        t = TAU * i / 16
        c, s = math.cos(t), math.sin(t)
        q = (cx + rx * math.copysign(abs(c) ** 0.8, c), cy + ry * math.copysign(abs(s) ** 0.8, s))
        top.append(a.jit(rotp(q, rot, (cx, cy)), 0.5))
    lower = top[:9]  # right end -> front -> left end
    back = top[8:] + top[:1]  # left end -> back -> right end
    stage(a, lay, 0)
    a.fill_poly(lower + [add(p, (0, fh)) for p in reversed(lower)], "clay", 0.8, step=40)
    stage(a, lay, 1)
    a.fill_smooth(top, "clay", 0.5)
    stage(a, lay, 2)
    dashes = []
    for dy in (-0.3, 0.36):
        span = 0.76 - abs(dy) * 0.3
        u = -span + a.u(0, 0.12)
        while u < span - 0.15:
            v = min(span, u + a.u(0.22, 0.36))
            dashes.append((rotp((cx + rx * u, cy + ry * dy), rot, (cx, cy)), rotp((cx + rx * v, cy + ry * dy), rot, (cx, cy))))
            u = v + a.u(0.1, 0.18)
    a.lines(dashes, FW, alpha=0.65, amp=0.2)
    stage(a, lay, 3)
    a.stipple(top, 3, 1.8, alpha=0.6)
    stage(a, lay, 4)
    a.curve([lerp(back[0], back[1], a.u(0.3, 0.6))] + back[1:-1] + [lerp(back[-1], back[-2], a.u(0.2, 0.5))], FW * 1.4,
            jit=0.3)
    stage(a, lay, 5)
    lip = [add(p, (0, fh)) for p in lower[1:-1]]
    a.curve([lerp(lower[0], lip[0], a.u(0.3, 0.7))] + lip + [lerp(lower[-1], lip[-1], a.u(0.1, 0.4))], MW * 1.05, jit=0.3)


@art_key("scene_garden", 400, 300, 1.3)
def scene_garden(a):
    """Kebun Ilmu: a calm garden with ten empty soil beds. The app puts a sticker or plot_seed over each bed, centred in
    REGIONS["scene_garden"]; every bed sits in the bottom third of its region so the upper part stays free."""
    hy = 118  # horizon, where the fence stands
    # ground and a soft distant hill behind the fence (the sky is the app's paper)
    gnd = ([(0, hy + 3)] + [(x, hy + 2 + 2.5 * math.sin(x / 47 + 0.6)) for x in range(20, 401, 40)]
           + [(400, hy + 3), (400, 300), (0, 300)])
    a.fill_poly(gnd, "sage", 0.15, off=(0, 0), step=40)
    hill = [(170, hy + 1), (214, 104), (268, 93), (326, 90), (372, 96), (404, 103), (404, hy + 1)]
    a.fill_smooth(hill, "slate", 0.13, off=(0, 0))
    a.curve(hill[1:-1], FW, alpha=0.45)
    # sun and one cloud, top-left
    sc = (50 + a.j(2), 44)
    a.fill_smooth(ellipse(sc, 18, 18, n=12), "ochre", 0.9)
    a.ell_outline(sc, 18, 18, w=MW * 1.2, second=0.5)
    a.lines([(polar(sc, 24, t), polar(sc, 29, t)) for t in range(-20, 340, 52)], FW * 1.2, alpha=0.6, amp=0.2)
    bumps = ((100, 64, 8), (114, 55, 12), (130, 59, 9.5), (142, 64, 6))
    ctop = []
    for x in range(92, 149, 4):
        ys = [cy - math.sqrt(max(0.0, r * r - (x - cx) ** 2)) for cx, cy, r in bumps if abs(x - cx) < r]
        ctop.append((x, min(ys) if ys else 66))
    cloud = ctop + [(146, 67), (120, 69), (94, 67)]
    a.fill_smooth(cloud, "slate", 0.12, off=(0, 0))
    a.curve(ctop[1:-1], MW * 0.9, jit=0.3)
    a.line((98, 67), (140, 67.5), FW, alpha=0.6, amp=0.3)
    # low bamboo fence (pagar bambu): posts with slanted cuts; rails are a few bamboo lengths that overlap at posts
    xs = [16 + i * 46 + a.j(4) for i in range(9)]
    posts = []
    for x in xs:
        top = hy - 27 + a.j(3)
        wdt = 5.5 + a.j(0.6)
        posts.append([(x, top + 3), (x + wdt, top), (x + wdt + a.j(0.5), hy + 2), (x, hy + 2)])
    a.layer = 1
    for p in posts:
        a.fill_poly(p, "ochre", 0.6, step=40)
    a.layer = 2
    for p in posts:
        a.outline_poly(p, MW * 0.8, second=0, over=0.8, gap=1.2)
    rails, edges, soft, joints = [], [], [], []
    off = a.reg("ochre")
    for ry in (hy - 20, hy - 9):
        for i0, i1 in ((0, 3), (3, 6), (6, 8)):
            p0 = (xs[i0] - (7 + a.u(0, 4) if i0 == 0 else -1), ry + a.j(1.2))
            p1 = (xs[i1] + (11 + a.u(0, 4) if i1 == 8 else 6.5), ry + a.j(1.2))
            rails.append((add(p0, off), add(p1, off)))
            edges.append((add(p0, (0, -2.2)), add(p1, (0, -2.2))))
            soft.append((add(p0, (2, 2.4)), add(p1, (-2, 2.4))))
            for t in (0.3, 0.68):
                m = lerp(p0, p1, t + a.j(0.06))
                joints.append((add(m, (0, -2.4)), add(m, (0.4, 2.6))))
    a.layer = 3
    a.lines(rails, 4.2, "ochre", 0.8, amp=0.4)
    a.layer = 4
    a.lines(edges, FW * 1.1, amp=0.4)
    a.layer = 5
    a.lines(soft + joints, FW, alpha=0.5, amp=0.3)
    # ten beds, each in the bottom third of its region (the front row is larger because its regions are)
    for r in REGIONS["scene_garden"].values():
        garden_bed(a, r["x"] * a.vw, r["y"] * a.vh, r["w"] * a.vw, r["h"] * a.vh, lay=10)


# ============================================================================================= picture vocabulary
#
# INTERACTIONS_AUDIO §5: the pic_* pictures shared by every language track, plus four interaction glyphs. One object or
# one figure per picture, readable at 48 dp, loosely off-centre. People come from one posable figure (Fig / figure)
# built on the construction of draw_person: head-radius proportions, capsule limbs, the skin recipe, hair_cap and the
# family face (pic_face extends face() with expressions), so pic_* and fam_* people read as one family.


SKIN_TONES = {"light": (0.18, 0.15), "mid": (0.3, 0.26), "deep": (0.42, 0.4)}


def skin_parts(a, shapes, smooth=True):
    """The skin recipe of skin_many (opaque ochre plate + clay and slate tints, one plate at a time) with the picture's
    tone a.tone = light / mid / deep, so pic_* people show varied sawo matang skin. mid equals skin()."""
    c_al, s_al = SKIN_TONES[getattr(a, "tone", "mid")]
    f = a.fill_smooth if smooth else a.fill_poly
    off = a.reg("ochre")
    for color, alpha in (("ochre", 1.0), ("clay", c_al), ("slate", s_al)):
        for pts in shapes:
            f(pts, color, alpha, off=off)


def ik2(s, t, l1, l2, bend):
    """Two-bone reach from s towards t: returns (elbow or knee, end). bend = +1 / -1 picks the side the joint goes."""
    d = sub(t, s)
    L = min(max(vlen(d), abs(l1 - l2) + 0.01), (l1 + l2) * 0.999)
    u = unit(d)
    x = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    return add(add(s, mul(u, x)), mul(perp(u), h * bend)), add(s, mul(u, L))


def angle_of(p, q):
    return math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))


def fig_dims(kid):
    """Bone lengths in head radii, the proportions of draw_person: a child about six heads tall, an adult about eight."""
    if kid:
        return {"neck": 1.18, "torso": 1.55, "sw": 1.0, "ua": 0.98, "fa": 0.92, "th": 1.18, "sh": 1.1, "ar": 0.25,
                "hip": 0.42, "lr": 0.25}
    return {"neck": 1.18, "torso": 2.45, "sw": 1.24, "ua": 1.36, "fa": 1.3, "th": 1.75, "sh": 1.68, "ar": 0.27,
            "hip": 0.5, "lr": 0.25}


STAND = {"arms": ((101, 94), (79, 86)), "legs": ((94, 91), (86, 89))}

KERUDUNG = [(0, -1.22), (0.9, -0.95), (1.2, -0.2), (1.24, 0.6), (1.78, 1.6), (1.58, 2.25), (0.5, 2.55), (-0.6, 2.5),
            (-1.52, 2.2), (-1.74, 1.55), (-1.22, 0.55), (-1.18, -0.25), (-0.88, -0.98)]

# the open hand of sense_hand, wrist at the origin, fingers up (-y), thumb to -x
OPEN_HAND = [((x - 122) / 100, (y - 206) / 100) for x, y in (
    (96, 222), (88, 186), (82, 164), (66, 152), (52, 128), (58, 116), (72, 124), (88, 140), (90, 112), (88, 72),
    (93, 58), (103, 58), (108, 72), (110, 100), (112, 60), (117, 42), (127, 40), (131, 56), (131, 98), (135, 60),
    (141, 48), (151, 50), (153, 64), (150, 104), (158, 82), (166, 74), (174, 80), (170, 112), (164, 150), (152, 186),
    (148, 222))]


class Fig:
    """Joints of one posed figure, in viewport units. A limb is (upper, lower) screen angles (0 = right, 90 = down) or
    ("ik", target, bend) to reach a point. Placed by its feet on ground_y, or by hip= or head= (centre of the head)."""

    def __init__(self, cx, ground_y, r, kid, pose, facing, hip=None, head=None):
        D = self.D = fig_dims(kid)
        self.r, self.kid, self.facing = r, kid, facing
        self.lean, self.tilt = pose.get("lean", 0.0), pose.get("head", 0.0)
        self.narrow = 0.82 if facing else 1.0
        up, side = rotp((0, -1), self.lean), rotp((1, 0), self.lean)
        self.up, self.side = up, side
        nb = mul(up, D["torso"] * r)
        hc = add(nb, mul(rotp(up, self.tilt * 0.5), D["neck"] * r))
        sw = D["sw"] * r * self.narrow
        sh = [add(nb, add(mul(side, sx * sw * 0.9), mul(up, -0.32 * r))) for sx in (-1, 1)]
        hp = [mul(side, sx * D["hip"] * r * self.narrow) for sx in (-1, 1)]
        arms, legs = pose["arms"], pose["legs"]
        if hip is None and head is not None:
            hip = sub(head, hc)
        if hip is None:
            low = max(self.limb(h, spec, D["th"] * r, D["sh"] * r)[1][1] for h, spec in zip(hp, legs))
            hip = (cx, ground_y - low - r * 0.33)
        self.hip, self.nb, self.hc = hip, add(nb, hip), add(hc, hip)
        self.sh, self.hp = [add(p, hip) for p in sh], [add(p, hip) for p in hp]
        self.el, self.hd, self.kn, self.an = [], [], [], []
        for s, spec in zip(self.sh, arms):
            e, h = self.limb(s, spec, D["ua"] * r, D["fa"] * r)
            self.el.append(e)
            self.hd.append(h)
        for p, spec in zip(self.hp, legs):
            k, an = self.limb(p, spec, D["th"] * r, D["sh"] * r)
            self.kn.append(k)
            self.an.append(an)

    @staticmethod
    def limb(base, spec, l1, l2):
        if spec[0] == "ik":
            return ik2(base, spec[1], l1, l2, spec[2])
        j = add(base, mul(dirv(spec[0]), l1))
        return j, add(j, mul(dirv(spec[1]), l2))


def drop(a, c, s, color="slate", rot=0.0, w=None):
    """A small tear or sweat drop, point up."""
    T = Tf(c, s, rot)
    pts = T.pts([(0, -1.5), (0.5, -0.4), (0.66, 0.3), (0.34, 0.8), (-0.34, 0.8), (-0.66, 0.3), (-0.5, -0.4)])
    a.fill_smooth(pts, color, 0.95)
    a.outline(pts, w or FW * 1.3, second=0, jit=0.1)


def pic_face(a, hc, r, expr="smile", look=0.0, tilt=0.0, blush=True, old=False, glasses=False, moustache=False):
    """The family face (the marks of face(): dot eyes, small hooked nose, soft mouth, blush) with expressions. look
    turns it a little (-1 left .. 1 right); line weights grow with the head so close-ups still read at 48 dp."""
    T = Tf(hc, 1, tilt)
    fw = max(1.0, r / 25.0)
    ox, sp = look * r * 0.3, 1 - 0.2 * abs(look)
    el, er = (ox - r * 0.37 * sp, r * 0.02), (ox + r * 0.33 * sp, -r * 0.02)
    ew = max(3.6, r * 0.2)
    if expr in ("happy", "thanks", "sing"):
        for e in (el, er):
            arc_ = [(e[0] - r * 0.13, e[1] + r * 0.06), (e[0], e[1] - r * 0.08), (e[0] + r * 0.13, e[1] + r * 0.06)]
            a.curve(T.pts(arc_), MW * 1.1 * fw, jit=0.1)
    elif expr in ("sleep", "yawn", "drink"):
        for e in (el, er):
            arc_ = [(e[0] - r * 0.13, e[1] - r * 0.02), (e[0], e[1] + r * 0.07), (e[0] + r * 0.13, e[1] - r * 0.02)]
            a.curve(T.pts(arc_), MW * 1.1 * fw, jit=0.1)
    elif expr == "tired":
        a.dots(T.pts([(e[0], e[1] + r * 0.06) for e in (el, er)]), ew * 0.8)
        for e in (el, er):
            a.curve(T.pts([(e[0] - r * 0.16, e[1] + r * 0.0), (e[0], e[1] - r * 0.03), (e[0] + r * 0.16, e[1] + r * 0.01)]),
                    MW * 1.2 * fw, jit=0.1)
    else:
        lk = {"shy": (r * 0.08, r * 0.05), "hungry": (r * 0.02, -r * 0.07), "down": (0, r * 0.07)}.get(expr, (0, 0))
        a.dots(T.pts([add(e, lk) for e in (el, er)]), ew)
    if expr in ("sad", "cold", "hungry"):
        a.lines([(T((el[0] - r * 0.17, el[1] - r * 0.17)), T((el[0] + r * 0.1, el[1] - r * 0.29))),
                 (T((er[0] + r * 0.17, er[1] - r * 0.18)), T((er[0] - r * 0.1, er[1] - r * 0.3)))], MW * fw, amp=0.2)
    nx = ox * 1.15
    a.curve(T.pts([(nx + r * 0.02, r * 0.08), (nx - r * 0.06, r * 0.22), (nx + r * 0.05, r * 0.25)]), FW * 1.2 * fw,
            jit=0.1)
    mx = ox * 0.9
    if expr in ("happy", "grin"):
        m = T.pts([(mx - r * 0.27, r * 0.34), (mx, r * 0.36), (mx + r * 0.25, r * 0.32), (mx + r * 0.16, r * 0.5),
                   (mx, r * 0.57), (mx - r * 0.17, r * 0.51)])
        a.fill_smooth(m, "clay", 0.9, off=(0, 0))
        a.outline(m, MW * fw, second=0, jit=0.1)
    elif expr in ("sing", "yawn", "hot", "hungry", "eat"):
        rx, ry = {"sing": (0.11, 0.14), "yawn": (0.13, 0.2), "hot": (0.13, 0.1), "hungry": (0.1, 0.08),
                  "eat": (0.1, 0.1)}[expr]
        a.ell(T((mx, r * 0.46)), r * rx, r * ry, "clay", 0.9, rot=tilt, w=MW * fw, second=0)
        if expr == "hot":
            a.fill_smooth(T.pts(ellipse((mx + r * 0.02, r * 0.53), r * 0.07, r * 0.06, n=6)), "blush", 1.0, off=(0, 0))
    elif expr == "sad":
        a.curve(T.pts([(mx - r * 0.2, r * 0.53), (mx, r * 0.42), (mx + r * 0.2, r * 0.51)]), MW * 1.05 * fw, jit=0.1)
        drop(a, T((el[0] - r * 0.04, el[1] + r * 0.3)), r * 0.09, "slate", tilt)
    elif expr in ("tired", "down"):
        a.curve(T.pts([(mx - r * 0.15, r * 0.45), (mx, r * 0.42), (mx + r * 0.15, r * 0.46)]), MW * fw, jit=0.1)
    elif expr == "cold":
        a.zig(T.pts([(mx - r * 0.2, r * 0.45), (mx - r * 0.1, r * 0.4), (mx, r * 0.46), (mx + r * 0.1, r * 0.4),
                     (mx + r * 0.2, r * 0.45)]), MW * fw, jit=0.1)
    elif expr == "drink":
        pass
    else:
        sm = 1.25 if expr == "thanks" else 1.0
        a.curve(T.pts([(mx - r * 0.22, r * 0.38), (mx - r * 0.02, r * (0.42 + 0.12 * sm)), (mx + r * 0.2, r * 0.36)]),
                MW * 0.95 * fw, jit=0.12)
    if blush:
        big = 1.45 if expr in ("shy", "hot") else 1.0
        for bx in (ox - r * 0.58 * sp, ox + r * 0.55 * sp):
            a.fill_smooth(T.pts(ellipse((bx, r * 0.27), r * 0.17 * big, r * 0.1 * big, n=7)), "blush", 0.85)
    if old:
        a.lines([(T((el[0] - r * 0.3, el[1] - r * 0.05)), T((el[0] - r * 0.42, el[1] - r * 0.14))),
                 (T((er[0] + r * 0.3, er[1] - r * 0.05)), T((er[0] + r * 0.42, er[1] - r * 0.14)))], FW, alpha=0.8, amp=0.3)
    if glasses:
        for e in (el, er):
            a.ell(T(e), r * 0.23, r * 0.2, w=FW * 1.2 * fw, second=0)
        a.line(T((el[0] + r * 0.23, el[1])), T((er[0] - r * 0.23, er[1])), FW * 1.2 * fw, amp=0.2)
    if moustache:
        m = T.pts([(mx - r * 0.3, r * 0.33), (mx - r * 0.02, r * 0.25), (mx + r * 0.28, r * 0.3), (mx + r * 0.2, r * 0.4),
                   (mx, r * 0.35), (mx - r * 0.22, r * 0.42)])
        a.hair(m, 2.4)


def draw_head(a, hc, r, hair="short", expr="smile", look=0.0, tilt=0.0, ker_col="sage", old=False, glasses=False,
              moustache=False, blush=True, lite=False):
    """Ears, head, hair and face of the family. hair: short, bob, long, ponytail, bun, grey, peci, kerudung, none."""
    T = Tf(hc, 1, tilt)
    if hair == "kerudung":
        ker = T.pts([(x * r, y * r) for x, y in KERUDUNG])
        a.fill_smooth(ker, ker_col)
        a.hatch(clip_half(ker, T((r * 0.6, 0)), T.v((1, 0.2))), T.ang(70), max(4.6, r * 0.2) * (1.5 if lite else 1),
                alpha=0.4)
        a.outline(ker, LW, second=0.4)
        a.curve(T.pts([(-r * 1.0, r * 1.3), (-r * 0.4, r * 1.8), (r * 0.3, r * 1.9)]), FW * 1.2, alpha=0.7)
        fc = (look * r * 0.1, r * 0.1)
        fpts = T.pts(ellipse(fc, r * 0.8, r * 0.88, n=12))
        skin_parts(a, [fpts])
        a.outline(fpts, MW * 1.3, second=0)
        pic_face(a, T((fc[0], r * 0.12)), r * 0.92, expr, look, tilt, blush, old, glasses)
        return
    if hair == "long":
        a.hair(T.pts([(-r * 1.0, -r * 0.3), (-r * 1.1, r * 0.7), (-r * 1.18, r * 1.62), (-r * 0.5, r * 1.78),
                      (r * 0.5, r * 1.78), (r * 1.16, r * 1.6), (r * 1.1, r * 0.7), (r * 1.0, -r * 0.3),
                      (r * 0.7, -r * 0.92), (0, -r * 1.12), (-r * 0.7, -r * 0.92)]), max(3.0, r * 0.12))
    elif hair == "bob":
        a.hair(T.pts([(-r * 1.0, -r * 0.4), (-r * 1.12, r * 0.4), (-r * 1.1, r * 0.82), (-r * 0.7, r * 0.9),
                      (r * 0.7, r * 0.9), (r * 1.1, r * 0.8), (r * 1.12, r * 0.4), (r * 1.0, -r * 0.4),
                      (r * 0.7, -r * 0.95), (0, -r * 1.12), (-r * 0.7, -r * 0.95)]), max(3.0, r * 0.12))
    elif hair == "ponytail":
        tail = T.pts(ribbon([(r * 0.72, -r * 0.7), (r * 1.32, -r * 0.62), (r * 1.48, -r * 0.05), (r * 1.3, r * 0.55)],
                            r * 0.5, r * 0.18))
        a.hair(tail, max(3.0, r * 0.12))
    elif hair == "bun":
        a.hair(T.pts(ellipse((-r * 0.12, -r * 1.08), r * 0.42, r * 0.34, -8, n=10)), max(3.0, r * 0.12))
    if hair not in ("long",):
        if abs(look) > 0.4:
            sides = [(-1 if look > 0 else 1, look * r * 0.42)]
        else:
            sides = [(-1, 0.0), (1, 0.0)]
        ears = [T.pts(ellipse((sx * r * 0.94 + dx, r * 0.1), r * 0.17, r * 0.25, n=7)) for sx, dx in sides]
        skin_parts(a, ears)
        for e in ears:
            a.outline(e, MW * 1.1, second=0, jit=0.2)
    head = T.pts(ellipse((0, 0), r * 0.96, r, n=12 if lite else 14))
    skin_parts(a, [head])
    if hair in ("short", "bob", "long", "ponytail", "bun"):
        low = {"bob": 0.18, "long": 0.12, "ponytail": 0.06}.get(hair, 0.0)
        cap = [add(p, (-look * r * 0.12, 0)) for p in hair_cap(a, 0, 0, r, dark=False, low=low)]
        a.hair(T.pts(cap), max(3.0, r * 0.12) * (1.6 if lite else 1))
    elif hair == "grey":
        cap = T.pts(hair_cap(a, 0, 0, r, dark=False))
        a.fill_smooth(cap, "paper", off=(0, 0))
        a.hatch(cap, T.ang(60), 3.0, alpha=0.5)
        a.outline(cap, MW * 1.2, second=0)
    elif hair == "peci":
        peci = T.pts([(-r * 0.88, -r * 0.42), (r * 0.9, -r * 0.5), (r * 0.82, -r * 1.2), (-r * 0.8, -r * 1.12)])
        a.fill_poly(peci, "slate", off=(0, 0))
        a.hatch(peci, T.ang(62), 2.6, alpha=0.6, inset=(0.4, 1.2), skip=0.0)
        a.outline_poly(peci, MW * 1.2, second=0)
    if hair == "ponytail":
        a.dots([T((r * 0.86, -r * 0.7))], max(4.0, r * 0.2), "ochre")
    a.outline(head, LW, second=0.35)
    pic_face(a, hc, r, expr, look, tilt, blush, old, glasses, moustache)


def outline_cut(a, pts, w, cut=None, jit=0.3):
    """Outline a shape; on a bust (cut = y of the soft bottom edge) only the part above the cut is drawn, so no line runs
    along the edge or past the picture."""
    if cut is None:
        a.outline(pts, w, second=0, jit=jit)
        return
    up = [p[1] < cut - 1.5 for p in pts]
    if all(up):
        a.outline(pts, w, second=0, jit=jit)
        return
    n = len(pts)
    start = next(i for i in range(n) if up[i] and not up[i - 1])
    run = []
    for k in range(n):
        i = (start + k) % n
        if up[i]:
            run.append(pts[i])
        elif run:
            break
    if len(run) > 1:
        a.curve(run, w, jit=jit)


def draw_arm(a, s, e, h, r, ar, col, sleeve="short", hand="round", flip=False, clip=None, cut=None):
    """Upper arm and forearm as one bent ribbon (two capsules at a sharp bend), a short sleeve over the upper part, then
    the hand. r: head radius (sets the hand size); ar: arm radius."""
    clip = clip or (lambda p: p)
    fa = angle_of(e, h)
    bend = abs((angle_of(s, e) - fa + 180) % 360 - 180)
    end = h if hand in ("none", "open") else lerp(e, h, 0.86)

    def limb(p0, p1, p2, w0, w1):
        if bend < 100:
            parts = [ribbon([p0, p1, p2], w0, w1)]
        else:
            parts = [capsule(p0, p1, w0 / 2, n=4), capsule(p1, p2, w0 / 2, w1 / 2, n=4)]
        return [q for q in (clip(p) for p in parts) if len(q) > 2]

    if sleeve == "long":
        for part in limb(s, e, end, ar * 2, ar * 1.8):
            a.fill_smooth(part, col)
            outline_cut(a, part, MW * 1.4, cut)
    else:
        parts = limb(s if sleeve == "none" else lerp(s, e, 0.3), e, end, ar * 1.65, ar * 1.5)
        skin_parts(a, parts)
        for part in parts:
            outline_cut(a, part, MW * 1.3, cut)
        slv = clip(capsule(s, lerp(s, e, 0.5), ar * 1.18)) if sleeve != "none" else []
        if len(slv) > 2:
            a.fill_smooth(slv, col)
            outline_cut(a, slv, MW * 1.4, cut)
    if hand == "round":
        hp = clip(ellipse(h, r * 0.23, r * 0.25, n=8))
        if len(hp) > 2:
            skin_parts(a, [hp])
            outline_cut(a, hp, MW * 1.2, cut, jit=0.2)
    elif hand == "open":
        hp = Tf(lerp(e, h, 0.93), r * 0.36, fa + 90, flip).pts(OPEN_HAND)
        skin_parts(a, [hp])
        a.curve(hp, MW * 1.2, jit=0.2)
    elif hand == "point":
        fist = ellipse(h, r * 0.2, r * 0.21, n=8)
        finger = capsule(h, add(h, mul(dirv(fa), r * 0.42)), r * 0.075, n=3)
        skin_parts(a, [fist, finger])
        a.outline(fist, MW * 1.2, second=0, jit=0.2)
        a.outline(finger, MW, second=0, jit=0.1)


def figure(a, cx=120, ground_y=222, r=24.0, kid=False, pose=None, facing=0, look=None, top="tshirt", top_col="sage",
           sleeve="short", bottom="trousers", bottom_col="slate", hair="short", ker_col="sage", expr="smile",
           shoes="clay", extras=None, hands=("round", "round"), hip=None, head=None, ground_line=True, cut=None,
           mid=None, old=False, lite=False, tone="mid"):
    """One posed person in the family hand. pose: {"lean", "head" (tilt), "arms", "legs", "behind"}; arms and legs are
    (viewer's left, viewer's right); "behind" names limbs drawn behind the body ("arm0", "leg1", ...). facing = 1 / -1
    turns the body three-quarter right / left. cut = y of a bust's soft bottom edge (legs skipped). mid(F) draws props
    held in front of the body, under the hands. extras: {"stripe": col, "collar": col, "placket", "buttons", "batik",
    "coat", "apron": col, "glasses", "moustache"}. Returns the Fig (joint positions)."""
    pose = dict(STAND, **(pose or {}))
    ex = extras or {}
    a.tone = tone
    F = Fig(cx, ground_y, r, kid, pose, facing, hip, head)
    D = F.D
    look = facing if look is None else look
    behind = set(pose.get("behind", ()))
    cutter = None if cut is None else ellipse((F.hip[0], cut - 900), 980, 900, n=72)

    def clip(p):
        return p if cutter is None else clip_convex(p, cutter)

    if ground_line and cut is None:
        ground(a, F.hip[0] - 50, F.hip[0] + 52, ground_y + 3, marks=3)
    lr, ar = D["lr"] * r, D["ar"] * r
    legs_on = cut is None

    hidden_legs = bottom in ("skirt", "sarung") or top == "dress_long"

    def leg(i, skin_done=False):
        p, k, an = F.hp[i], F.kn[i], F.an[i]
        if bottom == "trousers":
            a.blob(ribbon([p, k, an], lr * 2.5, lr * 2.2), bottom_col, w=MW * 1.5, second=0)
        elif not hidden_legs:
            sk = ribbon([p, k, an], lr * 1.9, lr * 1.6)
            if not skin_done:
                skin_parts(a, [sk])
            a.outline(sk, MW * 1.2, second=0, jit=0.3)
            if bottom == "shorts":
                a.blob(capsule(p, lerp(p, k, 0.78), lr * 1.5, lr * 1.4), bottom_col, w=MW * 1.4, second=0)
        ang = angle_of(k, an) - 90
        if facing:
            c, rx, ry = add(an, rotp((facing * r * 0.2, r * 0.12), ang)), r * 0.42, r * 0.19
        else:
            c, rx, ry = add(an, ((2 * i - 1) * r * 0.06, r * 0.13)), r * 0.36, r * 0.21
            ang += (2 * i - 1) * 4
        if shoes:
            a.ell(c, rx, ry, shoes, rot=ang, w=MW * 1.3, second=0)
        else:
            fp = ellipse(c, rx * 0.95, ry * 0.9, ang, n=8)
            skin_parts(a, [fp])
            a.outline(fp, MW * 1.2, second=0, jit=0.2)

    def arm(i):
        draw_arm(a, F.sh[i], F.el[i], F.hd[i], r, ar, top_col, sleeve, hands[i], flip=(i == 0), clip=clip, cut=cut)

    T = Tf(F.nb, 1, F.lean)
    tl, sw = D["torso"] * r, D["sw"] * r * F.narrow
    hem = {"dress": tl + D["th"] * r * 0.95, "dress_long": tl + (D["th"] + D["sh"]) * r * 0.95,
           "coat": tl + r * 1.1}.get(top, tl + r * 0.22)
    if cut is not None:
        hem = max(hem, cut + 30 - F.nb[1])
    flare = {"dress": 1.32, "dress_long": 1.3, "coat": 1.1}.get(top, 0.98)
    tor = clip(T.pts([(-0.3 * r, -0.1 * r), (-sw * 0.72, -0.02 * r), (-sw, 0.26 * r), (-sw * flare, hem), (sw * flare, hem),
                      (sw, 0.24 * r), (sw * 0.72, -0.03 * r), (0.3 * r, -0.1 * r)]))
    # behind the body
    for i in (0, 1):
        if legs_on and f"leg{i}" in behind:
            leg(i)
    for i in (0, 1):
        if f"arm{i}" in behind:
            arm(i)
    if legs_on:
        if bottom in ("trousers", "shorts"):
            q0, q1 = add(F.hp[0], mul(F.side, -lr * 1.3)), add(F.hp[1], mul(F.side, lr * 1.3))
            blk = [add(q0, mul(F.up, r * 0.2)), add(q1, mul(F.up, r * 0.2)), add(q1, mul(F.up, -r * 0.45)),
                   add(lerp(q0, q1, 0.5), mul(F.up, -r * 0.6)), add(q0, mul(F.up, -r * 0.45))]
            a.blob(blk, bottom_col, w=MW * 1.4, second=0)
        front = [i for i in (0, 1) if f"leg{i}" not in behind]
        batch = bottom not in ("trousers",) and not hidden_legs and len(front) == 2
        if batch:
            skin_parts(a, [ribbon([F.hp[i], F.kn[i], F.an[i]], lr * 1.9, lr * 1.6) for i in front])
        for i in front:
            leg(i, skin_done=batch)
        if bottom in ("skirt", "skirt_knee", "sarung"):
            top_y = F.hip[1] - r * 0.15
            if bottom == "skirt_knee":
                hem_y = (F.kn[0][1] + F.kn[1][1]) / 2 + r * 0.3
            else:
                hem_y = max(p[1] for p in F.an) - r * 0.1
            xs = [p[0] for p in F.an]
            half = D["hip"] * r * F.narrow + lr * 1.5
            x0, x1 = min(xs) - lr * 2.0, max(xs) + lr * 2.0
            sk = [(F.hip[0] - half, top_y), (F.hip[0] + half, top_y), (x1, hem_y), (x0, hem_y)]
            a.fill_poly(sk, bottom_col)
            if bottom == "sarung":
                a.hatch(sk, 0, 8, w=MW, alpha=0.3)
                a.hatch(sk, 90, 8, w=MW, alpha=0.3)
            else:
                a.hatch(clip_half(sk, ((x0 + x1) / 2 + (x1 - x0) * 0.18, 0), (1, 0)), 75, 4.6, alpha=0.4)
                fold = ((F.hip[0] - half * 0.3, top_y + r * 0.6), (x0 + (x1 - x0) * 0.3, hem_y - r * 0.2))
                a.lines([fold], FW, alpha=0.6)
            a.outline_poly(sk, LW, second=0.4)
    # neck, body
    nd = unit(sub(F.hc, F.nb))
    ns = perp(nd)
    neck = [add(F.nb, add(mul(ns, r * 0.24), mul(nd, -r * 0.1))), add(F.nb, add(mul(ns, -r * 0.24), mul(nd, -r * 0.1))),
            add(F.hc, add(mul(ns, -r * 0.24), mul(nd, -r * 0.6))), add(F.hc, add(mul(ns, r * 0.24), mul(nd, -r * 0.6)))]
    skin_parts(a, [neck], smooth=False)
    if tor:
        a.fill_poly(tor, top_col)
        if top == "coat":
            shirt = T.pts([(-r * 0.36, -r * 0.08), (r * 0.36, -r * 0.08), (0, r * 1.25)])
            a.fill_poly(shirt, ex.get("coat_shirt", "slate"), 0.9)
            a.hatch(clip(T.pts([(sw * 0.45, r * 0.1), (sw * flare, r * 0.3), (sw * flare, hem), (sw * 0.5, hem)])),
                    T.ang(72), 4.2, color="slate", alpha=0.35)
            a.lines([(T((-r * 0.36, -r * 0.08)), T((0, r * 1.25))), (T((r * 0.36, -r * 0.08)), T((0, r * 1.25))),
                     (T((0, r * 1.25)), T((r * 0.05, hem - r * 0.1)))], MW, amp=0.3)
            for px in (-1, 1):
                pk = clip(T.pts(rect(px * sw * 0.58 - r * 0.3, tl - r * 0.15, r * 0.6, r * 0.45)))
                if len(pk) > 2:
                    a.outline_poly(pk, FW * 1.3, second=0)
            bp = T((-sw * 0.5, r * 0.75))
            a.lines([(add(bp, (-r * 0.17, 0)), add(bp, (r * 0.17, 0))), (add(bp, (0, -r * 0.17)), add(bp, (0, r * 0.17)))],
                    r * 0.11, "sage", amp=0.1)
        if "apron" in ex:
            ap = clip(T.pts([(-sw * 0.55, r * 0.55), (sw * 0.55, r * 0.5), (sw * 0.78, hem), (-sw * 0.78, hem)]))
            if len(ap) > 2:
                a.fill_poly(ap, ex["apron"], 0.95)
                a.outline_poly(ap, MW * 1.2, second=0)
                a.lines([(T((-sw * 0.5, r * 0.55)), T((-r * 0.25, -r * 0.08))),
                         (T((sw * 0.5, r * 0.5)), T((r * 0.25, -r * 0.08)))], MW, amp=0.2)
        if "stripe" in ex:
            y0 = tl * (0.5 if kid else 0.42)
            band = clip_half(clip_half(tor, T((0, y0)), T.v((0, 1))), T((0, y0 + r * 0.32)), T.v((0, -1)))
            if len(band) > 2:
                a.fill_poly(band, ex["stripe"], 0.95)
        if "batik" in ex:
            x0, y0, x1, y1 = bbox(tor)
            pts, yy, row = [], y0 + 7, 0
            while yy < y1 - 3:
                xx = x0 + 6 + (row % 2) * 6
                while xx < x1 - 3:
                    if inside((xx, yy), tor):
                        pts += [(xx - 2.4, yy), (xx + 2.4, yy), (xx, yy - 2.4), (xx, yy + 2.4)]
                    xx += 12
                yy += 10
                row += 1
            a.dots(pts, 2.2, ex["batik"], 0.9)
        if "collar" in ex:
            for sx in (-1, 1):
                col = T.pts([(0, r * 0.3), (sx * r * 0.5, -r * 0.12), (sx * r * 0.62, r * 0.26)])
                a.block(col, ex["collar"], w=MW, second=0)
        if "placket" in ex:
            a.line(T((1, 0)), T((2, min(hem, tl + r * 0.2) - 2)), FW * 1.3)
            a.dots([T((5, r * (0.4 + 0.45 * k))) for k in range(3)], 2.8, "paper")
        if "buttons" in ex:
            a.dots([T((0, r * (0.35 + 0.42 * k))) for k in range(4)], max(2.8, r * 0.13), "paper")
        if cut is None:
            a.outline_poly(tor, LW, second=0 if lite else 0.45)
        else:
            outline_cut(a, tor, LW, cut, jit=0.4)
    under = [i for i in (0, 1) if f"arm{i}" not in behind and hair == "kerudung" and pose["arms"][i][0] != "ik"
             and 45 < pose["arms"][i][0] < 135]
    for i in under:
        arm(i)
    draw_head(a, F.hc, r, hair, expr, look, F.tilt, ker_col, old, "glasses" in ex, "moustache" in ex, lite=lite)
    if mid:
        mid(F)
    for i in (0, 1):
        if f"arm{i}" not in behind and i not in under:
            arm(i)
    return F


def motion_arcs(a, c, r, a0, a1, n=2, gap=0.42, w=None, color="ink", alpha=0.9):
    """Small drawn motion marks (as aya_wave): n short concentric arcs."""
    for k in range(n):
        a.arc(c, r * (1 + gap * k), a0, a1, w or FW * 1.4, color, alpha)


def curved_arrow(a, c, r, a0, a1, w=None, head=7.0, color="ink"):
    """A short drawn arc from angle a0 to a1 around c, with an open arrowhead at a1."""
    w = w or MW * 1.3
    a.arc(c, r, a0, a1, w, color)
    end = polar(c, r, a1)
    d = dirv(a1 + (90 if a1 > a0 else -90))
    a.zig([add(end, mul(rotp(d, 150), head)), end, add(end, mul(rotp(d, -150), head))], w, color, jit=0.2)


def note_mark(a, c, s=1.0, color="ink"):
    """A drawn eighth note (a musical sign, not a letter): filled head, stem and a small flag."""
    head = ellipse(c, 6.5 * s, 4.8 * s, -24, n=8)
    a.fill_smooth(head, color, 0.95, off=(0, 0))
    top = add(c, (5.6 * s, -26 * s))
    a.line(add(c, (5.6 * s, -1.5 * s)), top, MW * 1.2, color, amp=0.3)
    a.curve([top, add(top, (7 * s, 6 * s)), add(top, (8 * s, 14 * s))], MW * 1.2, color, jit=0.2)


# --------------------------------------------------------------------------------------------- pic: people & greetings


@art_key("pic_boy")
def pic_boy(a):
    figure(a, 114 + a.j(3), 226, 30, kid=True, top_col="clay", bottom="shorts", bottom_col="slate", shoes="ochre",
           extras={"stripe": "paper"}, pose={"arms": ((104, 97), (77, 83))}, tone="deep")


@art_key("pic_girl")
def pic_girl(a):
    figure(a, 124 + a.j(3), 226, 29, kid=True, top="dress", top_col="sage", bottom="none", hair="ponytail",
           extras={"collar": "paper"}, pose={"arms": ((103, 92), (76, 88))}, tone="mid")


@art_key("pic_man")
def pic_man(a):
    figure(a, 116 + a.j(3), 226, 24.5, top="shirt", top_col="slate", bottom="trousers", bottom_col="ochre", shoes="clay",
           extras={"collar": "slate", "placket": True}, tone="mid")


@art_key("pic_woman")
def pic_woman(a):
    figure(a, 122 + a.j(3), 226, 24.5, top="blouse", top_col="ochre", sleeve="long", bottom="skirt", bottom_col="clay",
           hair="bun", shoes="slate", extras={"buttons": True}, pose={"arms": ((99, 92), (80, 88))}, tone="light")


def interleave(a, n0, n1, n2):
    """Two figures that do not overlap (items n0:n1 and n1:n2): align their mark sequences by style and give each matched
    pair one draw layer, so same-style marks sit side by side and merge into one path. Keeps a two-person picture near
    the ~25 KB budget; each figure keeps its own drawing order."""
    import difflib

    st = [it[1:5] for it in a.items]
    sm = difflib.SequenceMatcher(None, st[n0:n1], st[n1:n2], autojunk=False)
    lay, out = 1, {}
    for op, i0, i1, j0, j1 in sm.get_opcodes():
        if op == "equal":
            for k in range(i1 - i0):
                out[n0 + i0 + k] = out[n1 + j0 + k] = lay
                lay += 1
        else:
            for i in range(i0, i1):
                out[n0 + i] = lay
                lay += 1
            for j in range(j0, j1):
                out[n1 + j] = lay
                lay += 1
    for i, l_ in out.items():
        a.items[i] = (l_,) + a.items[i][1:]


@art_key("pic_friends")
def pic_friends(a):
    ground(a, 22, 218, 228, marks=5)
    n0 = len(a.items)
    figure(a, 72, 226, 25.5, kid=True, top_col="ochre", bottom="trousers", bottom_col="slate", ground_line=False,
           expr="grin", pose={"arms": ((106, 98), (55, 57))}, lite=True, tone="light")
    n1 = len(a.items)
    figure(a, 170, 226, 25.5, kid=True, top="dress_long", top_col="sage", bottom="none", hair="kerudung", ker_col="clay",
           shoes="slate", ground_line=False, look=-0.2, pose={"arms": ((125, 123), (78, 84))}, lite=True, tone="deep")
    interleave(a, n0, n1, len(a.items))


@art_key("pic_teacher")
def pic_teacher(a):
    # a small chalkboard on an easel; chalk marks are shapes and squiggles, never letters
    for p0, p1 in (((168, 120), (156, 224)), ((214, 120), (226, 224)), ((192, 112), (194, 222))):
        a.blob(capsule(p0, p1, 3.2), "ochre", w=MW, second=0)
    board = [(146, 50), (232, 46), (234, 132), (148, 136)]
    a.fill_poly(board, "slate", 0.95)
    a.outline_poly(board, LW, second=0.4)
    a.outline_poly([(152, 56), (227, 53), (228, 126), (154, 129)], MW, "ochre", second=0)
    a.outline_poly([(168, 104), (184, 74), (200, 106)], MW * 1.2, "paper", second=0)
    a.curve([(172, 118), (182, 114), (192, 119), (204, 113), (216, 117)], FW * 1.5, "paper", 0.9)
    a.ell((211, 80), 9, 9, w=MW * 1.1, second=0)

    def book(F):
        T = Tf(add(F.nb, (-2, 30)), 1, -8)
        cover = T.pts(rect(-17, -14, 30, 40))
        a.block(cover, "ochre", w=MW * 1.3, second=0)
        a.line(T((-12, -14)), T((-12, 26)), MW, amp=0.2)

    figure(a, 86, 224, 21.5, top="blouse", top_col="sage", sleeve="long", bottom="skirt", bottom_col="slate",
           hair="kerudung", ker_col="clay", shoes="clay", facing=1, look=0.35, mid=book,
           pose={"arms": (("ik", (90, 118), 1), (-8, -26))}, hands=("round", "point"), tone="mid")


@art_key("pic_doctor")
def pic_doctor(a):
    def stetho(F):
        n0, n1 = add(F.nb, (-15, 2)), add(F.nb, (15, 2))
        a.curve([n0, add(F.nb, (-19, 24)), add(F.nb, (-11, 47)), add(F.nb, (0, 56))], MW * 1.6, "slate")
        a.curve([n1, add(F.nb, (18, 22)), add(F.nb, (13, 41)), add(F.nb, (3, 56))], MW * 1.6, "slate")
        a.curve([add(F.nb, (1, 56)), add(F.nb, (4, 68)), add(F.nb, (17, 75))], MW * 1.6, "slate")
        a.ell(add(F.nb, (20, 77)), 7, 7, "ochre", w=MW * 1.2, second=0)

    figure(a, 118 + a.j(3), 226, 24.5, top="coat", top_col="paper", sleeve="long", bottom="trousers", bottom_col="slate",
           shoes="slate", extras={"coat": True, "glasses": True}, mid=stetho, pose={"arms": ((102, 95), (78, 84))},
           tone="light")


@art_key("pic_wave_hello")
def pic_wave_hello(a):
    F = figure(a, r=44, kid=True, head=(100 + a.j(2), 104), cut=236, top_col="clay", hair="bob", expr="grin",
               pose={"arms": ((101, 94), (-50, -94))}, hands=("round", "open"), tone="deep")
    motion_arcs(a, add(F.hd[1], (2, -6)), 30, -62, -6, w=MW * 1.3)
    motion_arcs(a, add(F.hd[1], (-2, -6)), 30, -174, -122, w=MW * 1.3)


@art_key("pic_wave_bye")
def pic_wave_bye(a):
    F = figure(a, 150, 222, 27, kid=True, facing=1, look=-0.75, top_col="sage", bottom="shorts", bottom_col="slate",
               shoes="clay", ground_line=False,
               pose={"lean": 4, "head": -6, "arms": ((-118, -96), (66, 52)), "legs": ((110, 98), (72, 86)),
                     "behind": ("arm1", "leg0")}, hands=("open", "round"), tone="mid")
    ground(a, 100, 214, 225, marks=3)
    motion_arcs(a, add(F.hd[0], (2, -6)), 26, -156, -104, w=MW * 1.2)
    a.dots([(x, 224 + a.j(1)) for x in (28, 44, 60, 76)], 4.2, "ink", 0.55)


@art_key("pic_thanks")
def pic_thanks(a):
    cx = 118 + a.j(2)
    figure(a, r=44, kid=True, head=(cx, 102), cut=236, top_col="ochre", expr="thanks", hair="short",
           pose={"head": 7, "arms": (("ik", (cx - 9, 204), 1), ("ik", (cx + 9, 204), -1))}, hands=("none", "none"),
           tone="light")
    x, yb, yt = cx + 1, 210, 158
    for sx in (-1, 1):
        palm = [(x, yb), (x + sx * 13, yb - 2), (x + sx * 16, yb - 22), (x + sx * 13, yt + 16), (x + sx * 7, yt + 3),
                (x, yt)]
        skin_parts(a, [palm])
    pair = [(x - 13, yb), (x - 16, yb - 22), (x - 13, yt + 16), (x - 7, yt + 3), (x, yt), (x + 7, yt + 3),
            (x + 13, yt + 16), (x + 16, yb - 22), (x + 13, yb)]
    a.curve(pair, LW * 0.95, jit=0.3)
    a.curve([(x, yt + 2), (x + 0.5, yt + 26), (x, yb - 4)], MW * 1.1, jit=0.2)
    for sx in (-1, 1):
        a.curve([(x + sx * 4, yb - 14), (x + sx * 10, yb - 20), (x + sx * 14, yb - 15)], MW, jit=0.2)
        a.lines([((x + sx * 6, yt + 9), (x + sx * 9, yt + 15))], FW * 1.2, alpha=0.7)


@art_key("pic_sorry")
def pic_sorry(a):
    cx = 110 + a.j(2)
    F = figure(a, r=44, kid=True, head=(cx, 108), cut=236, top_col="slate", expr="shy",
               pose={"head": -8, "arms": ((101, 94), ("ik", (cx + 30, 70), -1))}, tone="mid")
    drop(a, add(F.hc, (-54, -26)), 7.5, "slate", -20)


@art_key("pic_yes_nod")
def pic_yes_nod(a):
    F = figure(a, r=46, kid=True, head=(118 + a.j(2), 112), cut=236, top_col="sage", expr="happy", hair="short",
               pose={"head": 3}, tone="deep")
    piv = add(F.hc, (0, 38))
    curved_arrow(a, piv, 80, -60, -32, w=MW * 1.5, head=9)
    curved_arrow(a, piv, 80, -120, -148, w=MW * 1.5, head=9)


# --------------------------------------------------------------------------------------------- pic: actions


@art_key("pic_eat")
def pic_eat(a):
    cx = 112 + a.j(2)

    def props(F):
        bc = (72, 204)
        a.fill_smooth(ellipse(bc, 40, 9, n=12), "slate", 0.5)
        heap = [(36, 204), (46, 186), (64, 176), (84, 178), (102, 188), (108, 204)]
        a.fill_smooth(heap, "paper", off=(0, 0))
        a.stipple(heap, 14, 1.8, alpha=0.5)
        a.curve(heap[:-1], MW * 1.2, jit=0.3)
        body = ellipse(bc, 42, 9, n=12, a0=0, sweep=180) + ellipse(bc, 42, 36, n=10, a0=180, sweep=-180)
        a.fill_smooth(body, "clay")
        a.hatch(clip_half(body, (bc[0] + 14, 0), (1, 0)), 70, 4.2, alpha=0.45)
        a.outline(body, LW, second=0)
        a.zig([(38, 214), (48, 222), (58, 214), (68, 222), (78, 214), (88, 222), (98, 214), (106, 220)], FW * 1.4,
              "paper", 0.85)
        mouth = add(F.hc, (2, 21))
        a.blob(capsule(add(mouth, (8, 10)), add(mouth, (34, 52)), 2.6), "slate", w=MW, second=0)
        sp = ellipse(add(mouth, (2, 4)), 10, 6.5, 32, n=9)
        a.fill_smooth(sp, "slate", 0.9)
        a.outline(sp, MW * 1.2, second=0, jit=0.2)
        a.fill_smooth(ellipse(add(mouth, (0, 1)), 6, 4, 20, n=7), "paper", off=(0, 0))

    figure(a, r=42, kid=True, head=(cx, 98), cut=236, top_col="sage", expr="eat", mid=props,
           extras={"stripe": "ochre"}, pose={"arms": (("ik", (64, 214), 1), ("ik", (cx + 32, 150), -1))}, tone="mid")


@art_key("pic_drink")
def pic_drink(a):
    def glass(F):
        H = Tf(F.hc, 1, F.tilt)
        T = Tf(H((6, 16)), 1.2, -46)
        g = T.pts([(-16, 0), (16, 0), (13, 58), (-13, 58)])
        water = T.pts([(-15.4, 12), (15.4, 12), (13, 57), (-12.6, 57)])
        a.fill_poly(g, "paper", 0.9, off=(0, 0))
        a.fill_poly(water, "slate", 0.65)
        a.hatch(water, T.ang(-50), 6, alpha=0.3)
        a.curve([T((-15, 12)), T((0, 10)), T((15, 13))], MW * 1.2, "ink", 0.8)
        a.outline_poly(g, LW, second=0)
        a.ell(T((0, 0)), 16 * 1.2, 4.5 * 1.2, w=MW, rot=-46, second=0)
        a.line(T((-9, 6)), T((-7, 48)), MW * 1.2, "paper", 0.9)

    figure(a, r=42, kid=True, head=(98 + a.j(2), 108), cut=236, top_col="ochre", expr="drink", hair="short", mid=glass,
           pose={"head": -14, "arms": ((101, 94), ("ik", (152, 160), -1))}, tone="light")


@art_key("pic_sleep")
def pic_sleep(a):
    mat = [(18, 166), (222, 162), (226, 194), (16, 198)]
    a.block(mat, "ochre", 0.9, second=0.4)
    a.hatch(mat, 0, 6, alpha=0.35)
    pillow = [(22, 146), (92, 140), (98, 166), (24, 170)]
    a.blob(pillow, "paper", w=MW * 1.5, second=0)
    a.curve([(30, 152), (60, 150), (86, 148)], FW, alpha=0.5)
    a.tone = "mid"
    draw_head(a, (64 + a.j(2), 132), 30, "short", "sleep", 0.0, -74)
    blanket = [(80, 168), (96, 136), (140, 120), (186, 124), (214, 140), (222, 168), (150, 172)]
    a.fill_smooth(blanket, "sage", 0.95)
    a.hatch(blanket, 80, 9, w=MW, color="paper", alpha=0.35)
    a.outline(blanket, LW, second=0.4)
    a.curve([(98, 150), (130, 140), (170, 142)], MW, alpha=0.6)
    hand = ellipse((110, 142), 8, 7, n=8)
    skin_parts(a, [hand])
    a.outline(hand, MW * 1.2, second=0, jit=0.2)
    for zx, zy, zs in ((112, 82, 15), (140, 54, 11), (162, 34, 8)):
        a.zig([(zx, zy), (zx + zs, zy - 0.5), (zx + 0.5, zy + zs), (zx + zs + 1, zy + zs)], MW * 1.3, jit=0.3)


@art_key("pic_read")
def pic_read(a):
    cx = 118 + a.j(2)

    def book(F):
        draw_open_book(a, Tf((cx + 2, 206), 0.52, -3))

    figure(a, r=42, kid=True, head=(cx, 96), cut=236, top_col="clay", hair="kerudung", ker_col="sage", expr="down",
           mid=book,
           pose={"head": 5, "arms": (("ik", (cx - 54, 210), 1), ("ik", (cx + 56, 206), -1))}, tone="deep")


@art_key("pic_write")
def pic_write(a):
    def desk(F):
        top = [(0, 190), (240, 184), (240, 240), (0, 240)]
        a.fill_poly(top, "ochre", 0.9, off=(0, 0))
        a.hatch(top, 4, 7, alpha=0.3)
        a.line((1, 190), (239, 184), LW)
        T = Tf((142, 208), 1, -8)
        book = T.pts(rect(-46, -16, 92, 34))
        a.fill_poly(book, "paper", off=(0, 0))
        a.outline_poly(book, MW * 1.3, second=0)
        a.line(T((0, -16)), T((0, 18)), FW * 1.3)
        for k in range(3):
            a.curve(T.pts([(-40 + i * 7, -6 + k * 9 + 1.6 * math.sin(i * 1.7 + k)) for i in range(5)]), FW * 1.2, alpha=0.6)

    F = figure(a, r=40, kid=True, head=(96 + a.j(2), 100), cut=236, top_col="slate", expr="down", hair="short", mid=desk,
               pose={"head": 12, "lean": 6, "arms": (("ik", (70, 200), 1), ("ik", (164, 200), -1))}, tone="light")
    h = F.hd[1]
    a.blob(capsule(add(h, (-8, 8)), add(h, (12, -34)), 3.2, 2.6), "clay", w=MW, second=0)
    a.fill_poly([add(h, (-11, 12)), add(h, (-5, 9)), add(h, (-12, 20))], "ink", 0.9, off=(0, 0))
    a.curve([(154, 214), (160, 210), (166, 215), (172, 209)], FW * 1.4, alpha=0.8)


@art_key("pic_walk")
def pic_walk(a):
    figure(a, 118 + a.j(3), 224, 29, kid=True, facing=1, top_col="ochre", bottom="shorts", bottom_col="sage",
           shoes="clay", pose={"lean": 4, "arms": ((116, 102), (58, 40)), "legs": ((62, 80), (118, 102)),
                               "behind": ("arm0", "leg0")}, tone="mid")


@art_key("pic_run")
def pic_run(a):
    figure(a, 132 + a.j(2), 216, 28, kid=True, facing=1, top_col="clay", bottom="shorts", bottom_col="slate",
           shoes="ochre", expr="grin", ground_line=False,
           pose={"lean": 15, "arms": ((44, -36), (136, 76)), "legs": ((126, 168), (26, 98)),
                 "behind": ("arm0", "leg0")}, tone="deep")
    ground(a, 74, 204, 224, marks=3)
    a.lines([((14, 92), (48, 92)), ((6, 114), (44, 114)), ((18, 136), (46, 136))], MW * 1.2, alpha=0.7)


@art_key("pic_play")
def pic_play(a):
    F = figure(a, 90 + a.j(2), 222, 28, kid=True, facing=1, top_col="sage", bottom="shorts", bottom_col="clay",
               shoes="slate", expr="grin", ground_line=False,
               pose={"lean": -6, "arms": ((-160, -130), (30, 10)), "legs": ((96, 92), (40, 12)), "behind": ("arm0",)},
               tone="light")
    ground(a, 34, 222, 226, marks=4)
    bc = add(F.an[1], (32, -8))
    round_ball(a, bc, 19, "ochre")
    a.curve([polar(bc, 10, 200), polar(bc, 10, 250), polar(bc, 10, 300)], 2.4, "paper", 0.9, jit=0.1)
    motion_arcs(a, bc, 27, -30, 30, w=MW * 1.2)


@art_key("pic_sing")
def pic_sing(a):
    figure(a, r=44, kid=True, head=(100 + a.j(2), 108), cut=236, top_col="ochre", hair="ponytail", expr="sing",
               pose={"head": -8, "arms": ((101, 94), ("ik", (112, 206), -1))}, tone="mid")
    note_mark(a, (168, 96), 1.15)
    note_mark(a, (196, 64), 0.95, "clay")
    note_mark(a, (178, 140), 0.8)


@art_key("pic_cook")
def pic_cook(a):
    wc = (136, 200)

    def stove(F):
        st = [(48, 216), (222, 210), (224, 240), (46, 240)]
        a.block(st, "slate", 0.9, second=0)
        a.lines([((66, 230), (82, 230)), ((184, 228), (200, 228))], MW, "paper", 0.7)
        a.blob(capsule((70, 196), (34, 186), 4.2, 3.6), "ochre", w=MW, second=0)
        wok = ellipse(wc, 68, 12, n=14, a0=0, sweep=180) + ellipse(wc, 68, 32, n=12, a0=180, sweep=-180)
        a.fill_smooth(ellipse(wc, 68, 12, n=14), "ink", 0.75, off=(0, 0))
        for c, col in (((112, 198), "ochre"), ((140, 194), "sage"), ((160, 199), "clay"), ((126, 202), "clay")):
            a.ell(c, 9, 5, col, w=FW * 1.3, second=0)
        a.fill_smooth(wok, "slate")
        a.hatch(clip_half(wok, (154, 0), (1, 0)), 70, 4.2, alpha=0.5)
        a.outline(wok, LW, second=0)
        for x in (110, 140, 168):
            a.curve([(x, 184), (x - 6, 170), (x + 2, 154), (x - 4, 140)], MW, alpha=0.55, jit=0.4)
        h = F.hd[1]
        a.blob(capsule(add(h, (-2, 4)), (150, 196), 3), "ochre", w=MW, second=0)
        a.block([(142, 190), (158, 188), (160, 202), (144, 204)], "slate", w=MW, second=0)

    figure(a, r=34, kid=False, head=(94 + a.j(2), 76), cut=236, top_col="sage", expr="smile", mid=stove,
           extras={"apron": "paper"}, pose={"arms": (("ik", (38, 186), 1), ("ik", (156, 168), -1))}, tone="deep")


@art_key("pic_swim")
def pic_swim(a):
    """Swimming, friendly and safe: a smiling child up to the chest in water, goggles pushed up on the forehead, both
    hands gliding forward at the surface (breaststroke), small ripples and splashes. Never a lone hand above water."""
    cx = 118 + a.j(2)
    wy = 172

    def goggles(F):
        H = Tf(F.hc, 1, F.tilt)
        a.curve(H.pts([(-40, -16), (-20, -24), (0, -26), (20, -24), (40, -16)]), 4.2, "slate")
        for gx in (-14, 14):
            lens = H.pts(ellipse((gx, -24), 11, 7.5, n=9))
            a.fill_smooth(lens, "sage", 0.9)
            a.outline(lens, MW * 1.3, second=0, jit=0.2)
        a.line(H((-3, -24)), H((3, -24)), MW * 1.2, amp=0.1)

    figure(a, r=40, kid=True, head=(cx, 98), cut=236, top_col="clay", hair="short", expr="grin", mid=goggles,
           pose={"arms": (("ik", (cx - 16, wy + 2), 1), ("ik", (cx + 18, wy), -1))}, tone="light")
    water = [(0, wy)] + [(x, wy + 3 * math.sin(x / 13 + 1)) for x in range(10, 241, 15)] + [(240, 240), (0, 240)]
    a.fill_poly(water, "slate", 0.5, off=(0, 0), step=40)
    for k, y in enumerate((wy + 1, 198, 222)):
        x0 = 6 + (k % 2) * 18
        a.curve([(x0 + i * 22, y + 3 * math.sin(i * 1.6 + k)) for i in range(11) if x0 + i * 22 <= 236],
                MW * (1.3 if k == 0 else 1.0), "ink" if k == 0 else "slate", 0.9)
    for rx in (70, 96):
        a.arc((cx, wy + 4), rx, 200, 340, MW, "paper", 0.7, ry=rx * 0.16)
    for c, rr in (((cx - 46, wy - 12), 4.5), ((cx - 58, wy - 4), 3.2), ((cx + 50, wy - 14), 4), ((cx + 62, wy - 6), 3)):
        a.ell(c, rr, rr, w=FW * 1.4, second=0)


@art_key("pic_sit")
def pic_sit(a):
    r = 29
    pose = {"arms": ((80, 30), (76, 24)), "legs": ((-4, 90), (2, 92)), "behind": ("arm0", "leg0")}
    F = Fig(108, 224, r, True, dict(STAND, **pose), 1)
    seat_y = F.hip[1] + r * 0.32
    for p0, p1 in (((F.hip[0] - 28, seat_y + 4), (F.hip[0] - 34, 226)),
                   ((F.hip[0] + 24, seat_y + 4), (F.hip[0] + 30, 226))):
        a.blob(capsule(p0, p1, 4.4, 3.8), "ochre", w=MW * 1.2, second=0)
    seat = rect(F.hip[0] - 44, seat_y, 82, 11)
    a.block(seat, "ochre", w=MW * 1.4, second=0)
    a.hatch(seat, 0, 3.6, alpha=0.4)
    ground(a, 44, 206, 227, marks=4)
    figure(a, 108, 224, r, kid=True, facing=1, top_col="slate", bottom="trousers", bottom_col="sage", shoes="clay",
           ground_line=False, pose=pose, tone="deep")


# --------------------------------------------------------------------------------------------- pic: feelings & describing


@art_key("pic_happy")
def pic_happy(a):
    F = figure(a, r=44, kid=True, head=(118 + a.j(2), 118), cut=236, top_col="ochre", hair="ponytail", expr="happy",
               pose={"arms": ((-150, -116), (-30, -64))}, hands=("open", "open"), tone="light")
    for c, a0, a1 in ((add(F.hc, (-62, -50)), -150, -110), (add(F.hc, (60, -52)), -70, -30)):
        motion_arcs(a, c, 14, a0, a1, w=MW * 1.2)


@art_key("pic_sad")
def pic_sad(a):
    figure(a, r=44, kid=True, head=(114 + a.j(2), 110), cut=236, top_col="slate", hair="short", expr="sad",
           pose={"head": 9, "lean": 3}, tone="mid")


@art_key("pic_tired")
def pic_tired(a):
    cx = 110 + a.j(2)
    figure(a, r=44, kid=True, head=(cx, 108), cut=236, top_col="sage", hair="bob", expr="yawn",
           pose={"head": -10, "arms": ((101, 94), ("ik", (cx + 22, 152), 1))}, hands=("round", "open"), tone="deep")


@art_key("pic_hot")
def pic_hot(a):
    sc = (204, 36)
    a.fill_smooth(ellipse(sc, 18, 18, n=12), "ochre")
    a.ell_outline(sc, 18, 18, w=MW * 1.2)
    a.lines([(polar(sc, 24, t), polar(sc, 31, t)) for t in range(60, 300, 40)], MW, "ochre", amp=0.2)

    def fan(F):
        h = F.hd[1]
        c = add(h, (8, -30))
        blade = [c] + [polar(c, 34, t) for t in range(-150, -29, 20)]
        a.fill_poly(blade, "clay", 0.9)
        a.lines([(c, polar(c, 32, t)) for t in range(-140, -39, 20)], FW * 1.2, alpha=0.6)
        a.outline_poly(blade, MW * 1.3, second=0)
        a.blob(capsule(add(h, (0, 6)), c, 2.8), "ochre", w=MW, second=0)

    F = figure(a, r=44, kid=True, head=(100 + a.j(2), 114), cut=236, top_col="clay", hair="short", expr="hot", mid=fan,
               pose={"arms": ((101, 94), ("ik", (162, 154), -1))}, tone="mid")
    for c, rot in ((add(F.hc, (-50, -36)), -30), (add(F.hc, (-60, -8)), -60), (add(F.hc, (40, -50)), 24)):
        drop(a, c, 7, "slate", rot)
    for x in (24, 40):
        a.curve([(x, 120), (x + 5, 108), (x - 2, 96), (x + 4, 84)], MW, "clay", 0.6, jit=0.3)


@art_key("pic_cold")
def pic_cold(a):
    def scarf(F):
        sc = [add(F.nb, p) for p in ((-40, -6), (-10, 6), (12, 4), (40, -8), (42, 8), (12, 20), (-12, 22), (-42, 8))]
        a.fill_smooth(sc, "clay")
        a.hatch(sc, 80, 5, alpha=0.4)
        a.outline(sc, MW * 1.4, second=0)
        tail = [add(F.nb, p) for p in ((10, 14), (26, 16), (30, 56), (14, 58))]
        a.block(tail, "clay", w=MW * 1.3, second=0)
        a.lines([(add(F.nb, (14 + k * 5, 58)), add(F.nb, (13 + k * 5, 66))) for k in range(4)], MW, "clay")

    cx = 118 + a.j(2)
    figure(a, r=44, kid=True, head=(cx, 104), cut=236, top_col="slate", sleeve="long", hair="short", expr="cold",
           mid=scarf, pose={"arms": (("ik", (cx + 36, 182), -1), ("ik", (cx - 34, 192), 1))}, tone="light")
    for sx in (-1, 1):
        x = cx + sx * 68
        a.lines([((x, 150 + k * 16), (x + sx * 10, 146 + k * 16)) for k in range(3)], MW * 1.3, alpha=0.8)
    for x0, y0 in ((18, 56), (178, 40)):
        for k in range(2):
            a.curve([(x0 + i * 11, y0 + k * 12 + 3 * math.sin(i * 1.7 + k)) for i in range(4)], MW, "slate", 0.85)


@art_key("pic_hungry")
def pic_hungry(a):
    bc = (190, 52)
    for c, rr in (((150, 98), 4), ((160, 86), 6)):
        a.ell(c, rr, rr, w=FW * 1.3, second=0)
    cloud = [polar(bc, 40 + 5 * math.sin(t / 25), t, 32 + 4 * math.cos(t / 30)) for t in range(0, 360, 30)]
    a.fill_smooth(cloud, "paper", off=(0, 0))
    a.outline(cloud, MW * 1.3, second=0)
    bw = ellipse((190, 56), 22, 5, n=10, a0=0, sweep=180) + ellipse((190, 56), 22, 16, n=8, a0=180, sweep=-180)
    a.fill_smooth([(170, 56), (178, 42), (190, 38), (202, 42), (210, 56)], "paper", off=(0, 0))
    a.curve([(170, 56), (178, 42), (190, 38), (202, 42), (210, 56)], MW, jit=0.2)
    a.blob(bw, "clay", w=MW * 1.2, second=0)
    cx = 98 + a.j(2)
    figure(a, r=42, kid=True, head=(cx, 112), cut=236, top_col="sage", hair="short", expr="hungry",
           pose={"head": -6, "arms": ((101, 94), ("ik", (cx + 16, 212), -1))}, hands=("round", "open"),
           extras={"stripe": "ochre"}, tone="deep")
    for k in range(2):
        a.curve([(146 + k * 9, 214 - k * 9), (152 + k * 9, 210 - k * 9), (148 + k * 9, 204 - k * 9)], MW, alpha=0.7)


def size_pair(a, ball_c, ball_r, cat_x):
    ground(a, 14, 226, 208, marks=5)
    draw_cat_sit(a, (cat_x, 206), 0.6)
    round_ball(a, ball_c, ball_r, "clay", w=LW if ball_r > 20 else MW * 1.3)
    if ball_r > 20:
        a.curve([polar(ball_c, ball_r * 0.62, t) for t in (196, 214, 232, 250)], 5, "paper", 0.85, jit=0.3)


@art_key("pic_big")
def pic_big(a):
    size_pair(a, (142 + a.j(2), 120), 84, 34)


@art_key("pic_small")
def pic_small(a):
    size_pair(a, (150 + a.j(2), 197), 10, 98)


# --------------------------------------------------------------------------------------------- pic: body


@art_key("pic_head")
def pic_head(a):
    hc = (118 + a.j(2), 104)
    neck = rect(hc[0] - 18, hc[1] + 50, 36, 64)
    skin_parts(a, [neck], smooth=False)
    a.curve([(hc[0] - 18, hc[1] + 60), (hc[0] - 19, hc[1] + 92), (hc[0] - 24, hc[1] + 116)], LW)
    a.curve([(hc[0] + 18, hc[1] + 60), (hc[0] + 19, hc[1] + 92), (hc[0] + 26, hc[1] + 116)], LW)
    draw_head(a, hc, 66, "short", "smile", 0.0, -3)


@art_key("pic_mouth")
def pic_mouth(a):
    lips = [(28, 116), (64, 92), (100, 88), (120, 95), (140, 88), (176, 92), (212, 114), (186, 152), (122, 172), (58, 152)]
    a.fill_smooth(lips, "clay", 0.9)
    a.hatch(clip_half(lips, (0, 140), (0, 1)), 20, 4.4, alpha=0.35)
    mouth = [(46, 116), (86, 110), (120, 114), (156, 110), (194, 116), (172, 140), (122, 154), (70, 140)]
    a.fill_smooth(mouth, "slate", 0.95)
    teeth = [(58, 116), (120, 119), (182, 116), (176, 130), (120, 134), (64, 130)]
    a.fill_smooth(teeth, "paper", off=(0, 0))
    a.lines([((x, 119), (x + a.j(1), 131)) for x in (82, 101, 120, 139, 158)], FW * 1.2, alpha=0.7)
    a.fill_smooth([(92, 144), (120, 138), (150, 144), (138, 152), (104, 152)], "blush", 0.9)
    a.outline(mouth, MW * 1.2, second=0)
    a.outline(lips, LW, second=0.4)
    a.curve([(20, 120), (28, 112), (24, 104)], MW, jit=0.2)
    a.curve([(220, 118), (212, 110), (218, 102)], MW, jit=0.2)


@art_key("pic_foot")
def pic_foot(a):
    """A bare right foot seen from above: heel, sole and five toes with nails (the clearest 'foot' at 48 dp)."""
    T = Tf((126 + a.j(2), 128), 1, -8)
    toes = [((-22, -64), 15, 20), ((2, -74), 10.5, 14), ((20, -68), 9.5, 12.5), ((35, -58), 8.5, 11), ((47, -44), 7.5, 9.5)]
    for c, rx, ry in toes:
        t = T.pts(ellipse(c, rx, ry, n=10))
        skin_parts(a, [t])
        a.outline(t, MW * 1.3, second=0, jit=0.2)
        a.fill_smooth(T.pts(ellipse((c[0], c[1] - ry * 0.4), rx * 0.55, ry * 0.38, n=7)), "paper", 0.9, off=(0, 0))
    sole = T.pts([(-6, 92), (24, 86), (38, 56), (44, 14), (52, -24), (52, -42), (36, -52), (10, -58), (-14, -52),
                  (-34, -48), (-40, -20), (-32, 18), (-36, 56), (-30, 84)])
    skin_parts(a, [sole])
    a.hatch(clip_half(sole, T((18, 0)), T.v((1, 0.1))), T.ang(70), 4.4, alpha=0.35)
    a.outline(sole, LW, second=0.4)
    a.curve(T.pts([(-30, -40), (-4, -46), (24, -44), (44, -36)]), FW * 1.3, alpha=0.6)
    a.arc(T((-30, 60)), 7, 120, 260, FW * 1.4, alpha=0.7)


# --------------------------------------------------------------------------------------------- pic: colours


def draw_daub(a, color):
    """One wide brush stroke of paint on paper, like a colour swatch: a soft rounded start, an even, slightly curving
    body, and a dry, split end where the bristles run out (paper shows through). The colour plate is the picture; ink
    only edges part of it. White gets a full edge and ink bristle lines so it shows on paper."""
    white = color == "learn_white"
    T = Tf((120 + a.j(3), 124 + a.j(4)), 1, a.u(-14, -6))
    L, W0 = 140, 37 + a.u(-3, 3)
    n = 8
    bend = a.u(6, 10)
    top, bot = [], []
    for i in range(n + 1):
        t = i / n
        x = -L / 2 + L * t
        w = W0 * (0.88 + 0.12 * math.sin(math.pi * min(1.0, t * 1.3))) * a.u(0.96, 1.04)
        yc = -bend * math.sin(math.pi * t)
        top.append((x, yc - w))
        bot.append((x, yc + w))
    head = [polar((-L / 2, 0), W0 * a.u(0.94, 1.0), 270 - 180 * k / 6, W0 * 0.98) for k in range(1, 6)]
    head = [(x + 10 + 0.35 * (x + L / 2), y) for x, y in head]
    tail, fingers = [], []
    for k in range(6):
        y0 = W0 - 2 * W0 * k / 6
        y1 = W0 - 2 * W0 * (k + 1) / 6
        tip = (L / 2 + a.u(6, 26), (y0 + y1) / 2 + a.j(2))
        notch = (L / 2 - a.u(2, 12), y1)
        tail += [tip] + ([notch] if k < 5 else [])
        fingers.append(tip)
    shape = T.pts(list(reversed(top)) + head + bot + tail)
    a.fill_smooth(shape, color, 1.0, off=(0, 0), jit=0.6)
    gaps = []
    for k in range(4):
        y = W0 * (0.62 - 0.42 * k) + a.j(3)
        gaps.append((T((L * a.u(0.02, 0.22), y)), T((L / 2 + a.u(0, 10), y + a.j(2)))))
    a.lines(gaps, a.u(1.6, 2.4), "ink" if white else "paper", 0.5 if white else 0.75, amp=0.8)
    edge = list(reversed(top))[3:] + head + bot[:-3]
    a.curve(T.pts(edge), LW if white else MW * 1.2, jit=0.5)
    if white:
        a.curve(T.pts(tail), MW, jit=0.4)
    a.lines([(T((-L / 2 + 30 + a.u(0, 20), y)), T((L * 0.05, y + a.j(3)))) for y in (-W0 * 0.45, W0 * 0.2)],
            FW * 1.1, alpha=0.35 if white else 0.15, amp=1.0)
    sc = T((-L / 2 + a.u(10, 40), W0 + a.u(16, 24)))
    a.fill_smooth(ellipse(sc, 4.5, 3.8, n=7), color, 1.0, off=(0, 0))
    if white:
        a.ell_outline(sc, 4.5, 3.8, w=FW * 1.3, second=0)


for _cname in ("red", "blue", "yellow", "green", "black", "white", "orange", "purple", "brown", "pink"):
    art_key(f"pic_color_{_cname}")(lambda a, c=_cname: draw_daub(a, f"learn_{c}"))


# --------------------------------------------------------------------------------------------- interaction glyphs


def glyph_under(a, pts, w, color, alpha=0.88):
    """The glyph family's broad colour stroke, offset like a second print plate under the ink line."""
    off = a.reg(color)
    a.stroke(a.open_curve([add(p, off) for p in pts], 1.0), w, color, alpha)


# --------------------------------------------------------------------------------------------- pic: food & drink


def plate(a, c, rx, ry=None, color="slate"):
    """A plain plate a little from above: a tinted rim, the inner well line, a hand contour."""
    ry = ry or rx * 0.3
    a.fill_smooth(ellipse(c, rx, ry, n=16), color, 0.3)
    well = (c[0], c[1] + ry * 0.08)
    a.fill_smooth(ellipse(well, rx * 0.72, ry * 0.66, n=14), "paper", 0.9, off=(0, 0))
    a.ell_outline(well, rx * 0.72, ry * 0.66, w=FW * 1.3, second=0)
    a.ell_outline(c, rx, ry, w=LW, second=0.4)


def bowl(a, c, rx, h, col="clay", content=None, zig=True):
    """A bowl a little from above: the dark inside and back rim, then the content, then the body drawn over it."""
    ry = rx * 0.25
    a.fill_smooth(ellipse(c, rx, ry, n=14), "slate", 0.6)
    a.arc(c, rx, 180, 360, MW * 1.3, ry=ry, n=8)
    if content:
        content()
    foot = [(c[0] - rx * 0.34, c[1] + h - 4), (c[0] + rx * 0.34, c[1] + h - 4), (c[0] + rx * 0.4, c[1] + h + 9),
            (c[0] - rx * 0.4, c[1] + h + 9)]
    a.block(foot, col, w=MW * 1.3, second=0)
    body = ellipse(c, rx, ry, n=12, a0=0, sweep=180) + ellipse(c, rx, h, n=12, a0=180, sweep=-180)
    a.fill_smooth(body, col)
    a.hatch(clip_half(body, (c[0] + rx * 0.35, 0), (1, 0)), 70, 4.2, alpha=0.45)
    if zig:
        zz = [(c[0] - rx * 0.6 + i * rx * 0.15, c[1] + ry + (h - ry) * (0.3 if i % 2 == 0 else 0.55)) for i in range(9)]
        a.zig(zz, MW, "paper", 0.8)
    a.outline(body, LW, second=0)


def heap_pts(c, rx, hh, n=9):
    return [(c[0] - rx * math.cos(math.pi * i / (n - 1)), c[1] + 2 - hh * math.sin(math.pi * i / (n - 1)) ** 0.85)
            for i in range(n)]


def steam(a, xs, y0, h=40):
    for x in xs:
        a.curve([(x, y0), (x - 6, y0 - h * 0.35), (x + 2, y0 - h * 0.7), (x - 4, y0 - h)], MW, alpha=0.55, jit=0.4)


@art_key("pic_rice_bowl")
def pic_rice_bowl(a):
    c = (118 + a.j(2), 132)

    def rice():
        heap = heap_pts(c, 82, 56)
        a.fill_smooth(heap + [(c[0], c[1] + 14)], "paper", off=(0, 0))
        grains = Path()
        for _ in range(26):
            p = (c[0] + a.u(-64, 64), c[1] + a.u(-46, 4))
            if inside(p, heap + [(c[0], c[1] + 14)]):
                ang = a.u(0, 180)
                a.seg(add(p, mul(dirv(ang), -2.6)), add(p, mul(dirv(ang), 2.6)), 0.2, grains)
        a.stroke(grains, MW, alpha=0.6)
        a.curve(heap, LW, jit=0.4)

    bowl(a, c, 92, 70, "clay", rice)
    a.line((26, 222), (214, 222), MW, alpha=0.6)


@art_key("pic_noodle_bowl")
def pic_noodle_bowl(a):
    c = (114 + a.j(2), 140)

    def noodles():
        a.fill_smooth(ellipse(c, 82, 19, n=14), "ochre", 0.95)
        for k in range(5):
            y = c[1] - 12 + k * 6
            a.curve([(c[0] - 70 + i * 20, y + 3 * math.sin(i * 1.9 + k)) for i in range(8)], FW * 1.4, "clay", 0.7)
        egg = ellipse((c[0] + 34, c[1] - 6), 17, 11, -10, n=10)
        a.fill_smooth(egg, "paper", off=(0, 0))
        a.outline(egg, MW * 1.2, second=0)
        a.fill_smooth(ellipse((c[0] + 36, c[1] - 6), 8, 6, n=8), "ochre")
        lf = leaf_pts((c[0] - 52, c[1] + 2), (c[0] - 14, c[1] - 16), 9)
        a.fill_smooth(lf, "sage")
        a.outline(lf, MW, second=0, jit=0.2)
        a.dots([(c[0] - 2, c[1] - 4), (c[0] + 8, c[1] + 4), (c[0] - 26, c[1] + 6)], 5, "sage")
        for x0 in (c[0] + 2, c[0] + 14):
            a.curve([(x0, c[1] - 2), (x0 + 6, c[1] - 30), (x0 + 1, c[1] - 56), (x0 + 12, c[1] - 74)], 4.2, "ochre")
            a.curve([(x0, c[1] - 2), (x0 + 6, c[1] - 30), (x0 + 1, c[1] - 56), (x0 + 12, c[1] - 74)], FW, alpha=0.7)

    bowl(a, c, 90, 62, "slate", noodles)
    for dx in (0, 14):
        a.blob(capsule((c[0] + 4 + dx, c[1] - 70), (c[0] + 52 + dx, c[1] - 128), 2.6, 3.6), "ochre", w=MW, second=0)


@art_key("pic_bread")
def pic_bread(a):
    loaf = [(44, 190), (40, 146), (46, 110), (70, 90), (100, 92), (118, 102), (138, 90), (170, 90), (196, 108),
            (204, 144), (202, 190)]
    a.fill_smooth(loaf, "ochre")
    a.fill_smooth(loaf, "clay", 0.4)
    a.hatch(clip_half(loaf, (170, 0), (1, 0)), 70, 4.2, alpha=0.45)
    a.outline(loaf, LW, second=0.4)
    a.curve([(72, 96), (92, 104), (110, 118)], MW, alpha=0.7)
    a.curve([(140, 96), (160, 102), (178, 116)], MW, alpha=0.7)
    T = Tf((96, 168), 1, -10)
    sl = T.pts([(-46, 44), (-50, 0), (-44, -26), (-26, -40), (-6, -36), (6, -42), (28, -40), (44, -22), (48, 4), (44, 44)])
    a.fill_smooth(sl, "clay", 0.85)
    inner = T.pts([(-40, 38), (-43, 0), (-38, -20), (-24, -31), (-6, -28), (6, -33), (26, -32), (38, -18), (41, 4),
                   (38, 38)])
    a.fill_smooth(inner, "paper", off=(0, 0))
    a.stipple(inner, 22, 1.8, alpha=0.45)
    a.outline(sl, LW, second=0.4)
    a.line((22, 216), (222, 214), MW, alpha=0.6)


@art_key("pic_egg_fried")
def pic_egg_fried(a):
    plate(a, (120, 138), 104, 52)
    white = [(60, 132), (66, 110), (92, 100), (120, 106), (150, 98), (176, 110), (184, 134), (168, 156), (136, 162),
             (104, 166), (74, 158)]
    a.fill_smooth(white, "paper", off=(0, 0))
    a.outline(white, LW, second=0.4)
    yc = (124 + a.j(3), 128)
    a.fill_smooth(ellipse(yc, 25, 20, n=12), "ochre")
    a.hatch(clip_half(ellipse(yc, 22, 17, n=16), (yc[0] + 6, yc[1] + 4), (0.6, 0.8)), 50, 3.6, alpha=0.45)
    a.ell_outline(yc, 25, 20, w=MW * 1.4)
    a.curve([polar(yc, 14, t, 11) for t in (200, 225, 250)], 3.2, "paper", 0.9, jit=0.1)


@art_key("pic_apple")
def pic_apple(a):
    ap = [(120, 72), (142, 58), (174, 64), (196, 94), (200, 132), (186, 174), (160, 202), (138, 208), (120, 200),
          (100, 208), (76, 202), (52, 174), (40, 132), (44, 94), (66, 64), (98, 58)]
    a.fill_smooth(ap, "clay")
    a.hatch(clip_half(ap, (138, 150), (0.6, 0.8)), 55, 4.4, alpha=0.45)
    a.curve([(66, 104), (62, 124), (66, 144)], 5, "paper", 0.8, jit=0.3)
    a.outline(ap, LW, second=0.45)
    a.curve([(120, 76), (122, 58), (130, 40)], LW * 1.1)
    lf = leaf_pts((126, 52), (174, 34), 13, asym=0.8)
    a.fill_smooth(lf, "sage")
    a.outline(lf, MW * 1.2, second=0, jit=0.2)
    a.line((128, 51), (164, 39), FW, amp=0.3)


@art_key("pic_orange_fruit")
def pic_orange_fruit(a):
    c, R = (100 + a.j(2), 118), 66
    body = ellipse(c, R, R * 0.96, n=16)
    a.fill_smooth(body, "ochre")
    a.fill_smooth(body, "clay", 0.42)
    a.stipple(ellipse(c, R - 8, R - 8, n=16), 34, 1.6, alpha=0.35)
    a.hatch(clip_half(ellipse(c, R - 4, R - 4, n=24), add(c, (18, 22)), (0.6, 0.8)), 52, 4.2, alpha=0.4)
    a.ell_outline(c, R, R * 0.96)
    a.curve([add(c, (-2, -R + 2)), add(c, (2, -R - 12))], LW)
    lf = leaf_pts(add(c, (2, -R - 8)), add(c, (40, -R - 22)), 11)
    a.fill_smooth(lf, "sage")
    a.outline(lf, MW * 1.2, second=0, jit=0.2)
    hc, hr = (176, 182), 40
    a.fill_smooth(ellipse(hc, hr, hr * 0.92, n=14), "ochre")
    a.fill_smooth(ellipse(hc, hr - 7, (hr - 7) * 0.92, n=14), "paper", 0.9, off=(0, 0))
    segs = []
    for k in range(9):
        t0, t1 = k * 40 + 4, k * 40 + 36
        seg = [hc] + [polar(hc, hr - 10, t0 + (t1 - t0) * i / 3, (hr - 10) * 0.92) for i in range(4)]
        segs.append(seg)
    for seg in segs:
        a.fill_smooth(seg, "ochre", 0.95)
        a.fill_smooth(seg, "clay", 0.35)
    a.ell_outline(hc, hr, hr * 0.92, w=LW)
    a.lines([(hc, polar(hc, hr - 8, k * 40, (hr - 8) * 0.92)) for k in range(9)], FW * 1.2, "paper", 0.9)


@art_key("pic_watermelon")
def pic_watermelon(a):
    T = Tf((122 + a.j(2), 88), 1, -6)
    rind = T.pts([polar((0, 0), 104, t, 98) for t in range(0, 181, 15)])
    white = T.pts([polar((0, 0), 94, t, 88) for t in range(0, 181, 15)])
    flesh = T.pts([polar((0, 0), 88, t, 82) for t in range(0, 181, 15)])
    a.fill_poly(rind, "sage", step=30)
    a.hatch(rind, T.ang(80), 4, alpha=0.4)
    a.fill_poly(white, "paper", off=(0, 0), step=30)
    a.fill_poly(flesh, "clay", step=30)
    a.stipple(flesh, 18, 1.6, "paper", 0.5)
    seeds = []
    for rr, n in ((42, 4), (64, 6)):
        for i in range(n):
            t = 20 + 140 * (i + 0.5) / n + a.j(4)
            seeds.append((T(polar((0, 0), rr, t, rr * 0.93)), t))
    for p, t in seeds:
        d = ellipse(p, 3.2, 5.6, T.ang(t) - 90 + 90, n=6)
        a.fill_smooth(d, "ink", 0.9, off=(0, 0))
    a.outline_poly([rind[0], rind[-1]], LW, closed=False, second=0)
    a.curve(rind, LW)
    a.curve(flesh, MW, alpha=0.8)


@art_key("pic_fish_dish")
def pic_fish_dish(a):
    plate(a, (118, 142), 108, 56)
    T = Tf((112, 136), 1, -4)
    body = T.pts([(-70, 0), (-56, -18), (-20, -28), (24, -26), (52, -14), (60, 0), (52, 14), (24, 26), (-20, 28),
                  (-56, 18)])
    tail = T.pts([(54, 0), (84, -24), (90, -16), (78, 0), (90, 16), (84, 24)])
    a.blob(tail, "ochre", w=MW * 1.4, second=0)
    a.fill_smooth(body, "ochre")
    a.fill_smooth(body, "clay", 0.5)
    for x in (-24, -6, 12, 30):
        a.line(T((x - 6, -20)), T((x + 6, 18)), MW, "ink", 0.6, amp=0.4)
    a.outline(body, LW, second=0.4)
    a.arc(T((-40, 0)), 18, -60, 60, MW)
    a.dots([T((-52, -6))], 6.5)
    lime = [(150, 172), (186, 160), (170, 186)]
    a.fill_poly(lime, "sage")
    a.fill_poly([(156, 172), (182, 163), (171, 181)], "paper", 0.7, off=(0, 0))
    a.outline_poly(lime, MW * 1.3, second=0)
    for c in ((60, 170), (80, 178)):
        a.ell(c, 12, 7, "sage", w=MW * 1.2, second=0)
        a.ell(c, 7, 4, "paper", 0.8, w=FW, second=0)


@art_key("pic_chicken_dish")
def pic_chicken_dish(a):
    plate(a, (120, 144), 106, 54)
    lf = leaf_pts((54, 156), (150, 120), 24, asym=0.9)
    a.fill_smooth(lf, "sage")
    a.outline(lf, MW * 1.2, second=0, jit=0.3)
    for c, rot in (((96, 132), -18), ((150, 146), 14)):
        T = Tf(c, 1, rot)
        bone = T.pts(capsule((22, 0), (52, 0), 5, 4.5, n=4))
        a.blob(bone, "paper", w=MW * 1.3, second=0)
        for kx in (52, 56):
            a.ell(T((kx, -5)), 6, 6, "paper", w=MW, second=0)
            a.ell(T((kx, 5)), 6, 6, "paper", w=MW, second=0)
        bulb = T.pts([(-38, 0), (-30, -20), (-6, -24), (16, -12), (26, 0), (16, 12), (-6, 24), (-30, 20)])
        a.fill_smooth(bulb, "ochre")
        a.fill_smooth(bulb, "clay", 0.55)
        a.stipple(bulb, 16, 2.4, "ochre", 0.9)
        a.hatch(clip_half(bulb, T((0, 6)), T.v((0, 1))), T.ang(30), 4, alpha=0.4)
        a.outline(bulb, LW, second=0.4)


@art_key("pic_vegetables")
def pic_vegetables(a):
    a.line((20, 214), (222, 212), MW, alpha=0.6)
    cc = (92, 150)
    cab = ellipse(cc, 58, 54, n=16)
    a.fill_smooth(cab, "sage")
    a.hatch(clip_half(ellipse(cc, 54, 50, n=20), (110, 170), (0.6, 0.8)), 55, 4.4, alpha=0.4)
    a.ell_outline(cc, 58, 54)
    for t in (200, 250, 300, 340):
        a.curve([add(cc, (0, 20)), polar(cc, 30, t), polar(cc, 52, t + 10)], MW, alpha=0.6)
    a.curve([polar(cc, 40, 190), polar(cc, 46, 230), polar(cc, 38, 280), polar(cc, 46, 320)], MW * 1.2)
    T = Tf((166, 120), 1, 28)
    carrot = T.pts([(-14, -50), (14, -50), (8, 30), (0, 62), (-8, 30)])
    for lfx, ang in ((-6, -110), (2, -90), (10, -70)):
        a.blob(capsule(T((lfx, -50)), add(T((lfx, -50)), mul(dirv(ang + 28), 30)), 4.5, 2.5), "sage", w=MW, second=0)
    a.fill_smooth(carrot, "ochre")
    a.fill_smooth(carrot, "clay", 0.55)
    a.lines([(T((-10, y)), T((-3, y + 2))) for y in (-30, -10, 10)] + [(T((10, y + 8)), T((4, y + 10))) for y in (-34, -4)],
            MW, alpha=0.6)
    a.outline(carrot, LW, second=0.3)
    tc = (170, 186)
    a.fill_smooth(ellipse(tc, 30, 26, n=14), "clay")
    a.hatch(clip_half(ellipse(tc, 27, 23, n=16), add(tc, (8, 8)), (0.6, 0.8)), 50, 4, alpha=0.45)
    a.ell_outline(tc, 30, 26)
    star = [polar(add(tc, (0, -22)), 10 if i % 2 == 0 else 4, -90 + 36 * i) for i in range(10)]
    a.fill_smooth(star, "sage")
    a.outline(star, MW, second=0, jit=0.2)


@art_key("pic_soup")
def pic_soup(a):
    c = (112 + a.j(2), 132)

    def broth():
        a.fill_smooth(ellipse(add(c, (0, 4)), 78, 16, n=14), "ochre", 0.9)
        for p, col in (((c[0] - 40, c[1] + 4), "clay"), ((c[0] - 8, c[1] + 10), "clay"), ((c[0] + 22, c[1] + 2), "ochre")):
            a.ell(p, 8, 4.6, col, w=FW * 1.3, second=0)
        for p0, p1 in (((c[0] - 24, c[1] - 2), (c[0] - 4, c[1] - 8)), ((c[0] + 30, c[1] + 10), (c[0] + 52, c[1] + 4))):
            lf = leaf_pts(p0, p1, 5)
            a.fill_smooth(lf, "sage")
            a.outline(lf, FW * 1.3, second=0, jit=0.1)
        a.blob(capsule((c[0] + 40, c[1] + 2), (c[0] + 92, c[1] - 62), 3.6, 4.6), "slate", 0.9, w=MW * 1.2, second=0)
        sp = ellipse((c[0] + 34, c[1] + 6), 13, 6, 12, n=9)
        a.blob(sp, "slate", 0.9, w=MW * 1.2, second=0)

    bowl(a, c, 88, 60, "sage", broth)
    steam(a, (c[0] - 34, c[0] - 6, c[0] + 18), c[1] - 22, 52)


def cup_body(a, top_c, rx, h, col):
    """A straight-sided cup: the rim ellipse at top_c, the body slightly narrowing to the base."""
    ry = rx * 0.26
    body = ellipse(top_c, rx, ry, n=10, a0=0, sweep=180)[::-1]
    body = [(top_c[0] - rx, top_c[1]), (top_c[0] - rx * 0.82, top_c[1] + h)] + \
        ellipse((top_c[0], top_c[1] + h), rx * 0.82, ry * 0.8, n=8, a0=180, sweep=-180) + [(top_c[0] + rx, top_c[1])]
    a.fill_poly(body, col, step=12)
    a.hatch(clip_half(body, (top_c[0] + rx * 0.35, 0), (1, 0)), 75, 4.2, alpha=0.45)
    a.stroke(a.sketch_poly(body[:2], closed=False), LW)
    a.curve(ellipse((top_c[0], top_c[1] + h), rx * 0.82, ry * 0.8, n=8, a0=180, sweep=-180), LW)
    a.stroke(a.sketch_poly([(top_c[0] + rx, top_c[1]), body[-2]], closed=False), LW)
    return body


@art_key("pic_tea_cup")
def pic_tea_cup(a):
    sc = (114, 196)
    a.fill_smooth(ellipse(sc, 86, 18, n=16), "slate", 0.35)
    a.ell_outline(sc, 86, 18, w=LW, second=0.4)
    a.ell_outline(sc, 46, 9, w=FW * 1.3, second=0)
    tc, rx = (112, 108), 58
    a.blob(ribbon([(166, 118), (196, 120), (200, 146), (184, 164), (162, 162)], 10), "sage", w=MW * 1.3, second=0)
    cup_body(a, tc, rx, 82, "sage")
    a.fill_smooth(ellipse(tc, rx, rx * 0.26, n=14), "paper", off=(0, 0))
    a.fill_smooth(ellipse(add(tc, (0, 3)), rx - 6, (rx - 6) * 0.24, n=14), "clay", 0.55)
    a.fill_smooth(ellipse(add(tc, (0, 3)), rx - 6, (rx - 6) * 0.24, n=14), "ochre", 0.5)
    a.ell_outline(tc, rx, rx * 0.26, w=LW)
    a.curve([(80, 104), (70, 130), (64, 150), (60, 162)], FW * 1.4)
    tag = [(52, 160), (68, 160), (68, 178), (52, 178)]
    a.block(tag, "ochre", w=MW * 1.2, second=0)
    steam(a, (100, 124), 86, 48)


@art_key("pic_coffee_cup")
def pic_coffee_cup(a):
    tc, rx = (108, 92), 56
    a.blob(ribbon([(160, 104), (194, 106), (198, 136), (186, 160), (160, 160)], 13), "slate", w=MW * 1.3, second=0)
    cup_body(a, tc, rx, 104, "slate")
    a.fill_smooth(ellipse(tc, rx, rx * 0.26, n=14), "paper", off=(0, 0))
    cof = ellipse(add(tc, (0, 3)), rx - 6, (rx - 6) * 0.24, n=14)
    a.fill_smooth(cof, "clay", 0.95)
    a.fill_smooth(cof, "slate", 0.55)
    a.curve(ellipse(add(tc, (0, 3)), rx - 16, (rx - 16) * 0.22, n=10, a0=200, sweep=150), MW, "ochre", 0.7)
    a.ell_outline(tc, rx, rx * 0.26, w=LW)
    for c, rot in (((180, 206), -20), ((206, 196), 30)):
        bean = ellipse(c, 12, 8, rot, n=9)
        a.fill_smooth(bean, "clay", 0.95)
        a.fill_smooth(bean, "slate", 0.4)
        a.outline(bean, MW * 1.2, second=0, jit=0.2)
        a.curve([polar(c, 8, rot + 180), add(c, (0, 1)), polar(c, 8, rot)], FW * 1.3, "paper", 0.8)
    a.line((22, 216), (224, 214), MW, alpha=0.6)
    steam(a, (96, 120), 74, 46)


@art_key("pic_milk_glass")
def pic_milk_glass(a):
    tint_patch(a, (124 + a.j(3), 128), 92, 96, "sage", 0.22)
    g = [(70, 52), (166, 52), (156, 206), (80, 206)]
    milk = [(72.5, 92), (163.5, 92), (156, 204), (80, 204)]
    a.fill_poly([(71, 54), (165, 54), (164, 90), (72, 90)], "slate", 0.22, off=(0, 0))
    a.fill_poly(milk, "paper", off=(0, 0))
    a.hatch(clip_half(milk, (140, 0), (1, 0)), 75, 5, color="slate", alpha=0.4)
    a.curve(ellipse((118, 92), 45, 7, n=12, a0=0, sweep=180), MW * 1.3)
    a.curve(ellipse((118, 92), 45, 7, n=12, a0=180, sweep=180), FW * 1.3, alpha=0.6)
    a.outline_poly(g, LW, closed=False, second=0)
    a.ell_outline((118, 52), 48, 7.5, w=MW * 1.2, second=0)
    a.curve([(90, 100), (92, 150), (94, 194)], MW, "slate", 0.45)
    drip = [(160, 56), (167, 70), (167, 94), (161, 100), (156, 88), (157, 68)]
    a.fill_smooth(drip, "paper", off=(0, 0))
    a.outline(drip, MW, second=0, jit=0.2)
    a.line((44, 212), (200, 210), MW, alpha=0.6)


@art_key("pic_juice")
def pic_juice(a):
    g = [(72, 70), (156, 70), (146, 214), (82, 214)]
    juice = [(74, 98), (154, 98), (146, 212), (82, 212)]
    a.blob(capsule((128, 92), (176, 22), 4.5), "clay", w=MW, second=0)
    a.lines([(lerp((128, 92), (176, 22), t), lerp((128, 92), (176, 22), t + 0.06)) for t in (0.5, 0.7, 0.9)], 7,
            "paper", 0.9)
    a.fill_poly(juice, "ochre", 0.95)
    a.fill_poly(juice, "clay", 0.4)
    a.hatch(clip_half(juice, (130, 0), (1, 0)), 75, 5, alpha=0.35)
    a.curve(ellipse((114, 98), 40, 6, n=12, a0=0, sweep=180), MW * 1.2)
    a.outline_poly(g, LW, closed=False, second=0)
    a.ell_outline((114, 70), 42, 7, w=MW, second=0)
    a.line((88, 108), (94, 196), MW, "paper", 0.7)
    oc, orr = (70, 70), 26
    a.fill_smooth(ellipse(oc, orr, orr, n=14), "ochre")
    a.fill_smooth(ellipse(oc, orr - 6, orr - 6, n=12), "paper", 0.85, off=(0, 0))
    for k in range(8):
        seg = [oc] + [polar(oc, orr - 9, k * 45 + 5 + i * 12) for i in range(4)]
        a.fill_smooth(seg, "ochre", 0.9)
    a.ell_outline(oc, orr, orr, w=MW * 1.4)
    a.line((48, 218), (184, 216), MW, alpha=0.6)


@art_key("pic_cake")
def pic_cake(a):
    sc = (120, 200)
    a.fill_smooth(ellipse(sc, 98, 18, n=16), "slate", 0.35)
    a.ell_outline(sc, 98, 18, w=LW, second=0.4)
    c, rx, ry = (120, 110), 76, 20
    side = [(c[0] - rx, c[1]), (c[0] - rx, c[1] + 80)] + ellipse((c[0], c[1] + 80), rx, ry, n=12, a0=180, sweep=-180) + \
        [(c[0] + rx, c[1])]
    a.fill_poly(side, "ochre", step=14)
    band = clip_half(clip_half(side, (0, c[1] + 36), (0, 1)), (0, c[1] + 50), (0, -1))
    a.fill_poly(band, "paper", off=(0, 0))
    a.fill_poly(clip_half(clip_half(side, (0, c[1] + 50), (0, 1)), (0, c[1] + 80), (0, -1)), "clay", 0.35)
    a.hatch(clip_half(side, (c[0] + 30, 0), (1, 0)), 75, 4.4, alpha=0.4)
    top = ellipse(c, rx, ry, n=16)
    a.fill_smooth(top, "paper", off=(0, 0))
    rim = [polar(c, rx, t, ry) for t in range(0, 181, 15)]
    drip = [add(polar(c, rx, t, ry), (0, 8 + 10 * ((t // 15) % 2))) for t in range(180, -1, -15)]
    a.fill_smooth(rim + drip, "paper", off=(0, 0))
    a.stroke(a.sketch_poly([(c[0] - rx, c[1]), (c[0] - rx, c[1] + 80)], closed=False), LW)
    a.stroke(a.sketch_poly([(c[0] + rx, c[1]), (c[0] + rx, c[1] + 80)], closed=False), LW)
    a.curve(ellipse((c[0], c[1] + 80), rx, ry, n=12, a0=180, sweep=-180), LW)
    a.curve([add(polar(c, rx, t, ry), (0, 8 + 10 * ((t // 15) % 2))) for t in range(180, -1, -15)], MW * 1.2, jit=0.3)
    a.ell_outline(c, rx, ry, w=LW)
    for sx, sy in ((-30, -4), (2, -10), (34, -2)):
        b = (c[0] + sx, c[1] + sy - 8)
        berry = [add(b, p) for p in ((0, -14), (10, -6), (8, 6), (0, 12), (-8, 6), (-10, -6))]
        a.fill_smooth(berry, "clay")
        a.outline(berry, MW * 1.2, second=0, jit=0.2)
        a.dots([add(b, (dx, dy)) for dx, dy in ((-3, -2), (3, 1), (0, 5))], 2.0, "paper", 0.9)
        a.fill_smooth([add(b, p) for p in ((-7, -12), (0, -18), (7, -12), (0, -9))], "sage")


@art_key("pic_kimchi")
def pic_kimchi(a):
    c = (120 + a.j(2), 142)

    def kim():
        pieces = [((c[0] - 40, c[1] - 6), -28, 1.0), ((c[0] + 4, c[1] - 26), 14, 1.1), ((c[0] + 40, c[1] - 6), 30, 0.95),
                  ((c[0] - 12, c[1] - 2), -6, 1.0), ((c[0] + 22, c[1] + 2), 10, 0.9)]
        for p, rot, s in pieces:
            T = Tf(p, s, rot)
            pc = T.pts([(-22, 14), (-24, -6), (-18, -20), (-10, -16), (-4, -26), (4, -18), (12, -26), (18, -14),
                        (24, -18), (24, 2), (20, 16)])
            a.fill_smooth(pc, "ochre", 0.55)
            a.fill_smooth(pc, "clay", 0.8)
            a.fill_smooth(T.pts([(-18, -14), (-10, -16), (-4, -24), (4, -18), (12, -24), (18, -14), (8, -10), (-8, -8)]),
                          "sage", 0.6)
            a.stroke(a.open_curve(T.pts([(-6, 12), (-3, -2), (0, -14)]), 0.4), 5, "paper", 0.7)
            a.outline(pc, MW * 1.3, second=0, jit=0.3)
        a.dots([(c[0] + a.u(-56, 56), c[1] + a.u(-40, 4)) for _ in range(16)], 3.2, "clay", 0.95)

    bowl(a, c, 84, 40, "paper", kim, zig=False)
    a.hatch(clip_half(ellipse(c, 84, 40, n=12, a0=0, sweep=180), (c[0] + 30, 0), (1, 0)), 70, 4.2, color="slate",
            alpha=0.4)
    a.line((24, 204), (216, 202), MW, alpha=0.6)


@art_key("pic_onigiri")
def pic_onigiri(a):
    lf = leaf_pts((24, 196), (220, 176), 34, asym=0.9, n=8)
    a.fill_smooth(lf, "sage")
    a.hatch(lf, -30, 7, alpha=0.3)
    a.outline(lf, MW * 1.3, second=0, jit=0.4)
    a.curve([(30, 194), (120, 188), (214, 178)], FW * 1.2, alpha=0.6)
    tri = [(118, 46), (138, 52), (178, 128), (184, 162), (170, 182), (70, 184), (54, 164), (60, 130), (100, 52)]
    a.fill_smooth(tri, "paper", off=(0, 0))
    grains = Path()
    for _ in range(22):
        p = (a.u(70, 170), a.u(60, 136))
        if inside(p, tri):
            ang = a.u(0, 180)
            a.seg(add(p, mul(dirv(ang), -2.6)), add(p, mul(dirv(ang), 2.6)), 0.2, grains)
    a.stroke(grains, MW, alpha=0.5)
    nori = clip_half(tri, (0, 134), (0, 1))
    nori = [p for p in nori]
    band = clip_half(clip_half(nori, (90, 0), (1, 0)), (152, 0), (-1, 0))
    a.fill_poly(band, "slate", step=10)
    a.fill_poly(band, "ink", 0.35, off=a.reg("slate"), step=10)
    a.hatch(band, 70, 3.2, alpha=0.45)
    a.outline_poly(band, MW * 1.2, second=0)
    a.outline(tri, LW, second=0.4)


@art_key("pic_dumplings")
def pic_dumplings(a):
    plate(a, (116, 150), 102, 52)
    for c, s, rot in (((76, 150), 1.0, -8), ((128, 136), 1.05, 4), ((156, 170), 1.0, -4)):
        T = Tf(c, s, rot)
        d = T.pts([(-34, 10), (-30, -6), (-16, -20), (0, -26), (16, -20), (30, -6), (34, 10), (0, 16)])
        a.fill_smooth(d, "paper", off=(0, 0))
        a.fill_smooth(d, "ochre", 0.3)
        a.hatch(clip_half(d, T((0, 6)), T.v((0, 1))), T.ang(20), 3.8, alpha=0.35)
        a.outline(d, LW, second=0.3)
        for k in range(5):
            x = -20 + k * 10
            a.curve(T.pts([(x - 3, -20 + abs(x) * 0.3), (x, -10 + abs(x) * 0.3), (x + 1, -2)]), FW * 1.4, alpha=0.8)
    dc = (196, 96)
    a.fill_smooth(ellipse(dc, 26, 9, n=12), "clay", 0.9)
    a.fill_smooth(ellipse(dc, 20, 6, n=10), "slate", 0.8)
    a.ell_outline(dc, 26, 9, w=MW * 1.3, second=0)
    a.curve(ellipse(dc, 26, 16, n=8, a0=180, sweep=-180), MW * 1.3)


@art_key("pic_chopsticks")
def pic_chopsticks(a):
    rest = [(118, 164), (156, 158), (158, 172), (120, 178)]
    a.blob(rest, "clay", w=MW * 1.4, second=0)
    for p0, p1 in (((40, 196), (206, 46)), ((60, 210), (214, 64))):
        st = ribbon([p0, lerp(p0, p1, 0.5), p1], 11, 5)
        a.fill_smooth(st, "ochre")
        a.hatch(st, 40, 3.6, alpha=0.3)
        a.outline(st, MW * 1.4, second=0, jit=0.3)
        a.fill_smooth(ribbon([p0, lerp(p0, p1, 0.18)], 11, 10), "clay", 0.7)
    a.line((20, 222), (220, 220), MW, alpha=0.5)


@art_key("pic_spoon_fork")
def pic_spoon_fork(a):
    nap = [rotp(p, -12, (120, 128)) for p in rect(54, 30, 132, 196)]
    a.fill_poly(nap, "sage", 0.75)
    a.hatch(nap, 78, 9, w=MW, color="paper", alpha=0.35)
    a.outline_poly(nap, LW, second=0.4)
    T = Tf((96, 128), 1, -12)
    a.blob(T.pts(capsule((0, -20), (0, 84), 6, 4.5, n=4)), "slate", 0.6, w=MW * 1.3, second=0)
    sp = T.pts(ellipse((0, -50), 20, 32, n=12))
    a.fill_smooth(sp, "slate", 0.6)
    a.hatch(clip_half(sp, T((6, 0)), T.v((1, 0))), T.ang(80), 3.6, alpha=0.4)
    a.outline(sp, LW, second=0)
    a.curve(T.pts([(-10, -64), (-13, -50), (-9, -36)]), 3, "paper", 0.9, jit=0.1)
    F = Tf((150, 122), 1, -12)
    a.blob(F.pts(capsule((0, -22), (0, 88), 6, 4.5, n=4)), "slate", 0.6, w=MW * 1.3, second=0)
    head = F.pts([(-18, -78), (-16, -40), (-8, -28), (8, -28), (16, -40), (18, -78), (13, -78), (12, -46), (6, -44),
                  (5, -78), (0, -78), (-1, -44), (-6, -44), (-6, -78), (-12, -78), (-12, -46), (-14, -46)])
    a.fill_poly(head, "slate", 0.6, step=30)
    a.outline_poly(head, MW * 1.4, second=0, over=1.0, gap=1.0)


# --------------------------------------------------------------------------------------------- pic: animals


def leg_post(a, top, bot, w, col, alpha=1.0, hoof=None, sock=None):
    """A straight animal leg; an optional sock (lower part in another colour) and hoof."""
    a.blob(capsule(top, bot, w, w * 0.88, n=4), col, alpha, w=MW * 1.4, second=0)
    if sock:
        a.blob(capsule(lerp(top, bot, 0.62), bot, w * 0.9, w * 0.86, n=4), sock, w=MW * 1.2, second=0)
    if hoof:
        a.block([add(bot, (-w * 1.0, -4)), add(bot, (w * 1.0, -4)), add(bot, (w * 1.1, 5)), add(bot, (-w * 1.1, 5))],
                hoof, w=MW * 1.2, second=0)


@art_key("pic_cat")
def pic_cat(a):
    ground(a, 30, 214, 206, marks=4)
    tail = ribbon([(164, 150), (184, 132), (192, 104), (184, 80), (172, 74)], 12, 7)
    a.blob(tail, "ochre", w=MW * 1.4, second=0)
    a.lines([(lerp((184, 132), (192, 104), t), add(lerp((184, 132), (192, 104), t), (8, 2))) for t in (0.2, 0.7)],
            MW, "clay", 0.9)
    for p0, p1 in (((96, 162), (92, 202)), ((152, 162), (158, 202))):
        a.blob(capsule(p0, p1, 8), "ochre", 0.85, w=MW * 1.3, second=0)
        a.hatch(capsule(p0, p1, 7), 70, 3.4, alpha=0.45)
    body = ellipse((126, 150), 54, 26, -3, n=16)
    a.fill_smooth(body, "ochre")
    a.lines([((x, 126 + abs(x - 126) * 0.05), (x + 4, 140)) for x in (110, 128, 146, 164)], MW * 1.2, "clay", 0.9)
    a.hatch(clip_half(body, (0, 160), (0, 1)), 20, 4, alpha=0.4)
    a.outline(body, LW, second=0.4)
    for p0, p1 in (((82, 160), (78, 204)), ((140, 164), (140, 204))):
        a.blob(capsule(p0, p1, 8.5), "ochre", w=MW * 1.3, second=0)
        a.ell(add(p1, (-3, 0)), 10, 5.5, "ochre", w=MW * 1.2, second=0)
    cat_head(a, Tf((0, 0), 2.1), (34, 54), 2.0)


@art_key("pic_dog")
def pic_dog(a):
    ground(a, 26, 220, 210, marks=4)
    tail = ribbon([(66, 132), (52, 116), (46, 96), (50, 82)], 11, 6)
    a.blob(tail, "clay", 0.85, w=MW * 1.4, second=0)
    motion_arcs(a, (50, 82), 14, 200, 250, w=MW)
    for p0, p1 in (((90, 160), (88, 206)), ((154, 160), (158, 206))):
        leg_post(a, p0, p1, 9, "clay", 0.65)
    body = [(60, 124), (90, 114), (150, 112), (176, 122), (182, 150), (168, 166), (100, 170), (64, 162)]
    a.fill_smooth(body, "clay", 0.85)
    a.fill_smooth([(150, 140), (176, 136), (178, 160), (160, 166)], "paper", 0.9, off=(0, 0))
    a.hatch(clip_half(body, (0, 156), (0, 1)), 20, 4, alpha=0.4)
    a.outline(body, LW, second=0.4)
    for p0, p1 in (((78, 162), (76, 208)), ((146, 164), (148, 208))):
        leg_post(a, p0, p1, 9.5, "clay", 0.85)
        a.ell(add(p1, (3, -1)), 11, 6, "paper", w=MW * 1.2, second=0)
    a.blob(capsule((160, 116), (184, 122), 6), "ochre", w=MW * 1.2, second=0)
    head = ellipse((180, 94), 27, 25, n=14)
    a.fill_smooth(head, "clay", 0.85)
    a.outline(head, LW, second=0.35)
    muz = ellipse((198, 110), 18, 13, -8, n=10)
    a.fill_smooth(muz, "paper", off=(0, 0))
    a.outline(muz, MW * 1.3, second=0)
    a.fill_smooth(ellipse((212, 102), 7, 5.5, n=8), "ink", 0.9, off=(0, 0))
    a.curve([(212, 108), (206, 116), (196, 116)], MW, jit=0.1)
    a.fill_smooth([(200, 116), (208, 116), (208, 126), (202, 128)], "clay")
    for e in ((174, 88), (192, 86)):
        a.dots([e], 7)
    for ear in (leaf_pts((164, 76), (154, 120), 11, asym=0.9), leaf_pts((196, 72), (208, 98), 8, asym=0.9)):
        a.fill_smooth(ear, "slate")
        a.hatch(ear, 80, 3.2, alpha=0.4)
        a.outline(ear, MW * 1.3, second=0, jit=0.2)


@art_key("pic_bird")
def pic_bird(a):
    br = ribbon([(14, 176), (90, 170), (160, 176), (228, 164)], 10, 7)
    a.blob(br, "ochre", w=MW * 1.3, second=0)
    a.hatch(br, 10, 3.6, alpha=0.35)
    for p0, p1 in (((196, 168), (226, 140)), ((178, 172), (196, 196))):
        lf = leaf_pts(p0, p1, 9)
        a.fill_smooth(lf, "sage")
        a.outline(lf, MW * 1.2, second=0, jit=0.2)
    tail = [(150, 140), (204, 168), (208, 150), (162, 124)]
    a.fill_smooth(tail, "slate")
    a.hatch(tail, 30, 3.4, alpha=0.4)
    a.outline(tail, MW * 1.3, second=0)
    body = ellipse((120, 128), 44, 36, -14, n=16)
    head = ellipse((88, 90), 27, 26, n=12)
    a.fill_smooth(body, "slate")
    a.fill_smooth(head, "slate")
    a.fill_smooth(ellipse((106, 146), 28, 22, -14, n=12), "ochre", 0.95)
    wing = leaf_pts((108, 116), (170, 142), 19, asym=0.7)
    a.fill_smooth(wing, "slate")
    a.fill_smooth(wing, "ink", 0.25)
    a.hatch(wing, 20, 3.4, color="paper", alpha=0.35)
    a.outline(wing, MW * 1.3, second=0, jit=0.2)
    a.outline(body, LW, second=0.35)
    a.outline(head, LW, second=0)
    a.fill_smooth([(64, 86), (46, 94), (64, 100)], "ochre")
    a.outline_poly([(64, 85), (45, 94), (64, 100)], MW * 1.2, second=0, over=0.8, gap=0.8)
    a.dots([(80, 84)], 7.5)
    for x in (114, 132):
        a.lines([((x, 160), (x - 3, 172)), ((x - 3, 172), (x - 10, 176)), ((x - 3, 172), (x + 4, 177))], MW * 1.2, amp=0.2)


@art_key("pic_fish")
def pic_fish(a):
    T = Tf((114 + a.j(2), 126), 1, -6)
    tail = T.pts([(52, 0), (88, -34), (98, -24), (80, 0), (98, 24), (88, 34)])
    a.blob(tail, "ochre", w=LW * 0.9, second=0)
    a.lines([(T((60, 0)), T((90, -22))), (T((60, 0)), T((90, 22))), (T((60, 0)), T((86, 0)))], FW * 1.2, alpha=0.6)
    for fin in (T.pts([(-14, -34), (6, -58), (34, -54), (34, -30)]), T.pts([(-10, 32), (6, 50), (22, 30)])):
        a.blob(fin, "ochre", w=MW * 1.3, second=0)
    body = T.pts([(-78, 2), (-62, -24), (-24, -38), (18, -36), (50, -18), (60, 0), (50, 18), (18, 36), (-24, 38),
                  (-62, 24)])
    a.fill_smooth(body, "clay")
    a.fill_smooth(clip_half(spline(body, True, 3), T((0, 14)), T.v((0, 1))), "ochre", 0.6)
    scales = Path()
    for row, y in enumerate((-18, 0, 18)):
        for k in range(4):
            x = -20 + k * 16 + (row % 2) * 8
            c = T((x, y))
            pts = [polar(c, 8, T.ang(t)) for t in (-70, -20, 30, 70)]
            smooth(scales, [a.jit(p, 0.3) for p in pts])
    a.stroke(scales, FW * 1.3, alpha=0.55)
    a.outline(body, LW, second=0.4)
    a.arc(T((-44, 0)), 22, T.ang(-60), T.ang(60), MW * 1.2)
    a.fill_smooth(ellipse(T((-58, -8)), 9, 9, n=10), "paper", off=(0, 0))
    a.ell_outline(T((-58, -8)), 9, 9, w=MW, second=0)
    a.dots([T((-60, -8))], 7)
    a.curve(T.pts([(-76, 6), (-70, 8), (-64, 6)]), MW, jit=0.1)
    for c, rr in (((36, 82), 6), ((26, 60), 4.5), ((38, 40), 3.5)):
        a.ell(c, rr, rr, w=MW, second=0)


@art_key("pic_cow")
def pic_cow(a):
    ground(a, 18, 226, 212, marks=5)
    a.curve([(196, 116), (204, 138), (206, 164)], MW * 1.3)
    a.hair([(200, 160), (212, 162), (214, 180), (204, 184), (200, 172)], 2.6)
    for p0, p1 in (((88, 160), (86, 208)), ((176, 158), (180, 208))):
        leg_post(a, p0, p1, 10, "clay", 0.65, hoof="slate", sock="paper")
    body = [(66, 104), (110, 96), (176, 98), (198, 114), (200, 156), (180, 168), (92, 170), (68, 158)]
    a.fill_smooth(body, "clay", 0.85)
    a.fill_smooth(clip_half(spline(body, True, 3), (176, 0), (1, 0)), "paper", 0.95, off=(0, 0))
    a.hatch(clip_half(body, (0, 156), (0, 1)), 20, 4.2, alpha=0.4)
    a.outline(body, LW, second=0.4)
    for p0, p1 in (((78, 164), (76, 210)), ((164, 164), (166, 210))):
        leg_post(a, p0, p1, 10.5, "clay", 0.85, hoof="slate", sock="paper")
    for p0, p1 in (((40, 86), (16, 96)), ((76, 86), (100, 92))):
        ear = leaf_pts(p0, p1, 9)
        a.fill_smooth(ear, "clay", 0.85)
        a.outline(ear, MW * 1.3, second=0, jit=0.2)
    for base, tip in (((44, 74), (34, 54)), ((70, 72), (80, 52))):
        horn = ribbon([base, lerp(base, tip, 0.5), tip], 9, 3)
        a.blob(horn, "paper", w=MW * 1.3, second=0)
    head = [(58, 66), (78, 72), (82, 100), (76, 126), (58, 134), (38, 126), (32, 100), (38, 72)]
    a.fill_smooth(head, "clay", 0.85)
    a.outline(head, LW, second=0.3)
    muz = ellipse((58, 132), 24, 15, n=12)
    a.fill_smooth(muz, "blush", 0.95)
    a.outline(muz, MW * 1.4, second=0)
    a.dots([(50, 132), (66, 131)], 6, "ink", 0.9)
    a.dots([(48, 96), (68, 95)], 7.5)
    a.fill_smooth(ellipse((58, 78), 9, 6, n=8), "paper", 0.9, off=(0, 0))


@art_key("pic_chicken")
def pic_chicken(a):
    ground(a, 36, 214, 206, marks=4)
    for k, (tip, w) in enumerate((((188, 74), 13), ((202, 96), 12), ((194, 120), 10))):
        f = leaf_pts((150, 124), tip, w, asym=0.8)
        a.fill_smooth(f, "slate")
        a.fill_smooth(f, "sage", 0.35)
        a.outline(f, MW * 1.3, second=0, jit=0.2)
    for x0, x1 in ((104, 100), (126, 128)):
        a.blob(capsule((x0, 166), (x1, 200), 3.6), "ochre", w=MW, second=0)
        a.lines([((x1, 200), (x1 - 12, 204)), ((x1, 200), (x1 + 4, 206)), ((x1, 200), (x1 + 10, 202))], MW, amp=0.2)
    body = [(68, 118), (90, 98), (130, 100), (160, 114), (170, 140), (154, 166), (112, 176), (80, 164), (64, 142)]
    head = ellipse((80, 84), 22, 22, n=12)
    a.fill_smooth(body, "ochre")
    a.fill_smooth(head, "ochre")
    wing = leaf_pts((98, 130), (156, 140), 20, asym=0.7)
    a.fill_smooth(wing, "clay", 0.6)
    a.lines([(lerp((98, 130), (156, 140), t), add(lerp((98, 130), (156, 140), t), (10, 10))) for t in (0.35, 0.55, 0.75)],
            FW * 1.3, alpha=0.6)
    a.outline(wing, MW * 1.3, second=0, jit=0.2)
    a.hatch(clip_half(body, (0, 156), (0, 1)), 20, 4, alpha=0.4)
    a.outline(body, LW, second=0.4)
    a.outline(head, LW, second=0)
    comb = [(66, 68), (68, 54), (76, 60), (82, 48), (88, 58), (96, 52), (96, 66)]
    a.fill_smooth(comb, "clay")
    a.outline(comb, MW * 1.2, second=0, jit=0.2)
    wat = [(64, 98), (70, 96), (72, 110), (66, 116), (60, 108)]
    a.fill_smooth(wat, "clay")
    a.outline(wat, MW, second=0, jit=0.2)
    a.fill_smooth([(60, 82), (44, 90), (60, 96)], "ochre")
    a.fill_smooth([(60, 82), (44, 90), (60, 96)], "clay", 0.5)
    a.outline_poly([(60, 81), (43, 90), (60, 97)], MW * 1.2, second=0, over=0.8, gap=0.8)
    a.dots([(74, 80)], 7)


@art_key("pic_rabbit")
def pic_rabbit(a):
    ground(a, 40, 212, 210, marks=4)
    for base, tip, w in (((92, 94), (74, 22), 13), ((106, 92), (120, 26), 12)):
        ear = leaf_pts(base, tip, w, asym=0.9)
        a.fill_smooth(ear, "slate", 0.55)
        a.fill_smooth(leaf_pts(lerp(base, tip, 0.15), lerp(base, tip, 0.85), w * 0.45), "blush", 0.9)
        a.outline(ear, MW * 1.4, second=0, jit=0.2)
    body = [(96, 206), (84, 174), (90, 142), (112, 124), (148, 126), (174, 150), (180, 184), (166, 206)]
    a.fill_smooth(body, "slate", 0.55)
    a.hatch(clip_half(body, (150, 0), (1, 0)), 65, 4.2, alpha=0.4)
    a.outline(body, LW, second=0.4)
    tail = ellipse((182, 182), 14, 13, n=10)
    a.fill_smooth(tail, "paper", off=(0, 0))
    a.outline(tail, MW * 1.3, second=0, jit=0.3)
    a.ell((150, 206), 24, 7, "slate", 0.55, w=MW * 1.3, second=0)
    head = ellipse((92, 114), 30, 25, -8, n=14)
    a.fill_smooth(head, "slate", 0.55)
    a.outline(head, LW, second=0.3)
    a.ell((96, 204), 10, 6, "slate", 0.55, w=MW * 1.2, second=0)
    a.dots([(82, 108)], 7.5)
    a.fill_smooth(ellipse((64, 118), 4.5, 3.5, n=6), "blush", off=(0, 0))
    a.curve([(64, 122), (66, 128), (72, 128)], FW * 1.3, jit=0.1)
    a.lines([((62, 120), (42, 116)), ((62, 123), (44, 128))], FW, alpha=0.8, amp=0.2)
    a.fill_smooth(ellipse((98, 124), 7, 4, n=6), "blush", 0.8)


@art_key("pic_horse")
def pic_horse(a):
    ground(a, 16, 226, 214, marks=5)
    tail = ribbon([(186, 104), (202, 120), (206, 150), (200, 172)], 14, 6)
    a.hair(tail, 3)
    for p0, p1 in (((84, 140), (82, 208)), ((166, 140), (172, 208))):
        leg_post(a, p0, p1, 8, "clay", 0.6, hoof="slate")
    body = [(70, 96), (110, 90), (170, 92), (192, 108), (190, 136), (170, 150), (92, 152), (70, 138)]
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(body, (0, 140), (0, 1)), 20, 4.2, alpha=0.4)
    a.outline(body, LW, second=0.4)
    for p0, p1 in (((78, 146), (76, 210)), ((156, 146), (158, 210))):
        leg_post(a, p0, p1, 8.5, "clay", hoof="slate")
    neck = [(70, 124), (62, 96), (54, 70), (64, 52), (84, 58), (94, 90), (102, 108)]
    a.fill_smooth(neck, "clay")
    head = [(68, 46), (52, 48), (36, 66), (24, 90), (28, 102), (44, 104), (60, 86), (78, 66)]
    a.fill_smooth(head, "clay")
    a.fill_smooth([(24, 90), (30, 80), (40, 86), (44, 104), (28, 102)], "slate", 0.45)
    mane = [(66, 40), (80, 46), (92, 72), (104, 100), (96, 104), (82, 76), (70, 56)]
    a.hair(mane, 3)
    a.outline(neck, LW, second=0)
    a.outline(head, LW, second=0.3)
    ear = leaf_pts((64, 48), (70, 26), 6)
    a.fill_smooth(ear, "clay")
    a.outline(ear, MW * 1.2, second=0, jit=0.2)
    a.dots([(54, 64)], 7)
    a.dots([(31, 92)], 4, "ink", 0.8)


@art_key("pic_goat")
def pic_goat(a):
    ground(a, 30, 220, 208, marks=4)
    a.fill_smooth([(64, 112), (54, 94), (70, 106)], "paper", off=(0, 0))
    a.outline_poly([(64, 112), (53, 93), (70, 106)], MW, closed=False, second=0)
    for p0, p1 in (((84, 152), (82, 204)), ((146, 152), (150, 204))):
        leg_post(a, p0, p1, 6.5, "ochre", 0.55, hoof="slate")
    body = [(62, 112), (100, 104), (150, 106), (168, 120), (166, 150), (150, 160), (88, 160), (64, 148)]
    a.fill_smooth(body, "paper", off=(0, 0))
    a.fill_smooth(ellipse((96, 126), 22, 14, 10, n=10), "ochre", 0.75)
    a.fill_smooth(ellipse((146, 140), 14, 11, n=9), "ochre", 0.75)
    a.hatch(clip_half(body, (0, 148), (0, 1)), 20, 4.2, alpha=0.4)
    a.outline(body, LW, second=0.4)
    for p0, p1 in (((74, 156), (72, 206)), ((138, 156), (140, 206))):
        leg_post(a, p0, p1, 7, "paper", hoof="slate")
    for base, mid_, tip in (((176, 76), (166, 56), (154, 62)), ((184, 74), (178, 52), (166, 54))):
        a.blob(ribbon([base, mid_, tip], 8, 3), "slate", w=MW * 1.2, second=0)
    head = [(158, 118), (162, 92), (176, 74), (196, 76), (210, 96), (208, 108), (192, 108), (176, 122)]
    a.fill_smooth(head, "paper", off=(0, 0))
    a.outline(head, LW, second=0.3)
    beard = leaf_pts((194, 106), (188, 134), 7)
    a.fill_smooth(beard, "ochre", 0.75)
    a.outline(beard, MW * 1.2, second=0, jit=0.2)
    ear = leaf_pts((172, 88), (148, 100), 8)
    a.fill_smooth(ear, "ochre", 0.75)
    a.outline(ear, MW * 1.2, second=0, jit=0.2)
    a.dots([(186, 88)], 7)
    a.dots([(206, 98)], 4, "ink", 0.8)


@art_key("pic_duck")
def pic_duck(a):
    body = [(48, 128), (66, 132), (110, 118), (160, 124), (178, 146), (166, 166), (110, 172), (66, 166), (52, 148)]
    a.fill_smooth(body, "paper", off=(0, 0))
    a.fill_smooth(body, "ochre", 0.18)
    wing = leaf_pts((84, 136), (150, 140), 16, asym=0.6)
    a.hatch(wing, 20, 3.6, alpha=0.4)
    a.outline(wing, MW * 1.3, second=0, jit=0.2)
    neck = [(146, 130), (150, 104), (160, 94), (176, 104), (172, 130)]
    a.fill_smooth(neck, "paper", off=(0, 0))
    a.fill_smooth(neck, "ochre", 0.18)
    a.outline(body, LW, second=0.4)
    head = ellipse((164, 86), 23, 21, n=12)
    a.fill_smooth(head, "paper", off=(0, 0))
    a.fill_smooth(head, "ochre", 0.18)
    a.outline(head, LW, second=0)
    bill = [(182, 84), (204, 86), (214, 94), (204, 100), (182, 98)]
    a.fill_smooth(bill, "ochre")
    a.fill_smooth(bill, "clay", 0.45)
    a.outline(bill, MW * 1.3, second=0, jit=0.2)
    a.line((184, 93), (206, 94), FW * 1.2, amp=0.2)
    a.dots([(168, 80)], 7)
    wy = 162
    water = [(0, wy)] + [(x, wy + 3 * math.sin(x / 12)) for x in range(10, 241, 15)] + [(240, 240), (0, 240)]
    a.fill_poly(water, "slate", 0.35, off=(0, 0), step=40)
    for k, y in enumerate((wy + 1, 186, 210)):
        a.curve([(4 + (k % 2) * 16 + i * 22, y + 3 * math.sin(i * 1.7 + k)) for i in range(11)],
                MW * (1.3 if k == 0 else 1.0), "ink" if k == 0 else "slate", 0.85)


@art_key("pic_elephant")
def pic_elephant(a):
    ground(a, 14, 226, 214, marks=5)
    a.curve([(204, 110), (210, 132), (212, 152)], MW * 1.3)
    a.hair([(208, 148), (218, 150), (218, 166), (210, 166)], 2.4)
    for p0, p1 in (((96, 150), (94, 206)), ((178, 148), (182, 206))):
        leg_post(a, p0, p1, 14, "slate", 0.7)
    body = [(72, 92), (120, 74), (180, 78), (206, 102), (206, 140), (186, 160), (98, 162), (74, 146)]
    a.fill_smooth(body, "slate")
    a.hatch(clip_half(body, (0, 148), (0, 1)), 20, 4.4, alpha=0.4)
    a.outline(body, LW, second=0.4)
    for p0, p1 in (((84, 150), (82, 210)), ((164, 152), (166, 210))):
        leg_post(a, p0, p1, 15, "slate")
        a.dots([add(p1, (dx, -1)) for dx in (-8, 0, 8)], 4.4, "paper", 0.9)
    head = ellipse((62, 98), 40, 38, n=16)
    a.fill_smooth(head, "slate")
    trunk = ribbon([(40, 110), (30, 140), (30, 170), (40, 186), (54, 182)], 24, 9, steps=3)
    a.fill_smooth(trunk, "slate")
    a.outline(head, LW, second=0.3)
    a.outline(trunk, LW, second=0)
    a.lines([(add(p, (-9, 0)), add(p, (8, 0))) for p in ((32, 140), (31, 154), (33, 168))], FW * 1.3, alpha=0.6)
    tusk = ribbon([(48, 126), (56, 140), (70, 144)], 7, 3)
    a.blob(tusk, "paper", w=MW * 1.2, second=0)
    ear = [(76, 66), (110, 70), (120, 100), (112, 132), (88, 138), (76, 116)]
    a.fill_smooth(ear, "slate")
    a.fill_smooth(ear, "blush", 0.35)
    a.hatch(ear, 60, 4.2, alpha=0.35)
    a.outline(ear, LW, second=0.3)
    a.dots([(52, 90)], 7.5)
    a.curve([(44, 84), (52, 80), (60, 82)], FW * 1.3, alpha=0.7)


@art_key("pic_monkey")
def pic_monkey(a):
    ground(a, 52, 214, 214, marks=4)
    tail = ribbon([(146, 200), (186, 196), (206, 170), (206, 140), (194, 128), (184, 138)], 9, 6, steps=3)
    a.blob(tail, "clay", 0.85, w=MW * 1.4, second=0)
    body = [(92, 210), (86, 172), (96, 140), (120, 130), (144, 140), (154, 172), (148, 210)]
    a.fill_smooth(body, "clay", 0.85)
    a.fill_smooth(ellipse((120, 178), 21, 24, n=10), "ochre", 0.8)
    a.outline(body, LW, second=0.4)
    for c in ((98, 210), (142, 210)):
        a.ell(c, 15, 7, "clay", 0.85, w=MW * 1.3, second=0)
    for c in ((82, 92), (158, 92)):
        a.fill_smooth(ellipse(c, 14, 14, n=9), "clay", 0.85)
        a.fill_smooth(ellipse(c, 7.5, 7.5, n=7), "blush", 0.9)
        a.ell_outline(c, 14, 14, w=MW * 1.3, second=0)
    head = ellipse((120, 94), 37, 33, n=14)
    a.fill_smooth(head, "clay", 0.85)
    a.outline(head, LW, second=0.3)
    face_ = [(120, 84), (132, 72), (148, 80), (148, 100), (136, 118), (120, 122), (104, 118), (92, 100), (92, 80),
             (108, 72)]
    a.fill_smooth(face_, "ochre", 0.85)
    a.outline(face_, MW * 1.3, second=0, jit=0.2)
    a.dots([(110, 90), (131, 89)], 7.5)
    a.dots([(117, 104), (124, 104)], 3, "ink", 0.8)
    a.curve([(110, 110), (121, 116), (132, 110)], MW, jit=0.1)
    ban = ribbon([(96, 168), (110, 156), (130, 152), (148, 160)], 13, 7)
    a.fill_smooth(ban, "ochre")
    a.outline(ban, MW * 1.4, second=0, jit=0.2)
    a.dots([(148, 160)], 5)
    for s, h in (((98, 144), (102, 168)), ((142, 144), (138, 164))):
        a.blob(capsule(s, h, 8), "clay", 0.85, w=MW * 1.3, second=0)
        a.ell(h, 8, 8, "clay", 0.85, w=MW * 1.2, second=0)


@art_key("glyph_listen")
def glyph_listen(a):
    box = [(40, 98), (72, 96), (72, 146), (40, 144)]
    cone = [(72, 96), (118, 58), (122, 186), (72, 146)]
    a.fill_poly(cone, "slate", 0.9)
    a.fill_poly(box, "slate")
    a.stroke(a.sketch_poly(box + [], closed=True), LW * 1.2)
    a.stroke(a.sketch_poly([(72, 96), (118, 58), (122, 186), (72, 146)], closed=False), LW * 1.2)
    for rr, wb in ((38, 15), (70, 15)):
        arc = [polar((120, 122), rr, t) for t in range(-48, 49, 16)]
        glyph_under(a, arc, wb, "ochre")
        a.curve(arc, 4.2, jit=0.6)


@art_key("glyph_drag")
def glyph_drag(a):
    hand = [(70, 214), (64, 168), (48, 140), (44, 122), (56, 118), (70, 134), (72, 92), (70, 52), (78, 40), (90, 42),
            (94, 58), (96, 104), (104, 96), (116, 98), (120, 110), (130, 104), (142, 108), (146, 120), (156, 118),
            (166, 126), (164, 160), (150, 192), (148, 214)]
    a.fill_smooth(hand, "ochre", 0.4)
    a.curve(hand, 4.2, jit=0.5)
    a.lines([((96, 104), (98, 126)), ((120, 110), (121, 128)), ((146, 120), (145, 136))], 2.0, amp=0.3)
    pts = [(118, 66), (150, 58), (184, 56), (206, 60)]
    glyph_under(a, pts, 15, "sage")
    a.curve(pts, 4.2, jit=0.5)
    end, d = pts[-1], unit(sub(pts[-1], pts[-2]))
    a.zig([add(end, mul(rotp(d, 148), 20)), end, add(end, mul(rotp(d, -148), 20))], 4.2, jit=0.4)


@art_key("glyph_trace")
def glyph_trace(a):
    path = [(30, 188), (52, 150), (82, 132), (110, 140), (128, 118)]
    glyph_under(a, path, 15, "ochre", 0.6)
    sp = spline(path, False, 6)
    a.dots(sp[::2], 6.0, "ink", 0.9)
    P = Tf((130, 116), 1.3, -48)
    body = P.pts([(15, -7), (78, -7), (78, 7), (15, 7)])
    a.fill_poly(body, "clay", 0.95)
    a.fill_poly(P.pts([(78, -7), (88, -7), (88, 7), (78, 7)]), "slate", 0.9)
    a.fill_poly(P.pts([(0, 0), (15, -7), (15, 7)]), "paper", off=(0, 0))
    a.fill_poly(P.pts([(0, 0), (5, -2.4), (5, 2.4)]), "ink", 0.95, off=(0, 0))
    a.outline_poly(P.pts([(0, 0), (15, -7), (88, -7), (90, 0), (88, 7), (15, 7)]), 4.0, second=0, over=1.2, gap=1.2)
    a.lines([(P((15, -7)), P((15, 7))), (P((78, -7)), P((78, 7)))], 2.2, amp=0.2)


@art_key("glyph_connect")
def glyph_connect(a):
    p0, p1 = (52, 158), (190, 80)
    mid = [lerp(p0, p1, t) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
    wob = [add(p, mul(perp(unit(sub(p1, p0))), 12 * math.sin(i * 2.2))) for i, p in enumerate(mid)]
    glyph_under(a, wob, 13, "sage")
    a.curve(wob, 4.0, jit=0.6)
    for c, col in ((p0, "clay"), (p1, "clay")):
        a.fill_smooth(ellipse(c, 17, 17, n=10), col)
        a.ell_outline(c, 17, 17, w=4.0, second=0)


# --------------------------------------------------------------------------------------------- pic: home & school


def pane_window(a, x, y, w, h, frame="ochre", glass="slate", shutters=None):
    """A wooden window: glass tint, cross bars, frame; optional open shutters (colour)."""
    if shutters:
        for sx, pts in ((-1, [(x - w * 0.42, y - 3), (x, y), (x, y + h), (x - w * 0.42, y + h + 3)]),
                        (1, [(x + w, y), (x + w * 1.42, y - 3), (x + w * 1.42, y + h + 3), (x + w, y + h)])):
            a.fill_poly(pts, shutters, 0.9)
            a.lines([(lerp(pts[0], pts[3], t), lerp(pts[1], pts[2], t)) for t in (0.2, 0.4, 0.6, 0.8)], FW * 1.2, alpha=0.6)
            a.outline_poly(pts, MW * 1.2, second=0)
    win = rect(x, y, w, h)
    a.fill_poly(win, glass, 0.4)
    a.lines([((x + w / 2, y), (x + w / 2, y + h)), ((x, y + h / 2), (x + w, y + h / 2))], MW * 1.2, amp=0.3)
    a.line((x + w * 0.2, y + h * 0.12), (x + w * 0.36, y + h * 0.04), MW, "paper", 0.8, amp=0.1)
    a.outline_poly(win, LW * 0.9, second=0)


@art_key("pic_house")
def pic_house(a):
    ground(a, 20, 222, 206, marks=5)
    wall = rect(48, 112, 146, 92)
    a.fill_poly(wall, "ochre", 0.7)
    a.hatch(clip_half(wall, (172, 0), (1, 0)), 75, 4.4, alpha=0.35)
    a.outline_poly(wall, LW, second=0.4)
    door = rect(106, 146, 30, 58)
    a.block(door, "slate", w=MW * 1.4, second=0)
    a.dots([(130, 176)], 4, "ochre")
    for x in (60, 154):
        pane_window(a, x, 132, 28, 30, shutters="sage")
    roof = [(28, 118), (214, 118), (180, 58), (62, 58)]
    a.fill_poly(roof, "clay")
    for t in (0.3, 0.55, 0.8):
        a.curve([lerp(roof[3], roof[0], t), lerp(roof[2], roof[1], t)], FW * 1.4, alpha=0.6)
    a.hatch(clip_half(roof, (150, 0), (1, 0)), 65, 5, alpha=0.35)
    a.outline_poly(roof, LW, second=0.4)
    a.block([(100, 204), (142, 204), (146, 212), (96, 212)], "slate", 0.5, w=MW, second=0)


@art_key("pic_school")
def pic_school(a):
    """A school: a long low building with a row of windows, a central door and the flagpole in the yard. The flag is
    red over white (merah putih), plain, as on any Indonesian school (flagged in the brief for Umar's confirmation)."""
    ground(a, 12, 228, 206, marks=5)
    a.line((26, 206), (24, 34), LW, amp=0.5)
    a.dots([(24, 30)], 8, "ochre")
    flag = [(26, 36), (66, 38), (64, 62), (26, 60)]
    a.fill_poly(flag[:2] + [lerp(flag[1], flag[2], 0.5), lerp(flag[0], flag[3], 0.5)], "clay")
    a.fill_poly([lerp(flag[0], flag[3], 0.5), lerp(flag[1], flag[2], 0.5), flag[2], flag[3]], "paper", off=(0, 0))
    a.outline_poly(flag, MW * 1.3, second=0)
    wall = rect(58, 116, 168, 88)
    a.fill_poly(wall, "ochre", 0.5)
    a.hatch(clip_half(wall, (206, 0), (1, 0)), 75, 4.4, alpha=0.35)
    a.outline_poly(wall, LW, second=0.4)
    for x in (68, 98, 172, 200):
        pane_window(a, x, 134, 20, 26)
    door = rect(130, 140, 26, 64)
    a.block(door, "slate", w=MW * 1.4, second=0)
    a.line((143, 142), (143, 202), FW * 1.3)
    sign = rect(120, 120, 46, 14)
    a.block(sign, "paper", w=MW * 1.2, second=0)
    roof = [(48, 120), (236, 120), (218, 86), (66, 86)]
    a.fill_poly(roof, "clay")
    a.hatch(roof, 0, 6, alpha=0.35)
    a.outline_poly(roof, LW, second=0.4)
    a.block([(124, 204), (162, 204), (166, 212), (120, 212)], "slate", 0.5, w=MW, second=0)


@art_key("pic_book")
def pic_book(a):
    T = Tf((118 + a.j(2), 124), 1, -10)
    pages = T.pts([(-54, -70), (66, -70), (70, 78), (-52, 80)])
    a.fill_poly(pages, "paper", off=(0, 0))
    a.lines([(T((62 + k * 2.5, -64)), T((66 + k * 2.5, 74))) for k in range(2)], FW, alpha=0.5, amp=0.2)
    a.lines([(T((-48, 78 + k * 2.5)), T((64, 76 + k * 2.5))) for k in range(1)], FW, alpha=0.5, amp=0.2)
    a.outline_poly(pages, MW * 1.2, second=0)
    rib = T.pts([(28, 70), (40, 70), (40, 110), (34, 100), (28, 110)])
    a.block(rib, "ochre", w=MW * 1.2, second=0)
    cover = T.pts(rect(-62, -78, 120, 152))
    a.fill_poly(cover, "slate")
    spine = T.pts(rect(-62, -78, 20, 152))
    a.fill_poly(spine, "ink", 0.3, off=a.reg("slate"))
    a.hatch(spine, T.ang(80), 3.8, alpha=0.4)
    label = T.pts(rect(-24, -52, 64, 34))
    a.block(label, "paper", w=MW * 1.2, second=0)
    a.lines([(T((-16, -40)), T((30, -40))), (T((-16, -30)), T((18, -30)))], FW * 1.4, alpha=0.5, amp=0.3)
    a.outline_poly(cover, LW, second=0.45)
    a.line(T((-42, -78)), T((-42, 74)), MW, amp=0.3)


@art_key("pic_pen")
def pic_pen(a):
    a.curve([(30, 214), (48, 204), (60, 214), (76, 202), (90, 210)], MW * 1.4, "slate", 0.9, jit=0.3)
    P = Tf((92, 196), 1, -48)
    body = P.pts([(18, -9), (150, -9), (150, 9), (18, 9)])
    a.fill_poly(body, "sage")
    a.hatch(P.pts([(18, 2), (150, 2), (150, 9), (18, 9)]), P.ang(0), 3.4, alpha=0.4, inset=(0.4, 1.2))
    grip = P.pts([(18, -9), (46, -9), (46, 9), (18, 9)])
    a.fill_poly(grip, "slate", 0.8)
    a.lines([(P((24 + k * 6, -9)), P((24 + k * 6, 9))) for k in range(4)], FW * 1.2, alpha=0.6, amp=0.1)
    a.fill_poly(P.pts([(0, 0), (18, -8), (18, 8)]), "slate", 0.6)
    a.outline_poly(P.pts([(0, 0), (18, -9), (150, -9), (156, 0), (150, 9), (18, 9)]), LW, second=0, over=1.2, gap=1.2)
    cap = P.pts([(108, -11), (156, -11), (162, 0), (156, 11), (108, 11)])
    a.block(cap, "slate", w=MW * 1.4, second=0)
    clip_ = P.pts([(114, -12), (152, -12), (152, -18), (118, -18)])
    a.block(clip_, "ochre", w=MW * 1.2, second=0)
    a.dots([P((1, 0))], 4, "ink")


@art_key("pic_pencil")
def pic_pencil(a):
    P = Tf((56, 190), 1.45, -42)
    body = P.pts([(15, -8), (96, -8), (96, 8), (15, 8)])
    a.fill_poly(body, "ochre")
    a.fill_poly(P.pts([(15, 2.6), (96, 2.6), (96, 8), (15, 8)]), "clay", 0.25)
    a.lines([(P((18, -2.6)), P((94, -2.6))), (P((18, 2.6)), P((94, 2.6)))], FW * 1.2, alpha=0.5, amp=0.2)
    a.fill_poly(P.pts([(96, -8), (108, -8), (108, 8), (96, 8)]), "slate", 0.9)
    a.hatch(P.pts([(96, -8), (108, -8), (108, 8), (96, 8)]), P.ang(90), 3.0, alpha=0.6, inset=(0.3, 0.8))
    a.fill_poly(P.pts([(108, -8), (118, -7), (121, 0), (118, 7), (108, 8)]), "blush", 0.95)
    a.fill_poly(P.pts([(0, 0), (15, -8), (15, 8)]), "paper", off=(0, 0))
    a.zig(P.pts([(15, -8), (12, -4), (15, -1), (12, 3), (15, 8)]), FW, jit=0.2)
    a.fill_poly(P.pts([(0, 0), (5, -2.6), (5, 2.6)]), "ink", 0.95, off=(0, 0))
    a.outline_poly(P.pts([(0, 0), (15, -8), (118, -7), (121, 0), (118, 7), (15, 8)]), LW, second=0, over=1.2, gap=1.2)
    a.lines([(P((96, -8)), P((96, 8))), (P((108, -8)), P((108, 8)))], MW, amp=0.2)


@art_key("pic_bag")
def pic_bag(a):
    a.curve([(102, 64), (104, 40), (136, 38), (140, 62)], LW * 1.1)
    for pts in ([(70, 76), (50, 120), (52, 190), (66, 204)], [(170, 76), (190, 120), (188, 190), (174, 204)]):
        a.curve(pts, 7, "slate")
        a.curve(pts, FW, alpha=0.6)
    body = [(70, 82), (88, 62), (152, 62), (172, 82), (176, 196), (164, 212), (78, 212), (64, 196)]
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(body, (150, 0), (1, 0)), 72, 4.4, alpha=0.4)
    a.outline(body, LW, second=0.4)
    a.curve([(72, 96), (120, 88), (168, 96)], MW, alpha=0.8)
    a.dots([(152, 92)], 5, "slate")
    pocket = [(84, 140), (156, 138), (160, 194), (82, 196)]
    a.fill_smooth(pocket, "ochre")
    a.outline(pocket, LW * 0.9, second=0)
    a.curve([(86, 152), (120, 148), (158, 150)], MW, alpha=0.8)
    a.line((140, 150), (142, 166), MW * 1.4, "slate", amp=0.1)


@art_key("pic_table")
def pic_table(a):
    ground(a, 20, 226, 212, marks=5)
    for p0, p1 in (((52, 112), (54, 176)), ((194, 104), (196, 168))):
        leg_post(a, p0, p1, 5.5, "ochre", 0.7)
    top = [(30, 104), (180, 94), (218, 120), (64, 134)]
    a.fill_poly(top, "ochre")
    a.lines([(lerp(top[0], top[3], t), lerp(top[1], top[2], t)) for t in (0.3, 0.62)], FW * 1.3, "clay", 0.6, amp=1.2)
    edge = [top[3], top[2], add(top[2], (0, 12)), add(top[3], (0, 12))]
    a.fill_poly(edge, "clay", 0.8)
    a.outline_poly(top, LW, second=0.4)
    a.outline_poly(edge, MW * 1.3, second=0)
    for p0, p1 in (((70, 146), (72, 210)), ((210, 132), (208, 200))):
        leg_post(a, p0, p1, 6, "ochre")


@art_key("pic_chair")
def pic_chair(a):
    ground(a, 34, 214, 214, marks=4)
    for p0, p1 in (((86, 128), (84, 196)), ((152, 122), (154, 190))):
        leg_post(a, p0, p1, 5, "ochre", 0.7)
    for p0, p1 in (((82, 132), (78, 30)), ((152, 124), (150, 24))):
        leg_post(a, p0, p1, 5.5, "ochre")
    for y0 in (44, 72):
        slat = [(78, y0 + 6), (150, y0), (150, y0 + 16), (78, y0 + 22)]
        a.block(slat, "clay", 0.85, w=MW * 1.3, second=0)
    seat = [(64, 134), (150, 126), (182, 146), (98, 156)]
    a.fill_poly(seat, "ochre")
    a.hatch(seat, -6, 6, alpha=0.3)
    edge = [seat[3], seat[2], add(seat[2], (0, 10)), add(seat[3], (0, 10))]
    a.fill_poly(edge, "clay", 0.8)
    a.outline_poly(seat, LW, second=0.4)
    a.outline_poly(edge, MW * 1.3, second=0)
    for p0, p1 in (((70, 140), (68, 212)), ((100, 164), (102, 214)), ((178, 154), (180, 206))):
        leg_post(a, p0, p1, 5.5, "ochre")


@art_key("pic_door")
def pic_door(a):
    frame = rect(54, 22, 132, 194)
    a.fill_poly(frame, "slate", 0.85)
    a.outline_poly(frame, LW, second=0.4)
    inside_ = rect(66, 34, 108, 182)
    a.fill_poly(inside_, "ink", 0.7, off=(0, 0))
    a.fill_poly(inside_, "slate", 0.5)
    leaf = [(66, 34), (146, 42), (146, 210), (66, 216)]
    a.fill_poly(leaf, "ochre")
    a.hatch(clip_half(leaf, (126, 0), (1, 0)), 80, 4.4, alpha=0.35)
    for y0, y1 in ((52, 116), (132, 196)):
        pnl = [(76, y0), (134, y0 + 5), (134, y1 + 2), (76, y1 + 4)]
        a.outline_poly(pnl, MW, second=0)
    a.outline_poly(leaf, LW, second=0.4)
    a.ell((134, 126), 6, 6, "slate", w=MW * 1.2, second=0)
    mat = [(48, 216), (190, 216), (198, 228), (40, 228)]
    a.block(mat, "sage", w=MW * 1.3, second=0)
    a.hatch(mat, 70, 4, alpha=0.4)


@art_key("pic_window")
def pic_window(a):
    x, y, w, h = 70, 50, 100, 116
    win = rect(x, y, w, h)
    a.fill_poly(win, "slate", 0.3)
    cl = [(96, 86), (104, 76), (116, 78), (122, 70), (134, 72), (140, 82), (132, 90), (98, 92)]
    a.fill_smooth(cl, "paper", off=(0, 0))
    a.outline(cl, MW, second=0, jit=0.2)
    for sx, pts in ((-1, [(30, 46), (x, y), (x, y + h), (30, y + h + 4)]), (1, [(x + w, y), (210, 46), (210, y + h + 4),
                                                                              (x + w, y + h)])):
        a.fill_poly(pts, "sage", 0.95)
        a.lines([(lerp(pts[0], pts[3], t), lerp(pts[1], pts[2], t)) for t in (0.14, 0.28, 0.42, 0.56, 0.7, 0.84)],
                FW * 1.3, alpha=0.6)
        a.outline_poly(pts, MW * 1.3, second=0)
    frame = Path()
    a.seg((x + w / 2, y), (x + w / 2, y + h), 0.3, frame)
    a.seg((x, y + h * 0.45), (x + w, y + h * 0.45), 0.3, frame)
    a.stroke(frame, 4.4, "ochre")
    a.stroke(frame, FW)
    a.outline_poly(win, LW, second=0.4)
    sill = rect(60, y + h, 120, 12)
    a.block(sill, "ochre", w=MW * 1.4, second=0)
    pot = [(146, y + h - 22), (168, y + h - 22), (164, y + h), (150, y + h)]
    for tip in ((142, y + h - 46), (160, y + h - 52), (174, y + h - 40)):
        lf = leaf_pts((157, y + h - 20), tip, 6)
        a.fill_smooth(lf, "sage")
        a.outline(lf, FW * 1.3, second=0, jit=0.2)
    a.block(pot, "clay", w=MW * 1.2, second=0)


@art_key("pic_bed")
def pic_bed(a):
    ground(a, 16, 226, 212, marks=5)
    head = [(26, 84), (48, 80), (50, 206), (28, 206)]
    a.block(head, "ochre", w=LW, second=0.4)
    a.hatch(head, 80, 4.4, alpha=0.4)
    foot = [(196, 128), (214, 126), (214, 206), (196, 206)]
    a.block(foot, "ochre", w=LW, second=0.4)
    frame = [(48, 168), (198, 168), (198, 188), (48, 188)]
    a.block(frame, "clay", 0.85, w=MW * 1.4, second=0)
    mat = [(48, 142), (198, 142), (198, 168), (48, 168)]
    a.fill_poly(mat, "paper", off=(0, 0))
    a.hatch(mat, 90, 9, w=MW, color="slate", alpha=0.35)
    a.outline_poly(mat, MW * 1.3, second=0)
    pil = [(54, 122), (100, 116), (106, 140), (56, 144)]
    a.blob(pil, "paper", w=MW * 1.5, second=0)
    a.curve([(62, 128), (82, 126), (98, 124)], FW, alpha=0.5)
    blanket = [(96, 138), (126, 128), (198, 130), (204, 140), (202, 178), (190, 180), (186, 150), (112, 150)]
    a.fill_smooth(blanket, "sage")
    a.hatch(blanket, 60, 8, w=MW, color="paper", alpha=0.35)
    a.outline(blanket, LW, second=0.4)


@art_key("pic_phone")
def pic_phone(a):
    T = Tf((120 + a.j(2), 122), 1, 8)
    body = T.pts([(-46, -90), (46, -90), (50, -84), (50, 86), (44, 92), (-44, 92), (-50, 86), (-50, -84)])
    a.fill_smooth(body, "slate")
    a.outline(body, LW, second=0.4)
    scr = T.pts(rect(-40, -74, 80, 148))
    a.fill_poly(scr, "sage", 0.55)
    a.hatch(clip_half(scr, T((10, 0)), T.v((1, 0.4))), T.ang(60), 7, color="paper", alpha=0.25)
    a.outline_poly(scr, MW * 1.2, second=0)
    for (ix, iy), col in (((-22, -50), "ochre"), ((6, -50), "clay"), ((-22, -22), "paper"), ((6, -22), "slate")):
        icon = T.pts(rect(ix, iy, 18, 18))
        a.blob(icon, col, 0.95, w=MW, second=0)
    a.line(T((-12, -82)), T((12, -82)), MW * 1.4, "ink", 0.8, amp=0.1)
    a.line(T((-16, 82)), T((16, 82)), MW * 1.4, "paper", 0.9, amp=0.1)


@art_key("pic_ball")
def pic_ball(a):
    c, R = (120 + a.j(2), 120), 80
    a.fill_smooth(ellipse(c, R, R, n=20), "paper", off=(0, 0))
    C = add(c, (5, 3))
    th = [-90 + 72 * i + 12 for i in range(5)]
    cen = [polar(C, 21, t) for t in th]
    outer = []
    for t in th:
        o = polar(C, 61, t)
        outer.append([polar(o, 19, t + 180 + 72 * j) for j in range(5)])

    def inb(p):
        d = sub(p, c)
        L = vlen(d)
        return p if L <= R - 2 else add(c, mul(d, (R - 2) / L))

    for pent in [cen] + outer:
        q = clip_convex(pent, ellipse(c, R - 2, R - 2, n=40))
        if len(q) > 2:
            a.fill_poly(q, "slate", step=12)
            a.outline_poly(q, MW, second=0)
    seams = []
    for i in range(5):
        seams.append((cen[i], outer[i][0]))
        seams.append((outer[i][4], outer[(i + 1) % 5][1]))
        seams.append((outer[i][2], polar(outer[i][2], 24, th[i] - 30)))
        seams.append((outer[i][3], polar(outer[i][3], 24, th[i] + 30)))
    a.lines([(inb(p), inb(q)) for p, q in seams if vlen(sub(lerp(p, q, 0.5), c)) < R - 4], MW * 1.1, amp=0.4)
    a.hatch(clip_half(ellipse(c, R - 2, R - 2, n=40), add(c, (R * 0.25, R * 0.25)), (0.7, 0.7)), 50, 4.4, color="slate",
            alpha=0.4)
    a.ell_outline(c, R, R)


@art_key("pic_shoes")
def pic_shoes(a):
    def shoe(T, col):
        sole = T.pts([(-62, 20), (64, 20), (70, 10), (66, 2), (-64, 2), (-68, 10)])
        upper = T.pts([(-64, 4), (-60, -30), (-36, -38), (-14, -36), (10, -16), (44, -12), (64, -4), (66, 4)])
        a.fill_smooth(upper, col)
        a.hatch(clip_half(upper, T((0, -6)), T.v((0, 1))), T.ang(10), 4, alpha=0.35)
        a.outline(upper, LW, second=0.3)
        a.block(sole, "paper", w=MW * 1.4, second=0)
        a.lines([(T((-14 + k * 9, -30 + k * 4)), T((-4 + k * 9, -22 + k * 4))) for k in range(3)], MW * 1.2, "paper", 0.95)
        a.lines([(T((-14 + k * 9, -24 + k * 4)), T((-6 + k * 9, -32 + k * 4))) for k in range(3)], FW * 1.2, alpha=0.7)
        a.curve(T.pts([(30, -12), (50, -8), (62, 0)]), FW * 1.3, alpha=0.6)
        a.fill_poly(T.pts([(-64, -10), (-56, -10), (-56, 4), (-64, 4)]), "ochre", 0.9)

    shoe(Tf((132, 128), 1.0, -4), "slate")
    shoe(Tf((104, 180), 1.05, 2), "clay")
    a.line((18, 206), (224, 204), MW, alpha=0.6)


@art_key("pic_shirt")
def pic_shirt(a):
    tee = [(70, 54), (100, 42), (140, 42), (170, 54), (210, 88), (190, 114), (170, 102), (172, 206), (68, 206),
           (70, 102), (50, 114), (30, 88)]
    a.fill_poly(tee, "sage", step=24)
    a.hatch(clip_half(tee, (150, 0), (1, 0)), 75, 4.6, alpha=0.35)
    a.outline_poly(tee, LW, second=0.4)
    a.curve([(100, 44), (110, 58), (120, 62), (130, 58), (140, 44)], 5, "ochre")
    a.curve([(100, 44), (110, 58), (120, 62), (130, 58), (140, 44)], FW, alpha=0.7)
    for p0, p1 in (((30, 88), (50, 114)), ((210, 88), (190, 114))):
        a.line(lerp(p0, p1, 0.0), lerp(p0, p1, 1.0), 5, "ochre", amp=0.3)
    pk = [(86, 92), (110, 92), (110, 118), (86, 118)]
    a.outline_poly(pk, MW * 1.2, second=0)
    a.lines([((76, 196), (164, 196))], FW, alpha=0.5)


@art_key("pic_hat")
def pic_hat(a):
    brim = [(116, 150), (170, 136), (214, 146), (206, 162), (160, 168), (118, 166)]
    a.fill_smooth(brim, "ochre")
    a.hatch(brim, 20, 4, alpha=0.35)
    a.outline(brim, LW, second=0.3)
    crown = [(40, 158), (44, 116), (66, 82), (100, 70), (136, 78), (160, 102), (168, 140), (164, 156), (110, 166)]
    a.fill_smooth(crown, "clay")
    a.hatch(clip_half(crown, (130, 0), (1, 0.2)), 70, 4.4, alpha=0.4)
    a.outline(crown, LW, second=0.4)
    a.curve([(100, 72), (96, 110), (104, 162)], MW, alpha=0.7)
    a.curve([(102, 72), (134, 104), (150, 154)], MW, alpha=0.6)
    a.ell((102, 70), 8, 5, "ochre", w=MW * 1.2, second=0)
    a.curve([(42, 152), (100, 164), (162, 152)], 4, "paper", 0.8)
    a.lines([((70 + k * 10, 120 + k * 2), (72 + k * 10, 124 + k * 2)) for k in range(3)], FW * 1.4, "paper", 0.8)


# --------------------------------------------------------------------------------------------- pic: places & transport


def wheel(a, c, r, hub="paper", spokes=0):
    a.stroke(a.ell_path(c, r, r, wob=0.012), r * 0.32, "ink", 0.9)
    a.fill_smooth(ellipse(c, r * 0.6, r * 0.6, n=10), hub, 0.95, off=(0, 0))
    a.ell_outline(c, r * 0.6, r * 0.6, w=MW, second=0)
    if spokes:
        a.lines([(polar(c, r * 0.14, t), polar(c, r * 0.56, t)) for t in range(0, 360, 360 // spokes)], FW, alpha=0.7)
    a.dots([c], r * 0.22, "slate")


@art_key("pic_market")
def pic_market(a):
    ground(a, 12, 228, 210, marks=5)
    for x in (34, 206):
        leg_post(a, (x, 74), (x, 206), 4.5, "ochre")
    aw_top, aw_bot = 44, 80
    xs = [22 + i * 24.5 for i in range(9)]
    for i in range(8):
        strip = [(xs[i], aw_top), (xs[i + 1], aw_top), (xs[i + 1], aw_bot), (xs[i] + 12.25, aw_bot + 10), (xs[i], aw_bot)]
        a.fill_poly(strip, "clay" if i % 2 == 0 else "paper", off=(0, 0) if i % 2 else None)
    scal = []
    for i in range(8):
        scal += [(xs[i], aw_bot), (xs[i] + 12.25, aw_bot + 10)]
    scal.append((xs[8], aw_bot))
    a.curve(scal, MW * 1.3)
    a.outline_poly([(xs[0], aw_top), (xs[8], aw_top), (xs[8], aw_bot), (xs[0], aw_bot)], LW, closed=False, second=0)
    a.line((xs[0] - 6, aw_top), (xs[8] + 6, aw_top), LW, over=(1, 1))
    counter = [(26, 150), (214, 150), (214, 206), (26, 206)]
    a.fill_poly(counter, "ochre", 0.8)
    a.hatch(counter, 90, 9, w=MW, alpha=0.3)
    a.outline_poly(counter, LW, second=0.4)
    a.line((22, 150), (218, 150), LW * 1.1)
    for bx, fill in ((66, "ochre"), (120, "sage"), (174, "clay")):
        bk = [(bx - 26, 150), (bx + 26, 150), (bx + 20, 128), (bx - 20, 128)]
        balls = []
        for k, (dx, dy) in enumerate(((-14, 124), (0, 120), (14, 124), (-7, 112), (7, 112))):
            balls.append(((bx + dx, dy), 9))
        for c, r in balls:
            round_ball(a, c, r, fill, hatch=False, w=MW * 1.2)
        a.fill_poly(bk, "ochre")
        a.hatch(bk, 30, 5, alpha=0.45)
        a.hatch(bk, -30, 5, alpha=0.45)
        a.outline_poly(bk, MW * 1.4, second=0)


@art_key("pic_hospital")
def pic_hospital(a):
    """A hospital: a tall plain building, rows of windows, an entrance canopy and a sign with a plain green plus sign
    (deliberately not the protected Red Cross emblem)."""
    ground(a, 12, 228, 210, marks=5)
    bld = rect(42, 58, 156, 150)
    a.fill_poly(bld, "slate", 0.25)
    a.hatch(clip_half(bld, (176, 0), (1, 0)), 75, 4.6, alpha=0.3)
    a.outline_poly(bld, LW, second=0.4)
    a.line((36, 58), (204, 58), LW * 1.1, over=(1, 1))
    for row, y in enumerate((96, 130)):
        for x in (54, 82, 140, 168):
            w_ = rect(x, y, 18, 20)
            a.block(w_, "slate", 0.85, w=MW * 1.2, second=0)
            a.line((x + 3, y + 4), (x + 8, y + 2), MW, "paper", 0.7, amp=0.1)
    sign = rect(94, 24, 52, 52)
    a.block(sign, "paper", w=LW, second=0.4)
    a.lines([((120, 34), (120, 66)), ((104, 50), (136, 50))], 11, "sage", amp=0.3)
    can = [(86, 166), (154, 166), (160, 178), (80, 178)]
    a.block(can, "sage", w=MW * 1.3, second=0)
    door = rect(100, 178, 40, 30)
    a.block(door, "slate", 0.9, w=MW * 1.3, second=0)
    a.line((120, 178), (120, 208), FW * 1.3)


@art_key("pic_park")
def pic_park(a):
    gnd = [(0, 184)] + [(x, 182 + 4 * math.sin(x / 30)) for x in range(20, 241, 40)] + [(240, 240), (0, 240)]
    a.fill_poly(gnd, "sage", 0.3, off=(0, 0), step=40)
    a.curve([(8, 186), (120, 180), (232, 186)], MW * 1.2)
    path_ = [(120, 186), (150, 186), (196, 240), (120, 240)]
    a.fill_poly(path_, "ochre", 0.35, off=(0, 0))
    a.lines([((122, 188), (124, 238)), ((150, 188), (192, 238))], FW * 1.2, alpha=0.6)
    a.blob(ribbon([(70, 186), (68, 150), (72, 112)], 16, 11), "clay", 0.85, w=MW * 1.4, second=0)
    can = [(70, 26), (102, 34), (118, 62), (114, 94), (96, 116), (64, 122), (34, 110), (22, 82), (30, 50)]
    a.fill_smooth(can, "sage")
    a.hatch(clip_half(can, (84, 90), (0.6, 0.8)), 55, 4.4, alpha=0.4)
    a.outline(can, LW, second=0.4)
    for c in ((54, 60), (86, 74), (60, 96)):
        a.arc(c, 12, 200, 340, MW, alpha=0.7)
    for x in (146, 214):
        leg_post(a, (x, 160), (x, 196), 3.5, "slate")
    a.block([(136, 132), (222, 128), (222, 140), (136, 144)], "ochre", w=MW * 1.3, second=0)
    a.block([(132, 152), (226, 150), (228, 164), (132, 166)], "ochre", w=MW * 1.4, second=0)
    a.lines([((146, 140), (146, 152)), ((214, 136), (214, 150))], MW * 1.2, amp=0.1)
    tufts = []
    for x in (20, 46, 104, 180, 212):
        tufts += [((x, 210), (x - 4, 200)), ((x, 210), (x + 1, 198)), ((x, 210), (x + 5, 201))]
    a.lines(tufts, FW * 1.3, amp=0.3)


@art_key("pic_station")
def pic_station(a):
    rails = [((14, 206), (122, 206)), ((14, 222), (122, 222))]
    a.lines(rails, MW * 1.3)
    a.lines([((22 + k * 17, 202), (18 + k * 17, 226)) for k in range(6)], MW, "ochre", 0.9)
    plat = [(118, 168), (232, 168), (232, 226), (118, 226)]
    a.fill_poly(plat, "ochre", 0.4)
    a.hatch(plat, 0, 8, alpha=0.3)
    a.outline_poly(plat, LW, second=0.4)
    a.line((118, 174), (232, 174), 4, "paper", 0.9)
    for x in (140, 214):
        leg_post(a, (x, 66), (x, 168), 4, "slate")
    roof = [(108, 54), (236, 50), (236, 64), (104, 68)]
    a.block(roof, "clay", w=LW, second=0.4)
    tr = [(26, 74), (98, 74), (110, 92), (112, 200), (18, 200), (18, 92)]
    a.fill_smooth(tr, "sage")
    a.hatch(clip_half(tr, (90, 0), (1, 0)), 75, 4.4, alpha=0.4)
    a.outline(tr, LW, second=0.4)
    ws = [(26, 88), (98, 88), (100, 128), (24, 128)]
    a.fill_poly(ws, "slate", 0.85)
    a.line((34, 96), (48, 92), MW, "paper", 0.8, amp=0.1)
    a.outline_poly(ws, MW * 1.3, second=0)
    a.block(rect(22, 150, 88, 14), "ochre", 0.9, w=MW * 1.2, second=0)
    for c in ((36, 176), (96, 176)):
        a.ell(c, 9, 7, "ochre", w=MW * 1.3, second=0)
    a.block(rect(30, 192, 74, 10), "slate", w=MW * 1.2, second=0)


@art_key("pic_car")
def pic_car(a):
    a.line((10, 198), (230, 196), MW, alpha=0.6)
    body = [(22, 152), (30, 128), (62, 118), (84, 88), (150, 86), (176, 116), (210, 122), (220, 140), (218, 166),
            (24, 168)]
    a.fill_smooth(body, "sage")
    a.hatch(clip_half(body, (0, 150), (0, 1)), 15, 4.4, alpha=0.35)
    a.outline(body, LW, second=0.4)
    for wpts in ([(92, 96), (124, 94), (124, 118), (80, 120)], [(132, 94), (148, 94), (166, 118), (132, 118)]):
        a.block(wpts, "slate", 0.8, w=MW * 1.3, second=0)
    a.line((128, 92), (128, 160), MW, amp=0.3)
    a.line((112, 128), (122, 128), MW * 1.3, amp=0.1)
    a.ell((212, 136), 6, 5, "ochre", w=MW, second=0)
    a.ell((28, 140), 5, 4, "clay", w=MW, second=0)
    for c in ((66, 168), (178, 168)):
        wheel(a, c, 24)


@art_key("pic_bus")
def pic_bus(a):
    a.line((8, 202), (232, 200), MW, alpha=0.6)
    body = [(18, 70), (206, 66), (222, 80), (226, 170), (16, 174)]
    a.fill_poly(body, "ochre", step=24)
    a.fill_poly([(17, 140), (225, 138), (226, 150), (17, 152)], "clay", 0.9)
    a.hatch(clip_half(body, (0, 156), (0, 1)), 10, 4.4, alpha=0.35)
    a.outline_poly(body, LW, second=0.4)
    for x in (28, 64, 100, 136):
        a.block(rect(x, 82, 28, 36), "slate", 0.85, w=MW * 1.2, second=0)
        a.line((x + 4, 88), (x + 12, 84), MW, "paper", 0.7, amp=0.1)
    door = rect(176, 82, 30, 82)
    a.block(door, "slate", 0.85, w=MW * 1.3, second=0)
    a.line((191, 82), (191, 164), FW * 1.3)
    a.block([(208, 82), (220, 84), (222, 120), (208, 120)], "slate", 0.85, w=MW * 1.2, second=0)
    a.ell((220, 152), 5, 6, "paper", w=MW, second=0)
    for c in ((58, 174), (188, 174)):
        wheel(a, c, 22)


@art_key("pic_train")
def pic_train(a):
    a.lines([((6, 196), (232, 196)), ((6, 204), (232, 204))], MW * 1.2)
    a.lines([((14 + k * 19, 196), (10 + k * 19, 210)) for k in range(12)], MW, "ochre", 0.9)
    car = [(0, 92), (96, 92), (96, 180), (0, 180)]
    a.fill_poly(car, "clay", 0.85, off=(0, 0))
    a.outline_poly([(0, 92), (96, 92), (96, 180), (0, 180)], LW, closed=False, second=0)
    for x in (10, 52):
        a.block(rect(x, 106, 30, 30), "slate", 0.85, w=MW * 1.2, second=0)
    eng = [(106, 92), (192, 92), (216, 114), (224, 150), (220, 180), (106, 180)]
    a.fill_smooth(eng, "clay")
    a.fill_poly([(106, 152), (222, 152), (222, 162), (106, 162)], "paper", 0.9, off=(0, 0))
    a.hatch(clip_half(eng, (0, 166), (0, 1)), 10, 4.4, alpha=0.35)
    a.outline(eng, LW, second=0.4)
    for x in (118, 152):
        a.block(rect(x, 106, 26, 30), "slate", 0.85, w=MW * 1.2, second=0)
    a.block([(186, 104), (200, 106), (214, 132), (186, 134)], "slate", 0.85, w=MW * 1.2, second=0)
    a.ell((214, 168), 5, 5, "ochre", w=MW, second=0)
    a.line((96, 160), (106, 160), LW, amp=0.1)
    for c in ((22, 184), (76, 184), (126, 184), (198, 184)):
        wheel(a, c, 11, "slate")


@art_key("pic_motorbike")
def pic_motorbike(a):
    a.line((10, 208), (230, 206), MW, alpha=0.6)
    for c in ((54, 180), (184, 180)):
        wheel(a, c, 26)
    a.blob([(30, 150), (60, 134), (118, 136), (124, 158), (84, 166), (36, 166)], "clay", w=LW, second=0.3)
    a.blob([(118, 160), (154, 160), (160, 172), (112, 174)], "slate", 0.8, w=MW * 1.3, second=0)
    seat = [(42, 132), (60, 120), (112, 120), (118, 134)]
    a.fill_smooth(seat, "slate")
    a.outline(seat, MW * 1.4, second=0)
    shield = [(146, 162), (150, 120), (160, 84), (176, 82), (178, 110), (172, 150), (186, 176), (172, 182)]
    a.fill_smooth(shield, "clay")
    a.hatch(clip_half(shield, (170, 0), (1, 0)), 70, 4, alpha=0.4)
    a.outline(shield, LW, second=0.3)
    a.line((168, 86), (182, 178), MW * 1.6, "slate", amp=0.3)
    a.line((150, 74), (196, 68), LW * 1.1, amp=0.4)
    a.ell((158, 60), 7, 5, "slate", w=MW, second=0)
    a.line((160, 66), (164, 76), MW)
    a.ell((184, 92), 6, 7, "ochre", w=MW * 1.2, second=0)
    a.line((30, 150), (18, 152), MW * 1.4, "slate", amp=0.2)


@art_key("pic_bicycle")
def pic_bicycle(a):
    a.line((10, 204), (230, 202), MW, alpha=0.6)
    rh, fh, bb, seat, head = (60, 164), (184, 164), (112, 166), (100, 108), (166, 104)
    for c in (rh, fh):
        a.stroke(a.ell_path(c, 38, 38, wob=0.015), 4.8)
        a.ell_outline(c, 32, 32, w=FW * 1.2, second=0, wob=0.015)
        a.lines([(polar(c, 4, t), polar(c, 31, t)) for t in range(0, 360, 40)], FW, alpha=0.6, amp=0.2)
        a.dots([c], 6, "slate")
    frame = [(rh, bb), (bb, seat), (seat, rh), (seat, head), (head, bb), (head, fh)]
    p = Path()
    for s0, s1 in frame:
        a.seg(add(s0, a.reg("slate")), add(s1, a.reg("slate")), 0.6, p)
    a.stroke(p, 6.0, "slate")
    a.lines(frame, MW, amp=0.6)
    a.ell((98, 102), 14, 4.5, "ink", 0.85, w=MW, second=0)
    a.curve([head, (162, 88), (176, 82), (184, 88)], LW)
    bask = [(168, 82), (210, 80), (206, 112), (174, 114)]
    a.fill_poly(bask, "ochre")
    a.hatch(bask, 40, 5, alpha=0.45)
    a.hatch(bask, -40, 5, alpha=0.45)
    a.outline_poly(bask, MW * 1.4, second=0)
    a.ell(bb, 8, 8, "ochre", w=MW, second=0)
    a.line(bb, (122, 180), LW, amp=0.2)


@art_key("pic_plane")
def pic_plane(a):
    cl = [(30, 178), (40, 166), (58, 168), (66, 158), (82, 162), (88, 174), (80, 182), (34, 184)]
    a.fill_smooth(cl, "slate", 0.2, off=(0, 0))
    a.outline(cl, MW, second=0, jit=0.2)
    T = Tf((118, 112), 1, -10)
    a.blob(T.pts([(-14, 10), (22, 10), (-2, 64), (-22, 64)]), "slate", w=LW * 0.9, second=0)
    fus = T.pts([(-96, 2), (-90, -12), (-60, -18), (70, -18), (96, -10), (104, 0), (96, 10), (70, 16), (-80, 16),
                 (-94, 10)])
    a.fill_smooth(fus, "slate", 0.3)
    a.fill_smooth(T.pts([(-96, 2), (-90, -12), (-60, -18), (-58, 16), (-80, 16), (-94, 10)]), "clay", 0.9)
    a.hatch(clip_half(fus, T((0, 6)), T.v((0, 1))), T.ang(5), 4, alpha=0.35)
    a.outline(fus, LW, second=0.4)
    fin = T.pts([(-60, -16), (-88, -60), (-74, -62), (-40, -16)])
    a.block(fin, "clay", w=LW * 0.9, second=0)
    a.dots([T((x, -6)) for x in range(-36, 70, 14)], 5.5, "slate")
    a.block(T.pts([(80, -14), (94, -12), (100, -4), (82, -4)]), "slate", 0.9, w=MW, second=0)
    a.blob(T.pts([(-6, -4), (30, -4), (6, -40), (-10, -40)]), "slate", 0.6, w=MW * 1.3, second=0)
    eng = T.pts(capsule((8, 30), (30, 30), 7))
    a.blob(eng, "slate", w=MW * 1.2, second=0)


@art_key("pic_ship")
def pic_ship(a):
    wy = 176
    for k, x0 in enumerate((148, 162)):
        a.curve([(x0, 50 - k * 4), (x0 + 12, 36), (x0 + 4, 22), (x0 + 18, 8)], MW, alpha=0.55, jit=0.4)
    fun = [(140, 56), (166, 56), (162, 96), (144, 96)]
    a.fill_poly(fun, "ochre")
    a.fill_poly([(140.5, 62), (165.5, 62), (165, 70), (141, 70)], "ink", 0.6, off=(0, 0))
    a.outline_poly(fun, LW * 0.9, second=0)
    sup = [(72, 96), (186, 96), (186, 132), (72, 132)]
    a.fill_poly(sup, "paper", off=(0, 0))
    a.outline_poly(sup, LW, second=0.4)
    for x in (84, 108, 132, 156):
        a.block(rect(x, 106, 16, 12), "slate", 0.85, w=MW, second=0)
    hull = [(20, 130), (222, 130), (200, 184), (40, 184)]
    a.fill_poly(hull, "clay")
    a.fill_poly([(21, 130), (221, 130), (216, 144), (26, 144)], "paper", 0.9, off=(0, 0))
    a.hatch(clip_half(hull, (0, 160), (0, 1)), 10, 4.4, alpha=0.4)
    a.outline_poly(hull, LW, second=0.4)
    a.ell_outline((60, 156), 6, 6, w=MW, second=0)
    a.ell_outline((88, 156), 6, 6, w=MW, second=0)
    water = [(0, wy)] + [(x, wy + 3 * math.sin(x / 13)) for x in range(10, 241, 15)] + [(240, 240), (0, 240)]
    a.fill_poly(water, "slate", 0.4, off=(0, 0), step=40)
    for k, y in enumerate((wy + 1, 200, 222)):
        a.curve([(4 + (k % 2) * 16 + i * 22, y + 3 * math.sin(i * 1.7 + k)) for i in range(11)],
                MW * (1.3 if k == 0 else 1.0), "ink" if k == 0 else "slate", 0.85)


# --------------------------------------------------------------------------------------------- pic: nature & weather


def puff_cloud(a, c, w, h, col="slate", alpha=0.25, line=MW * 1.3):
    """A drawn cloud: bumps along the top, a flat-ish bottom, a tinted underside."""
    bumps = []
    n = 5
    for i in range(n):
        t = i / (n - 1)
        sn = math.sin(math.pi * t)
        bumps.append((c[0] - w / 2 + w * t, c[1] - h * (0.35 + 0.45 * sn), h * (0.42 + 0.2 * sn)))
    top = []
    for x in range(int(c[0] - w / 2 - h * 0.3), int(c[0] + w / 2 + h * 0.3) + 1, 5):
        ys = [cy - math.sqrt(max(0.0, r * r - (x - cx) ** 2)) for cx, cy, r in bumps if abs(x - cx) < r]
        if ys:
            top.append((x, min(ys)))
    shape = top + [(top[-1][0], c[1] + h * 0.1), (c[0], c[1] + h * 0.18), (top[0][0], c[1] + h * 0.1)]
    a.fill_smooth(shape, "paper", off=(0, 0))
    a.fill_smooth(clip_half(subdivide(shape, 6), (0, c[1] - h * 0.12), (0, 1)), col, alpha)
    a.outline(shape, line, second=0.3)
    return shape


@art_key("pic_sun")
def pic_sun(a):
    c, R = (118 + a.j(2), 122), 54
    for i in range(12):
        t = i * 30 + 8
        L = 34 if i % 2 == 0 else 22
        ray = [polar(c, R + 10, t - 7), polar(c, R + 10 + L, t), polar(c, R + 10, t + 7)]
        a.fill_poly(ray, "ochre")
        a.outline_poly(ray, MW * 1.2, second=0, over=0.8, gap=1.0)
    a.fill_smooth(ellipse(c, R, R, n=18), "ochre")
    a.fill_smooth(ellipse(add(c, (6, 6)), R * 0.7, R * 0.7, n=14), "clay", 0.25)
    a.hatch(clip_half(ellipse(c, R - 4, R - 4, n=24), add(c, (14, 18)), (0.6, 0.8)), 50, 4.4, alpha=0.4)
    a.ell_outline(c, R, R)


@art_key("pic_rain")
def pic_rain(a):
    puff_cloud(a, (120, 92), 150, 64, "slate", 0.55, LW)
    for i, (x, y) in enumerate(((64, 136), (96, 150), (130, 138), (162, 152), (80, 182), (114, 196), (148, 184),
                                (182, 192))):
        drop(a, (x, y), 7.5, "slate", 20)
    a.lines([((40, 222), (100, 222)), ((130, 224), (200, 222))], MW, "slate", 0.7)


@art_key("pic_cloud")
def pic_cloud(a):
    tint_patch(a, (122, 120), 104, 84, "slate", 0.16)
    puff_cloud(a, (120 + a.j(3), 140), 170, 86, "slate", 0.3, LW)


@art_key("pic_rainbow")
def pic_rainbow(a):
    c = (120, 182)
    cols = ("clay", "ochre", "sage", "slate")
    for k, col in enumerate(cols):
        r = 100 - k * 15
        pts = [polar(c, r, t, r * 0.92) for t in range(180, 361, 15)]
        off = a.reg(col)
        a.stroke(a.open_curve([add(p, off) for p in pts], 0.6), 15, col, 0.95)
    for r in (108, 47):
        a.curve([polar(c, r, t, r * 0.92) for t in range(180, 361, 15)], MW * 1.2, jit=0.4)
    for cc in ((50, 188), (190, 188)):
        puff_cloud(a, cc, 56, 36, "slate", 0.3, MW * 1.4)


@art_key("pic_tree")
def pic_tree(a):
    ground(a, 30, 214, 212, marks=4)
    trunk = [(104, 210), (110, 150), (108, 120), (130, 120), (128, 150), (136, 210)]
    a.fill_smooth(trunk, "clay", 0.85)
    a.hatch(clip_half(trunk, (124, 0), (1, 0)), 75, 4, alpha=0.4)
    a.outline(trunk, LW, second=0.3)
    a.curve([(118, 140), (100, 120), (90, 108)], LW)
    a.curve([(122, 132), (142, 116), (150, 104)], LW)
    can = [(118, 26), (150, 30), (178, 50), (194, 80), (190, 112), (168, 132), (134, 138), (100, 136), (68, 126),
           (48, 102), (48, 70), (68, 42), (92, 28)]
    a.fill_smooth(can, "sage")
    a.hatch(clip_half(can, (140, 110), (0.6, 0.8)), 55, 4.4, alpha=0.4)
    a.outline(can, LW, second=0.4)
    for c in ((84, 66), (126, 54), (160, 82), (100, 104), (150, 116)):
        a.arc(c, 14, 200, 340, MW, alpha=0.7)
    a.dots([(96, 84), (142, 92), (170, 104), (118, 116)], 9, "ochre")


@art_key("pic_flower")
def pic_flower(a):
    ground(a, 60, 190, 214, marks=3)
    a.curve([(118, 212), (122, 160), (116, 112)], LW * 1.1, "sage")
    a.curve([(118, 212), (122, 160), (116, 112)], FW, alpha=0.7)
    for base, tip in (((120, 186), (162, 160)), ((121, 170), (78, 150))):
        lf = leaf_pts(base, tip, 13)
        a.fill_smooth(lf, "sage")
        a.outline(lf, MW * 1.3, second=0, jit=0.2)
        a.line(base, lerp(base, tip, 0.8), FW, amp=0.3)
    c = (116 + a.j(2), 86)
    for i in range(5):
        t = -90 + 72 * i + 10
        pet = ellipse(polar(c, 30, t), 26, 19, t, n=10)
        a.fill_smooth(pet, "clay")
        a.hatch(clip_half(pet, polar(c, 34, t), dirv(t)), t + 90, 4, alpha=0.35)
        a.outline(pet, MW * 1.4, second=0, jit=0.3)
    a.fill_smooth(ellipse(c, 16, 15, n=10), "ochre")
    a.stipple(ellipse(c, 12, 11, n=10), 8, 2.2, alpha=0.6)
    a.ell_outline(c, 16, 15, w=MW * 1.3, second=0)


@art_key("pic_mountain")
def pic_mountain(a):
    back = [(110, 200), (162, 92), (178, 80), (194, 98), (228, 200)]
    a.fill_smooth(back + [(170, 204)], "slate", 0.35)
    a.curve(back, MW * 1.3, alpha=0.8)
    m = [(10, 204), (60, 120), (96, 56), (110, 40), (124, 42), (140, 64), (184, 140), (222, 204)]
    a.fill_smooth(m + [(116, 210)], "sage")
    a.hatch(clip_half(m + [(116, 210)], (130, 0), (1, -0.2)), 65, 4.6, alpha=0.4)
    cap = [(88, 70), (96, 56), (110, 40), (124, 42), (140, 64), (130, 70), (118, 62), (106, 72)]
    a.fill_smooth(cap, "slate", 0.85)
    a.outline(cap, MW, second=0, jit=0.2)
    a.curve(m, LW)
    a.curve([(60, 196), (90, 168), (116, 160), (110, 130), (124, 104)], MW, "ochre", 0.9)
    for x in (34, 196):
        a.blob([(x, 176), (x + 10, 200), (x - 10, 200)], "sage", w=MW, second=0)
    a.line((4, 206), (236, 204), MW * 1.1)


@art_key("pic_sea")
def pic_sea(a):
    hy = 92
    a.fill_poly([(0, hy), (240, hy), (240, 240), (0, 240)], "slate", 0.4, off=(0, 0), step=60)
    a.line((1, hy), (239, hy + a.j(1)), MW * 1.3)
    for k, y in enumerate((112, 136, 164)):
        x0 = (k % 2) * 20 - 6
        pts = []
        for i in range(7):
            x = x0 + 10 + i * 32
            if x + 22 <= 236:
                pts += [(x, y), (x + 12, y - 8 - k * 2), (x + 22, y - 2)]
        a.curve(pts, MW * (1.0 + 0.2 * k), "ink", 0.75)
    crest = [(0, 214), (40, 196), (78, 186), (110, 190), (120, 204), (108, 214), (96, 206), (102, 198)]
    a.fill_smooth([(0, 240), (0, 214), (40, 196), (78, 186), (110, 190), (124, 206), (150, 220), (240, 214), (240, 240)],
                  "slate", 0.6)
    a.curve(crest, LW)
    a.curve([(124, 208), (170, 222), (238, 216)], MW * 1.2)
    a.curve([(30, 206), (70, 194), (100, 196)], MW, "paper", 0.8)
    sc = (178, 76)
    a.fill_smooth([polar(sc, 20, t) for t in range(180, 361, 30)], "ochre", 0.9)
    a.curve([polar(sc, 20, t) for t in range(180, 361, 30)], MW * 1.2)


@art_key("pic_star")
def pic_star(a):
    c = (116 + a.j(2), 126)
    star = [polar(c, 92 if i % 2 == 0 else 38, -90 + 36 * i + 4) for i in range(10)]
    a.fill_smooth(star, "ochre")
    a.hatch(clip_half(star, add(c, (10, 10)), (0.6, 0.8)), 55, 4.4, alpha=0.4)
    a.curve([polar(c, 50 if i % 2 == 0 else 20, -90 + 36 * i + 4) for i in range(11)], FW * 1.2, alpha=0.5)
    a.outline(star, LW, second=0.4)
    for sc, s in (((204, 52), 8), ((36, 196), 6)):
        a.lines([(add(sc, (-s, 0)), add(sc, (s, 0))), (add(sc, (0, -s)), add(sc, (0, s)))], MW * 1.2, "ochre", amp=0.2)


# INTERACTIONS_AUDIO §5, in its order: every key must exist (main() checks), sheets 9-12 group by these
PIC_GROUPS = {
    "people": ["pic_boy", "pic_girl", "pic_man", "pic_woman", "pic_friends", "pic_teacher", "pic_doctor",
               "pic_wave_hello", "pic_wave_bye", "pic_thanks", "pic_sorry", "pic_yes_nod"],
    "colours": [f"pic_color_{c}" for c in ("red", "blue", "yellow", "green", "black", "white", "orange", "purple",
                                           "brown", "pink")],
    "food": ["pic_rice_bowl", "pic_noodle_bowl", "pic_bread", "pic_egg_fried", "pic_apple", "pic_orange_fruit",
             "pic_watermelon", "pic_fish_dish", "pic_chicken_dish", "pic_vegetables", "pic_soup", "pic_tea_cup",
             "pic_coffee_cup", "pic_milk_glass", "pic_juice", "pic_cake", "pic_kimchi", "pic_onigiri", "pic_dumplings",
             "pic_chopsticks", "pic_spoon_fork"],
    "animals": ["pic_cat", "pic_dog", "pic_bird", "pic_fish", "pic_cow", "pic_chicken", "pic_rabbit", "pic_horse",
                "pic_goat", "pic_duck", "pic_elephant", "pic_monkey"],
    "things": ["pic_house", "pic_school", "pic_book", "pic_pen", "pic_pencil", "pic_bag", "pic_table", "pic_chair",
               "pic_door", "pic_window", "pic_bed", "pic_phone", "pic_ball", "pic_shoes", "pic_shirt", "pic_hat"],
    "places": ["pic_market", "pic_hospital", "pic_park", "pic_station", "pic_car", "pic_bus", "pic_train",
               "pic_motorbike", "pic_bicycle", "pic_plane", "pic_ship"],
    "nature": ["pic_sun", "pic_rain", "pic_cloud", "pic_rainbow", "pic_tree", "pic_flower", "pic_mountain", "pic_sea",
               "pic_star"],
    "actions": ["pic_eat", "pic_drink", "pic_sleep", "pic_read", "pic_write", "pic_walk", "pic_run", "pic_play",
                "pic_sing", "pic_cook", "pic_swim", "pic_sit"],
    "feelings": ["pic_happy", "pic_sad", "pic_tired", "pic_hot", "pic_cold", "pic_big", "pic_small", "pic_hungry"],
    "body": ["pic_head", "pic_mouth", "pic_foot"],
    "glyphs": ["glyph_listen", "glyph_drag", "glyph_trace", "glyph_connect"],
}


# ============================================================================================= output

REGIONS = {
    "scene_kampung_shapes": {
        "sun": {"x": 0.06, "y": 0.06, "w": 0.18, "h": 0.24},
        "roof": {"x": 0.30, "y": 0.20, "w": 0.36, "h": 0.22},
        "wall": {"x": 0.34, "y": 0.44, "w": 0.28, "h": 0.37},
        "kite": {"x": 0.74, "y": 0.06, "w": 0.16, "h": 0.26},
        "board": {"x": 0.72, "y": 0.56, "w": 0.22, "h": 0.18},
    },
    "body_child": {
        "eyes": {"x": 0.36, "y": 0.10, "w": 0.28, "h": 0.07},
        "nose": {"x": 0.45, "y": 0.175, "w": 0.10, "h": 0.05},
        "mouth": {"x": 0.42, "y": 0.235, "w": 0.16, "h": 0.05},
        "ear": {"x": 0.24, "y": 0.11, "w": 0.09, "h": 0.10},
        "hand": {"x": 0.06, "y": 0.46, "w": 0.14, "h": 0.10},
        "foot": {"x": 0.54, "y": 0.89, "w": 0.20, "h": 0.08},
    },
    "map_indonesia": {
        "sumatra": {"x": 0.02, "y": 0.05, "w": 0.22, "h": 0.55},
        "jawa": {"x": 0.24, "y": 0.62, "w": 0.20, "h": 0.14},
        "kalimantan": {"x": 0.28, "y": 0.08, "w": 0.20, "h": 0.40},
        "sulawesi": {"x": 0.50, "y": 0.20, "w": 0.14, "h": 0.40},
        "bali_nusa_tenggara": {"x": 0.45, "y": 0.78, "w": 0.22, "h": 0.12},
        "maluku": {"x": 0.66, "y": 0.25, "w": 0.10, "h": 0.35},
        "papua": {"x": 0.77, "y": 0.25, "w": 0.22, "h": 0.45},
    },
    # placement regions, not tap targets: the app centres a sticker or plot_seed over each bed
    "scene_garden": {
        "plot_01": {"x": 0.07, "y": 0.42, "w": 0.14, "h": 0.18},
        "plot_02": {"x": 0.25, "y": 0.42, "w": 0.14, "h": 0.18},
        "plot_03": {"x": 0.43, "y": 0.42, "w": 0.14, "h": 0.18},
        "plot_04": {"x": 0.61, "y": 0.42, "w": 0.14, "h": 0.18},
        "plot_05": {"x": 0.79, "y": 0.42, "w": 0.14, "h": 0.18},
        "plot_06": {"x": 0.04, "y": 0.66, "w": 0.16, "h": 0.22},
        "plot_07": {"x": 0.23, "y": 0.66, "w": 0.16, "h": 0.22},
        "plot_08": {"x": 0.42, "y": 0.66, "w": 0.16, "h": 0.22},
        "plot_09": {"x": 0.61, "y": 0.66, "w": 0.16, "h": 0.22},
        "plot_10": {"x": 0.80, "y": 0.66, "w": 0.16, "h": 0.22},
    },
}

DRAFT_NOTE = (
    "DRAFT art authored as code by art/tools/draw.py (ART_DIRECTION section 6). "
    "Placeholder until a human illustrator redraws or approves it (section 7). Generated: do not edit by hand."
)
TEXTURE_NOTE = "Texture slot: the app composites the shared paper-grain overlay above this drawing; no grain is baked in."


def render(key):
    vw, vh, k, fn = ART[key]
    a = Art(key, vw, vh, k)
    fn(a)
    return a


def merged(items):
    out = []
    for it in sorted(items, key=lambda x: x[0]):
        it = it[1:]
        if out and out[-1][:4] == it[:4]:
            out[-1] = it[:4] + (out[-1][4] + it[4],)
        else:
            out.append(it)
    return out


def fmt_num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s or "0"


def to_vector_drawable(a):
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        f"<!-- {a.key}: {DRAFT_NOTE} -->",
        f"<!-- {TEXTURE_NOTE} -->",
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
        f'  android:width="{a.vw}dp"',
        f'  android:height="{a.vh}dp"',
        f'  android:viewportWidth="{a.vw}"',
        f'  android:viewportHeight="{a.vh}">',
    ]
    for kind, color, w, alpha, d in merged(a.items):
        if kind == "f":
            attrs = [f'android:fillColor="@color/art_{color}"']
            if alpha < 1:
                attrs.append(f'android:fillAlpha="{fmt_num(alpha)}"')
        else:
            attrs = [
                f'android:strokeColor="@color/art_{color}"',
                f'android:strokeWidth="{fmt_num(w)}"',
                'android:strokeLineCap="round"',
                'android:strokeLineJoin="round"',
            ]
            if alpha < 1:
                attrs.append(f'android:strokeAlpha="{fmt_num(alpha)}"')
        lines.append("  <path")
        lines.extend(f"    {x}" for x in attrs)
        lines.append(f'    android:pathData="{d}" />')
    lines.append("</vector>")
    return "\n".join(lines) + "\n"


def svg_paths(a, pal):
    out = []
    for kind, color, w, alpha, d in merged(a.items):
        if kind == "f":
            op = f' fill-opacity="{fmt_num(alpha)}"' if alpha < 1 else ""
            out.append(f'<path d="{d}" fill="{pal[color]}"{op}/>')
        else:
            op = f' stroke-opacity="{fmt_num(alpha)}"' if alpha < 1 else ""
            out.append(
                f'<path d="{d}" fill="none" stroke="{pal[color]}" stroke-width="{fmt_num(w)}" '
                f'stroke-linecap="round" stroke-linejoin="round"{op}/>'
            )
    return "\n".join(out)


def to_svg(a, pal=LIGHT, bg=None):
    head = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{a.vw}" height="{a.vh}" '
        f'viewBox="0 0 {a.vw} {a.vh}">\n<!-- {a.key}: {DRAFT_NOTE} -->\n<!-- {TEXTURE_NOTE} -->\n'
    )
    back = f'<rect width="{a.vw}" height="{a.vh}" fill="{bg}"/>\n' if bg else ""
    return head + back + svg_paths(a, pal) + "\n</svg>\n"


SHEETS = [
    ("1_characters", lambda k: k.startswith(("aya_", "cover_", "glyph_", "state_", "gem", "app_icon")), 6, 150),
    ("2_stickers", lambda k: k.startswith(("sticker_", "plot_")), 6, 150),
    ("3_count_mango_egg", lambda k: k.startswith(("count_mango", "count_egg")), 8, 128),
    ("4_count_marble_groups", lambda k: k.startswith(("count_marble", "groups_")), 8, 128),
    ("5_math", lambda k: k.startswith(("shape_", "solid_", "frac_", "balance_", "length_")), 8, 128),
    ("6_clocks", lambda k: k.startswith("clock_"), 8, 128),
    ("7_world", lambda k: k.startswith(("pos_", "sense_", "fam_", "fruit_", "coin_", "note_"))
     or k in ("wash_hands", "sleep_moon", "drink_water", "toothbrush"), 8, 128),
    ("8_scenes", lambda k: k in ("scene_kampung_shapes", "body_child", "map_indonesia", "scene_garden"), 3, 380),
    ("9_pic_people", lambda k: k in PIC_GROUPS["people"] + PIC_GROUPS["actions"] + PIC_GROUPS["feelings"]
     + PIC_GROUPS["body"], 8, 128),
    ("10_pic_colours_food", lambda k: k in PIC_GROUPS["colours"] + PIC_GROUPS["food"], 8, 128),
    ("11_pic_animals_things", lambda k: k in PIC_GROUPS["animals"] + PIC_GROUPS["things"], 8, 128),
    ("12_pic_places_nature", lambda k: k in PIC_GROUPS["places"] + PIC_GROUPS["nature"], 8, 128),
]


def natural(k):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", k)]


def contact_sheet(keys, arts, cols, tile, pal, bg, label):
    import cairosvg

    pad, lab = 14, 18
    rows = (len(keys) + cols - 1) // cols
    W = pad + cols * (tile + pad)
    H = pad + rows * (tile + lab + pad) + 22
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        f'<rect width="{W}" height="{H}" fill="{bg}"/>',
        f'<text x="{pad}" y="{H - 8}" font-family="DejaVu Sans, sans-serif" font-size="11" fill="{pal["ink"]}" '
        f'fill-opacity="0.7">{label}</text>',
    ]
    for i, key in enumerate(keys):
        a = arts[key]
        r, c = divmod(i, cols)
        x, y = pad + c * (tile + pad), pad + r * (tile + lab + pad)
        s = min(tile / a.vw, tile / a.vh)
        ox, oy = x + (tile - a.vw * s) / 2, y + (tile - a.vh * s) / 2
        parts.append(
            f'<rect x="{x}" y="{y}" width="{tile}" height="{tile}" fill="none" stroke="{pal["ink"]}" '
            f'stroke-opacity="0.08"/>'
        )
        parts.append(f'<g transform="translate({ox:.1f} {oy:.1f}) scale({s:.4f})">{svg_paths(a, pal)}</g>')
        parts.append(
            f'<text x="{x + tile / 2}" y="{y + tile + 13}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" '
            f'font-size="10" fill="{pal["ink"]}">{key}</text>'
        )
    parts.append("</svg>")
    return cairosvg.svg2png(bytestring="\n".join(parts).encode("utf-8"))


def write_registry(keys):
    nonsquare = [(k, ART[k][0], ART[k][1]) for k in keys if ART[k][0] != ART[k][1]]
    out = [
        "package id.petalytix.ayailmu.core.design.art",
        "",
        "import id.petalytix.ayailmu.core.design.R",
        "",
        "// GENERATED by art/tools/draw.py from docs/ART_CATALOG.md. Do not edit by hand; re-run the tool.",
        "// DRAFT art (ART_DIRECTION section 6): placeholders until an illustrator redraws or approves them (section 7).",
        "",
        "/**",
        " * Art keys mapped to their VectorDrawables (`R.drawable.art_<key>`), the single lookup the UI uses.",
        " * [aspect] is the viewport width divided by its height, so a caller can reserve space before drawing.",
        " */",
        "object ArtRegistry {",
        "    private val drawables: Map<String, Int> =",
        "        mapOf(",
    ]
    out += [f'            "{k}" to R.drawable.art_{k},' for k in keys]
    out += [
        "        )",
        "",
        "    private val aspects: Map<String, Float> =",
        "        mapOf(",
    ]
    out += [f'            "{k}" to {w}f / {h}f,' for k, w, h in nonsquare]
    out += [
        "        )",
        "",
        "    val keys: Set<String> = drawables.keys",
        "",
        "    fun drawable(key: String): Int? = drawables[key]",
        "",
        "    fun aspect(key: String): Float = aspects[key] ?: 1f",
        "}",
        "",
    ]
    REGISTRY_KT.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_KT.write_text("\n".join(out), encoding="utf-8")


def write_learn_colors():
    for night, path in LEARN_XML.items():
        out = [
            '<?xml version="1.0" encoding="utf-8"?>',
            "<!--",
            "  GENERATED by art/tools/draw.py (LEARN). Do not edit by hand; re-run the tool.",
            f"  Learning colours ({'night' if night else 'light'}): used only by the pic_color_* paint daubs, the one",
            "  place a picture leaves the muted art palette for a colour a child names without doubt",
            "  (INTERACTIONS_AUDIO section 5).",
            "  DRAFT values until the illustrator's style bible confirms them.",
            "-->",
            "<resources>",
        ]
        out += [f'  <color name="art_{k}">{v[1 if night else 0]}</color>' for k, v in LEARN.items()]
        out += ["</resources>", ""]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(out), encoding="utf-8")


def write_index(keys):
    INDEX_JSON.parent.mkdir(parents=True, exist_ok=True)
    # Every published region table whose scene is drawn (modules add their own, e.g. sci_plant_parts).
    regions = {k: REGIONS[k] for k in sorted(REGIONS) if k in keys}
    body = {"keys": sorted(keys), "regions": regions}
    INDEX_JSON.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------------------------- drawing modules
# Follow-up 12: more drawings live in sibling modules art/tools/art_*.py so several people can draw at once. Each
# module does `from draw import *` (plus any helper it needs by name) and registers keys with @art_key, and may
# append its own contact sheets to SHEETS. Aliasing this module as "draw" first means a module imports THIS copy
# (the one running as __main__), so its keys land in the same ART registry.
def _load_drawing_modules():
    import importlib

    sys.modules.setdefault("draw", sys.modules[__name__])
    here = FsPath(__file__).resolve().parent
    if str(here) not in sys.path:
        sys.path.insert(0, str(here))
    for mod in sorted(p.stem for p in here.glob("art_*.py")):
        importlib.import_module(mod)


_load_drawing_modules()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="comma-separated keys (review helper; skips index/registry/sheets)")
    ap.add_argument("--png", help="with --only: write PNG renders of those keys into this directory")
    ap.add_argument("--night", action="store_true", help="with --png: render with the night palette")
    ap.add_argument("--scale", type=float, default=1.0, help="with --png: render scale")
    ap.add_argument("--no-sheets", action="store_true", help="skip the PNG contact sheets")
    args = ap.parse_args(argv)

    if args.only:
        import cairosvg

        keys = [k for k in args.only.split(",") if k]
        missing = [k for k in keys if k not in ART]
        if missing:
            sys.exit(f"unknown keys: {missing}")
        out = FsPath(args.png or ".")
        out.mkdir(parents=True, exist_ok=True)
        pal, bg = (NIGHT, NIGHT_BG) if args.night else (LIGHT, LIGHT_BG)
        arts = {}
        for key in keys:
            a = arts[key] = render(key)
            cairosvg.svg2png(bytestring=to_svg(a, pal, bg).encode(), write_to=str(out / f"{key}.png"), scale=args.scale)
        cols = min(len(keys), 6)
        (out / "review_sheet.png").write_bytes(contact_sheet(keys, arts, cols, 160, pal, bg, "review"))
        print(f"rendered {len(keys)} keys into {out}")
        return

    missing = [k for g in PIC_GROUPS.values() for k in g if k not in ART]
    if missing:
        sys.exit(f"INTERACTIONS_AUDIO section 5 keys without a drawing: {missing}")
    keys = sorted(ART, key=natural)
    arts = {}
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    DRAWABLE_DIR.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for key in keys:
        a = render(key)
        arts[key] = a
        (PREVIEW_DIR / f"{key}.svg").write_text(to_svg(a), encoding="utf-8")
        vd = to_vector_drawable(a)
        (DRAWABLE_DIR / f"art_{key}.xml").write_text(vd, encoding="utf-8")
        sizes[key] = len(vd.encode("utf-8"))
    write_index(keys)
    write_registry(keys)
    write_learn_colors()
    big = sorted(sizes.items(), key=lambda kv: -kv[1])[:5]
    print(f"wrote {len(keys)} keys; largest drawables: " + ", ".join(f"{k} {v / 1024:.1f} KB" for k, v in big))
    if not args.no_sheets:
        for name, pred, cols, tile in SHEETS:
            ks = [k for k in keys if pred(k)]
            if not ks:
                continue
            for suffix, pal, bg in (("", LIGHT, LIGHT_BG), ("_night", NIGHT, NIGHT_BG)):
                png = contact_sheet(ks, arts, cols, tile, pal, bg, f"AyaIlmu DRAFT art, sheet {name}{suffix}")
                (PREVIEW_DIR / f"sheet_{name}{suffix}.png").write_bytes(png)
        print(f"wrote contact sheets to {PREVIEW_DIR}")


if __name__ == "__main__":
    main()
