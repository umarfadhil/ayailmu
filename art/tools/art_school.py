"""Follow-up 12, art group A (MODULES_LEVELS_STORIES §6.4): science, maths and culture pictures for the new levels.
DRAFT art (ART_DIRECTION §6): placeholders until an illustrator redraws or approves them.

Diagrams are drawings, not textbook charts: no text or digits (a number line has ticks, a thermometer marks, money
notes are generic). Objects are 240 x 240 like the pic_* vocabulary; the cycles and the solar system are 400 x 300;
the world map is 400 x 200 like map_indonesia. sci_plant_parts and soc_world_continents publish tap regions
(REGIONS, copied into docs/ART_CATALOG.md); a small wrapper below makes draw.py's write_index export every REGIONS
entry whose key is drawn (draw.py lists its four scenes by name).
"""

from draw import *  # noqa: F401,F403
import draw as _draw
from art_covers import art  # group A shared helper: @art_key + snap + pack + coarse

# --------------------------------------------------------------------------------------------- regions export


def _export_all_regions():
    """Chain onto draw.write_index: after it runs, add every REGIONS entry whose key is drawn and is not listed yet.
    Idempotent, so another module may wrap write_index the same way."""
    orig = _draw.write_index

    def write_index(keys):
        orig(keys)
        path = _draw.INDEX_JSON
        body = json.loads(path.read_text(encoding="utf-8"))
        extra = {k: _draw.REGIONS[k] for k in sorted(_draw.REGIONS) if k in keys and k not in body.get("regions", {})}
        if extra:
            body.setdefault("regions", {}).update(extra)
            path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")

    _draw.write_index = write_index


_export_all_regions()

REGIONS["sci_plant_parts"] = {
    "flower": {"x": 0.36, "y": 0.04, "w": 0.28, "h": 0.30},
    "leaf": {"x": 0.22, "y": 0.34, "w": 0.56, "h": 0.22},
    "stem": {"x": 0.46, "y": 0.36, "w": 0.08, "h": 0.32},
    "root": {"x": 0.30, "y": 0.70, "w": 0.40, "h": 0.27},
}

# --------------------------------------------------------------------------------------------- small shared marks


def arrow(a, pts, w=None, head=8.0, color="ink", alpha=1.0, jit=0.4):
    """A drawn arrow along pts with an open head at the end."""
    w = w or MW * 1.3
    a.curve(pts, w, color, alpha, jit)
    end = pts[-1]
    d = unit(sub(end, spline(pts, False, 4)[-3] if len(pts) > 2 else pts[0]))
    a.zig([add(end, mul(rotp(d, 150), head)), end, add(end, mul(rotp(d, -150), head))], w, color, alpha, jit=0.2)


def dashed(a, pts, w=FW * 1.3, color="ink", alpha=0.7, on=6.0, off=5.0):
    sp = spline(pts, False, 8) if len(pts) > 2 else subdivide(pts, 2, closed=False)
    segs, acc, cur = [], 0.0, [sp[0]]
    draw_on = True
    for p, q in zip(sp, sp[1:]):
        acc += vlen(sub(q, p))
        cur.append(q)
        if acc >= (on if draw_on else off):
            if draw_on:
                segs.append((cur[0], cur[-1]))
            draw_on, acc, cur = not draw_on, 0.0, [q]
    a.lines(segs, w, color, alpha, amp=0.2)


def soil_band(a, y, x0=0, x1=240, y1=240, stones=4):
    gnd = [(x0, y)] + [(x, y + 2.5 * math.sin(x / 23 + 0.4)) for x in range(int(x0) + 20, int(x1), 30)] + [
        (x1, y), (x1, y1), (x0, y1)]
    a.fill_poly(gnd, "clay", 0.32, off=(0, 0), step=40)
    a.stipple(gnd, int((x1 - x0) / 9), 2.0, alpha=0.45)
    a.curve([(x0 + 4, y + 1), ((x0 + x1) / 2, y - 2), (x1 - 4, y + 1)], MW * 1.2)
    for i in range(stones):
        c = (x0 + (x1 - x0) * (i + 0.5) / stones + a.j(10), y + (y1 - y) * a.u(0.45, 0.85))
        a.ell(c, a.u(5, 8), a.u(3.5, 5), "slate", 0.5, w=FW * 1.3, second=0)


def grass_tufts(a, xs, y, h=10):
    segs = []
    for x in xs:
        segs += [((x, y), (x - 4, y - h * 0.8)), ((x, y), (x + 1, y - h)), ((x, y), (x + 5, y - h * 0.75))]
    a.lines(segs, FW * 1.3, "ink", 0.85, amp=0.3)


# --------------------------------------------------------------------------------------------- science


@art("sci_plant_parts", 400, 300, 1.3)
def sci_plant_parts(a):
    """A whole flowering plant with its roots shown in a cut-away of the soil. Tap regions (REGIONS): flower at the
    top, leaf (the band of the two big leaves), stem (the stalk below the leaves; drawn on top of leaf where they
    overlap, the smaller region wins), root (under the soil line)."""
    gy = 206
    soil_band(a, gy, 0, 400, 300, stones=6)
    grass_tufts(a, (40, 76, 120, 282, 330, 372), gy)
    # roots: one tap root and branching side roots, all below the soil line
    root_top = (200, gy + 2)
    main = [root_top, (198, 232), (203, 258), (199, 286)]
    a.curve(main, LW * 1.1)
    side = [((199, 222), (166, 240), (142, 262)), ((201, 228), (236, 246), (258, 270)),
            ((198, 246), (176, 264), (168, 286)), ((202, 252), (224, 270), (232, 288)),
            ((166, 240), (150, 246), (134, 244)), ((236, 246), (252, 248), (266, 244))]
    for p0, p1, p2 in side:
        a.curve([p0, p1, p2], MW * 1.1, jit=0.4)
    hairs = []
    for p0, p1, p2 in side[:4]:
        for t in (0.4, 0.7):
            q = lerp(p1, p2, t)
            hairs.append((q, add(q, (a.j(6), a.u(5, 9)))))
    a.lines(hairs, FW, alpha=0.7, amp=0.2)
    # stem
    stem = [(200, gy + 4), (197, 172), (202, 130), (200, 96)]
    a.blob(ribbon(stem, 9, 6), "sage", w=MW * 1.4, second=0)
    # two big leaves around y 108..166
    for base, tip, wd in (((198, 152), (104, 120), 30), ((202, 134), (296, 112), 30)):
        lp = leaf_pts(base, tip, wd, asym=0.75)
        a.fill_smooth(lp, "sage")
        a.hatch(clip_half(spline(lp, True, 2), lerp(base, tip, 0.5), unit(perp(sub(tip, base)))), 60, 5.0, alpha=0.35)
        a.outline(lp, LW, second=0.3)
        a.curve([base, lerp(base, tip, 0.5), lerp(base, tip, 0.88)], MW, jit=0.3)
        for t in (0.3, 0.55, 0.75):
            p = lerp(base, tip, t)
            n = unit(perp(sub(tip, base)))
            a.line(p, add(add(p, mul(n, wd * 0.5)), mul(unit(sub(tip, base)), 10)), FW, alpha=0.6, amp=0.2)
    # flower: five clay petals and an ochre centre, around (200, 58)
    fc = (201, 58)
    for k in range(5):
        ang = -90 + 72 * k + a.j(5)
        tip = polar(fc, 44, ang)
        pet = ellipse(polar(fc, 24, ang), 21, 15, ang, n=10)
        a.fill_smooth(pet, "clay", 0.9)
        a.outline(pet, MW * 1.4, second=0, jit=0.3)
    a.ell(fc, 13, 12, "ochre", w=LW, second=0)
    a.stipple(ellipse(fc, 9, 8, n=10), 6, 2.0, alpha=0.7)
    a.curve([(200, 96), (201, 84), (201, 72)], LW)


@art("sci_seed_sprout", 240, 240, 1.0)
def sci_seed_sprout(a):
    """Germination in a cut-away of the soil: a split bean seed, its first root reaching down, the curved shoot pushing
    up through the soil line with two small leaves just open."""
    gy = 96
    soil_band(a, gy, 0, 240, 240, stones=4)
    seed_c = (116, 156)
    root = [(116, 166), (112, 186), (118, 206), (114, 230)]
    a.curve(root, LW)
    a.lines([((113, 190), (98, 202)), ((117, 206), (134, 216)), ((115, 218), (102, 228))], MW, amp=0.3)
    for sx in (-1, 1):
        half = ellipse(add(seed_c, (sx * 11, 0)), 13, 19, sx * 14, n=12)
        a.fill_smooth(half, "ochre")
        a.hatch(clip_half(half, add(seed_c, (sx * 16, 0)), (sx, 0)), 70, 3.6, alpha=0.45)
        a.outline(half, LW, second=0, jit=0.3)
    shoot = [(118, 140), (124, 118), (120, 96), (112, 76), (118, 58)]
    a.blob(ribbon(shoot, 7, 5), "sage", w=MW * 1.3, second=0)
    top = (118, 58)
    for tip, wd in (((80, 40), 16), ((158, 32), 17)):
        lp = leaf_pts(top, tip, wd, asym=0.75)
        a.fill_smooth(lp, "sage")
        a.outline(lp, LW, second=0, jit=0.3)
        a.curve([top, lerp(top, tip, 0.5), lerp(top, tip, 0.82)], FW * 1.2, jit=0.3)
    grass_tufts(a, (30, 200), gy, 9)


def leaf_big(a, base, tip, wd, col="sage", veins=4, bite=None):
    lp = leaf_pts(base, tip, wd, asym=0.85, n=8)
    a.fill_smooth(lp, col)
    a.hatch(clip_half(spline(lp, True, 2), lerp(base, tip, 0.5), unit(perp(sub(tip, base)))), 60, 5.4, alpha=0.3)
    a.outline(lp, LW, second=0.35)
    a.curve([base, lerp(base, tip, 0.5), lerp(base, tip, 0.9)], MW, jit=0.3)
    d, n = unit(sub(tip, base)), unit(perp(sub(tip, base)))
    segs = []
    for i in range(veins):
        t = 0.2 + 0.6 * i / max(1, veins - 1)
        p = lerp(base, tip, t)
        for sgn in (1, -1):
            segs.append((p, add(add(p, mul(n, sgn * wd * 0.55)), mul(d, wd * 0.45))))
    a.lines(segs, FW, alpha=0.55, amp=0.3)
    return lp


@art("sci_butterfly_egg", 240, 240, 1.0)
def sci_butterfly_egg(a):
    """A leaf with a small cluster of butterfly eggs on it (round, pale, ribbed), seen close up."""
    leaf_big(a, (24, 214), (214, 30), 70)
    eggs = [(118, 112), (136, 104), (128, 126), (146, 120), (110, 132), (140, 140), (122, 146)]
    for c in eggs:
        e = ellipse(c, 9, 10, -40, n=10)
        a.fill_smooth(e, "paper", off=(0, 0))
        a.fill_smooth(e, "ochre", 0.45)
    a.lines([(add(c, (-3, -6)), add(c, (-3, 6))) for c in eggs] + [(add(c, (2, -7)), add(c, (2, 7))) for c in eggs],
            FW, alpha=0.5, amp=0.2)
    for c in eggs:
        a.ell(c, 8.5, 10, rot=-40, w=MW * 1.2, second=0)


@art("sci_caterpillar", 240, 240, 1.0)
def sci_caterpillar(a):
    """A caterpillar (ulat) crawling along a leaf with a bitten edge: round segments, small stripes, a friendly head
    with dot eyes and two short feelers."""
    lp = leaf_big(a, (12, 226), (232, 150), 66, veins=4)
    for c, r in (((170, 178), 11), ((194, 172), 8), ((82, 200), 7)):
        hole = [polar(c, r * a.u(0.75, 1.2), t) for t in range(0, 360, 40)]
        a.fill_smooth(hole, "paper", off=(0, 0))
        a.outline(hole, MW * 1.2, second=0, jit=0.3)
    segs = [(48, 160), (66, 150), (84, 146), (102, 146), (120, 140), (136, 130), (151, 122)]
    for i, c in enumerate(segs):
        r = 13 if i < len(segs) - 1 else 15
        e = ellipse(c, r, r * 0.95, n=10)
        a.fill_smooth(e, "ochre" if i % 2 else "sage")
        a.outline(e, MW * 1.4, second=0, jit=0.3)
        if i < len(segs) - 1:
            a.line(add(c, (-4, -9)), add(c, (2, 9)), 3.0, "clay", 0.8, amp=0.3)
            a.lines([(add(c, (-4, 12)), add(c, (-6, 18))), (add(c, (4, 12)), add(c, (5, 18)))], MW, amp=0.2)
    h = segs[-1]
    a.dots([add(h, (5, -3))], 4.4)
    a.curve([add(h, (-2, 7)), add(h, (5, 9)), add(h, (10, 6))], FW * 1.3, jit=0.1)
    for dx in (-6, 6):
        a.curve([add(h, (dx, -13)), add(h, (dx + 3, -22)), add(h, (dx + 8, -26))], MW, jit=0.2)
    a.fill_smooth(ellipse(add(h, (10, 2)), 3.4, 2.2, n=6), "blush", 0.9)


@art("sci_pupa", 240, 240, 1.0)
def sci_pupa(a):
    """A chrysalis (kepompong) hanging from a twig by a short silk pad: a pale green drop with a ring of small gold
    dots and soft fold lines, a leaf on the twig."""
    tw = [(10, 50), (70, 58), (140, 52), (226, 62)]
    a.blob(ribbon(tw, 9, 6), "ochre", w=MW * 1.4, second=0)
    a.fill_smooth(ribbon(tw, 9, 6), "clay", 0.4)
    lf = leaf_pts((176, 58), (214, 104), 16, asym=0.75)
    a.fill_smooth(lf, "sage")
    a.outline(lf, MW * 1.4, second=0, jit=0.3)
    a.line((178, 60), (206, 94), FW, amp=0.3)
    stalk = (112, 57)
    a.line(stalk, (113, 74), MW * 1.4, amp=0.2)
    body = [(113, 72), (126, 82), (138, 108), (142, 140), (136, 172), (124, 194), (114, 204), (104, 194), (92, 172),
            (86, 140), (90, 108), (100, 82)]
    a.fill_smooth(body, "sage", 0.85)
    a.hatch(clip_half(spline(body, True, 3), (126, 0), (1, 0)), 74, 4.6, alpha=0.4)
    a.curve([(96, 110), (114, 104), (134, 112)], MW, alpha=0.8)
    a.curve([(92, 150), (112, 158), (138, 150)], FW * 1.3, alpha=0.6)
    a.curve([(98, 176), (112, 182), (130, 176)], FW * 1.3, alpha=0.6)
    a.dots([(100, 121), (108, 118), (117, 117), (126, 118), (134, 122)], 4.2, "ochre")
    a.outline(body, LW, second=0.4)


@art("sci_ice_cube", 240, 240, 1.0)
def sci_ice_cube(a):
    """Three ice cubes on a small plate, rounded edges and pale glints, a little melt-water pooling around them."""
    plate(a, (120, 186), 98, 26)
    a.fill_smooth(ellipse((118, 186), 70, 13, n=14), "slate", 0.3)

    def cube(x, y, s, rot):
        T = Tf((x, y), s, rot)
        front = T.pts([(-24, -18), (22, -20), (24, 22), (-22, 24)])
        top = T.pts([(-24, -18), (-8, -34), (36, -36), (22, -20)])
        side = T.pts([(22, -20), (36, -36), (38, 4), (24, 22)])
        for f, al in ((front, 0.3), (top, 0.14), (side, 0.42)):
            a.fill_smooth(f, "paper", 0.9, off=(0, 0))
            a.fill_smooth(f, "slate", al)
        a.hatch(side, T.ang(80), 4.0, color="slate", alpha=0.5)
        a.outline_poly(T.pts([(-24, -18), (-8, -34), (36, -36), (38, 4), (24, 22), (-22, 24)]), LW, second=0.3)
        a.outline_poly(T.pts([(-24, -18), (22, -20), (24, 22)]), MW * 1.2, closed=False, second=0)
        a.line(T((22, -20)), T((36, -36)), MW * 1.2)
        a.curve(T.pts([(-16, -10), (-16, 4), (-12, 12)]), 3.0, "paper", 0.9, jit=0.2)

    cube(78, 152, 1.0, -6)
    cube(160, 156, 0.92, 8)
    cube(118, 116, 0.95, 3)
    for c in ((54, 192), (178, 196)):
        drop(a, c, 6, "slate")


@art("sci_water_drop", 240, 240, 1.0)
def sci_water_drop(a):
    """One big falling water drop, two small ones, and the ripple rings where an earlier drop met the water."""
    T = Tf((118, 96), 1.0)
    big = T.pts([(0, -70), (14, -40), (30, -12), (38, 14), (34, 38), (18, 54), (0, 58), (-18, 54), (-34, 38), (-38, 14),
                 (-30, -12), (-14, -40)])
    a.fill_smooth(big, "slate", 0.75)
    a.hatch(clip_half(spline(big, True, 3), T((12, 10)), (0.7, 0.7)), 55, 4.6, alpha=0.4)
    a.curve(T.pts([(-22, 6), (-22, 26), (-12, 40)]), 5, "paper", 0.85, jit=0.2)
    a.outline(big, LW, second=0.4)
    drop(a, (182, 70), 9, "slate")
    drop(a, (60, 136), 7, "slate", 10)
    pool = (126, 206)
    a.fill_smooth(ellipse(pool, 92, 18, n=16), "slate", 0.22)
    for rx, ry, w in ((26, 6, MW * 1.3), (52, 11, MW), (80, 16, FW * 1.3)):
        a.ell_outline(pool, rx, ry, w=w, second=0, wob=0.02)
    for dx, h in ((-14, 14), (0, 20), (14, 12)):
        a.curve([(pool[0] + dx, pool[1] - 6), (pool[0] + dx * 1.3, pool[1] - h)], MW, jit=0.2)


@art("sci_steam_kettle", 240, 240, 1.0)
def sci_steam_kettle(a):
    """A kettle on a small gas stove (kompor), flames under it and steam curling out of the spout: water turning to
    steam."""
    st = [(40, 196), (204, 192), (206, 226), (38, 228)]
    a.block(st, "slate", 0.9, second=0)
    a.dots([(66, 212), (182, 210)], 8, "ochre")
    a.lines([((84, 190), (84, 178)), ((156, 188), (156, 178))], LW, amp=0.2)
    for x, h, col in ((96, 22, "clay"), (110, 28, "ochre"), (124, 30, "clay"), (138, 26, "ochre"), (150, 20, "clay")):
        fl = [(x - 6, 186), (x - 4, 186 - h * 0.5), (x, 186 - h), (x + 4, 186 - h * 0.45), (x + 6, 186)]
        a.fill_smooth(fl, col, 0.9)
        a.curve(fl, FW * 1.3, jit=0.2)
    body = [(70, 172), (66, 140), (78, 112), (100, 98), (140, 98), (162, 112), (174, 140), (170, 172)]
    a.fill_smooth(body, "ochre")
    a.hatch(clip_half(spline(body, True, 3), (148, 0), (1, 0)), 70, 4.4, alpha=0.45)
    a.curve([(84, 124), (80, 140), (84, 156)], 4, "paper", 0.8, jit=0.2)
    sp = ribbon([(166, 140), (186, 124), (200, 100)], 18, 9)
    a.blob(sp, "ochre", w=MW * 1.4, second=0)
    a.outline(body, LW, second=0.4)
    a.line((66, 172), (174, 172), MW * 1.3)
    a.ell((120, 96), 22, 6, "clay", w=MW * 1.3, second=0)
    a.ell((120, 88), 6, 5, "clay", w=MW * 1.2, second=0)
    a.curve([(88, 104), (92, 60), (148, 60), (152, 104)], LW * 1.3)
    for k, (x, y) in enumerate(((204, 92), (214, 88), (196, 84))):
        a.curve([(x, y), (x + 8, y - 16), (x - 2, y - 32), (x + 8, y - 50), (x + 2, y - 64)], MW * (1.4 - 0.2 * k),
                alpha=0.75, jit=0.4)


@art("sci_solar_system", 400, 300, 1.3)
def sci_solar_system(a):
    """The Sun at the left edge and the eight planets on their orbit lines, in order and roughly in size: small rocky
    ones, then big banded Jupiter, ringed Saturn, and the two pale ice giants. Not to scale."""
    sc = (-34, 150)
    rays = [(polar(sc, 112, t), polar(sc, 126, t)) for t in range(-50, 51, 12)]
    a.lines(rays, MW * 1.3, "ochre", 0.9, amp=0.3)
    sun = [polar(sc, 100 + a.j(2), t) for t in range(-70, 71, 10)] + [(-2, 300), (-2, 0)]
    a.fill_smooth(sun, "ochre")
    a.hatch(clip_half(sun, (40, 0), (1, 0)), 60, 5.0, color="clay", alpha=0.45)
    a.curve([polar(sc, 100, t) for t in range(-62, 63, 10)], LW)
    planets = [
        # orbit r, angle, size, colour, extra
        (130, 12, 5, "slate", None), (154, -15, 8, "ochre", None), (180, 18, 8.5, "slate", "earth"),
        (206, -9, 6.5, "clay", None), (248, 15, 23, "ochre", "bands"), (296, -19, 17, "ochre", "ring"),
        (340, 12, 12, "slate", "pale"), (382, -6, 11.5, "slate", None)]
    for r, ang, s, col, ex in planets:
        a.arc(sc, r, -38, 38, FW * 1.2, "slate", 0.55, n=8)
    for r, ang, s, col, ex in planets:
        c = polar(sc, r, ang)
        if ex == "ring":
            a.arc(c, s * 2.0, 180, 360, MW * 1.4, "ink", ry=s * 0.55, rot=-12, n=8)
        e = ellipse(c, s, s, n=12)
        a.fill_smooth(e, col, 0.55 if ex == "pale" else 0.95)
        if ex == "earth":
            a.fill_smooth(ellipse(add(c, (-2, -1)), s * 0.5, s * 0.6, 20, n=7), "sage", off=(0, 0))
        if ex == "bands":
            a.lines([(add(c, (-s * 0.9, dy)), add(c, (s * 0.9, dy + 2))) for dy in (-9, -3, 4, 11)], MW, "clay", 0.8,
                    amp=0.4)
        if s > 9:
            a.hatch(clip_half(e, add(c, (s * 0.3, 0)), (1, 0)), 62, 3.6, alpha=0.4)
        a.ell_outline(c, s, s, w=LW if s > 9 else MW * 1.3, second=0)
        if ex == "ring":
            a.arc(c, s * 2.0, 0, 180, MW * 1.4, "ink", ry=s * 0.55, rot=-12, n=8)
            a.arc(c, s * 1.7, 10, 170, FW * 1.3, "ochre", ry=s * 0.42, rot=-12, n=8)
    a.dots([(372, 40), (330, 262), (240, 44), (148, 270)], 3.0, "ochre", 0.9)


@art("sci_magnet", 240, 240, 1.0)
def sci_magnet(a):
    """A horseshoe magnet (red with pale tips) holding a chain of paper clips and pulling a small nail toward it;
    short arcs show the pull."""
    T = Tf((112, 92), 1, -8)
    outer = T.pts([polar((0, 0), 62, t) for t in range(180, 361, 15)] + [(62, 64), (34, 64)]
                  + [polar((0, 0), 34, t) for t in range(360, 179, -15)] + [(-34, 64), (-62, 64)])
    a.fill_smooth(outer, "clay")
    a.hatch(clip_half(outer, T((30, 0)), T.v((1, 0))), T.ang(70), 4.4, alpha=0.45)
    for x0 in (-62, 34):
        tip = T.pts(rect(x0, 40, 28, 26))
        a.fill_poly(tip, "paper", off=(0, 0))
        a.fill_poly(tip, "slate", 0.35)
        a.outline_poly(tip, MW * 1.3, second=0)
    a.outline(outer, LW, second=0.4)
    a.curve(T.pts([(-48, -10), (-40, -36), (-16, -52)]), 4, "paper", 0.75, jit=0.2)

    def clip_(c, rot):
        P = Tf(c, 1.25, rot)
        a.curve(P.pts([(-3, 10), (-3, -10), (0, -13), (4, -10), (4, 13), (0, 16), (-6, 13), (-6, -4)]), MW * 1.3,
                "slate", jit=0.15)

    for c, rot in ((T((-48, 86)), -6), (T((-46, 116)), 6), (T((-49, 146)), -4)):
        clip_(c, rot)
    nail = [T((46, 112)), T((70, 152))]
    a.line(nail[0], nail[1], 4.4, "slate", amp=0.2)
    a.line(add(nail[0], (-7, 5)), add(nail[0], (7, -5)), LW, amp=0.1)
    for r in (10, 17):
        a.arc(T((48, 74)), r, 50, 130, FW * 1.4, alpha=0.8)
        a.arc(T((-48, 140)), r - 4, 50, 130, FW * 1.2, alpha=0.6)


@art("sci_battery_bulb", 240, 240, 1.0)
def sci_battery_bulb(a):
    """A simple circuit: a battery, two wires, and a small bulb that lights (short drawn rays). No + or - signs."""
    T = Tf((86, 180), 1, -4)
    body = T.pts(rect(-58, -18, 104, 36))
    a.fill_poly(body, "ochre")
    band = T.pts(rect(-58, -18, 30, 36))
    a.fill_poly(band, "slate", 0.9)
    a.hatch(T.pts(rect(-58, 4, 104, 14)), T.ang(0), 3.4, alpha=0.4)
    a.outline_poly(body, LW, second=0.3)
    a.line(T((-28, -18)), T((-28, 18)), MW)
    nub = T.pts(rect(46, -7, 9, 14))
    a.block(nub, "slate", w=MW * 1.3, second=0)
    bc = (170, 72)
    a.curve([T((55, 0)), (150, 172), (172, 150), (174, 112)], MW * 1.5, "clay", jit=0.4)
    a.curve([T((-58, 0)), (16, 150), (60, 112), (128, 118), (164, 110)], MW * 1.5, "ink", jit=0.4)
    base = [(156, 92), (184, 92), (182, 114), (158, 114)]
    a.fill_poly(base, "slate", 0.9)
    a.lines([((157, 99), (183, 99)), ((157, 106), (183, 106))], FW * 1.3, "paper", 0.7, amp=0.2)
    a.outline_poly(base, MW * 1.4, second=0)
    glass = [(156, 92), (148, 76), (144, 56), (152, 38), (170, 30), (188, 38), (196, 56), (192, 76), (184, 92)]
    a.fill_smooth(glass, "ochre", 0.35)
    a.fill_smooth(glass, "paper", 0.5, off=(0, 0))
    a.zig([(162, 88), (164, 64), (168, 56), (172, 64), (176, 56), (178, 64), (180, 88)], FW * 1.4, jit=0.2)
    a.outline(glass, LW, second=0.3)
    a.lines([(polar((170, 58), 38, t), polar((170, 58), 52, t)) for t in range(-160, 1, 32)], MW * 1.4, "ochre", amp=0.3)


@art("sci_water_cycle", 400, 300, 1.3)
def sci_water_cycle(a):
    """The water cycle as one picture: the sun warms the sea, water rises as vapour (wavy arrows up), gathers into a
    cloud that drifts to the mountain, falls as rain, and runs back to the sea as a river. Arrows only, no words."""
    sc = (52, 50)
    a.lines([(polar(sc, 30, t), polar(sc, 38, t)) for t in range(0, 360, 40)], MW * 1.2, "ochre", amp=0.2)
    a.fill_smooth(ellipse(sc, 23, 23, n=12), "ochre")
    a.ell_outline(sc, 23, 23)
    # land and mountain on the right
    land = [(170, 300), (198, 262), (236, 236), (276, 168), (312, 104), (330, 96), (352, 132), (378, 170), (400, 186),
            (400, 300)]
    a.fill_smooth(land, "sage", 0.75)
    a.hatch(clip_half(land, (340, 0), (1, 0)), 66, 6, alpha=0.35)
    a.outline(land[1:-1], LW, second=0)
    snow = [(306, 112), (312, 104), (330, 96), (342, 114), (334, 112), (324, 120), (316, 112)]
    a.fill_smooth(snow, "paper", off=(0, 0))
    a.curve(snow[3:], MW, jit=0.3)
    # sea on the left
    sea = [(0, 222)] + [(x, 222 + 3 * math.sin(x / 14)) for x in range(10, 231, 15)] + [(236, 236), (200, 262),
                                                                                        (172, 300), (0, 300)]
    a.fill_poly(sea, "slate", 0.55, off=(0, 0), step=40)
    for k, y in enumerate((236, 258, 280)):
        a.curve([(8 + i * 24 + k * 8, y + 3 * math.sin(i * 1.6 + k)) for i in range(8) if 8 + i * 24 + k * 8 < 200 - k * 18],
                MW, "paper", 0.7)
    a.curve([(0, 222)] + [(x, 222 + 3 * math.sin(x / 14)) for x in range(10, 231, 15)], MW * 1.3)
    # river from the mountain to the sea
    river = [(322, 150), (300, 186), (284, 214), (246, 240), (214, 262), (190, 278)]
    a.stroke(a.open_curve([add(p, a.reg("slate")) for p in river], 0.6), 11, "slate", 0.85)
    a.curve(river, FW * 1.3, "paper", 0.9)
    # evaporation: three wavy arrows up from the sea
    for x in (78, 118, 158):
        pts = [(x, 212), (x + 6, 196), (x - 4, 180), (x + 5, 164), (x, 148)]
        arrow(a, pts, MW * 1.2, 7, "ink", 0.85)
    # clouds: one forming over the sea, one over the mountain, an arrow between them
    puff_cloud(a, (150, 92), 92, 46, "slate", 0.25)
    puff_cloud(a, (318, 54), 104, 50, "slate", 0.4)
    arrow(a, [(204, 62), (236, 46), (262, 46)], MW * 1.4, 9)
    # rain over the mountain
    a.lines([((x, 72 + (x % 3) * 4), (x - 6, 92 + (x % 3) * 4)) for x in range(282, 360, 13)], MW * 1.2, "slate", 0.9)
    # back to the sea: an arrow beside the river
    arrow(a, [(352, 212), (318, 244), (264, 270)], MW * 1.4, 9)


def rice_plant(a, base, s=1.0):
    """A clump of padi: thin leaves and three drooping golden panicles."""
    T = Tf(base, s)
    for tip in ((-30, -70), (-14, -92), (6, -96), (24, -78), (36, -54), (-36, -40)):
        a.curve([T((0, 0)), T((tip[0] * 0.4, tip[1] * 0.5)), T(tip)], MW * 1.3, "sage", jit=0.3)
    for st, tip in (((0, -90), (24, -62)), ((-8, -84), (-30, -60)), ((4, -94), (40, -86))):
        a.curve([T((0, 0)), T(st), T(lerp(st, tip, 0.5)), T(tip)], FW * 1.3, jit=0.3)
        for t in (0.25, 0.45, 0.65, 0.85):
            p = T(lerp(st, tip, t))
            a.fill_smooth(ellipse(p, 3.4 * s, 2.4 * s, 30, n=6), "ochre", off=(0, 0))
    a.line(T((-18, 0)), T((18, 0)), MW, amp=0.3)


def mouse(a, c, s=1.0, flip=False):
    T = Tf(c, s, 0, flip)
    a.curve(T.pts([(-26, 4), (-44, 0), (-56, -10), (-62, -24)]), MW * 1.2, jit=0.3)
    body = T.pts([(-28, 8), (-30, -6), (-18, -18), (2, -20), (18, -14), (28, -4), (34, 4), (24, 10), (0, 12)])
    a.fill_smooth(body, "slate", 0.55)
    a.hatch(clip_half(body, T((0, 2)), T.v((0, 1))), 70, 3.4, alpha=0.4)
    a.outline(body, MW * 1.5, second=0, jit=0.3)
    ear = T.pts(ellipse((12, -18), 7, 8, n=8))
    a.fill_smooth(ear, "blush", 0.9)
    a.outline(ear, MW * 1.2, second=0, jit=0.2)
    a.dots([T((24, -6))], 3.6)
    a.dots([T((34, 3))], 3.4, "clay")
    a.lines([(T((30, 2)), T((40, -2))), (T((30, 4)), T((41, 5)))], FW, alpha=0.7, amp=0.1)


def snake(a, c, s=1.0, flip=False):
    """A friendly green snake in a loose S, head raised, patterned back."""
    T = Tf(c, s, 0, flip)
    path = [(-56, 22), (-36, 30), (-12, 22), (0, 6), (14, -6), (34, -6), (44, 6), (46, 22), (52, 26)]
    body = T.pts(ribbon(path, 13, 9, steps=3))
    a.fill_smooth(body, "sage")
    sp = spline(T.pts(path), False, 3)
    a.dots(sp[2:-2:3], 4.0, "ochre", 0.9)
    a.outline(body, MW * 1.5, second=0, jit=0.3)
    head = T.pts(ellipse((-58, 14), 11, 8, -20, n=10))
    a.fill_smooth(head, "sage")
    a.outline(head, MW * 1.5, second=0, jit=0.2)
    a.dots([T((-61, 10))], 3.4)
    a.curve(T.pts([(-68, 16), (-76, 14), (-80, 10)]), FW * 1.3, "clay", jit=0.1)


def eagle(a, c, s=1.0):
    """An elang bondol in flight (white head, chestnut wings and body), wings spread, seen a little from below."""
    T = Tf(c, s)
    for sx in (-1, 1):
        wing = T.pts([(sx * 8, -4), (sx * 34, -22), (sx * 62, -26), (sx * 76, -18), (sx * 70, -12), (sx * 74, -6),
                      (sx * 62, -2), (sx * 64, 4), (sx * 48, 4), (sx * 30, 8), (sx * 12, 10)])
        a.fill_smooth(wing, "clay")
        a.hatch(clip_half(wing, T((0, 2)), T.v((0, 1))), 70, 3.6, alpha=0.4)
        a.outline(wing, MW * 1.5, second=0, jit=0.3)
        a.lines([(T((sx * 56, -4)), T((sx * 64, 2))), (T((sx * 46, -2)), T((sx * 50, 5)))], FW * 1.2, alpha=0.7)
    body = T.pts([(-10, -6), (0, -10), (10, -6), (12, 14), (6, 26), (0, 30), (-6, 26), (-12, 14)])
    a.fill_smooth(body, "clay")
    a.outline(body, MW * 1.5, second=0, jit=0.2)
    tail = T.pts([(-7, 26), (7, 26), (10, 38), (-10, 38)])
    a.fill_poly(tail, "clay", 0.9)
    a.outline_poly(tail, MW * 1.2, second=0)
    head = T.pts(ellipse((0, -14), 9, 9, n=10))
    a.fill_smooth(head, "paper", off=(0, 0))
    a.outline(head, MW * 1.5, second=0, jit=0.2)
    a.dots([T((3, -16))], 3.2)
    beak = T.pts([(6, -12), (14, -10), (10, -6)])
    a.fill_poly(beak, "ochre")
    a.outline_poly(beak, FW * 1.3, second=0)


@art("sci_food_chain", 400, 300, 1.3)
def sci_food_chain(a):
    """A food chain from the rice field: rice (padi) is eaten by a mouse, the mouse by a snake, the snake by an eagle
    (elang bondol). Drawn arrows point the way the food goes; no words."""
    ground(a, 12, 330, 262, marks=6)
    rice_plant(a, (54, 260), 1.5)
    mouse(a, (148, 238), 1.4)
    snake(a, (284, 232), 1.3, flip=True)
    eagle(a, (318, 84), 1.35)
    arrow(a, [(86, 186), (106, 172), (124, 186)], MW * 1.6, 10)
    arrow(a, [(184, 196), (200, 180), (214, 190)], MW * 1.6, 10)
    arrow(a, [(318, 196), (334, 168), (330, 140)], MW * 1.6, 10)


@art("sci_microscope", 240, 240, 1.0)
def sci_microscope(a):
    """A school microscope, side view: heavy base, curved arm, angled tube with the eyepiece, lenses over the stage, a
    glass slide with a tiny green sample, focus knob."""
    base = [(56, 210), (186, 210), (192, 224), (50, 224)]
    a.block(base, "slate", second=0.3)
    a.hatch(base, 0, 3.6, alpha=0.4)
    arm = ribbon([(150, 208), (170, 168), (166, 120), (140, 82)], 26, 18)
    a.blob(arm, "slate", second=0.3)
    a.hatch(clip_half(arm, (162, 0), (1, 0)), 70, 4.0, alpha=0.4)
    stage = [(54, 150), (156, 146), (158, 158), (56, 162)]
    a.block(stage, "slate", 0.9, second=0)
    slide = [(70, 144), (124, 142), (124, 148), (70, 150)]
    a.block(slide, "paper", w=MW * 1.2, second=0)
    a.dots([(96, 145)], 5, "sage")
    a.blob(capsule((92, 176), (92, 198), 6), "ochre", w=MW * 1.2, second=0)
    T = Tf((110, 82), 1, 22)
    tube = T.pts(rect(-14, -56, 28, 92))
    a.fill_poly(tube, "paper", 0.9, off=(0, 0))
    a.fill_poly(tube, "slate", 0.35)
    a.hatch(clip_half(tube, T((6, 0)), T.v((1, 0))), T.ang(90), 3.6, alpha=0.4)
    a.outline_poly(tube, LW, second=0.3)
    eye = T.pts(rect(-10, -74, 20, 20))
    a.block(eye, "slate", w=MW * 1.3, second=0)
    nose = T.pts([(-18, 36), (18, 36), (12, 50), (-12, 50)])
    a.block(nose, "slate", 0.9, w=MW * 1.3, second=0)
    for dx in (-6, 6):
        a.blob(capsule(T((dx, 48)), T((dx, 62)), 4), "ochre", w=MW, second=0)
    a.ell((164, 128), 13, 13, "ochre", w=LW, second=0)
    a.ell((164, 128), 5, 5, w=MW, second=0)


# --------------------------------------------------------------------------------------------- maths


def paper_sheet(a, c, w, h, rot=-3):
    T = Tf(c, 1, rot)
    sheet = T.pts(rect(-w / 2, -h / 2, w, h))
    a.fill_poly(sheet, "paper", off=(0, 0), step=30)
    a.fill_poly(sheet, "ochre", 0.12, off=(0, 0), step=30)
    a.outline_poly(sheet, MW * 1.2, second=0, over=1.5, gap=2.0)
    return T


@art("math_bar_chart", 240, 240, 1.0)
def math_bar_chart(a):
    """A bar chart drawn by hand on a sheet: two axes, light tick marks on the side, four bars of different heights in
    four colours. No numbers or labels (the question says what the bars count)."""
    T = paper_sheet(a, (120, 122), 204, 196, -2)
    x0, y0 = -76, 74
    for k in range(1, 6):
        y = y0 - k * 26
        a.line(T((x0 - 6, y)), T((x0, y)), MW, amp=0.1)
        a.line(T((x0 + 4, y)), T((86, y)), FW, "slate", 0.35, amp=0.3)
    for (bx, h, col) in ((-60, 78, "sage"), (-20, 130, "ochre"), (20, 52, "clay"), (60, 104, "slate")):
        bar = T.pts(rect(bx - 13, y0 - h, 26, h))
        a.fill_poly(bar, col, 0.9)
        a.hatch(clip_half(bar, T((bx + 3, 0)), T.v((1, 0))), T.ang(70), 4.0, alpha=0.4)
        a.outline_poly(bar, MW * 1.5, second=0)
    a.line(T((x0, y0)), T((x0, -84)), LW, amp=0.4)
    a.line(T((x0, y0)), T((88, y0)), LW, amp=0.4)


@art("math_pie_half", 240, 240, 1.0)
def math_pie_half(a):
    """A pie chart drawn on paper: one half coloured, the other half left plain, the dividing line across."""
    T = paper_sheet(a, (120, 120), 200, 200, 3)
    c = T((0, 0))
    r = 74
    half = [polar(c, r, t) for t in range(-90, 91, 15)]
    a.fill_smooth(half + [c], "clay", 0.9)
    a.hatch(half + [c], 62, 4.6, alpha=0.4)
    a.ell_outline(c, r, r, w=LW, wob=0.02)
    a.line(polar(c, r, -90), polar(c, r, 90), MW * 1.4, amp=0.3)


def frog(a, c, s=1.0, flip=False):
    T = Tf(c, s, 0, flip)
    body = T.pts([(-20, 8), (-22, -4), (-14, -14), (0, -18), (14, -14), (22, -4), (20, 8), (0, 12)])
    a.fill_smooth(body, "sage")
    a.outline(body, MW * 1.5, second=0, jit=0.3)
    for ex in (-10, 10):
        e = T.pts(ellipse((ex, -18), 6, 6, n=8))
        a.fill_smooth(e, "sage")
        a.outline(e, MW * 1.2, second=0, jit=0.2)
        a.dots([T((ex + 1, -18))], 3.6)
    a.curve(T.pts([(-8, -4), (0, 0), (8, -4)]), FW * 1.4, jit=0.1)
    for sx in (-1, 1):
        a.curve(T.pts([(sx * 18, 6), (sx * 28, 4), (sx * 26, 14), (sx * 34, 14)]), MW * 1.3, jit=0.2)


@art("math_number_line", 240, 240, 1.0)
def math_number_line(a):
    """A number line: arrows at both ends, evenly spaced tick marks (the middle one a little taller), and a small frog
    that has hopped along it, its hops drawn as dashed arcs. No numbers."""
    y = 150
    a.line((16, y), (224, y + 1), LW, amp=0.4)
    for x in (16, 224):
        d = -1 if x < 100 else 1
        a.zig([(x - d * 10, y - 7), (x, y + (0 if d < 0 else 1)), (x - d * 10, y + 8)], LW, jit=0.2)
    ticks = [36 + 21 * i for i in range(9)]
    a.lines([((x, y - (13 if i == 4 else 8)), (x, y + (13 if i == 4 else 8))) for i, x in enumerate(ticks)], MW * 1.3,
            amp=0.1)
    for i0, i1 in ((2, 4), (4, 6)):
        xa, xb = ticks[i0], ticks[i1]
        dashed(a, [(xa, y - 12), ((xa + xb) / 2, y - 48), (xb, y - 12)], MW, "clay", 0.9)
    frog(a, (ticks[6], y - 24), 1.0)


@art("math_ruler", 240, 240, 1.0)
def math_ruler(a):
    """A wooden ruler with its tick marks (longer every fifth) and a pencil drawing a straight line along its edge."""
    T = Tf((114, 128), 1, -28)
    body = T.pts(rect(-104, -20, 208, 40))
    a.fill_poly(body, "ochre")
    a.hatch(T.pts(rect(-104, 6, 208, 14)), T.ang(0), 3.6, alpha=0.35)
    ticks = [(T((x, -20)), T((x, -20 + (14 if (x + 95) % 50 == 0 else (10 if (x + 95) % 25 == 0 else 6))))) for x in
             range(-95, 96, 5)]
    a.lines(ticks, FW * 1.2, amp=0.1)
    a.outline_poly(body, LW, second=0.3)
    a.ell(T((88, 6)), 4, 4, w=MW, second=0)
    a.line(T((-100, -26)), T((40, -26)), MW * 1.2, "slate", amp=0.3)
    P = Tf(T((40, -27)), 1, -28 - 52)
    pb = P.pts([(14, -6), (90, -6), (90, 6), (14, 6)])
    a.fill_poly(pb, "clay", 0.95)
    a.fill_poly(P.pts([(90, -6), (100, -6), (100, 6), (90, 6)]), "slate", 0.9)
    a.fill_poly(P.pts([(0, 0), (14, -6), (14, 6)]), "paper", off=(0, 0))
    a.fill_poly(P.pts([(0, 0), (5, -2.2), (5, 2.2)]), "ink", 0.95, off=(0, 0))
    a.outline_poly(P.pts([(0, 0), (14, -6), (100, -6), (102, 0), (100, 6), (14, 6)]), LW, second=0, over=1, gap=1)
    a.lines([(P((14, -6)), P((14, 6))), (P((90, -6)), P((90, 6)))], MW, amp=0.1)


def angle_pic(a, v, p1, p2, marker):
    """Two rays from vertex v (to p1, p2) as broad colour plates under ink lines, a light tint inside the angle, open
    arrowheads, and the angle marker (a small square for a right angle, an arc otherwise)."""
    wedge = [v, lerp(v, p1, 0.6)] + [lerp(lerp(v, p1, 0.6), lerp(v, p2, 0.6), t / 6) for t in range(1, 6)] + [
        lerp(v, p2, 0.6)]
    a.fill_smooth(wedge, "sage", 0.25, off=(0, 0))
    for p, col in ((p1, "ochre"), (p2, "ochre")):
        off = a.reg(col)
        a.stroke(a.open_curve([add(v, off), add(p, off)], 0.6), 12, col, 0.75)
        a.line(v, p, LW * 1.1, amp=0.5)
        d = unit(sub(p, v))
        a.zig([add(p, mul(rotp(d, 150), 12)), p, add(p, mul(rotp(d, -150), 12))], LW, jit=0.2)
    if marker == "square":
        d1, d2 = unit(sub(p1, v)), unit(sub(p2, v))
        q = [add(v, mul(d1, 24)), add(add(v, mul(d1, 24)), mul(d2, 24)), add(v, mul(d2, 24))]
        a.fill_poly([v] + q, "clay", 0.6)
        a.zig(q, MW * 1.4, jit=0.2)
    else:
        a0, a1 = angle_of(v, p1), angle_of(v, p2)
        arc_ = [polar(v, 34, a0 + (a1 - a0) * t / 6) for t in range(7)]
        a.fill_smooth([v] + arc_, "clay", 0.6)
        a.curve(arc_, MW * 1.4, jit=0.2)
    a.dots([v], 8)


@art("math_angle_right", 240, 240, 1.0)
def math_angle_right(a):
    """A right angle: two rays from one corner, the small square in the corner."""
    angle_pic(a, (64, 186), (214, 182), (60, 34), "square")


@art("math_angle_acute", 240, 240, 1.0)
def math_angle_acute(a):
    """An acute angle (about 40 degrees): two rays from one point, a small arc between them."""
    v = (40, 184)
    angle_pic(a, v, (214, 186), polar(v, 176, -40), "arc")


def bank_note(a, c, rot, col):
    T = Tf(c, 1, rot)
    note = T.pts(rect(-74, -38, 148, 76))
    a.fill_poly(note, col, 0.85)
    a.fill_poly(T.pts(rect(-64, -29, 128, 58)), "paper", 0.45, off=(0, 0))
    a.outline_poly(T.pts(rect(-64, -29, 128, 58)), FW * 1.3, alpha=0.7, second=0)
    oc = T((-30, 0))
    a.fill_smooth(ellipse(oc, 20, 22, rot, n=10), "paper", 0.9, off=(0, 0))
    a.ell_outline(oc, 20, 22, rot, w=MW, second=0)
    for k in range(4):
        lp = leaf_pts(oc, polar(oc, 15, rot - 90 + 90 * k), 5, asym=1.0, n=3)
        a.fill_smooth(lp, col, 0.9)
    for k in range(3):
        a.curve(T.pts([(4 + i * 12, -14 + k * 14 + 3 * math.sin(i * 1.4 + k)) for i in range(5)]), FW * 1.3, alpha=0.6)
    a.outline_poly(note, LW, second=0.3)


@art("math_money_notes", 240, 240, 1.0)
def math_money_notes(a):
    """Money for counting: two generic paper notes, fanned, and two coins. No denominations, no national emblems, no
    real banknote design (amounts stay in the question text)."""
    bank_note(a, (112, 92), -10, "sage")
    bank_note(a, (128, 130), 6, "clay")
    for c, col in (((70, 192), "ochre"), ((112, 200), "slate")):
        a.fill_smooth(ellipse(c, 24, 24, n=12), col)
        a.ell_outline(c, 24, 24, w=LW)
        a.ell_outline(c, 16, 16, w=FW * 1.3, second=0)
        a.curve([polar(c, 18, 200), polar(c, 18, 230), polar(c, 18, 260)], 2.6, "paper", 0.8, jit=0.1)


@art("math_thermometer", 240, 240, 1.0)
def math_thermometer(a):
    """A glass thermometer: a round bulb, a red column about two thirds up, tick marks beside it (longer every fifth),
    no numbers."""
    T = Tf((118, 120), 1, 8)
    tube = T.pts([(-13, 70), (-13, -88), (-8, -100), (8, -100), (13, -88), (13, 70)])
    a.fill_smooth(tube, "paper", 0.9, off=(0, 0))
    a.fill_smooth(tube, "slate", 0.15)
    col = T.pts(rect(-5, -30, 10, 104))
    a.fill_poly(col, "clay")
    bulb = T.pts(ellipse((0, 88), 24, 24, n=12))
    a.fill_smooth(bulb, "clay")
    a.hatch(clip_half(bulb, T((8, 0)), T.v((1, 0))), T.ang(60), 4.0, alpha=0.4)
    a.outline(bulb, LW, second=0.3)
    a.outline(tube, LW, second=0.3)
    a.curve(T.pts([(-7, 60), (-7, -40), (-5, -80)]), 2.4, "paper", 0.9, jit=0.2)
    ticks = [(T((13, y)), T((13 + (14 if k % 5 == 0 else 8), y))) for k, y in enumerate(range(62, -90, -8))]
    a.lines(ticks, MW, amp=0.1)


# --------------------------------------------------------------------------------------------- culture


@art("soc_rumah_gadang", 240, 240, 1.0)
def soc_rumah_gadang(a):
    """Rumah gadang (Minangkabau, Sumatera Barat): a long house on posts under a dark ijuk roof whose ridge sweeps up
    into sharp gonjong horns, a smaller gonjong roof over the front stairs, carved walls."""
    ground(a, 12, 228, 214, marks=5)
    for x in (34, 70, 106, 142, 178, 206):
        a.blob(capsule((x, 172), (x, 212), 4.5), "ochre", w=MW * 1.2, second=0)
    floor = [(22, 166), (218, 166), (214, 176), (26, 176)]
    a.block(floor, "clay", w=MW * 1.4, second=0)
    wall = [(30, 124), (210, 124), (214, 166), (26, 166)]
    a.fill_poly(wall, "clay", 0.9)
    a.zig([(32 + i * 9, 132 if i % 2 == 0 else 140) for i in range(21)], MW, "ochre", 0.9)
    a.zig([(32 + i * 9, 154 if i % 2 == 0 else 146) for i in range(21)], FW * 1.4, "paper", 0.7)
    for x in (60, 100, 140, 180):
        a.block(rect(x - 8, 128, 16, 26), "slate", 0.8, w=MW, second=0)
    a.outline_poly(wall, LW, second=0.3)
    roof = [(6, 32), (28, 74), (58, 96), (92, 104), (148, 104), (182, 96), (212, 74), (234, 30), (226, 76), (212, 108),
            (204, 126), (36, 126), (28, 108), (14, 76)]
    a.fill_smooth(roof, "slate")
    a.fill_smooth(roof, "ink", 0.3)
    a.hatch(roof, 80, 5.0, color="paper", alpha=0.25)
    a.outline(roof, LW, second=0.4)
    front = [(84, 64), (98, 92), (120, 100), (142, 92), (156, 64), (150, 100), (138, 118), (102, 118), (90, 100)]
    a.fill_smooth(front, "slate", 0.9)
    a.hatch(front, 80, 4.0, color="paper", alpha=0.3)
    a.outline(front, LW, second=0.3)
    a.lines([((6, 32), (4, 24)), ((234, 30), (237, 22)), ((84, 64), (82, 56)), ((156, 64), (158, 56))], MW * 1.2,
            "ochre", amp=0.2)
    for k in range(4):
        y = 178 + k * 9
        a.line((108 - k * 2, y), (132 + k * 2, y), MW * 1.2, "ochre", amp=0.2)
    a.lines([((106, 176), (100, 214)), ((134, 176), (140, 214))], MW * 1.3, amp=0.3)


@art("soc_joglo", 240, 240, 1.0)
def soc_joglo(a):
    """Joglo (Jawa): an open pendopo on a low stone base, four wooden pillars, a wide gently sloping lower roof and a
    tall steep central roof (brunjung) above it, clay tiles."""
    base = [(14, 196), (226, 196), (232, 216), (8, 216)]
    a.block(base, "slate", 0.6, second=0.3)
    a.hatch(base, 0, 5, alpha=0.3)
    a.lines([((96, 216), (90, 228)), ((144, 216), (150, 228)), ((88, 228), (152, 228))], MW, amp=0.3)
    for x in (44, 92, 148, 196):
        post = rect(x - 5, 124, 10, 72)
        a.block(post, "ochre", w=MW * 1.3, second=0)
        a.block(rect(x - 9, 190, 18, 7), "slate", 0.8, w=MW, second=0)
    a.line((44, 132), (196, 132), MW * 1.3)
    lower = [(4, 128), (66, 86), (174, 86), (236, 128)]
    a.fill_poly(lower, "clay")
    a.hatch(lower, 0, 6, alpha=0.4)
    a.outline_poly(lower, LW, second=0.3)
    a.line((2, 130), (238, 130), MW * 1.4, amp=0.3)
    top = [(58, 92), (104, 26), (136, 26), (182, 92)]
    a.fill_poly(top, "clay", 0.95)
    a.hatch(top, 0, 5, alpha=0.45)
    a.hatch(clip_half(top, (124, 0), (1, 0)), 70, 4.4, alpha=0.3)
    a.outline_poly(top, LW, second=0.4)
    a.line((100, 24), (140, 24), LW, amp=0.2)
    a.dots([(100, 22), (140, 22)], 6, "ochre")


@art("soc_tongkonan", 240, 240, 1.0)
def soc_tongkonan(a):
    """Tongkonan (Toraja, Sulawesi Selatan), seen from the side: a carved house on posts under a long saddle roof that
    sweeps up at both ends like a boat; a post with stacked horns at the front."""
    ground(a, 10, 232, 220, marks=5)
    for x in (68, 98, 128, 158):
        a.blob(capsule((x, 168), (x, 218), 5), "ochre", w=MW * 1.2, second=0)
    a.line((60, 186), (168, 186), MW * 1.3, amp=0.3)
    body = [(58, 116), (172, 116), (168, 168), (62, 168)]
    a.fill_poly(body, "clay", 0.9)
    for row, y in enumerate((126, 146)):
        for x in range(70, 166, 16):
            sq = [(x, y), (x + 7, y - 6), (x + 14, y), (x + 7, y + 6)]
            a.fill_poly(sq, "ochre" if (x // 16 + row) % 2 else "paper", 0.9, off=(0, 0))
    a.lines([((58, 136), (172, 136)), ((60, 156), (170, 156))], FW * 1.4, alpha=0.7)
    a.outline_poly(body, LW, second=0.3)
    roof = [(8, 30), (40, 62), (80, 80), (150, 80), (190, 62), (232, 24), (222, 54), (196, 92), (176, 116), (54, 116),
            (34, 92), (16, 60)]
    a.fill_smooth(roof, "slate")
    a.fill_smooth(roof, "ink", 0.25)
    for k in range(3):
        a.curve([(16 + k * 6, 44 + k * 16), (60, 84 + k * 10), (115, 92 + k * 8), (170, 84 + k * 10),
                 (222 - k * 6, 40 + k * 16)], MW, "paper", 0.45)
    a.outline(roof, LW, second=0.4)
    a.blob(capsule((44, 116), (44, 218), 5), "ochre", w=MW * 1.2, second=0)
    for k in range(5):
        y = 128 + k * 13
        horn = [(44, y + 6), (30, y), (24, y - 7), (36, y - 2), (44, y), (52, y - 2), (64, y - 7), (58, y), (44, y + 6)]
        a.fill_smooth(horn, "paper", off=(0, 0))
        a.curve(horn, MW, jit=0.2)


@art("soc_gamelan", 240, 240, 1.0)
def soc_gamelan(a):
    """Gamelan: a saron (bronze keys on a carved wooden box) with its wooden mallet, and a hanging gong behind it on a
    frame."""
    for x in (40, 200):
        a.blob(capsule((x, 30), (x, 150), 4.5), "clay", w=MW * 1.2, second=0)
    a.blob(capsule((32, 30), (208, 30), 5), "clay", w=MW * 1.3, second=0)
    a.curve([(120, 34), (118, 46), (120, 54)], MW)
    gc = (120, 92)
    a.fill_smooth(ellipse(gc, 40, 40, n=14), "ochre")
    a.hatch(clip_half(ellipse(gc, 38, 38, n=20), add(gc, (14, 0)), (1, 0)), 60, 4.0, alpha=0.4)
    a.ell_outline(gc, 40, 40)
    a.ell_outline(gc, 26, 26, w=MW, second=0)
    a.ell(gc, 11, 11, "ochre", w=MW * 1.4, second=0)
    a.curve([polar(gc, 30, 200), polar(gc, 30, 230), polar(gc, 30, 255)], 3.4, "paper", 0.75, jit=0.2)
    box = [(26, 168), (214, 162), (206, 206), (34, 210)]
    a.fill_poly(box, "clay")
    a.zig([(40 + i * 12, 190 if i % 2 == 0 else 198) for i in range(15)], MW, "ochre", 0.9)
    a.outline_poly(box, LW, second=0.3)
    for i in range(7):
        x = 40 + i * 24
        key = [(x, 156 - i * 0.6), (x + 20, 156 - i * 0.6), (x + 20, 170 - i * 0.6), (x, 170 - i * 0.6)]
        a.fill_poly(key, "ochre")
        a.outline_poly(key, MW * 1.3, second=0, over=1, gap=1)
        a.dots([(x + 4, 163 - i * 0.6), (x + 16, 163 - i * 0.6)], 2.6)
    a.blob(capsule((150, 222), (214, 214), 3.2), "ochre", w=MW * 1.2, second=0)
    a.ell((218, 213), 7, 6, "clay", w=MW * 1.2, second=0)


@art("soc_sasando", 240, 240, 1.0)
def soc_sasando(a):
    """Sasando (Pulau Rote, NTT): a bamboo tube strung with many strings, held inside a fan of folded lontar palm leaf
    that opens around it."""
    fan = [(120, 214), (58, 170), (30, 112), (34, 64), (60, 38), (120, 28), (180, 38), (206, 64), (210, 112), (182, 170)]
    a.fill_smooth(fan, "ochre", 0.75)
    a.lines([((120, 206), lerp((120, 206), q, 0.93)) for q in subdivide(fan[1:], 14, closed=False)], MW, "clay", 0.55,
            amp=0.4)
    a.outline(fan, LW, second=0.4)
    inner = [(120, 196), (82, 164), (66, 118), (70, 84), (120, 72), (170, 84), (174, 118), (158, 164)]
    a.fill_smooth(inner, "clay", 0.35)
    a.curve(inner[1:-1], MW, alpha=0.8, jit=0.3)
    tube = rect(106, 50, 28, 172)
    a.fill_poly(tube, "ochre")
    a.fill_poly(tube, "sage", 0.3)
    a.lines([((108, 112), (132, 112)), ((108, 168), (132, 168))], MW, amp=0.2)
    a.lines([((109 + i * 3.6, 56), (109 + i * 3.6, 216)) for i in range(7)], FW, alpha=0.8, amp=0.2)
    a.outline_poly(tube, LW, second=0.3)
    a.dots([(110 + i * 4, 52) for i in range(6)], 3.2, "clay")
    a.ell((120, 224), 16, 5, "clay", w=MW * 1.2, second=0)


@art("soc_wayang", 240, 240, 1.0)
def soc_wayang(a):
    """A wayang kulit puppet in profile (a generic noble figure, not one named character): a crowned head with the long
    fine nose, broad shoulders and narrow waist, very long thin arms on their own rods, a patterned kain with the
    pointed front flap, feet wide apart, perforations in the leather; the central rod (gapit) runs down into a banana
    trunk."""
    trunk = [(30, 210), (214, 204), (216, 228), (28, 232)]
    a.fill_poly(trunk, "sage", 0.8)
    a.hatch(trunk, 0, 5, alpha=0.35)
    a.outline_poly(trunk, LW, second=0.3)
    a.blob(capsule((126, 14), (122, 218), 3.2), "clay", w=MW * 1.2, second=0)
    # far arm (behind the body), on its rod
    far = [(106, 84), (84, 118), (74, 154)]
    a.blob(ribbon(far, 8, 5), "slate", 0.95, w=MW * 1.2, second=0)
    a.line((74, 154), (58, 216), MW * 1.2, "clay", amp=0.3)
    # legs and feet, wide stance
    for leg, foot in ((((112, 160), (100, 182), (96, 196)), [(80, 196), (104, 194), (106, 200), (80, 201)]),
                      (((140, 160), (150, 182), (152, 196)), [(146, 194), (172, 196), (172, 201), (146, 200)])):
        a.blob(ribbon(list(leg), 9, 7), "slate", 0.95, w=MW * 1.2, second=0)
        a.block(foot, "slate", 0.95, w=MW * 1.2, second=0)
    # kain with the pointed front flap (dodot)
    kain = [(110, 118), (140, 118), (150, 140), (148, 166), (104, 166), (102, 140)]
    a.fill_poly(kain, "clay")
    flap = [(136, 122), (150, 132), (176, 182), (160, 180), (140, 150)]
    a.fill_poly(flap, "ochre")
    a.zig([(108, 148), (114, 142), (120, 148), (126, 142), (132, 148), (138, 142), (144, 148)], MW, "ochre", 0.9)
    a.dots([(112, 130), (122, 128), (132, 130), (116, 158), (128, 158), (140, 158), (156, 156), (162, 168)], 3.0,
           "paper", 0.9)
    a.outline_poly(kain, LW, second=0.3)
    a.outline_poly(flap, MW * 1.4, second=0)
    # torso: broad shoulders to a narrow waist, a gold necklace
    torso = [(100, 82), (154, 80), (142, 100), (138, 120), (112, 120), (108, 100)]
    a.fill_smooth(torso, "slate", 0.95)
    a.curve([(108, 86), (126, 98), (146, 84)], 4.2, "ochre", 0.95)
    a.dots([(118, 108), (126, 112), (134, 108)], 3.0, "paper", 0.9)
    a.outline(torso, LW, second=0.3)
    a.curve([(108, 120), (126, 116), (142, 120)], 4.0, "ochre", 0.95)
    # head in profile: crown, back ornament curl, long fine nose
    a.blob(ribbon([(128, 70), (136, 64), (142, 58)], 10, 9), "slate", 0.95, w=MW * 1.2, second=0)
    face = [(128, 40), (148, 36), (154, 42), (172, 56), (158, 54), (154, 60), (146, 66), (134, 64), (126, 54)]
    a.fill_smooth(face, "slate", 0.95)
    a.outline(face, LW, second=0)
    a.curve([(144, 46), (150, 47), (154, 46)], MW * 1.2, "paper", 0.9, jit=0.1)
    crown = [(124, 42), (126, 26), (134, 14), (146, 12), (154, 22), (152, 38)]
    a.fill_smooth(crown, "ochre")
    a.dots([(134, 26), (142, 22), (146, 32), (136, 36)], 3.0, "clay", 0.9)
    a.outline(crown, MW * 1.5, second=0)
    curl = [(124, 34), (108, 28), (96, 34), (94, 46), (102, 52), (110, 46), (104, 40)]
    a.curve(curl, 5.0, "ochre", 0.95)
    a.curve(curl, FW * 1.3, jit=0.2)
    # near arm in front, on its rod
    near = [(150, 84), (174, 118), (172, 158)]
    a.blob(ribbon(near, 8, 5), "slate", 0.95, w=MW * 1.2, second=0)
    a.dots([(166, 106), (172, 146)], 5.0, "ochre")
    a.line((172, 158), (190, 216), MW * 1.2, "clay", amp=0.3)
    a.curve([(168, 156), (176, 164), (182, 162)], MW, jit=0.2)


def kawung(a, c, r, col):
    for k in range(4):
        e = ellipse(polar(c, r * 0.58, 45 + 90 * k), r * 0.5, r * 0.3, 45 + 90 * k, n=8)
        a.fill_smooth(e, col, 0.85)
    a.dots([c], r * 0.22, "ink", 0.8)


@art("soc_batik", 240, 240, 1.0)
def soc_batik(a):
    """Batik: a length of cloth with a kawung pattern (four ovals around a point, repeated), partly rolled, and a
    canting (wax pen) drawing a new line with a drop of wax."""
    cloth = [(18, 40), (200, 28), (214, 176), (30, 196)]
    a.fill_poly(cloth, "ochre", 0.45)
    a.fill_poly(cloth, "paper", 0.3, off=(0, 0))
    a.layer = 1
    for gy in range(4):
        for gx in range(5):
            c = (40 + gx * 38 + gy * 2.5, 60 + gy * 38 - gx * 2.4)
            if inside(c, cloth):
                kawung(a, c, 15, "clay")
    a.layer = 2
    a.outline_poly(cloth, LW, second=0.3)
    roll = ribbon([(196, 26), (204, 100), (214, 178)], 22, 22)
    a.fill_smooth(roll, "ochre", 0.85)
    a.hatch(roll, 80, 4.0, alpha=0.4)
    a.outline(roll, LW, second=0.3)
    a.curve([(52, 214), (90, 206), (126, 212)], 3.4, "slate", 0.9)
    T = Tf((150, 212), 1, -30)
    a.blob(T.pts(capsule((10, 0), (86, 0), 4.6)), "ochre", w=MW * 1.3, second=0)
    cup = T.pts([(-8, -10), (12, -10), (14, 4), (2, 10), (-10, 4)])
    a.fill_poly(cup, "clay", 0.9)
    a.outline_poly(cup, MW * 1.4, second=0)
    a.curve([T((-6, 8)), T((-14, 16)), T((-20, 18))], MW * 1.3)
    drop(a, (130, 226), 5, "slate")


# world map: (longitude, latitude) outlines, stylised (draft, not a survey map)
WORLD = {
    "north_america": [
        [(-168, 66), (-162, 70), (-150, 71), (-140, 70), (-128, 70), (-115, 68), (-100, 69), (-95, 72), (-84, 69),
         (-82, 64), (-90, 58), (-82, 54), (-78, 58), (-77, 62), (-70, 61), (-64, 60), (-60, 55), (-56, 52), (-60, 47),
         (-66, 44), (-70, 42), (-74, 40), (-76, 35), (-81, 31), (-80, 26), (-81, 25), (-83, 29), (-89, 30), (-95, 29),
         (-97, 26), (-97, 21), (-94, 18), (-90, 21), (-87, 21), (-88, 16), (-84, 15), (-83, 10), (-79, 9), (-77, 8),
         (-80, 7.5), (-84, 9), (-87, 13), (-92, 15), (-96, 16), (-105, 20), (-106, 23), (-110, 25), (-112, 29),
         (-117, 32), (-121, 35), (-124, 40), (-124, 46), (-127, 50), (-133, 55), (-140, 59), (-148, 60), (-153, 58),
         (-158, 56), (-164, 54), (-162, 58), (-165, 61), (-166, 64)],
        [(-73, 78), (-60, 82), (-35, 83), (-20, 81), (-19, 75), (-22, 70), (-32, 67), (-42, 60), (-48, 61), (-53, 66),
         (-55, 71), (-62, 76)],
        [(-80, 73), (-68, 70), (-62, 66), (-66, 62.5), (-72, 64), (-78, 65), (-74, 67), (-84, 70)],
        [(-122, 74), (-100, 73), (-92, 75), (-84, 77), (-72, 80), (-64, 82), (-90, 82), (-118, 77)],
        [(-85, 22), (-80, 23.2), (-74.2, 20.2), (-77.5, 19.9), (-80, 21.8)],
    ],
    "south_america": [
        [(-77, 8), (-72, 12), (-64, 10.5), (-60, 8), (-52, 5), (-50, 1), (-44, -2), (-35, -6), (-37, -12), (-39, -18),
         (-41, -22), (-48, -26), (-52, -32), (-57, -36), (-63, -40), (-65, -45), (-68, -51), (-69, -55), (-73, -53),
         (-75, -47), (-73, -40), (-71, -30), (-70, -20), (-76, -14), (-80, -7), (-81, -3), (-80, 1), (-77, 4)],
    ],
    "europe": [
        [(-9.5, 43.5), (-9, 37), (-6, 36), (-2, 37), (0, 39), (3, 42.5), (6, 43), (9, 44), (12, 42), (16, 38), (17.5, 40.5),
         (14, 43), (13, 45.5), (16, 43.5), (19.5, 41.5), (21, 38), (23, 36.8), (24, 38.5), (23, 40.5), (26.2, 40.6),
         (29, 41.1), (35, 43.3), (40, 43.4), (48, 42.2), (50.5, 44.5), (51.5, 47), (55, 51), (59, 52), (59.5, 56),
         (59.5, 61), (61, 65), (66, 69.5), (55, 68.5), (48, 67.5), (42, 66.5), (38, 64.5), (34, 66), (36, 69), (30, 70),
         (24, 71), (18, 70), (13, 67), (9, 63), (5, 60), (6, 58), (10, 59), (12, 56), (16, 56), (19, 59), (17, 63),
         (22, 65.5), (25, 65), (22, 62), (21, 60), (28, 60), (24, 57), (21, 55.5), (14, 54), (11, 54), (8.5, 57),
         (8, 54), (5, 53), (3, 51.5), (1.5, 50.5), (-1.5, 49.7), (-4.5, 48.5), (-1.5, 46.5), (-1.5, 44)],
        [(-5.5, 50), (1.5, 51), (1.7, 52.8), (-0.2, 54.5), (-2, 56), (-1.8, 57.6), (-4, 58.6), (-5.5, 58), (-5.6, 56),
         (-3, 54.8), (-4.5, 53.3), (-4.5, 52), (-3, 51.4)],
        [(-10, 52), (-6, 52), (-6, 54.5), (-8, 55.2), (-10, 54)],
        [(-23, 64), (-14, 64.5), (-14, 66.3), (-22, 66.4)],
    ],
    "africa": [
        [(-17, 21), (-16.5, 28), (-10, 30), (-9.5, 32), (-6, 35.8), (-2, 35.2), (3, 36.8), (10, 37), (11, 33.5),
         (15, 32), (20, 30.5), (20, 32), (25, 31.7), (29, 30.9), (32.3, 31.2), (32.5, 29.9), (33.5, 27.5), (35.5, 24),
         (37.5, 18.5), (39.5, 15), (43, 12.5), (44, 11), (51, 12), (51, 10.5), (49, 6), (46, 2), (42, -1), (40, -3),
         (39.5, -7), (40.5, -11), (40.5, -15), (37, -17.5), (35.5, -22), (32.8, -26), (32, -29), (28, -33), (25, -34),
         (20, -35), (18, -33), (17, -29), (15, -27), (14.5, -22), (12, -17), (13.5, -11), (12, -5), (9.5, -1),
         (9.5, 3.5), (8, 4.5), (5, 5.8), (2, 6.2), (-2, 4.8), (-5, 5.2), (-8, 4.5), (-11, 6.5), (-13, 8), (-15, 11),
         (-17, 14.5)],
        [(49, -12), (50.5, -15.5), (47.5, -24.5), (45, -25.5), (43.5, -22), (44, -17), (47, -14.5)],
    ],
    "asia": [
        [(66, 69.5), (61, 65), (59.5, 61), (59.5, 56), (59, 52), (55, 51), (51.5, 47), (50.5, 44.5), (48, 42.2),
         (40, 43.4), (35, 43.3), (29, 41.1), (26.2, 40.6), (26.3, 39.5), (27, 37.5), (28.5, 36.7), (30.5, 36.3),
         (32.5, 36.1), (34.5, 36.8), (36, 36.6), (35.8, 34.6), (35, 33), (34.3, 31.3), (32.6, 31.1), (32.6, 29.9),
         (34, 27.8), (34.9, 29.5), (37, 26.5), (39, 22), (41, 18), (43, 13.3), (45, 12.8), (49, 14), (52, 15.5),
         (55, 17.5), (57.5, 18.5), (59.5, 22.5), (56.3, 26.4), (54, 24.2), (51, 24.5), (50, 26.5), (48.5, 28.5),
         (48, 30), (51, 28), (54, 26.7), (57, 25.7), (61, 25.2), (66.5, 25.4), (68, 23.7), (70, 21), (72.8, 19),
         (73.5, 15.5), (75, 12), (76.5, 8.3), (78, 8.2), (80, 10.5), (80.3, 13.5), (80.2, 15.8), (82, 17), (86, 20),
         (87, 21.6), (90, 22), (91.8, 22.4), (94, 19), (94.5, 16), (97.5, 16.5), (98.5, 12), (98.3, 8), (100.5, 6.5),
         (101, 3), (103.5, 1.4), (104, 2), (103.5, 5), (102, 6.3), (101, 12.5), (100, 13.5), (102.5, 12.2), (105, 8.7),
         (106.5, 10.5), (109, 11.7), (109, 15), (106.5, 17.5), (106.7, 20.5), (109.5, 21.5), (111, 21.5), (114, 22.3),
         (117, 23.5), (119.5, 25.5), (121.5, 28.5), (122, 30.8), (121, 32.5), (120.5, 34), (119.2, 35), (122.5, 37.4),
         (118.5, 38), (117.5, 39), (121, 40.7), (124.5, 39.8), (125.3, 37.7), (126.5, 34.5), (129.4, 35.3),
         (129.5, 37), (128.5, 38.6), (127.5, 39.8), (129.8, 41), (131, 42.6), (133, 42.8), (135.5, 43.8), (138, 46),
         (140.5, 48.5), (140.6, 52), (141.5, 53.3), (137, 54), (135, 54.7), (137.5, 56.5), (140.5, 58.5), (143.5, 59.4),
         (148, 59.3), (152, 59), (155, 59.4), (156.8, 61.5), (160, 61.5), (163, 60), (159.5, 57), (156, 57.5),
         (156.5, 51), (158.5, 52.5), (160, 54.5), (162.5, 56), (163.5, 58), (166, 60), (170, 60), (172.5, 61),
         (177, 62.5), (179.8, 65), (179.8, 68.8), (176, 69.8), (170, 70), (161, 69.5), (152, 70.8), (146, 72.3),
         (140, 72.5), (130, 71), (128, 72.5), (122, 73), (114, 73.6), (113, 76), (104, 77.7), (98, 76), (90, 75.5),
         (87, 74), (80, 73.5), (75, 72.5), (72.5, 72.8), (69, 73), (68, 69)],
        [(95.3, 5.6), (97.5, 5.2), (100.3, 2.3), (103.7, -1), (106, -3), (105.8, -5.8), (104.5, -5.9), (102.3, -4),
         (100.4, -1), (98.7, 1.7), (97.3, 3.5)],
        [(105.2, -6.8), (108, -6.3), (110.5, -6.5), (112.5, -6.9), (114.5, -7.7), (114.4, -8.6), (111, -8.2),
         (108, -7.8), (106, -7.4)],
        [(109, 1.5), (109.6, -1), (110.2, -3), (114.5, -4.1), (116.5, -3), (116, 0.5), (117.8, 1.8), (119, 5),
         (117.5, 7), (116, 6.5), (113.5, 4.3), (111, 1.8)],
        [(119, -5.5), (119.5, -3), (118.8, -2.6), (119.8, 0.5), (120.6, 1.2), (124.9, 1.6), (120.6, 0.2), (121.5, -0.9),
         (123.3, -0.9), (121.5, -1.8), (122.5, -4.5), (121.3, -4.6), (120.4, -2.9), (120.4, -5.6)],
        [(120, 18.5), (122.2, 18.5), (122, 16), (124, 13), (121.6, 13.8), (120.6, 14.5), (120, 16)],
        [(122, 7), (126, 7), (126.5, 8.5), (125.5, 9.6), (123.5, 8.6)],
        [(130, 31.5), (131, 34), (133, 34.5), (135, 33.6), (137, 34.6), (140, 35), (141, 38), (141.5, 41.4), (140, 40.5),
         (139.8, 38.5), (137, 37), (133, 35.6), (130.8, 34.3), (129.8, 33)],
        [(140, 41.8), (141.5, 42.6), (143.5, 42), (145.5, 43.3), (142, 45.4), (141.3, 43.3)],
        [(120.2, 22.8), (121.9, 25.1), (121, 25), (120, 23.5)],
        [(79.8, 6.3), (80, 9.7), (81.8, 7.5), (81.2, 6.2)],
        [(142, 46), (143.5, 49.5), (143, 54.3), (142.4, 53.8), (142, 50)],
        [(131, -1), (134, -1), (136, -2.5), (138, -1.6), (141, -2.6), (144.5, -3.8), (146, -5), (147.5, -6),
         (150.5, -10.5), (147.5, -10.2), (146, -8), (143.5, -9), (141, -9.1), (139, -8.1), (138, -7.3), (137.5, -5),
         (135, -4.3), (133, -4), (132, -2.8)],
    ],
    "australia": [
        [(113.5, -22), (114, -26.5), (115, -34), (118, -35), (123, -34), (129, -31.6), (134, -32.5), (136, -35),
         (138, -34.5), (140, -38), (144, -38.3), (147.5, -38), (150, -37.5), (151.5, -33), (153.5, -28.5), (153, -25),
         (150.5, -22.5), (148, -20), (146, -18.5), (145.3, -14.5), (143.5, -14), (142.5, -10.7), (141.5, -13),
         (141.5, -17), (140, -17.5), (137.5, -16), (135.8, -15), (136.8, -12.2), (132.5, -11.4), (130.3, -12.4),
         (129.5, -15), (126.5, -13.9), (125, -15.8), (122.5, -17), (121, -19.5), (118.5, -20.3), (115.5, -21.5)],
        [(144.8, -40.7), (148.3, -40.9), (148, -43.2), (146.5, -43.6), (145.3, -42.2)],
        [(172.7, -34.5), (175, -36.6), (178.5, -37.7), (177, -39.5), (175.5, -41.5), (174.6, -41.2), (174.5, -39),
         (173.8, -39.2), (174.5, -37), (173, -35.5)],
        [(172.6, -40.5), (174.3, -41.7), (172.8, -43.7), (171.2, -44.5), (169, -46.6), (166.5, -46), (168.5, -44),
         (170.5, -42.8), (172, -41)],
    ],
}
WORLD_COLOURS = {"north_america": ("sage", 0.9), "south_america": ("ochre", 0.9), "europe": ("slate", 0.6),
                 "africa": ("clay", 0.75), "asia": ("sage", 0.75), "australia": ("ochre", 0.9)}
# inland seas painted over the land (paper): Black Sea, Caspian Sea, Hudson Bay's opening stays as drawn
WORLD_SEAS = [
    [(28, 41.5), (28, 44), (30.5, 46.5), (33, 45.5), (36, 45.4), (38, 47), (41.5, 41.6), (36, 41.5), (31, 41.2)],
    [(47, 45), (49.5, 47), (53, 46.8), (53.5, 44), (52.5, 41), (54, 37.5), (50.5, 37), (49, 40), (49.5, 42), (48.5, 43.5)],
]


def thin(pts, d):
    """Drop outline points closer than d to the last kept one (the map is small: about 1.1 px per degree)."""
    out = [pts[0]]
    for p in pts[1:]:
        if vlen(sub(p, out[-1])) >= d:
            out.append(p)
    return out if len(out) >= 4 else pts


def world_xy(lon, lat):
    return ((lon + 180) / 360 * 400, (84 - lat) / 174 * 200)


REGIONS["soc_world_continents"] = {
    "north_america": {"x": 0.03, "y": 0.0, "w": 0.42, "h": 0.44},
    "south_america": {"x": 0.25, "y": 0.44, "w": 0.15, "h": 0.40},
    "europe": {"x": 0.47, "y": 0.06, "w": 0.16, "h": 0.22},
    "africa": {"x": 0.45, "y": 0.28, "w": 0.18, "h": 0.44},
    "asia": {"x": 0.63, "y": 0.02, "w": 0.37, "h": 0.52},
    "australia": {"x": 0.81, "y": 0.54, "w": 0.19, "h": 0.30},
    "antarctica": {"x": 0.0, "y": 0.86, "w": 1.0, "h": 0.14},
}


@art("soc_world_continents", 400, 200, 1.15)
def soc_world_continents(a):
    """The seven continents, stylised (draft, not a survey map): the Americas on the left, Europe, Africa, Asia (with
    Indonesia's islands) and Australia, Antarctica along the bottom. Neighbouring continents get different colours;
    the sea is the paper with short slate dashes. Tap regions in REGIONS: one box per continent; the boxes touch but
    do not overlap. They are rectangles, so the western edge of Arabia falls in Africa's box, New Guinea in Asia's and
    Iceland in North America's."""
    shapes = {name: [thin([world_xy(*p) for p in poly], 4.2) for poly in polys] for name, polys in WORLD.items()}
    ant = [(4, 176), (40, 173), (80, 177), (108, 171), (116, 162), (124, 170), (160, 177), (200, 172), (240, 178),
           (280, 174), (320, 178), (360, 173), (396, 176), (396, 198), (4, 198)]
    every = [p for polys in shapes.values() for p in polys] + [ant]
    sea = []
    y, row = 8, 0
    while y < 172:
        x = 6 + (row % 2) * 12 + a.j(4)
        while x < 394:
            L = a.u(6, 10)
            seg = ((x, y + a.j(1.5)), (x + L, y + a.j(1.5)))
            probe = [seg[0], seg[1], lerp(seg[0], seg[1], 0.5)]
            if not any(inside(add(p, (dx, dy)), s) for s in every for p in probe for dx, dy in
                       ((0, 0), (0, 4), (0, -4), (4, 0), (-4, 0))):
                sea.append(seg)
            x += a.u(26, 34)
        y += a.u(12, 15)
        row += 1
    a.lines(sea, FW * 1.1, "slate", 0.5, amp=0.3)
    for name, polys in shapes.items():
        col, al = WORLD_COLOURS[name]
        for k, pts in enumerate(polys):
            a.fill_smooth(pts, col, al, jit=0.3)
        for k, pts in enumerate(polys):
            big = len(pts) > 12
            a.outline(pts, LW * 0.75 if big else MW, second=0, jit=0.3)
    for s in WORLD_SEAS:
        pts = [world_xy(*p) for p in s]
        a.fill_smooth(pts, "paper", off=(0, 0), jit=0.2)
        a.outline(pts, FW * 1.4, second=0, jit=0.2)
    a.fill_smooth(ant, "paper", off=(0, 0))
    a.fill_smooth(ant, "slate", 0.18)
    a.hatch(ant, 8, 5.0, color="slate", alpha=0.4)
    a.curve(ant[:13], LW * 0.75, jit=0.3)


@art("soc_saman_dance", 400, 300, 1.35)
def soc_saman_dance(a):
    """Tari Saman (Aceh): three dancers kneeling close in a row, in dark costume with bright woven bands and head
    cloths, clapping together; the middle one's hands are up on the off-beat. Short arcs show the rhythm."""
    ground(a, 20, 380, 274, marks=6)
    r = 27
    xs = (106, 200, 294)
    for i, cx in enumerate(xs):
        up = i == 1
        hy = 126 + (6 if up else 0)
        hip_y = hy + r * (1.18 + 2.45)
        chest = hy + r * 2.4
        arms = (("ik", (cx - 46, hy - 40), 1), ("ik", (cx + 46, hy - 40), -1)) if up else (
            ("ik", (cx - 2, chest), 1), ("ik", (cx + 2, chest), -1))
        F = figure(a, r=r, head=(cx + a.j(2), hy), cut=hip_y + 6, top="shirt", top_col="slate", sleeve="long",
                   hair="short", expr="happy" if up else "smile", lite=True, pose={"arms": arms, "head": (-4, 4, 3)[i]},
                   tone="mid")
        band = [add(F.hc, p) for p in ((-26, -12), (0, -20), (26, -12), (26, -3), (0, -11), (-26, -3))]
        a.fill_smooth(band, "ochre")
        a.outline(band, MW * 1.2, second=0, jit=0.2)
        a.blob([add(F.hc, p) for p in ((24, -10), (36, -18), (38, -6), (28, -3))], "clay", w=MW, second=0)
        a.zig([add(F.nb, (-26, 4)), add(F.nb, (-13, 18)), add(F.nb, (0, 30)), add(F.nb, (13, 18)), add(F.nb, (26, 4))],
              5.0, "ochre", 0.95, jit=0.2)
        a.zig([add(F.nb, (-20, 6)), add(F.nb, (0, 22)), add(F.nb, (20, 6))], 2.4, "clay", 0.95, jit=0.2)
        # the lap: knees side by side in front of the hips, drawn over the cut torso
        lap = [(cx - 50, 272), (cx - 50, hip_y - 4), (cx - 30, hip_y - 14), (cx - 4, hip_y - 8), (cx + 4, hip_y - 8),
               (cx + 30, hip_y - 14), (cx + 50, hip_y - 4), (cx + 50, 272)]
        a.fill_smooth(lap, "slate")
        a.hatch(clip_half(lap, (cx + 18, 0), (1, 0)), 70, 5.0, alpha=0.35)
        a.zig([(cx - 46, 262), (cx - 34, 254), (cx - 22, 262), (cx - 10, 254), (cx + 2, 262), (cx + 14, 254),
               (cx + 26, 262), (cx + 38, 254), (cx + 46, 262)], MW, "ochre", 0.9)
        a.outline(lap, LW, second=0.3)
        a.line((cx - 2, hip_y - 6), (cx, hip_y + 18), MW, amp=0.3)
        if up:
            motion_arcs(a, (cx, hy - 60), 26, -150, -30, w=MW * 1.2, alpha=0.7)
        else:
            motion_arcs(a, (cx, chest), 26, 205, 245, w=FW * 1.4, alpha=0.7)
            motion_arcs(a, (cx, chest), 26, -65, -25, w=FW * 1.4, alpha=0.7)


SHEETS.append(("13b_fu12_science_maths", lambda k: k.startswith(("sci_", "math_")), 6, 150))
SHEETS.append(("13c_fu12_culture", lambda k: k.startswith("soc_"), 5, 180))
