"""Hand-authored stroke data for the 24 basic hangul jamo (AyaIlmu `trace`, INTERACTIONS_AUDIO.md §4).

KanjiVG has no hangul, so these are drawn by hand. REVIEW STATUS: DRAFT - a Korean reviewer must confirm the
stroke order, the direction of each stroke and the proportions before release (see art/strokes/README.md).

How to read this file
- Every jamo is drawn alone in a square cell. Coordinates are on a 0..100 grid: x to the right, y DOWN,
  origin top-left (the builder divides by 100). The 20..80 band is the "body" of a consonant; vowels run longer.
- Each entry is (key, glyph, [stroke 1, stroke 2, ...]) in WRITING ORDER. Each stroke is a list of points in
  WRITING DIRECTION: the first point is where the pen goes down, the last is where it lifts.
- Helpers: `line(p0, p1, ...)` = straight segments through the points (corners stay sharp);
  `curve(p0, c1, c2, p1)` = one smooth cubic Bezier from p0 to p1; `join(a, b)` = continue stroke a with b;
  `circle(cx, cy, r)` = one closed stroke starting at the TOP and running COUNTER-CLOCKWISE (first to the left).
- General rules used: horizontals go left -> right, verticals top -> bottom; top before bottom, left before right;
  a "ㄱ" shape (horizontal then down) is one stroke, a "ㄴ" shape (down then right) is one stroke.

To fix a jamo: edit its points here, then rebuild with
  python3 -I android/tools/strokes_build.py --cache <kanjivg-cache-dir>
and look at the contact sheet (python3 art/strokes/contact_sheet.py).
"""
import math

Point = tuple[float, float]


def line(*pts: Point) -> list[Point]:
    """Straight segments through the points, in order (a corner at every inner point)."""
    return [tuple(map(float, p)) for p in pts]


def curve(p0: Point, c1: Point, c2: Point, p1: Point, n: int = 24) -> list[Point]:
    """A cubic Bezier from p0 to p1 with control points c1, c2, sampled densely."""
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * p1[0]
        y = u**3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * p1[1]
        out.append((x, y))
    return out


def join(*parts: list[Point]) -> list[Point]:
    """One stroke made of several pieces; a piece that starts where the previous one ended is not repeated."""
    out: list[Point] = []
    for part in parts:
        for p in part:
            if not out or (abs(out[-1][0] - p[0]) > 1e-9 or abs(out[-1][1] - p[1]) > 1e-9):
                out.append(p)
    return out


def on(stroke: list[Point], frac: float) -> Point:
    """The point at `frac` (0..1) of the way along a stroke - used to start a stroke ON an earlier one."""
    seg = [math.dist(p, q) for p, q in zip(stroke, stroke[1:])]
    goal = frac * sum(seg)
    for (p, q), d in zip(zip(stroke, stroke[1:]), seg):
        if goal <= d and d > 0:
            t = goal / d
            return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))
        goal -= d
    return stroke[-1]


def circle(cx: float, cy: float, r: float, n: int = 40) -> list[Point]:
    """Closed stroke: starts at the top, goes counter-clockwise (left, down, right, up) back to the top."""
    return [(cx - r * math.sin(2 * math.pi * i / n), cy - r * math.cos(2 * math.pi * i / n)) for i in range(n + 1)]


# ---------------------------------------------------------------------------------------------------------------
# Shared pieces
# ---------------------------------------------------------------------------------------------------------------

def giyeok(top: float = 25, bottom: float = 79, left: float = 23, right: float = 75) -> list[Point]:
    """ㄱ: ONE stroke - across to the right, then down, easing a little to the left at the foot."""
    return join(
        line((left, top), (right, top)),
        curve((right, top), (right, top + 0.45 * (bottom - top)), (right - 1, top + 0.75 * (bottom - top)),
              (right - 6, bottom)),
    )


def jieut(top: float, bottom: float = 80) -> list[list[Point]]:
    """ㅈ in the common 2-stroke handwritten form (like a 'ス'):
    1) across to the right, then a sharp turn into a long sweep down to the lower left (one stroke, like ㄱ);
    2) from the middle of that sweep, down to the lower right.
    (The 3-stroke print form - bar, left sweep, right sweep - is NOT used here.)"""
    h = bottom - top
    sweep = curve((66, top), (60, top + 0.30 * h), (42, top + 0.68 * h), (20, bottom))
    s1 = join(line((24, top), (66, top)), sweep)
    x0, y0 = on(sweep, 0.40)  # stroke 2 starts on the sweep, a little above its middle
    s2 = curve((x0, y0), (x0 + 0.25 * (81 - x0), y0 + 0.45 * (bottom - y0)),
               (x0 + 0.60 * (81 - x0), y0 + 0.80 * (bottom - y0)), (81, bottom))
    return [s1, s2]


def kkokji(top: float = 11, bottom: float = 21) -> list[Point]:
    """The short 'cap' dash on top of ㅊ and ㅎ: a short stroke straight down at the centre."""
    return line((50, top), (50, bottom))


SIOT_LEFT = curve((50, 20), (50, 46), (41, 66), (19, 79))  # ㅅ stroke 1: top centre, sweeping down-left


# ---------------------------------------------------------------------------------------------------------------
# The 24 jamo: (key, glyph, strokes in writing order)
# ---------------------------------------------------------------------------------------------------------------

JAMO: list[tuple[str, str, list[list[Point]]]] = [
    # ---- consonants -------------------------------------------------------------------------------------------
    # ㄱ - 1 stroke: right, then down.
    ("hangul_g", "ㄱ", [giyeok()]),
    # ㄴ - 1 stroke: down, then right.
    ("hangul_n", "ㄴ", [line((26, 22), (26, 77), (79, 77))]),
    # ㄷ - 2 strokes: 1) top bar left->right; 2) ㄴ from the bar's left end: down, then right.
    ("hangul_d", "ㄷ", [
        line((25, 25), (76, 25)),
        line((25, 25), (25, 76), (78, 76)),
    ]),
    # ㄹ - 3 strokes: 1) ㄱ (top bar, down to the middle); 2) middle bar left->right; 3) ㄴ from the middle bar's
    # left end: down, then right.
    ("hangul_r", "ㄹ", [
        line((25, 21), (74, 21), (74, 49)),
        line((25, 49), (74, 49)),
        line((25, 49), (25, 78), (78, 78)),
    ]),
    # ㅁ - 3 strokes: 1) left side down; 2) top + right side (ㄱ shape); 3) bottom left->right.
    ("hangul_m", "ㅁ", [
        line((25, 24), (25, 77)),
        line((25, 24), (75, 24), (75, 77)),
        line((25, 77), (75, 77)),
    ]),
    # ㅂ - 4 strokes: 1) left side down; 2) right side down; 3) middle bar; 4) bottom bar.
    ("hangul_b", "ㅂ", [
        line((26, 20), (26, 78)),
        line((74, 20), (74, 78)),
        line((26, 48), (74, 48)),
        line((26, 78), (74, 78)),
    ]),
    # ㅅ - 2 strokes: 1) from the top centre, a sweep down to the lower left; 2) from the middle of stroke 1,
    # down to the lower right.
    ("hangul_s", "ㅅ", [
        SIOT_LEFT,
        curve(on(SIOT_LEFT, 0.42), (54, 60), (66, 72), (81, 79)),
    ]),
    # ㅇ - 1 stroke: start at the top, go counter-clockwise (to the left first) all the way round.
    ("hangul_ng", "ㅇ", [circle(50, 50, 28)]),
    # ㅈ - 2 strokes (handwritten form, see jieut()).
    ("hangul_j", "ㅈ", jieut(top=24, bottom=80)),
    # ㅊ - 3 strokes: 1) the short top dash, straight down; 2)+3) ㅈ as above, lower down.
    ("hangul_ch", "ㅊ", [kkokji(12, 23)] + jieut(top=32, bottom=84)),
    # ㅋ - 2 strokes: 1) ㄱ; 2) middle bar left->right, ending on the down stroke.
    ("hangul_k", "ㅋ", [
        giyeok(),
        line((23, 52), (75, 52)),
    ]),
    # ㅌ - 3 strokes (textbook order): 1) top bar; 2) middle bar; 3) ㄴ from the top bar's left end: down, right.
    # (Some teachers write ㄷ first and the middle bar last; reviewer please confirm.)
    ("hangul_t", "ㅌ", [
        line((25, 24), (75, 24)),
        line((25, 50), (73, 50)),
        line((25, 24), (25, 77), (78, 77)),
    ]),
    # ㅍ - 4 strokes: 1) top bar; 2) left leg down; 3) right leg down; 4) bottom bar.
    ("hangul_p", "ㅍ", [
        line((20, 24), (80, 24)),
        line((37, 24), (38, 77)),
        line((63, 24), (62, 77)),
        line((18, 77), (82, 77)),
    ]),
    # ㅎ - 3 strokes: 1) the short top dash, straight down; 2) bar left->right; 3) ㅇ (top, counter-clockwise).
    ("hangul_h", "ㅎ", [
        kkokji(11, 21),
        line((24, 30), (76, 30)),
        circle(50, 59, 20),
    ]),
    # ---- vowels -----------------------------------------------------------------------------------------------
    # ㅏ - 2 strokes: 1) long vertical down; 2) short bar from the vertical to the right.
    ("hangul_a", "ㅏ", [
        line((42, 10), (42, 90)),
        line((42, 48), (68, 48)),
    ]),
    # ㅑ - 3 strokes: 1) long vertical; 2) upper short bar to the right; 3) lower short bar to the right.
    ("hangul_ya", "ㅑ", [
        line((42, 10), (42, 90)),
        line((42, 37), (68, 37)),
        line((42, 60), (68, 60)),
    ]),
    # ㅓ - 2 strokes: 1) short bar from the left INTO the vertical; 2) long vertical down.
    ("hangul_eo", "ㅓ", [
        line((32, 48), (58, 48)),
        line((58, 10), (58, 90)),
    ]),
    # ㅕ - 3 strokes: 1) upper short bar; 2) lower short bar (both left->right); 3) long vertical down.
    ("hangul_yeo", "ㅕ", [
        line((32, 37), (58, 37)),
        line((32, 60), (58, 60)),
        line((58, 10), (58, 90)),
    ]),
    # ㅗ - 2 strokes: 1) short vertical down; 2) long bar left->right underneath.
    ("hangul_o", "ㅗ", [
        line((50, 30), (50, 62)),
        line((12, 63), (88, 63)),
    ]),
    # ㅛ - 3 strokes: 1) left short vertical; 2) right short vertical; 3) long bar underneath.
    ("hangul_yo", "ㅛ", [
        line((38, 30), (38, 62)),
        line((62, 30), (62, 62)),
        line((12, 63), (88, 63)),
    ]),
    # ㅜ - 2 strokes: 1) long bar left->right; 2) short vertical down from its middle.
    ("hangul_u", "ㅜ", [
        line((12, 38), (88, 38)),
        line((50, 38), (50, 72)),
    ]),
    # ㅠ - 3 strokes: 1) long bar; 2) left short vertical; 3) right short vertical.
    ("hangul_yu", "ㅠ", [
        line((12, 38), (88, 38)),
        line((38, 38), (38, 72)),
        line((62, 38), (62, 72)),
    ]),
    # ㅡ - 1 stroke: left -> right.
    ("hangul_eu", "ㅡ", [line((10, 50), (90, 50))]),
    # ㅣ - 1 stroke: top -> bottom.
    ("hangul_i", "ㅣ", [line((50, 10), (50, 90))]),
]


def jamo() -> dict[str, tuple[str, list[list[tuple[float, float]]]]]:
    """key -> (glyph, strokes) with coordinates scaled to 0..1 (still dense; the builder simplifies them)."""
    out = {}
    for key, glyph, strokes in JAMO:
        out[key] = (glyph, [[(x / 100.0, y / 100.0) for x, y in s] for s in strokes])
    return out
