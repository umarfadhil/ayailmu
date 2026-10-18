"""Follow-up 12, art group A (MODULES_LEVELS_STORIES §6.1): covers for Nilai, Sejarah and the five language tracks,
and the four level badges. DRAFT art (ART_DIRECTION §6): placeholders until an illustrator redraws or approves them.

Also the small shared library of group A, imported by art_values.py and art_school.py:

- `art(key, vw, vh, k)`: like @art_key, then evens out stroke weights (`snap`), reorders marks so same-style marks
  merge (`pack`, never changing what is drawn on top of what) and writes large marks with whole-unit coordinates
  (`coarse`); together they keep scenes with two or three people from growing far past the drawable budget.
- `brush()`: one hand-lettered brush stroke (tapered ink ribbon over an offset colour plate) for the script covers.
"""

from draw import *  # noqa: F401,F403  (the hand, figure(), palette, registry)

import re as _re

# --------------------------------------------------------------------------------------------- shared: snap + pack

_NUM = _re.compile(r"-?\d+(?:\.\d+)?")
# stroke weights in units of the picture's k: contour, medium, detail, fine. Heavier strokes (> 3.4) stay as drawn.
_LADDER = ((2.7, 3.0), (2.2, 2.5), (1.65, 1.9), (1.25, 1.4), (0.0, 1.1))


def snap(a):
    """Even out stroke weights to five steps (still visibly varied, ART_DIRECTION §2.2) so marks can merge."""
    out = []
    for it in a.items:
        lay, kind, col, w, al, d = it
        if kind == "s":
            u = w / a.k
            if u <= 3.4:
                for lo, v in _LADDER:
                    if u >= lo:
                        w = round(v * a.k, 2)
                        break
        out.append((lay, kind, col, w, al, d))
    a.items = out


def _bb(it):
    nums = [float(x) for x in _NUM.findall(it[5])]
    xs, ys = nums[0::2], nums[1::2]
    pad = it[3] / 2 + 0.8
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def pack(a):
    """Reorder the marks so same-style marks sit next to each other (and merge into one path), keeping the order of
    every pair of differently styled marks whose boxes overlap: what lies on top of what never changes."""
    items = sorted(a.items, key=lambda x: x[0])
    n = len(items)
    st = [it[1:5] for it in items]
    bb = [_bb(it) for it in items]
    succ = [[] for _ in range(n)]
    indeg = [0] * n
    for j in range(n):
        x0, y0, x1, y1 = bb[j]
        for i in range(j):
            if st[i] != st[j]:
                b = bb[i]
                if b[0] < x1 and x0 < b[2] and b[1] < y1 and y0 < b[3]:
                    succ[i].append(j)
                    indeg[j] += 1
    ready = [i for i in range(n) if indeg[i] == 0]
    order, last = [], None
    while ready:
        pick = next((i for i in ready if st[i] == last), ready[0])
        ready.remove(pick)
        order.append(pick)
        last = st[pick]
        for j in succ[pick]:
            indeg[j] -= 1
            if indeg[j] == 0:
                ready.append(j)
        ready.sort()
    a.items = [(0,) + items[i][1:] for i in order]


def _round_int(m):
    v = round(float(m.group()))
    return "0" if v == 0 else str(v)


def coarse(a, big=24.0):
    """Whole-unit coordinates for marks larger than `big` units (half a unit is at most half a dp on screen, far
    below the hand's own wobble); small marks (eyes, dots, fine detail) keep one decimal. Saves about a quarter of
    the path data of a scene."""
    out = []
    for it in a.items:
        x0, y0, x1, y1 = _bb(it)
        if max(x1 - x0, y1 - y0) >= big:
            it = it[:5] + (_NUM.sub(_round_int, it[5]),)
        out.append(it)
    a.items = out


def art(key, vw=240, vh=240, k=1.0):
    """@art_key plus snap(), pack() and coarse() after drawing."""

    def deco(fn):
        def run(a):
            fn(a)
            snap(a)
            pack(a)
            coarse(a)

        run.__doc__ = fn.__doc__
        art_key(key, vw, vh, k)(run)
        return fn

    return deco


# --------------------------------------------------------------------------------------------- shared: brush letters


def brush(a, pts, w, plate="clay", t0=0.45, t1=0.3, belly=0.35, plate_w=1.25, plate_alpha=0.55, steps=3):
    """One hand-lettered brush stroke: a tapered ink ribbon (thin start t0, full width around `belly`, thin end t1)
    over a broad colour plate offset like a second print plate. pts run in writing order."""
    sp = spline(pts, closed=False, steps=steps) if len(pts) > 2 else [lerp(pts[0], pts[1], i / 8) for i in range(9)]
    n = len(sp)
    if plate:
        off = a.reg(plate)
        a.stroke(a.open_curve([add(p, off) for p in pts], 0.8), w * plate_w / a.k, plate, plate_alpha)
    left, right = [], []
    for i, p in enumerate(sp):
        t = i / (n - 1)
        if t < belly:
            f = t0 + (1 - t0) * math.sin(math.pi / 2 * t / belly)
        else:
            f = 1 - (1 - t1) * ((t - belly) / (1 - belly)) ** 1.6
        nrm = perp(unit(sub(sp[min(n - 1, i + 1)], sp[max(0, i - 1)])))
        hw = w * f / 2 * (1 + a.j(0.06))
        left.append(add(p, mul(nrm, hw)))
        right.append(add(p, mul(nrm, -hw)))
    shape = left + right[::-1]
    a.fill(smooth(Path(), [a.jit(q, 0.3) for q in orient(shape)], closed=True), "ink", 0.95)


def brush_dot(a, c, r, plate="clay", rot=0.0):
    """A brush dot (Arabic nuqta, kana/hanzi dots): a slanted lozenge with soft corners."""
    pts = [rotp(add(c, p), rot, c) for p in ((-r * 0.9, r * 0.1), (-r * 0.2, -r * 0.85), (r * 0.95, -r * 0.2),
                                             (r * 0.25, r * 0.8))]
    if plate:
        off = a.reg(plate)
        a.fill_smooth([add(p, mul(sub(p, c), 0.3)) for p in pts], plate, 0.55, off=off)
    a.fill_smooth(pts, "ink", 0.95, off=(0, 0), jit=0.3)


# --------------------------------------------------------------------------------------------- covers (4:3)


def cover_ground(a, color="ochre", cx=204):
    tint_patch(a, (cx + a.j(6), 246), 178, 40, color, 0.18)


def palm_hand(a, wrist, ang, s, sleeve_from, sleeve_col, tone="mid", flip=False):
    """A hand seen from the side, palm up, fingers together and slightly curled at the tips (offering or receiving),
    on a sleeved forearm. wrist: wrist point; ang: rotation of the hand (0 = fingers to the right, or to the left
    with flip); the sleeve runs from sleeve_from to the wrist and is drawn first, so the whole hand shows."""
    a.tone = tone
    T = Tf(wrist, s, ang, flip)
    sleeve = capsule(sleeve_from, T((-3, 0)), 17 * s, 16 * s, n=4)
    a.fill_smooth(sleeve, sleeve_col)
    a.hatch(clip_half(sleeve, T((0, 4)), T.v((0, 1))), T.ang(70), 5.0, alpha=0.35)
    a.outline(sleeve, LW, second=0.3)
    hand = T.pts([(0, -11), (14, -12), (22, -20), (32, -28), (40, -30), (43, -25), (35, -17), (30, -11), (46, -10),
                  (66, -9), (84, -8), (95, -11), (101, -6), (97, 0), (84, 4), (62, 8), (36, 12), (12, 12), (0, 11)])
    skin_parts(a, [hand])
    a.outline(hand, LW, second=0, jit=0.3)
    a.lines([(T((60, -3)), T((90, -3))), (T((58, 3)), T((86, 2)))], FW * 1.3, alpha=0.75, amp=0.2)
    a.curve(T.pts([(18, -13), (26, -14), (31, -11)]), FW * 1.3, alpha=0.75, jit=0.2)
    return T


@art("cover_nilai", 400, 300, 1.35)
def cover_nilai(a):
    """Nilai: berbagi. An adult's hand from the right offers a mango on its open palm; a child's smaller hand from the
    lower left reaches up, palm open, to receive it. No faces needed: the gesture is the idea."""
    cover_ground(a, "sage")
    palm_hand(a, (128, 204), -16, 0.92, (30, 254), "ochre", tone="deep")
    palm_hand(a, (318, 168), 6, 1.15, (414, 196), "sage", tone="light", flip=True)
    draw_mango(a, (232 + a.j(2), 118), 76, 30)
    motion_arcs(a, (196, 128), 26, 150, 205, w=MW * 1.2, alpha=0.7)


@art("cover_sejarah", 400, 300, 1.35)
def cover_sejarah(a):
    """Sejarah: an hourglass beside an unrolled scroll (squiggles, never letters): time and the stories kept."""
    cover_ground(a, "ochre")
    # scroll, lying a little slanted
    T = Tf((178, 214), 1, -5)
    sheet = T.pts([(-112, -34), (100, -40), (102, 26), (-110, 34)])
    a.fill_poly(sheet, "ochre", 0.35)
    a.fill_poly(sheet, "paper", 0.6, off=(0, 0))
    a.hatch(clip_half(sheet, T((70, 0)), T.v((1, 0))), T.ang(80), 5.2, alpha=0.3)
    for k in range(4):
        y = -22 + k * 13
        ln = (150, 120, 160, 90)[k]
        a.curve(T.pts([(-88 + i * ln / 6, y + 2.4 * math.sin(i * 1.7 + k)) for i in range(7)]), MW, alpha=0.6, jit=0.4)
    a.outline_poly(sheet, LW, second=0.35)
    for x0, rr in ((-112, 13), (102, 15)):
        roll = T.pts(rect(x0 - rr, -46, rr * 2, 88))
        a.fill_poly(roll, "ochre")
        a.hatch(clip_half(roll, T((x0 + rr * 0.3, 0)), T.v((1, 0))), T.ang(80), 3.8, alpha=0.45)
        a.outline_poly(roll, LW, second=0.3)
        a.ell(T((x0, -46)), rr, 4.5, "clay", 0.9, w=MW * 1.2, second=0)
        a.ell(T((x0, 42)), rr, 4.5, w=MW * 1.2, second=0)
    seal = T((-56, 30))
    a.blob([polar(seal, 13 + a.j(1.2), t) for t in range(0, 360, 36)], "clay", w=MW * 1.3, second=0)
    a.curve([add(seal, (-4, 10)), add(seal, (-8, 26)), add(seal, (-2, 30))], MW * 1.5, "clay")
    a.curve([add(seal, (4, 10)), add(seal, (8, 25)), add(seal, (14, 28))], MW * 1.5, "clay")
    # hourglass behind-right of the scroll
    H = Tf((300, 128), 1, 4)
    for y0, h in ((-92, 14), (78, 14)):
        cap = H.pts(rect(-46, y0, 92, h))
        a.fill_poly(cap, "clay")
        a.hatch(cap, H.ang(0), 4.2, alpha=0.4)
        a.outline_poly(cap, LW, second=0.3)
    glass = H.pts([(-34, -78), (34, -78), (30, -46), (8, -10), (6, 0), (8, 10), (30, 46), (34, 78), (-34, 78), (-30, 46),
                   (-8, 10), (-6, 0), (-8, -10), (-30, -46)])
    a.fill_smooth(glass, "slate", 0.18, off=(0, 0))
    sand_top = H.pts([(-24, -48), (24, -48), (7, -14), (-7, -14)])
    a.fill_smooth(sand_top, "ochre")
    heap = H.pts([(-31, 76), (-22, 56), (-6, 44), (6, 44), (22, 56), (31, 76)])
    a.fill_smooth(heap, "ochre")
    a.stipple(heap, 12, 1.8, alpha=0.6)
    a.line(H((0, -12)), H((0, 44)), 2.6, "ochre", amp=0.2)
    a.outline(glass, LW, second=0.4)
    a.curve(H.pts([(-22, -66), (-24, -54), (-18, -44)]), 3.0, "paper", 0.85, jit=0.2)
    for px in (-42, 42):
        post = H.pts(rect(px - 4, -78, 8, 156))
        a.fill_poly(post, "ochre", 0.95)
        a.outline_poly(post, MW * 1.3, second=0)


def tea_glass(a, c, s=1.0):
    """A small tulip-shaped glass of amber tea on a saucer, a wisp of steam."""
    T = Tf(c, s)
    sau = T.pts(ellipse((0, 54), 46, 9, n=14))
    a.fill_smooth(sau, "slate", 0.55)
    a.outline(sau, LW, second=0.3)
    gl = T.pts([(-30, -40), (30, -40), (24, -18), (17, 0), (19, 22), (26, 44), (22, 52), (-22, 52), (-26, 44), (-19, 22),
                (-17, 0), (-24, -18)])
    tea = T.pts([(-27, -28), (27, -28), (23, -16), (17, 0), (19, 22), (25, 43), (21, 50), (-21, 50), (-25, 43), (-19, 22),
                 (-17, 0), (-23, -16)])
    a.fill_smooth(gl, "paper", 0.7, off=(0, 0))
    a.fill_smooth(tea, "clay", 0.8)
    a.fill_smooth(tea, "ochre", 0.45)
    a.hatch(clip_half(tea, T((10, 0)), (1, 0)), 75, 4.0, alpha=0.4)
    a.outline(gl, LW, second=0.35)
    a.ell(T((0, -40)), 30 * s, 5 * s, w=MW, second=0)
    a.curve(T.pts([(-16, -22), (-12, -6), (-14, 10)]), 3.2, "paper", 0.8, jit=0.2)
    steam(a, [T((-8, -52))[0], T((10, -56))[0]], T((0, -50))[1], 40 * s)


@art("cover_lang_arab", 400, 300, 1.35)
def cover_lang_arab(a):
    """Arabic: alif, ba, ta (the first letters every learner meets, «alif ba ta»), hand-lettered right to left as
    brush strokes with their dots, beside a glass of tea on a saucer. Letters are drawn shapes, not type."""
    cover_ground(a, "ochre")
    base = 196
    # alif (rightmost letter)
    brush(a, [(236, 92), (233, 140), (229, base)], 17, "clay", t0=0.8, t1=0.4, belly=0.2)
    # ba: a shallow boat, tick up at both ends, one dot below
    brush(a, [(212, 170), (208, 190), (186, base + 2), (150, base + 2), (132, 190), (128, 172)], 14, "sage", t0=0.6,
          t1=0.5, belly=0.45)
    brush_dot(a, (170, 222), 8, "sage", 12)
    # ta: the same boat, two dots above
    brush(a, [(112, 168), (108, 188), (84, base + 1), (50, base), (34, 188), (30, 170)], 14, "ochre", t0=0.6, t1=0.5,
          belly=0.45)
    brush_dot(a, (62, 160), 7.5, "ochre", 10)
    brush_dot(a, (84, 157), 7.5, "ochre", -6)
    tea_glass(a, (322, 176), 1.15)


def draw_apple(a, c, s=1.0):
    T = Tf(c, s)
    body = T.pts([(0, -34), (16, -44), (34, -40), (46, -20), (46, 6), (36, 30), (18, 44), (0, 40), (-18, 44), (-36, 30),
                  (-46, 6), (-46, -20), (-34, -40), (-16, -44)])
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(spline(body, True, 3), T((14, 6)), T.v((0.7, 0.7))), 62, 4.4, alpha=0.45)
    a.curve(T.pts([(-30, -24), (-36, -8), (-34, 8)]), 4.0, "paper", 0.75, jit=0.2)
    a.outline(body, LW, second=0.4)
    a.curve(T.pts([(0, -34), (2, -50), (8, -62)]), LW * 1.1)
    lf = leaf_pts(T((6, -54)), T((40, -66)), 11 * s, asym=0.7)
    a.fill_smooth(lf, "sage")
    a.outline(lf, MW * 1.2, second=0, jit=0.3)
    a.curve([T((8, -55)), T((24, -61)), T((34, -64))], FW * 1.2)


@art("cover_lang_inggris", 400, 300, 1.35)
def cover_lang_inggris(a):
    """English: a hand-lettered capital A and small a (single-storey, as children write it) as brush strokes, and one
    apple."""
    cover_ground(a, "sage")
    # capital A: two slanted strokes and a crossbar
    brush(a, [(92, 72), (74, 136), (56, 204)], 16, "clay", t0=0.5, t1=0.55, belly=0.25)
    brush(a, [(94, 70), (114, 136), (134, 204)], 16, "clay", t0=0.6, t1=0.45, belly=0.3)
    brush(a, [(70, 160), (96, 157), (120, 160)], 12, "clay", t0=0.7, t1=0.5, belly=0.4)
    # small a: a round bowl and its stem
    bowl = [(220, 148), (206, 134), (186, 134), (170, 150), (166, 174), (176, 196), (196, 202), (214, 190), (220, 170)]
    brush(a, bowl, 13, "ochre", t0=0.5, t1=0.7, belly=0.4)
    brush(a, [(222, 130), (221, 170), (226, 204)], 13, "ochre", t0=0.6, t1=0.35, belly=0.3)
    draw_apple(a, (318, 172), 1.2)


def rice_sujeo(a, c, s=1.0):
    """A bowl of rice with the Korean table set (sujeo) lying in front of it: a long flat spoon and a pair of flat
    metal chopsticks side by side."""
    T = Tf(c, s)

    def rice():
        heap = T.pts(heap_pts((0, -2), 42, 24))
        a.fill_smooth(heap, "paper", off=(0, 0))
        a.stipple(heap, 10, 1.8, alpha=0.5)
        a.curve(heap, MW * 1.2, jit=0.3)

    bowl(a, T((0, 0)), 50 * s, 46 * s, "slate", rice)
    for dy in (0, 9):
        stick = [T((-76, 72 + dy)), T((84, 58 + dy)), T((84, 61.5 + dy)), T((-76, 76.5 + dy))]
        a.fill_poly(stick, "ochre", 0.95)
        a.outline_poly(stick, MW * 1.2, second=0, over=1, gap=1)
    handle = [T((-70, 98)), T((30, 90)), T((30, 95)), T((-70, 103))]
    a.fill_poly(handle, "ochre", 0.95)
    a.outline_poly(handle, MW * 1.2, second=0, over=1, gap=1)
    sp = T.pts(ellipse((52, 90), 24, 11, -5, n=12))
    a.fill_smooth(sp, "ochre", 0.95)
    a.curve(T.pts([(40, 86), (52, 83), (64, 86)]), 3.0, "paper", 0.8, jit=0.2)
    a.outline(sp, LW, second=0.3)


@art("cover_lang_korea", 400, 300, 1.35)
def cover_lang_korea(a):
    """Korean: the hangul syllable 한 (han) as brush strokes: ㅎ top left, ㅏ to its right, ㄴ along the bottom; and
    the everyday spoon-and-chopsticks set on a cloth."""
    cover_ground(a, "ochre")
    # ㅎ: short top stroke, a horizontal, a circle
    brush(a, [(98, 62), (104, 74)], 12, "clay", t0=0.7, t1=0.6, belly=0.4)
    brush(a, [(68, 86), (102, 84), (132, 86)], 12, "clay", t0=0.6, t1=0.5, belly=0.35)
    ring = [polar((100, 124), 25, t, 22) for t in range(-100, 266, 30)]
    brush(a, ring, 11, "clay", t0=0.6, t1=0.6, belly=0.5)
    # ㅏ: a vertical with a short stroke to the right
    brush(a, [(168, 56), (168, 110), (166, 170)], 13, "sage", t0=0.6, t1=0.4, belly=0.25)
    brush(a, [(170, 112), (186, 112), (200, 114)], 11, "sage", t0=0.7, t1=0.5, belly=0.4)
    # ㄴ: down, then along the bottom
    brush(a, [(76, 168), (76, 198), (80, 212), (130, 213), (186, 210)], 13, "ochre", t0=0.6, t1=0.35, belly=0.3)
    rice_sujeo(a, (306, 150), 1.0)


def origami_crane(a, c, s=1.0):
    """A folded paper crane seen from the side: diamond body, thin neck up to the left with the head folded down,
    thin tail up to the right, two wings raised; flat facets and a few fold lines."""
    T = Tf(c, s)
    wing_b = T.pts([(-4, -10), (30, -86), (40, -80), (16, -6)])
    a.fill_poly(wing_b, "ochre", 0.7)
    a.outline_poly(wing_b, MW * 1.4, second=0)
    neck = T.pts([(-30, 2), (-62, -62), (-16, 8)])
    tail = T.pts([(14, 8), (66, -58), (32, 2)])
    head = T.pts([(-62, -62), (-78, -50), (-60, -54)])
    for part in (neck, tail):
        a.fill_poly(part, "clay", 0.95)
        a.outline_poly(part, MW * 1.5, second=0)
    a.fill_poly(head, "clay")
    a.outline_poly(head, MW * 1.3, second=0)
    body = T.pts([(-34, 0), (0, -14), (34, 0), (2, 26)])
    a.fill_poly(body, "clay")
    a.hatch(T.pts([(0, -14), (34, 0), (2, 26)]), T.ang(70), 4.0, alpha=0.45)
    a.outline_poly(body, LW, second=0.3)
    a.line(T((0, -14)), T((2, 26)), MW, amp=0.3)
    wing_f = T.pts([(-18, -6), (-38, -92), (-24, -96), (14, -8)])
    a.fill_poly(wing_f, "ochre")
    a.hatch(clip_half(wing_f, T((-22, -50)), T.v((1, 0.2))), T.ang(76), 4.4, alpha=0.4)
    a.outline_poly(wing_f, LW, second=0.3)
    ground(a, T((-46, 34))[0], T((56, 34))[0], T((0, 34))[1], marks=3)


@art("cover_lang_jepang", 400, 300, 1.35)
def cover_lang_jepang(a):
    """Japanese: the hiragana あ (a) in its three brush strokes, and a folded paper crane."""
    cover_ground(a, "sage")
    # 1: the short horizontal; 2: the long down stroke with a slight bend; 3: the big loop
    brush(a, [(64, 92), (110, 88), (150, 82)], 12, "clay", t0=0.6, t1=0.5, belly=0.3)
    brush(a, [(102, 56), (104, 120), (110, 172), (118, 210)], 12, "clay", t0=0.6, t1=0.35, belly=0.25)
    loop = [(140, 122), (122, 160), (98, 196), (78, 206), (64, 196), (70, 170), (98, 148), (136, 138), (168, 146),
            (182, 170), (172, 196), (148, 212)]
    brush(a, loop, 12, "ochre", t0=0.6, t1=0.3, belly=0.3, steps=4)
    origami_crane(a, (306, 176), 1.05)


def lantern(a, c, s=1.0):
    """A paper lantern (lampion) on a string: ribbed round body, dark caps, a tassel."""
    T = Tf(c, s)
    a.curve([T((0, -120)), T((2, -96)), T((0, -66))], MW * 1.2)
    body = T.pts([polar((0, 0), 58, t, 52) for t in range(0, 360, 20)])
    a.fill_smooth(body, "clay")
    for dx in (-36, -14, 14, 36):
        a.curve(T.pts([(dx * 0.55, -50), (dx, 0), (dx * 0.55, 50)]), MW, "ink", 0.6, jit=0.3)
    a.hatch(clip_half(spline(body, True, 3), T((22, 0)), (1, 0)), 74, 4.6, alpha=0.4)
    a.outline(body, LW, second=0.4)
    for y in (-56, 50):
        cap = T.pts(rect(-26, y - 6, 52, 12))
        a.fill_poly(cap, "ochre")
        a.outline_poly(cap, MW * 1.4, second=0)
    a.line(T((0, 62)), T((0, 76)), MW * 1.3)
    tas = T.pts([(-7, 74), (7, 74), (10, 108), (-10, 108)])
    a.fill_poly(tas, "ochre", 0.95)
    a.lines([(T((x, 80)), T((x * 1.3, 106))) for x in (-4, 0, 4)], FW * 1.2, alpha=0.7)
    a.outline_poly(tas, MW * 1.2, second=0)


@art("cover_lang_mandarin", 400, 300, 1.35)
def cover_lang_mandarin(a):
    """Mandarin: the hanzi 学 (xué, to learn) as brush strokes: three dots, the cover, then 子; and a paper lantern
    (lampion), familiar from Imlek in Indonesia."""
    cover_ground(a, "ochre")
    # three strokes on top: dot, dot, a left-falling stroke
    brush(a, [(82, 56), (92, 72)], 11, "clay", t0=0.5, t1=0.8, belly=0.6)
    brush(a, [(118, 52), (124, 70)], 11, "clay", t0=0.5, t1=0.8, belly=0.6)
    brush(a, [(166, 50), (156, 64), (146, 74)], 11, "clay", t0=0.8, t1=0.4, belly=0.3)
    # the cover: a short down stroke, then across with a hook down
    brush(a, [(64, 92), (66, 110)], 11, "sage", t0=0.6, t1=0.6, belly=0.5)
    brush(a, [(66, 90), (120, 88), (176, 88), (172, 100), (166, 110)], 11, "sage", t0=0.6, t1=0.4, belly=0.4)
    # 子: across with a turn down-left, the vertical hook, the long horizontal
    brush(a, [(88, 122), (124, 120), (146, 120), (130, 134), (118, 144)], 11, "ochre", t0=0.6, t1=0.6, belly=0.4)
    brush(a, [(118, 142), (120, 190), (118, 214), (110, 216), (100, 208)], 12, "ochre", t0=0.7, t1=0.4, belly=0.3)
    brush(a, [(62, 168), (120, 165), (182, 166)], 12, "ochre", t0=0.6, t1=0.45, belly=0.35)
    lantern(a, (306, 156), 1.0)


# --------------------------------------------------------------------------------------------- level badges


def badge_disc(a, color="ochre"):
    tint_patch(a, (120 + a.j(3), 126 + a.j(3)), 104, 100, color, 0.16)


def soil_mound(a, cx, base, rx=62, h=26):
    pile = []
    for i in range(11):
        t = math.pi * i / 10
        lift = math.sin(t) ** 1.3
        pile.append((cx - rx * math.cos(t), base - h * lift))
    sag = [(cx + rx * 0.5, base + 4), (cx, base + 6), (cx - rx * 0.5, base + 4)]
    a.fill_smooth(pile + sag, "clay", 0.6)
    a.hatch(clip_half(spline(pile + sag, True, 3), (cx + 18, 0), (1, 0)), 62, 6.0, alpha=0.42)
    a.stipple(clip_half(pile + sag, (cx + 8, 0), (-1, 0)), 8, 2.6, alpha=0.6)
    a.curve(pile, LW * 1.6)
    a.line((cx - rx - 8, base + 2), (cx + rx + 6, base + 3), MW * 1.1, amp=0.8, over=(1, 3))
    return (cx, base - h + 3)


def aya_leaf(a, base, tip, wdt, w=LW * 1.25, vein=True):
    lp = leaf_pts(base, tip, wdt, asym=0.75)
    a.fill_smooth(lp, "sage")
    a.outline(lp, w, second=0, jit=0.3)
    if vein:
        a.curve([base, lerp(base, tip, 0.5), lerp(base, tip, 0.82)], MW, jit=0.3)


@art("level_pemula", 240, 240, 1.5)
def level_pemula(a):
    """Pemula: a seedling: a short stem and Aya's two leaves, just out of a small soil mound."""
    badge_disc(a)
    root = soil_mound(a, 120 + a.j(2), 192)
    top = (root[0] + 2, root[1] - 46)
    a.curve([root, (root[0] - 6, root[1] - 22), top], LW * 1.5)
    aya_leaf(a, top, (top[0] - 58, top[1] - 26), 21)
    aya_leaf(a, top, (top[0] + 60, top[1] - 40), 23)


@art("level_menengah", 240, 240, 1.5)
def level_menengah(a):
    """Menengah: a sapling: a taller stem with three pairs of Aya's leaves, the top pair still small."""
    badge_disc(a)
    root = soil_mound(a, 118 + a.j(2), 202)
    stem = [root, (root[0] - 5, root[1] - 40), (root[0] + 3, root[1] - 84), (root[0] - 1, root[1] - 126)]
    a.curve(stem, LW * 1.55)
    sp = spline(stem, False, 6)
    for t, ln, wd, lift in ((0.36, 50, 17, 10), (0.66, 44, 15, 20), (0.97, 30, 11, 24)):
        b = sp[int(t * (len(sp) - 1))]
        aya_leaf(a, b, (b[0] - ln, b[1] - lift), wd, LW * 1.15)
        aya_leaf(a, b, (b[0] + ln * 1.05, b[1] - lift - 8), wd * 1.05, LW * 1.15)


def crown_pts(c, rx, ry, n=11, bump=0.12, ph=0.0):
    """A leafy crown: an ellipse whose edge bulges into n leaf-tip bumps."""
    pts = []
    for i in range(n * 3):
        t = TAU * i / (n * 3)
        f = 1 + bump * (1 if i % 3 == 0 else (-0.2 if i % 3 == 1 else 0.3))
        pts.append((c[0] + rx * f * math.cos(t + ph), c[1] + ry * f * math.sin(t + ph)))
    return pts


def tree_trunk(a, base, top, w0, w1, branches=()):
    trunk = ribbon([base, lerp(base, top, 0.5), top], w0, w1)
    a.fill_smooth(trunk, "ochre")
    a.fill_smooth(trunk, "clay", 0.45)
    a.hatch(clip_half(trunk, add(base, (w0 * 0.15, 0)), (1, 0)), 76, 3.6, alpha=0.5)
    a.outline(trunk, LW * 1.3, second=0, jit=0.3)
    for p0, p1, bw in branches:
        br = ribbon([p0, lerp(p0, p1, 0.5), p1], bw, bw * 0.55)
        a.fill_smooth(br, "ochre")
        a.fill_smooth(br, "clay", 0.45)
        a.outline(br, LW * 1.1, second=0, jit=0.3)


@art("level_mahir", 240, 240, 1.5)
def level_mahir(a):
    """Mahir: a young tree: a slim trunk with two branches and a round crown made of Aya's leaves."""
    badge_disc(a)
    root = soil_mound(a, 120 + a.j(2), 206, rx=66)
    top = (root[0] + 2, root[1] - 92)
    tree_trunk(a, (root[0], root[1] + 2), top, 16, 9,
               ((lerp(root, top, 0.55), (root[0] - 28, root[1] - 98), 8),
                (lerp(root, top, 0.7), (root[0] + 30, root[1] - 106), 8)))
    cc = (root[0] + 2, root[1] - 128)
    crown = crown_pts(cc, 66, 50, n=12, bump=0.1, ph=a.u(0, 1))
    a.fill_smooth(crown, "sage")
    a.hatch(clip_half(spline(crown, True, 2), (cc[0] + 20, cc[1] + 10), (0.6, 0.8)), 62, 5.4, alpha=0.4)
    for ang in (200, 250, 300, 345, 30):
        p = polar(cc, 30, ang, 22)
        aya_leaf(a, p, polar(cc, 60, ang + 8, 46), 10, MW * 1.2)
    a.outline(crown, LW * 1.4, second=0.3)


@art("level_master", 240, 240, 1.5)
def level_master(a):
    """Master: a full fruiting tree: a sturdy trunk, a wide crown of Aya's leaves and ripe mangoes hanging in it."""
    badge_disc(a)
    root = soil_mound(a, 120 + a.j(2), 210, rx=72, h=22)
    top = (root[0] + 1, root[1] - 82)
    tree_trunk(a, (root[0], root[1] + 2), top, 22, 12,
               ((lerp(root, top, 0.5), (root[0] - 40, root[1] - 102), 11),
                (lerp(root, top, 0.66), (root[0] + 42, root[1] - 110), 11)))
    cc = (root[0] + 1, root[1] - 132)
    crown = crown_pts(cc, 92, 64, n=14, bump=0.09, ph=a.u(0, 1))
    a.fill_smooth(crown, "sage")
    a.hatch(clip_half(spline(crown, True, 2), (cc[0] + 30, cc[1] + 14), (0.6, 0.8)), 62, 5.4, alpha=0.4)
    for ang in (196, 236, 282, 322, 2):
        p = polar(cc, 44, ang, 30)
        aya_leaf(a, p, polar(cc, 84, ang + 8, 58), 11, MW * 1.2)
    a.outline(crown, LW * 1.4, second=0.3)
    for c, rot in (((cc[0] - 46, cc[1] + 18), 8), ((cc[0] + 8, cc[1] + 36), -6), ((cc[0] + 52, cc[1] + 10), 14),
                   ((cc[0] - 12, cc[1] - 16), -10)):
        draw_mango(a, c, 30, rot, leaf=False, hatch=False, w=LW * 1.1)


SHEETS.append(("13a_fu12_covers_levels", lambda k: k in (
    "cover_nilai", "cover_sejarah", "cover_lang_arab", "cover_lang_inggris", "cover_lang_korea", "cover_lang_jepang",
    "cover_lang_mandarin", "level_pemula", "level_menengah", "level_mahir", "level_master"), 6, 150))
