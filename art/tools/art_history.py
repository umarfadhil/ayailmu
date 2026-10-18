"""Sejarah (history) pictures for follow-up 12 (MODULES_LEVELS_STORIES §2, §4, §6.2). DRAFT art (ART_DIRECTION §6).

Story panels are a 16:9 scene (hist_bg_*, 400 x 225, a full opaque scene) plus up to four picture LAYERS that the app
positions and animates on top. Every other hist_* key is such a layer: no background, transparent around the object.

Depiction rules (§4): no face likeness. People are flat ink silhouettes seen from the side (no eyes, mouths or other
facial features; one shared scale, feet on the bottom edge) and are otherwise shown through the objects of their
work. No weapons, no war, no violence, no religious symbols, no readable text or digits (marks are abstract).

Scenes are quieter than the layers: thin lines at partial alpha, pale washes, and calm open space in the left third and
the lower third where layers usually go. Layers use full-strength ink and colour so they read on top.

Viewports: scenes 400 x 225; silhouettes 240 x 240 (adult about 222 tall, child about 150, feet at y = 236, so one
`w` gives one scale); props 240 x 240, wide objects 320 x 240.
"""

from draw import *  # noqa: F401,F403  (the shared hand: Art helpers, geometry, palette roles, SHEETS, art_key)
from draw import SHEETS, art_key, puff_cloud, ribbon, crescent, wheel, draw_open_book, leaf_pts  # noqa: F401

HIST_BG = ["hist_bg_sea", "hist_bg_harbor", "hist_bg_classroom_old", "hist_bg_library_old", "hist_bg_lab",
           "hist_bg_ward", "hist_bg_village_java", "hist_bg_desert_road", "hist_bg_sky_field", "hist_bg_green_hills",
           "hist_bg_hills_aceh", "hist_bg_city_old", "hist_bg_night_sky", "hist_bg_map_world", "hist_bg_room_lamp"]
HIST_SIL = ["hist_sil_man", "hist_sil_woman", "hist_sil_woman_kebaya", "hist_sil_woman_headscarf", "hist_sil_boy",
            "hist_sil_girl", "hist_sil_teacher_class", "hist_sil_sailor", "hist_sil_scholar", "hist_sil_traveler",
            "hist_sil_scientist", "hist_sil_nurse"]
HIST_PROPS = ["hist_oil_lamp", "hist_compass_old", "hist_astrolabe", "hist_book_stack", "hist_globe_old", "hist_quill",
              "hist_small_boat", "hist_sunrise"]
HIST_FIG = ["hist_ki_hajar_school", "hist_slate_board", "hist_kartini_letters", "hist_dewi_sartika_school",
            "hist_sewing_kit", "hist_rumoh_aceh", "hist_hatta_books", "hist_coop_shop", "hist_habibie_plane",
            "hist_blueprint", "hist_treasure_ship", "hist_sejong_scroll", "hist_rain_gauge", "hist_spinning_wheel",
            "hist_sandals_path", "hist_khwarizmi_board", "hist_ibn_sina_book", "hist_herbs_mortar",
            "hist_camera_obscura", "hist_lens", "hist_caravan", "hist_route_map", "hist_qarawiyyin", "hist_handshake",
            "hist_tree_seedlings", "hist_curie_flask", "hist_notebook", "hist_nightingale_lamp", "hist_hospital_bed",
            "hist_braille_dots", "hist_braille_book", "hist_telescope", "hist_jupiter_moons", "hist_wright_flyer",
            "hist_bicycle_shop", "hist_water_pump", "hist_hands_spelling", "hist_peanut_plant", "hist_soil_field"]
HIST_ALL = HIST_BG + HIST_SIL + HIST_PROPS + HIST_FIG

BGK = 1.15  # stroke scale of the scenes (they stay lighter than the layers through alpha, not weight)
PK = 1.2  # stroke scale of the props: layers are shown small (w 0.15-0.35 of a scene), so their lines are bolder
BG_INK = 0.45  # ink alpha of scene contours


# --------------------------------------------------------------------------------------------- scene helpers


def frange(x0, x1, step):
    out, x = [], x0
    while x < x1:
        out.append(x)
        x += step
    out.append(x1)
    return out


def wave_x(x0, x1, base, terms, step=16):
    """Points along a gentle terrain line: base + sum of A sin(x / f + p)."""
    return [(x, base + sum(A * math.sin(x / f + p) for A, f, p in terms)) for x in frange(x0, x1, step)]


def bg_paper(a):
    """A full-bleed paper sheet, so the scene is opaque under its layers (it follows the night palette)."""
    a.fill(Path().M((-1, -1)).L((a.vw + 1, -1)).L((a.vw + 1, a.vh + 1)).L((-1, a.vh + 1)).Z(), "paper")


def flat(a, pts, color, alpha, step=80, jit=0.4):
    """A flat print wash (no gradient): straight-edged."""
    a.fill_poly(pts, color, alpha, off=(0, 0), jit=jit, step=step)


def soft(a, pts, color, alpha, jit=0.4):
    """A flat print wash with soft (spline) edges."""
    a.fill_smooth(pts, color, alpha, off=(0, 0), jit=jit)


def land(a, top, color, alpha, bottom=None):
    bottom = a.vh + 8 if bottom is None else bottom
    soft(a, top + [(top[-1][0] + 6, bottom), (top[0][0] - 6, bottom)], color, alpha)


def bl(a, pts, w=MW, alpha=BG_INK, color="ink", jit=0.4):
    """A scene line: thinner and lighter than a layer's contour."""
    a.curve(pts, w, color, alpha, jit)


def bline(a, p0, p1, w=MW, alpha=BG_INK, color="ink", amp=0.6):
    a.line(p0, p1, w, color, alpha, amp=amp)


def bpoly(a, pts, w=MW * 0.9, alpha=BG_INK, closed=True):
    a.outline_poly(pts, w, alpha=alpha, closed=closed, second=0, over=1.6, gap=1.4)


def bg_cloud(a, c, w, h, alpha=0.4, tint=0.12):
    """A quiet scene cloud: paper body, a faint slate underside, a light top contour."""
    bumps = []
    n = 4
    for i in range(n):
        t = i / (n - 1)
        sn = math.sin(math.pi * t)
        bumps.append((c[0] - w / 2 + w * t, c[1] - h * (0.3 + 0.45 * sn), h * (0.42 + 0.22 * sn)))
    top = []
    for x in frange(c[0] - w / 2 - h * 0.3, c[0] + w / 2 + h * 0.3, 6):
        ys = [cy - math.sqrt(max(0.0, r * r - (x - cx) ** 2)) for cx, cy, r in bumps if abs(x - cx) < r]
        if ys:
            top.append((x, min(ys)))
    shape = top + [(top[-1][0], c[1] + h * 0.12), (top[0][0], c[1] + h * 0.12)]
    soft(a, shape, "paper", 1.0, jit=0.2)
    soft(a, clip_half(subdivide(shape, 8), (0, c[1] - h * 0.1), (0, 1)), "slate", tint, jit=0.2)
    bl(a, top[1:-1], MW * 0.9, alpha, jit=0.3)
    bline(a, (top[0][0] + 4, c[1] + h * 0.12), (top[-1][0] - 6, c[1] + h * 0.12), FW, alpha * 0.7, amp=0.3)


def wave_marks(a, rows, x_step, alpha_fn, w=FW * 1.3, size=6.0):
    """Small drawn wave ticks; alpha_fn(x, y) -> alpha or 0 (skip). Grouped by alpha so they merge."""
    groups = {}
    for y in rows:
        x = a.u(0, x_step)
        while x < a.vw - 8:
            al = alpha_fn(x, y)
            if al and a.rng.random() > 0.25:
                s = size * a.u(0.8, 1.2)
                groups.setdefault(al, []).append([(x, y), (x + s, y - s * 0.3), (x + 2 * s, y), (x + 3 * s, y + s * 0.25)])
            x += x_step * a.u(0.7, 1.3)
    for al, marks in sorted(groups.items()):
        for m in marks:
            bl(a, m, w, al, jit=0.2)


def tufts(a, pts, h=7.0, w=FW * 1.2, alpha=0.4, color="ink"):
    segs = []
    for x, y in pts:
        s = h * a.u(0.8, 1.2)
        segs += [((x, y), (x - s * 0.5, y - s * 0.8)), ((x, y), (x + 0.5, y - s)), ((x, y), (x + s * 0.55, y - s * 0.75))]
    a.lines(segs, w, color, alpha, amp=0.2)


def bird_marks(a, pts, s=5.0, alpha=0.5):
    for x, y in pts:
        bl(a, [(x - s, y - s * 0.3), (x - s * 0.4, y - s * 0.5), (x, y)], FW * 1.3, alpha, jit=0.1)
        bl(a, [(x, y), (x + s * 0.5, y - s * 0.6), (x + s * 1.1, y - s * 0.35)], FW * 1.3, alpha, jit=0.1)


def palm(a, base, h, lean=8.0, s=1.0, alpha=0.5, frond_col="sage", frond_alpha=0.5):
    """A coconut palm for scenes: a curved trunk and a crown of drooping fronds."""
    top = add(base, (lean, -h))
    mid = add(lerp(base, top, 0.5), (lean * 0.6 + 2, 0))
    a.fill_smooth(ribbon([base, mid, top], 4.2 * s, 2.6 * s), "ochre", 0.45, off=(0, 0), jit=0.2)
    bl(a, [base, mid, top], MW * 0.8 * s, alpha, jit=0.2)
    leaves = []
    for k, ang in enumerate((-160, -128, -96, -60, -24, 8, 30)):
        L = (26 + 6 * math.cos(math.radians(ang + 90))) * s * a.u(0.85, 1.1)
        tip = add(top, (L * math.cos(math.radians(ang)), L * math.sin(math.radians(ang)) * 0.55 + L * 0.42))
        ctrl = add(top, (L * 0.55 * math.cos(math.radians(ang)), -L * 0.18))
        leaves.append([top, ctrl, tip])
    for lf in leaves:
        a.fill_smooth(ribbon(lf, 5.5 * s, 0.8), frond_col, frond_alpha, off=(0, 0), jit=0.2)
    for lf in leaves:
        bl(a, lf, FW * 1.1 * s, alpha, jit=0.2)


# --------------------------------------------------------------------------------------------- scenes (16:9)


@art_key("hist_bg_sea", 400, 225, BGK)
def hist_bg_sea(a):
    """Open sea under a high sky: a far island on the right, two clouds; calm water in the left and lower thirds."""
    bg_paper(a)
    hy = 92
    flat(a, rect(-2, -2, 404, hy + 3), "slate", 0.10)
    flat(a, [(-2, hy - 20), (402, hy - 26), (402, hy + 1), (-2, hy + 1)], "ochre", 0.10)
    isl = [(282, hy + 1), (294, hy - 6), (312, hy - 11), (330, hy - 9), (346, hy - 4), (360, hy + 1)]
    soft(a, isl + [(322, hy + 3)], "sage", 0.4)
    bl(a, isl, FW * 1.2, 0.4)
    flat(a, [(-2, hy), (402, hy), (402, 227), (-2, 227)], "slate", 0.24)
    flat(a, [(-2, hy), (402, hy), (402, hy + 13), (-2, hy + 16)], "slate", 0.12)
    bline(a, (-2, hy), (402, hy + a.j(1)), MW, 0.5)
    bg_cloud(a, (296, 44), 80, 22)
    bg_cloud(a, (368, 24), 40, 12, 0.35)
    bg_cloud(a, (204, 58), 34, 10, 0.3)
    bird_marks(a, [(248, 30), (262, 38)])

    def al(x, y):
        if y > 160 or x < 133:
            return 0.22 if a.rng.random() < 0.45 else 0
        return 0.38

    wave_marks(a, [hy + 12, hy + 26, hy + 42, hy + 60, hy + 82, hy + 106], 34, al)


@art_key("hist_bg_harbor", 400, 225, BGK)
def hist_bg_harbor(a):
    """An old harbour: warehouses and a far ship on the right shore, a wooden pier; open water left and front."""
    bg_paper(a)
    hy = 124
    flat(a, rect(-2, -2, 404, hy + 3), "slate", 0.09)
    hills = [(150, hy)] + wave_x(176, 410, 108, [(6, 40, 0.5), (3, 17, 1.0)])
    land(a, hills, "sage", 0.26, bottom=hy + 2)
    bl(a, hills[2:-1], FW * 1.2, 0.35)
    for x, w, h in ((248, 44, 22), (300, 58, 30), (366, 38, 20)):
        wall = rect(x, hy - h, w, h)
        flat(a, wall, "ochre", 0.34)
        roof = [(x - 4, hy - h), (x + w / 2, hy - h - 13), (x + w + 4, hy - h)]
        flat(a, roof, "clay", 0.42)
        bpoly(a, roof, MW * 0.8)
        bpoly(a, wall, MW * 0.8, closed=False)
        door = rect(x + w * 0.38, hy - h * 0.62, w * 0.24, h * 0.62)
        flat(a, door, "slate", 0.3)
    # a far ship with furled sails at anchor
    hull = [(170, hy - 3), (232, hy - 4), (226, hy + 4), (178, hy + 4)]
    flat(a, hull, "clay", 0.4)
    bpoly(a, hull, MW * 0.8)
    for mx, mh in ((190, 50), (212, 42)):
        bline(a, (mx, hy - 3), (mx + 1, hy - mh), MW * 0.8, 0.5)
        for yy in (hy - mh + 8, hy - mh + 22):
            bline(a, (mx - 9, yy), (mx + 10, yy + 1), MW * 1.3, 0.55, "ochre", 0.3)
    a.lines([((176, hy - 4), (190, hy - 50)), ((190, hy - 50), (212, hy - 42)), ((212, hy - 42), (230, hy - 5))], FW,
            alpha=0.3, amp=0.3)
    # water
    flat(a, [(-2, hy), (402, hy), (402, 227), (-2, 227)], "slate", 0.24)
    bline(a, (-2, hy), (402, hy), MW * 0.9, 0.45)
    # pier from the right edge
    deck = [(226, 150), (404, 142), (404, 152), (228, 158)]
    for x in frange(236, 396, 24):
        y = 157 - (x - 226) * 0.045
        bline(a, (x, y), (x + a.j(1), y + 26 + a.j(3)), MW * 1.5, 0.45, amp=0.3)
    flat(a, deck, "ochre", 0.5)
    bpoly(a, deck, MW * 0.9, 0.5)
    a.lines([((x, 157 - (x - 226) * 0.045), (x + 2, 150 - (x - 226) * 0.045)) for x in frange(244, 396, 16)], FW,
            alpha=0.3, amp=0.1)
    bird_marks(a, [(110, 40), (124, 48), (300, 52)], 4.5, 0.45)

    def al(x, y):
        if y > 168 or x < 133:
            return 0.22 if a.rng.random() < 0.5 else 0
        return 0.34

    wave_marks(a, [hy + 10, hy + 22, hy + 38, hy + 58, hy + 80], 36, al)


@art_key("hist_bg_classroom_old", 400, 225, BGK)
def hist_bg_classroom_old(a):
    """An old classroom: a chalkboard with abstract chalk marks and a shuttered window on the right; plain wall left."""
    bg_paper(a)
    fy = 166
    flat(a, rect(-2, -2, 404, fy + 2), "ochre", 0.13)
    flat(a, rect(-2, 128, 404, fy - 128), "ochre", 0.16)
    a.lines([((x, 129), (x + a.j(0.6), fy - 1)) for x in frange(12, 392, 23)], FW, alpha=0.18, amp=0.2)
    bline(a, (-2, 128), (402, 128), FW * 1.3, 0.38)
    flat(a, rect(-2, fy, 404, 64), "clay", 0.18)
    bline(a, (-2, fy), (402, fy + a.j(1)), MW, 0.5)
    a.lines([((-2, y), (402, y + a.j(1))) for y in (fy + 13, fy + 29, fy + 50)], FW, alpha=0.24, amp=0.4)
    flat(a, rect(-2, -2, 404, 12), "clay", 0.24)
    bline(a, (-2, 10), (402, 10), FW * 1.3, 0.4)
    # chalkboard
    frame = rect(170, 30, 160, 84)
    flat(a, frame, "ochre", 0.55)
    board = rect(177, 36, 146, 72)
    flat(a, board, "slate", 0.75)
    bpoly(a, frame, MW * 0.9, 0.55)
    bpoly(a, board, FW * 1.3, 0.5)
    chalk = dict(w=FW * 1.4, alpha=0.7, color="paper")
    bl(a, ellipse((206, 60), 12, 11, n=9)[:9], **chalk)
    bl(a, [(232, 76), (246, 50), (262, 77), (230, 77)], **chalk)
    bl(a, [(276, 52), (284, 46), (292, 54), (300, 46), (308, 54)], **chalk)
    bl(a, [(276, 68), (290, 64), (304, 70), (314, 66)], **chalk)
    a.dots([(194 + 7 * i, 92) for i in range(5)] + [(194 + 7 * i, 99) for i in range(3)], 2.4, "paper", 0.7)
    bl(a, [(250, 94), (270, 92), (296, 96)], **chalk)
    shelf = rect(166, 114, 168, 5)
    flat(a, shelf, "ochre", 0.6)
    bpoly(a, shelf, FW * 1.3, 0.5)
    a.lines([((268, 112), (276, 112)), ((282, 112.5), (287, 112))], MW * 1.3, "paper", 0.9, amp=0.1)
    # window on the right with open shutters
    win = rect(354, 32, 34, 70)
    flat(a, win, "slate", 0.14)
    flat(a, rect(342, 32, 11, 70), "sage", 0.3)
    flat(a, rect(389, 32, 11, 70), "sage", 0.3)
    bpoly(a, win, MW * 0.9, 0.5)
    a.lines([((371, 33), (371, 101)), ((355, 66), (387, 66))], FW * 1.2, alpha=0.45, amp=0.2)
    a.lines([((343, 40 + 8 * k), (352, 41 + 8 * k)) for k in range(8)] + [((390, 40 + 8 * k), (399, 41 + 8 * k))
                                                                           for k in range(8)], FW, alpha=0.3, amp=0.1)


def book_row(a, x0, x1, y, hmin, hmax, cols, alpha=0.5):
    """Books standing on a shelf at y, from x0 to x1: fills grouped by colour, a few spine marks."""
    x, spines = x0, []
    by_col = {}
    i = 0
    while x < x1 - 4:
        w = a.u(4.5, 8.5)
        h = a.u(hmin, hmax)
        if a.rng.random() < 0.08 and x + 12 < x1:
            x += a.u(4, 8)
            continue
        col = cols[i % len(cols)] if a.rng.random() < 0.7 else a.rng.choice(cols)
        by_col.setdefault(col, []).append([(x, y), (x + w, y), (x + w, y - h), (x, y - h)])
        if a.rng.random() < 0.5:
            spines.append(((x + 1.2, y - h * 0.7), (x + w - 1.2, y - h * 0.7)))
        x += w + a.u(0.3, 1.2)
        i += 1
    for col, books in by_col.items():
        for b in books:
            flat(a, b, col, alpha, jit=0.2)
    a.lines(spines, FW, "paper", 0.55, amp=0.1)


@art_key("hist_bg_library_old", 400, 225, BGK)
def hist_bg_library_old(a):
    """An old library: tall shelves of books on the right, an arched window; plain wall and floor left and front."""
    bg_paper(a)
    fy = 168
    flat(a, rect(-2, -2, 404, fy + 2), "ochre", 0.12)
    flat(a, rect(-2, fy, 404, 62), "clay", 0.17)
    bline(a, (-2, fy), (402, fy), MW, 0.5)
    a.lines([((-2, y), (402, y + a.j(1))) for y in (fy + 15, fy + 34)], FW, alpha=0.22, amp=0.4)
    # arched window
    x0, x1, yb, yt = 146, 206, 116, 46
    arch = [(x0, yb), (x0, yt)] + [polar(((x0 + x1) / 2, yt), (x1 - x0) / 2, t) for t in range(180, 361, 20)] + [(x1, yb)]
    soft(a, arch, "slate", 0.14)
    bl(a, arch, MW * 0.9, 0.5)
    bline(a, (x0 - 3, yb), (x1 + 3, yb), MW, 0.5)
    a.lines([(((x0 + x1) / 2, yt - 28), ((x0 + x1) / 2, yb)), ((x0, 80), (x1, 80))], FW * 1.2, alpha=0.4, amp=0.2)
    # shelves
    sx0, sx1, top = 232, 398, 16
    case = rect(sx0, top, sx1 - sx0, fy - top)
    flat(a, case, "ochre", 0.3)
    levels = [52, 90, 128, fy - 4]
    for y in levels:
        book_row(a, sx0 + 6, sx1 - 6, y, 18, 30, ("clay", "sage", "slate", "ochre"), 0.38)
    for y in levels:
        flat(a, rect(sx0, y, sx1 - sx0, 4), "ochre", 0.6, jit=0.2)
    bpoly(a, case, MW * 0.9, 0.5)
    a.lines([((sx0, y), (sx1, y)) for y in levels], FW * 1.2, alpha=0.45, amp=0.3)
    bline(a, (sx0 - 4, top), (sx1 + 4, top), MW * 1.2, 0.5)


@art_key("hist_bg_lab", 400, 225, BGK)
def hist_bg_lab(a):
    """An old laboratory: shelves of glassware and a window behind a long bench whose top is a free surface."""
    bg_paper(a)
    by = 148
    flat(a, rect(-2, -2, 404, by + 2), "slate", 0.07)
    # window
    win = rect(148, 26, 62, 76)
    flat(a, win, "slate", 0.12)
    bpoly(a, win, MW * 0.9, 0.5)
    a.lines([((179, 27), (179, 101)), ((149, 64), (209, 64))], FW * 1.2, alpha=0.4, amp=0.2)
    bline(a, (144, 103), (214, 103), MW, 0.45)
    # shelves with glassware on the right wall
    for y in (62, 104):
        flat(a, rect(248, y, 148, 4), "ochre", 0.55, jit=0.2)
        bline(a, (248, y), (396, y), FW * 1.3, 0.45)
    jars = []
    for x, y, kind, col in ((256, 62, "bottle", "sage"), (276, 62, "flask", "slate"), (300, 62, "jar", "clay"),
                            (322, 62, "bottle", "ochre"), (346, 62, "flask", "sage"), (372, 62, "jar", "slate"),
                            (262, 104, "jar", "ochre"), (286, 104, "flask", "clay"), (312, 104, "bottle", "slate"),
                            (338, 104, "jar", "sage"), (362, 104, "bottle", "clay"), (382, 104, "flask", "ochre")):
        if kind == "bottle":
            pts = [(x - 5, y), (x + 5, y), (x + 5, y - 16), (x + 2, y - 20), (x + 2, y - 26), (x - 2, y - 26), (x - 2, y - 20),
                   (x - 5, y - 16)]
        elif kind == "flask":
            pts = [(x - 9, y), (x + 9, y), (x + 2, y - 14), (x + 2, y - 24), (x - 2, y - 24), (x - 2, y - 14)]
        else:
            pts = rect(x - 7, y - 18, 14, 18)
        jars.append((pts, col))
    for pts, col in jars:
        flat(a, pts, col, 0.35, step=40, jit=0.2)
    for pts, _ in jars:
        bpoly(a, pts, FW * 1.2, 0.42)
    # bench: the top edge is a free surface for layers
    flat(a, rect(-2, by, 404, 7), "ochre", 0.55)
    flat(a, rect(-2, by + 7, 404, 72), "ochre", 0.24)
    bline(a, (-2, by), (402, by + a.j(1)), MW, 0.55)
    bline(a, (-2, by + 7), (402, by + 7), FW * 1.2, 0.4)
    for x in (182, 290):
        dr = rect(x, by + 18, 92, 26)
        bpoly(a, dr, FW * 1.2, 0.3)
        a.dots([(x + 46, by + 31)], 3.4, "ink", 0.35)
    # test-tube rack at the far right of the bench
    rack = rect(352, by - 14, 40, 6)
    for k in range(5):
        tx = 356 + k * 8
        tube = [(tx - 2, by - 26), (tx + 2, by - 26), (tx + 2, by - 4), (tx, by - 2), (tx - 2, by - 4)]
        flat(a, tube, ("sage", "clay", "slate", "ochre", "sage")[k], 0.3, jit=0.1)
        bpoly(a, tube, FW, 0.4)
    flat(a, rack, "clay", 0.4)
    bpoly(a, rack, FW * 1.2, 0.45)
    a.lines([((354, by - 8), (354, by)), ((390, by - 8), (390, by))], FW * 1.4, alpha=0.45, amp=0.1)


@art_key("hist_bg_ward", 400, 225, BGK)
def hist_bg_ward(a):
    """A long 19th-century hospital ward: tall arched windows and small distant beds; a calm floor in front."""
    bg_paper(a)
    fy = 142
    flat(a, rect(-2, -2, 404, fy + 2), "ochre", 0.12)
    flat(a, rect(-2, fy, 404, 88), "clay", 0.13)
    bline(a, (-2, fy), (402, fy), MW, 0.5)
    a.lines([((-2, y), (402, y + a.j(1))) for y in (fy + 12, fy + 28, fy + 52)], FW, alpha=0.2, amp=0.4)
    flat(a, rect(-2, -2, 404, 10), "clay", 0.2)
    bline(a, (-2, 8), (402, 8), FW * 1.3, 0.38)
    for i, x0 in enumerate((168, 244, 320)):
        x1, yt, yb = x0 + 46, 44, 104
        win = [(x0, yb), (x0, yt)] + [polar(((x0 + x1) / 2, yt), 23, t) for t in range(180, 361, 30)] + [(x1, yb)]
        soft(a, win, "slate", 0.14)
        bl(a, win, MW * 0.85, 0.48)
        a.lines([(((x0 + x1) / 2, yt - 20), ((x0 + x1) / 2, yb)), ((x0, 74), (x1, 74))], FW, alpha=0.38, amp=0.2)
        bline(a, (x0 - 3, yb), (x1 + 3, yb), FW * 1.4, 0.45)
        if i < 2:
            a.lines([((x1 + 15, 20), (x1 + 15, fy))], FW, alpha=0.2, amp=0.3)
        # a small distant bed under each window
        bx, by = x0 - 2, 128
        flat(a, [(bx, by), (bx + 50, by), (bx + 50, by + 6), (bx, by + 6)], "paper", 1.0, jit=0.2)
        flat(a, [(bx, by - 1), (bx + 50, by - 1), (bx + 50, by + 6), (bx, by + 6)], "slate", 0.12, jit=0.2)
        flat(a, [(bx + 2, by - 5), (bx + 12, by - 6), (bx + 13, by), (bx + 2, by)], "paper", 1.0, jit=0.2)
        bpoly(a, [(bx, by - 1), (bx + 50, by - 1), (bx + 50, by + 6), (bx, by + 6)], FW * 1.2, 0.42)
        a.lines([((bx, by - 10), (bx, fy)), ((bx + 50, by - 4), (bx + 50, fy)), ((bx - 1, by - 10), (bx + 3, by - 10))],
                FW * 1.2, alpha=0.42, amp=0.2)


@art_key("hist_bg_village_java", 400, 225, BGK)
def hist_bg_village_java(a):
    """A Javanese village: a volcano far right, terraced sawah, a limasan house and coconut palms; calm left and front."""
    bg_paper(a)
    flat(a, rect(-2, -2, 404, 120), "slate", 0.08)
    vol = [(150, 106), (230, 70), (270, 42), (290, 33), (306, 33), (322, 42), (360, 70), (430, 104)]
    land(a, vol, "slate", 0.2, bottom=112)
    bl(a, vol[1:-1], FW * 1.3, 0.38)
    bg_cloud(a, (338, 26), 34, 10, 0.3)
    hills = wave_x(-10, 410, 106, [(4, 45, 0.2), (2.5, 19, 1.3)])
    land(a, hills, "sage", 0.24, bottom=116)
    # terraces (sawah) between y 112 and 150
    for k, (base, col, al) in enumerate(((114, "sage", 0.3), (124, "ochre", 0.22), (135, "sage", 0.34),
                                         (146, "ochre", 0.2))):
        top = wave_x(-10, 410, base, [(2.2, 36, k * 1.7), (1.2, 13, k)], 24)
        land(a, top, col, al, bottom=base + 16)
        bl(a, top[1:-1], FW * 1.2, 0.3)
    tufts(a, [(x + a.j(3), 131 + a.j(1)) for x in frange(200, 390, 19)], 5, alpha=0.3)
    tufts(a, [(x + a.j(3), 142 + a.j(1)) for x in frange(170, 390, 21)], 5.5, alpha=0.3)
    # a limasan house
    hx, hy = 236, 111
    wall = rect(hx, hy - 16, 52, 16)
    flat(a, wall, "ochre", 0.4)
    a.lines([((hx + 5 + 6 * i, hy - 15), (hx + 5 + 6 * i, hy - 1)) for i in range(8)], FW, alpha=0.2, amp=0.1)
    roof = [(hx - 10, hy - 16), (hx + 12, hy - 34), (hx + 40, hy - 34), (hx + 62, hy - 16)]
    flat(a, roof, "clay", 0.45)
    bpoly(a, roof, MW * 0.85, 0.5)
    bpoly(a, wall, FW * 1.3, 0.45, closed=False)
    flat(a, rect(hx + 22, hy - 12, 9, 12), "slate", 0.35)
    palm(a, (350, 150), 78, 10)
    palm(a, (378, 158), 64, -6, 0.85)
    palm(a, (214, 116), 44, 6, 0.65, 0.42)
    # foreground (lower third): plain ground and a path
    fg = wave_x(-10, 410, 154, [(2, 50, 0.4)])
    land(a, fg, "ochre", 0.16)
    path_ = [(150, 227), (196, 190), (232, 168), (256, 156), (266, 156), (250, 170), (226, 196), (204, 227)]
    soft(a, path_, "clay", 0.13)
    tufts(a, [(30, 196), (70, 212), (330, 200), (372, 184)], 6, alpha=0.32)


@art_key("hist_bg_desert_road", 400, 225, BGK)
def hist_bg_desert_road(a):
    """A desert track winding to the horizon past dunes, a small oasis far right; open sand left and front."""
    bg_paper(a)
    hy = 108
    flat(a, rect(-2, -2, 404, hy + 4), "ochre", 0.08)
    sc = (332, 42)
    soft(a, ellipse(sc, 15, 15, n=12), "ochre", 0.55)
    bl(a, ellipse(sc, 15, 15, n=14)[:13], FW * 1.3, 0.4)
    far = wave_x(-10, 410, hy, [(3, 30, 0.3), (2, 11, 1)])
    land(a, far, "slate", 0.14, bottom=hy + 12)
    for x, h in ((344, 18), (356, 22), (372, 16)):
        palm(a, (x, hy + 1), h, 2, 0.4, 0.42)
    for x in (318, 382):
        flat(a, rect(x, hy - 8, 14, 9), "ochre", 0.45, jit=0.2)
        bpoly(a, rect(x, hy - 8, 14, 9), FW, 0.4)
    mid = wave_x(-10, 410, 124, [(7, 42, 2.4), (3, 17, 0.6)])
    land(a, mid, "ochre", 0.26)
    bl(a, mid[8:-1], MW * 0.85, 0.38)
    near = wave_x(-10, 410, 160, [(6, 60, 1.0), (2, 23, 0.2)])
    land(a, near, "ochre", 0.18)
    bl(a, near[14:-1], FW * 1.3, 0.3)
    # the track: wide at the bottom, narrowing to the horizon
    cl = [(196, 227), (214, 196), (250, 170), (282, 146), (292, 130), (302, hy + 6)]
    wid = [30, 25, 18, 12, 7, 3]
    left, right = [], []
    for i, p in enumerate(cl):
        left.append((p[0] - wid[i], p[1]))
        right.append((p[0] + wid[i], p[1]))
    soft(a, left + right[::-1], "clay", 0.16)
    bl(a, left, FW * 1.3, 0.32)
    bl(a, right, FW * 1.3, 0.32)
    a.lines([(lerp(cl[i], cl[i + 1], 0.2), lerp(cl[i], cl[i + 1], 0.6)) for i in range(len(cl) - 2)], FW, alpha=0.25,
            amp=0.3)
    ripples = []
    for x, y in ((330, 150), (360, 162), (300, 186), (350, 196), (250, 132), (380, 138)):
        ripples.append([(x, y), (x + 8, y - 2), (x + 16, y)])
    for r in ripples:
        bl(a, r, FW, 0.25, jit=0.2)


@art_key("hist_bg_sky_field", 400, 225, BGK)
def hist_bg_sky_field(a):
    """A wide sky over low sand dunes by the sea (Kitty Hawk), a small wooden camp shed; most of the frame is open sky."""
    bg_paper(a)
    hy = 168
    flat(a, rect(-2, -2, 404, hy + 4), "slate", 0.10)
    bg_cloud(a, (292, 40), 66, 18)
    bg_cloud(a, (364, 82), 44, 12, 0.32)
    bg_cloud(a, (168, 30), 40, 11, 0.3)
    flat(a, [(286, hy - 4), (404, hy - 5), (404, hy + 3), (286, hy + 3)], "slate", 0.3)
    dune = wave_x(150, 300, hy, [(-10, 38, 2.6), (-3, 14, 0.4)], 10)
    land(a, dune, "ochre", 0.3, bottom=hy + 10)
    bl(a, dune[2:-2], MW * 0.85, 0.4)
    shed = rect(232, hy - 22, 26, 13)
    flat(a, shed, "ochre", 0.5, jit=0.2)
    flat(a, [(229, hy - 22), (245, hy - 31), (261, hy - 22)], "clay", 0.45, jit=0.2)
    bpoly(a, shed, FW * 1.2, 0.5, closed=False)
    bpoly(a, [(229, hy - 22), (245, hy - 31), (261, hy - 22)], FW * 1.2, 0.5)
    fg = wave_x(-10, 410, hy + 2, [(2, 40, 0.0), (1, 13, 1)])
    land(a, fg, "ochre", 0.22)
    bl(a, fg[1:-1], MW * 0.8, 0.4)
    tufts(a, [(x + a.j(4), hy + 4 + a.j(2)) for x in frange(150, 395, 21)], 6, alpha=0.36)
    tufts(a, [(40, 204), (96, 216), (300, 210), (360, 196)], 6, alpha=0.3, color="ink")
    bird_marks(a, [(220, 64), (232, 70)], 4.2, 0.42)


@art_key("hist_bg_green_hills", 400, 225, BGK)
def hist_bg_green_hills(a):
    """Rolling green highland hills (Kenya): a far snow-capped peak, two flat-topped acacias; calm front hill."""
    bg_paper(a)
    flat(a, rect(-2, -2, 404, 120), "slate", 0.07)
    peak = [(220, 104), (270, 62), (290, 44), (302, 40), (316, 50), (340, 70), (392, 104)]
    land(a, peak, "slate", 0.18, bottom=110)
    cap = [(283, 52), (290, 44), (302, 40), (316, 50), (308, 54), (298, 49), (291, 55)]
    soft(a, cap, "paper", 0.9, jit=0.2)
    bl(a, peak[1:-1], FW * 1.3, 0.38)
    bg_cloud(a, (170, 44), 44, 12, 0.3)
    far = wave_x(-10, 410, 100, [(6, 52, 0.4), (3, 21, 1.2)])
    land(a, far, "sage", 0.2)
    mid = wave_x(-10, 410, 122, [(8, 60, 2.0), (3, 23, 0.4)])
    land(a, mid, "sage", 0.24)
    bl(a, mid[7:-1], MW * 0.85, 0.38)
    for k in range(4):
        y = 134 + k * 6
        bl(a, [(250 + k * 6, y), (300, y - 3 + k), (360, y + 1), (396, y - 2)], FW, 0.22)
    near = wave_x(-10, 410, 156, [(6, 70, 3.2), (2, 25, 0.2)])
    land(a, near, "sage", 0.2)
    bl(a, near[10:-1], FW * 1.4, 0.32)
    for c, s in (((318, 108), 1.0), ((354, 116), 0.8)):
        x, y = c
        trunk = [(x, y + 26 * s), (x + 1, y + 12 * s), (x - 6 * s, y)]
        bl(a, trunk, MW * 1.1 * s, 0.5, jit=0.2)
        bl(a, [(x + 1, y + 12 * s), (x + 8 * s, y + 1)], MW * s, 0.5, jit=0.2)
        can = [(x - 22 * s, y + 1), (x - 12 * s, y - 6 * s), (x + 8 * s, y - 8 * s), (x + 24 * s, y - 3 * s), (x + 20 * s, y + 2),
               (x - 4 * s, y + 3)]
        soft(a, can, "sage", 0.6, jit=0.2)
        bl(a, can[:5], FW * 1.3, 0.48, jit=0.2)
    tufts(a, [(26, 200), (80, 214), (330, 206), (380, 190)], 6, alpha=0.3)


@art_key("hist_bg_hills_aceh", 400, 225, BGK)
def hist_bg_hills_aceh(a):
    """Forested hills of Aceh: blue ridges with a band of mist, a river in the valley, palms; calm front slope."""
    bg_paper(a)
    flat(a, rect(-2, -2, 404, 120), "slate", 0.08)
    ridge = wave_x(-10, 410, 76, [(10, 34, 0.6), (5, 13, 2.0), (3, 7, 0.3)], 10)
    land(a, ridge, "slate", 0.2, bottom=120)
    bl(a, ridge[12:-1], FW * 1.3, 0.35)
    mist = wave_x(-10, 410, 92, [(2, 40, 0.0)], 20)
    soft(a, mist + [(410, 102), (300, 104), (150, 101), (-10, 103)], "paper", 0.75)
    forest = []
    x = -10
    while x < 412:
        r = a.u(5, 9)
        forest.append((x, 106 - r * 0.9 + 3 * math.sin(x / 50)))
        forest.append((x + r, 104 + 3 * math.sin(x / 50)))
        x += 2 * r
    land(a, forest, "sage", 0.32, bottom=175)
    bl(a, forest[20:-1], FW * 1.2, 0.35)
    river = [(250, 118), (282, 122), (300, 130), (288, 140), (310, 150), (350, 156), (400, 160)]
    soft(a, ribbon(river, 4, 18), "slate", 0.28)
    near = wave_x(-10, 410, 140, [(-8, 70, 1.6), (2, 12, 0.5)], 14)
    land(a, near, "sage", 0.3)
    bl(a, near[10:-1], MW * 0.85, 0.4)
    fg = wave_x(-10, 410, 166, [(4, 70, 0.3)])
    land(a, fg, "sage", 0.18)
    palm(a, (360, 150), 66, 8, 0.9)
    palm(a, (386, 160), 52, -5, 0.75)
    tufts(a, [(30, 196), (90, 210), (300, 204)], 6, alpha=0.3)


@art_key("hist_bg_city_old", 400, 225, BGK)
def hist_bg_city_old(a):
    """An old town street: tiled roofs, plastered houses with arched windows and an awning on the right; a cobbled
    street in front and a low far skyline on the left (no places of worship, no signs)."""
    bg_paper(a)
    sy = 152  # street line
    flat(a, rect(-2, -2, 404, sy + 2), "slate", 0.08)
    sky = []
    x = -10
    while x < 200:
        w = a.u(14, 26)
        h = a.u(10, 24)
        sky += [(x, sy - 30 - h), (x + w, sy - 30 - h)]
        x += w
    land(a, [(-10, sy - 30)] + sky + [(200, sy - 30)], "slate", 0.12, bottom=sy + 2)
    houses = [(118, 52, 58, "ochre"), (172, 66, 84, "paper"), (240, 58, 70, "ochre"), (300, 48, 92, "paper"),
              (350, 54, 66, "ochre")]
    for x, w, h, col in houses:
        wall = rect(x, sy - h, w, h)
        if col == "paper":
            flat(a, wall, "paper", 1.0)
            flat(a, wall, "slate", 0.1)
        else:
            flat(a, wall, "ochre", 0.3)
        roof = [(x - 4, sy - h), (x + w * 0.5, sy - h - 16), (x + w + 4, sy - h)]
        flat(a, roof, "clay", 0.42)
        bpoly(a, roof, MW * 0.85)
        bpoly(a, wall, MW * 0.85, closed=False)
        # arched windows in rows
        rows = int((h - 24) // 26)
        for r in range(rows):
            for cx in (x + w * 0.28, x + w * 0.72):
                yb = sy - 18 - r * 26
                wpts = [(cx - 5, yb), (cx - 5, yb - 10)] + [polar((cx, yb - 10), 5, t) for t in (210, 270, 330)] + [
                    (cx + 5, yb - 10), (cx + 5, yb)]
                soft(a, wpts, "slate", 0.3, jit=0.2)
                bl(a, wpts, FW * 1.1, 0.42, jit=0.2)
    # a shop awning and door on the right house
    aw = [(352, sy - 32), (402, sy - 32), (402, sy - 24), (356, sy - 22)]
    flat(a, aw, "clay", 0.35)
    a.lines([((362 + 10 * k, sy - 32), (362 + 10 * k, sy - 23)) for k in range(4)], MW * 1.3, "paper", 0.6, amp=0.1)
    bpoly(a, aw, FW * 1.3, 0.45)
    flat(a, rect(196, sy - 26, 14, 26), "slate", 0.3)
    bline(a, (-2, sy), (402, sy), MW, 0.45)
    flat(a, rect(-2, sy, 404, 80), "ochre", 0.16)
    cob = []
    for k, y in enumerate((sy + 12, sy + 26, sy + 44, sy + 64)):
        x = a.u(0, 20) + k * 9
        while x < 400:
            if a.rng.random() < 0.55 and not (x < 133 and y > 170):
                cob.append([(x, y), (x + 4, y + 2.4), (x + 9, y + 0.5)])
            x += a.u(18, 30)
    for c in cob:
        bl(a, c, FW, 0.24, jit=0.2)


@art_key("hist_bg_night_sky", 400, 225, BGK)
def hist_bg_night_sky(a):
    """A clear night sky full of stars and a crescent moon over dark low hills (open sky for planets and figures)."""
    bg_paper(a)
    flat(a, rect(-2, -2, 404, 230), "slate", 0.72)
    flat(a, [(-2, -2), (404, -2), (404, 54), (-2, 66)], "slate", 0.2)
    stars, small, crosses = [], [], []
    for _ in range(46):
        p = (a.u(6, 394), a.u(6, 160))
        if 300 < p[0] < 360 and 20 < p[1] < 76:
            continue
        (stars if a.rng.random() < 0.4 else small).append(p)
    for _ in range(7):
        crosses.append((a.u(20, 390), a.u(12, 130)))
    a.dots(stars, 3.2, "ochre", 0.95)
    a.dots(small, 2.0, "ochre", 0.75)
    segs = []
    for x, y in crosses:
        s = a.u(3.5, 5.5)
        segs += [((x - s, y), (x + s, y)), ((x, y - s), (x, y + s))]
    a.lines(segs, FW * 1.3, "ochre", 0.95, amp=0.1)
    moon = crescent((332, 44), 15, (339, 39), 13)
    soft(a, moon, "ochre", 0.95, jit=0.2)
    hill = wave_x(-10, 410, 182, [(-8, 70, 1.0), (3, 25, 0.3)])
    land(a, hill, "sage", 0.62)
    land(a, hill, "slate", 0.3)
    hill2 = wave_x(180, 410, 172, [(-10, 50, 0.2), (2, 14, 0.4)], 12)
    land(a, hill2, "sage", 0.5)
    land(a, hill2, "slate", 0.3)
    for x, s in ((342, 1.0), (360, 0.8), (376, 1.1)):
        y = 176 - 4 * s
        tree = ellipse((x, y - 10 * s), 7 * s, 11 * s, n=9)
        soft(a, tree, "sage", 0.7, jit=0.2)
        soft(a, tree, "slate", 0.35, jit=0.2)


# continents in rough (lon, lat): a hand-drawn world, a draft, not a survey map
WORLD = {
    "n_america": [(-165, 66), (-140, 70), (-115, 72), (-95, 72), (-80, 66), (-62, 58), (-58, 48), (-68, 44), (-75, 36),
                  (-81, 26), (-90, 29), (-97, 26), (-97, 19), (-88, 16), (-82, 9), (-78, 8), (-88, 13), (-100, 17),
                  (-106, 22), (-113, 30), (-118, 34), (-124, 41), (-125, 49), (-134, 57), (-150, 60), (-163, 58)],
    "greenland": [(-56, 80), (-28, 82), (-20, 72), (-40, 61), (-50, 66), (-56, 74)],
    "s_america": [(-79, 9), (-62, 10), (-50, 1), (-35, -6), (-40, -22), (-48, -27), (-57, -36), (-65, -42), (-68, -53),
                  (-74, -51), (-72, -36), (-70, -18), (-81, -5), (-80, 1)],
    "eurasia": [(-10, 36), (-9, 43), (-1, 46), (-4, 48), (2, 51), (8, 54), (6, 58), (11, 63), (20, 70), (32, 71), (45, 68),
                (60, 70), (80, 73), (100, 77), (120, 73), (140, 72), (160, 70), (178, 68), (178, 64), (165, 60),
                (157, 52), (142, 53), (140, 46), (130, 42), (126, 37), (121, 31), (119, 24), (109, 20), (108, 12),
                (104, 9), (100, 13), (101, 6), (103, 1), (99, 8), (97, 16), (92, 22), (87, 21), (80, 15), (77, 8),
                (72, 20), (67, 25), (58, 25), (59, 22), (52, 16), (44, 12), (43, 16), (38, 22), (35, 28), (34, 31),
                (36, 36), (28, 37), (26, 40), (22, 37), (19, 41), (14, 41), (16, 38), (12, 44), (8, 44), (3, 43)],
    "britain": [(-5, 50), (1, 51), (-1, 55), (-3, 58), (-6, 56)],
    "africa": [(-17, 21), (-17, 14), (-12, 7), (-5, 5), (5, 5), (9, 4), (10, -2), (12, -6), (13, -17), (18, -34),
               (25, -34), (32, -28), (35, -20), (40, -15), (40, -5), (43, 0), (51, 11), (43, 12), (37, 20), (33, 28),
               (30, 31), (20, 32), (10, 35), (0, 36), (-6, 35), (-10, 30)],
    "madagascar": [(44, -16), (50, -15), (47, -25), (44, -24)],
    "australia": [(114, -22), (122, -17), (130, -12), (137, -12), (142, -11), (146, -19), (153, -25), (150, -37),
                  (141, -38), (135, -34), (129, -31), (117, -35), (114, -28)],
    "sumatra": [(95, 5), (98, 4), (104, -2), (106, -6), (103, -5), (98, 0)],
    "java": [(106, -6), (114, -7), (114, -8.6), (106, -7.4)],
    "borneo": [(109, 1), (113, 3), (117, 7), (119, 4), (117, 0), (116, -4), (110, -3)],
    "sulawesi": [(119, 1), (125, 1), (121, -1), (123, -5), (120, -5), (119, -2)],
    "new_guinea": [(131, -1), (138, -2), (146, -5), (151, -10), (142, -9), (138, -8), (133, -4)],
    "japan": [(130, 31), (135, 34), (140, 36), (142, 41), (140, 41), (136, 36), (131, 34)],
    "philippines": [(120, 18), (123, 17), (126, 7), (122, 7), (121, 13)],
    "sri_lanka": [(80, 9.5), (82, 7), (80, 6)],
    "new_zealand": [(173, -35), (178, -38), (174, -42), (167, -46), (170, -44)],
}


def lonlat(lon, lat):
    return (14 + (lon + 180) / 360 * 372, 14 + (80 - lat) / 142 * 197)


@art_key("hist_bg_map_world", 400, 225, BGK)
def hist_bg_map_world(a):
    """An old world map on parchment: rough hand-drawn continents, a faint graticule, a small compass rose (no letters)."""
    bg_paper(a)
    flat(a, rect(-2, -2, 404, 230), "ochre", 0.2)
    frame = rect(7, 7, 386, 211)
    bpoly(a, frame, MW, 0.5)
    bpoly(a, rect(11, 11, 378, 203), FW, 0.35)
    grat = []
    for lon in range(-150, 181, 30):
        x = lonlat(lon, 0)[0]
        grat.append(((x, 12), (x, 213)))
    for lat in (60, 30, 0, -30):
        y = lonlat(0, lat)[1]
        grat.append(((12, y), (388, y)))
    a.lines(grat, FW, "slate", 0.25, amp=0.6)
    shapes = {k: [lonlat(*p) for p in v] for k, v in WORLD.items()}
    for k, pts in shapes.items():
        soft(a, pts, "sage", 0.4, jit=0.3)
    for k, pts in shapes.items():
        w = MW * 0.85 if len(pts) > 8 else FW * 1.2
        a.outline(pts, w, alpha=0.48, second=0, jit=0.3)

    def al(x, y):
        p = (x + 6, y)
        if any(inside(q, s) for s in shapes.values() for q in (p, (x, y), (x + 12, y), (x + 6, y - 6), (x + 6, y + 5))):
            return 0
        return 0.28

    wave_marks(a, [36, 62, 100, 132, 160, 190], 40, al, FW, 5)
    c = lonlat(75, -44)
    pts = [polar(c, 14 if i % 2 == 0 else 4, -90 + 45 * i) for i in range(8)]
    soft(a, pts, "clay", 0.4, jit=0.1)
    bl(a, pts + [pts[0]], FW * 1.2, 0.5, jit=0.1)
    a.ell_outline(c, 9, 9, w=FW, alpha=0.4, second=0)


@art_key("hist_bg_room_lamp", 400, 225, BGK)
def hist_bg_room_lamp(a):
    """A quiet room at night: a window with a crescent moon and open shutters, a wooden table whose top is a free
    surface (for the lamp and the letters); plain wall on the left."""
    bg_paper(a)
    flat(a, rect(-2, -2, 404, 230), "ochre", 0.2)
    flat(a, rect(-2, -2, 404, 14), "clay", 0.18)
    bline(a, (-2, 12), (402, 12), FW * 1.3, 0.38)
    fy = 198
    flat(a, rect(-2, fy, 404, 32), "clay", 0.16)
    bline(a, (-2, fy), (402, fy), FW * 1.4, 0.42)
    # window with a night sky
    wx, wy, ww, wh = 288, 30, 78, 76
    pane = rect(wx, wy, ww, wh)
    flat(a, pane, "slate", 0.62)
    moon = crescent((wx + 56, wy + 22), 9, (wx + 60, wy + 19), 8)
    soft(a, moon, "ochre", 0.9, jit=0.1)
    a.dots([(wx + 14, wy + 16), (wx + 30, wy + 34), (wx + 20, wy + 52), (wx + 64, wy + 54)], 2.0, "ochre", 0.9)
    flat(a, rect(wx - 18, wy, 16, wh), "clay", 0.36)
    flat(a, rect(wx + ww + 2, wy, 16, wh), "clay", 0.36)
    a.lines([((wx - 16, wy + 6 + 7 * k), (wx - 4, wy + 7 + 7 * k)) for k in range(10)]
            + [((wx + ww + 4, wy + 6 + 7 * k), (wx + ww + 16, wy + 7 + 7 * k)) for k in range(10)], FW, alpha=0.32,
            amp=0.1)
    bpoly(a, pane, MW, 0.55)
    a.lines([((wx + ww / 2, wy), (wx + ww / 2, wy + wh)), ((wx, wy + wh / 2), (wx + ww, wy + wh / 2))], MW * 0.9,
            "ochre", 0.7, amp=0.2)
    bline(a, (wx - 22, wy + wh + 2), (wx + ww + 22, wy + wh + 2), MW * 1.2, 0.5)
    cur = [(wx - 30, wy - 6), (wx - 18, wy - 6), (wx - 22, wy + 40), (wx - 14, wy + 86), (wx - 30, wy + 88)]
    soft(a, cur, "sage", 0.3, jit=0.2)
    bl(a, cur[1:4], FW * 1.2, 0.35)
    # table
    ty = 148
    top = [(146, ty), (404, ty), (404, ty + 8), (144, ty + 8)]
    flat(a, top, "clay", 0.48)
    flat(a, rect(150, ty + 8, 254, 14), "clay", 0.3)
    for x in (158, 386):
        flat(a, rect(x, ty + 22, 8, fy + 14 - ty - 22), "clay", 0.36, jit=0.2)
        bpoly(a, rect(x, ty + 22, 8, fy + 14 - ty - 22), FW * 1.2, 0.45, closed=False)
    bline(a, (144, ty), (404, ty), MW, 0.55)
    bline(a, (146, ty + 8), (404, ty + 8), FW * 1.2, 0.42)
    bline(a, (150, ty + 22), (404, ty + 22), FW * 1.2, 0.4)


# ============================================================================================= silhouettes
#
# One side-view figure builder for every hist_sil_* key: flat ink, no facial features (the head is a plain profile
# shape), clothing told by the outline plus a few fine paper-coloured inner lines, and at most one colour plate (a held
# object or a cloth detail). Angles are degrees from straight down, positive = forward (the way the figure faces).

ADULT = dict(torso=0.31, hcd=0.105, hrx=0.061, hry=0.069, th=0.245, sh=0.245, ank=0.035, ua=0.165, fa=0.15, sjd=0.04,
             neck=0.026, arm0=0.028, arm1=0.02, leg0=0.041, leg1=0.026, hand=0.023, foot=0.066, nose=1.12,
             tor=[(1.0, -0.035), (0.93, -0.06), (0.75, -0.066), (0.5, -0.052), (0.2, -0.066), (-0.06, -0.06),
                  (-0.06, 0.052), (0.25, 0.056), (0.5, 0.052), (0.72, 0.073), (0.9, 0.06), (1.0, 0.033)])
KID = dict(torso=0.3, hcd=0.125, hrx=0.074, hry=0.084, th=0.2, sh=0.2, ank=0.04, ua=0.15, fa=0.14, sjd=0.045,
           neck=0.03, arm0=0.03, arm1=0.022, leg0=0.042, leg1=0.03, hand=0.026, foot=0.075, nose=1.07,
           tor=[(1.0, -0.044), (0.9, -0.068), (0.5, -0.065), (0.15, -0.072), (-0.06, -0.065), (-0.06, 0.065),
                (0.3, 0.074), (0.6, 0.07), (0.9, 0.062), (1.0, 0.04)])
# a plain head in profile, facing +x, in units of (rx, ry): round skull, a soft brow and nose bump, no features
HEAD_PROFILE = [(-0.98, 0.05), (-0.92, -0.45), (-0.6, -0.86), (-0.05, -1.0), (0.48, -0.88), (0.84, -0.52), (0.95, -0.14),
                (1.12, 0.1), (1.0, 0.25), (1.0, 0.42), (0.88, 0.62), (0.6, 0.86), (0.22, 0.95), (-0.28, 0.86),
                (-0.72, 0.6)]
SIL_GY = 236  # ground line of every silhouette (feet on the bottom edge)
ADULT_H, KID_H = 218, 158


def ink(a, pts, alpha=1.0):
    a.fill_smooth(pts, "ink", alpha, off=(0, 0), jit=0.3)


def inkp(a, pts, alpha=1.0):
    a.fill_poly(pts, "ink", alpha, off=(0, 0), jit=0.3, step=40)


def pline(a, pts, w=FW * 1.3, alpha=0.7):
    """A fine inner clothing line, in paper colour on the ink."""
    a.curve(pts, w, "paper", alpha, jit=0.25)


class Sil:
    """Joints of one side-view figure. arms / legs: (near, far), each (upper, lower) angles or ("ik", point, bend)."""

    def __init__(self, a, cx, kid=False, H=None, lean=0.0, facing=1, arms=((6, 14), (-8, -2)), legs=((4, 1), (-5, -3)),
                 gy=SIL_GY, hip=None, nod=0.0):
        P = self.P = KID if kid else ADULT
        self.a, self.kid, self.facing = a, kid, facing
        H = self.H = H or (KID_H if kid else ADULT_H)
        self.gy = gy

        def u(t):
            return (facing * math.sin(math.radians(t)), math.cos(math.radians(t)))

        self.u = u
        lk = []
        for s in legs:
            k = mul(u(s[0]), P["th"] * H)
            lk.append((k, add(k, mul(u(s[1]), P["sh"] * H))))
        if hip is None:
            low = max(an[1] for _, an in lk)
            hip = (cx, gy - P["ank"] * H - low)
        self.hip = hip
        self.kn = [add(hip, k) for k, _ in lk]
        self.an = [add(hip, an) for _, an in lk]
        self.leg_specs = legs
        self.axis = rotp((0, -1), lean * facing)
        self.fw = mul(perp(self.axis), facing)  # forward, across the body
        self.sh = add(hip, mul(self.axis, P["torso"] * H))
        self.sj = add(self.sh, add(mul(self.axis, -P["sjd"] * H), mul(self.fw, -0.004 * H)))
        hax = rotp(self.axis, nod * facing)
        self.hc = add(self.sh, add(mul(hax, P["hcd"] * H), mul(self.fw, 0.012 * H)))
        self.nod = nod
        self.el, self.hd = [], []
        for s in arms:
            if s[0] == "ik":
                e, h = ik2(self.sj, s[1], P["ua"] * H, P["fa"] * H, s[2] * facing)
            else:
                e = add(self.sj, mul(u(s[0]), P["ua"] * H))
                h = add(e, mul(u(s[1]), P["fa"] * H))
            self.el.append(e)
            self.hd.append(h)

    def reach(self, i, target, bend=1):
        """Re-pose arm i so its hand reaches target (a two-bone reach; bend picks the elbow side)."""
        P, H = self.P, self.H
        self.el[i], self.hd[i] = ik2(self.sj, target, P["ua"] * H, P["fa"] * H, bend * self.facing)

    def T(self, t, f):
        """A point in the torso frame: t along hip (0) -> shoulder (1), f forward in units of H."""
        return add(add(self.hip, mul(self.axis, t * self.P["torso"] * self.H)), mul(self.fw, f * self.H))

    def Hd(self, x, y):
        """A point in the head frame (units of the head radii), x forward."""
        P = self.P
        p = (self.facing * x * P["hrx"] * self.H, y * P["hry"] * self.H)
        return add(self.hc, rotp(p, self.nod * self.facing))

    # ---- body parts (all ink)
    def torso(self, extra=0.0):
        pts = [self.T(t, f * (1 + extra)) for t, f in self.P["tor"]]
        ink(self.a, pts)

    def head(self, nose=True):
        P = self.P
        prof = [(x if (x < 0.96 or nose) else 0.96, y) for x, y in HEAD_PROFILE]
        prof = [(x * (P["nose"] / 1.12) if x > 1 else x, y) for x, y in prof]
        ink(self.a, [self.Hd(x, y) for x, y in prof])
        nb = self.Hd(-0.15, 0.8)
        ink(self.a, capsule(self.sh, nb, P["neck"] * self.H * 1.15, P["neck"] * self.H))

    def arm(self, i, sleeve=1.0, hand=True):
        P, H = self.P, self.H
        s, e, h = self.sj, self.el[i], self.hd[i]
        ink(self.a, capsule(s, e, P["arm0"] * H * sleeve, P["arm0"] * H * 0.85 * sleeve, n=4))
        ink(self.a, capsule(e, lerp(e, h, 0.92), P["arm0"] * H * 0.82 * sleeve, P["arm1"] * H * sleeve, n=4))
        if hand:
            self.a.fill_smooth(ellipse(h, P["hand"] * H, P["hand"] * H * 1.15, angle_of(e, h), n=8), "ink", off=(0, 0),
                               jit=0.2)

    def leg(self, i, r0=1.0, r1=1.0, foot=True):
        P, H = self.P, self.H
        hp = add(self.hip, mul(self.fw, (0.008 if i == 0 else -0.008) * H))
        k, an = self.kn[i], self.an[i]
        ink(self.a, capsule(hp, k, P["leg0"] * H * r0, P["leg0"] * H * 0.76 * r0, n=4))
        ink(self.a, capsule(k, an, P["leg0"] * H * 0.74 * r1, P["leg1"] * H * r1, n=4))
        if foot:
            self.foot(i)

    def foot(self, i, size=1.0):
        P, H = self.P, self.H
        an = self.an[i]
        sh_ang = self.leg_specs[i][1] if self.leg_specs[i][0] != "ik" else 0
        rot = max(0.0, -sh_ang - 12) * 0.9 * self.facing
        f = self.facing
        L = P["foot"] * H * size
        loc = [(-0.025 * H, -0.012 * H), (0.018 * H, -0.01 * H), (L * 0.75, 0.012 * H), (L, 0.024 * H),
               (L * 0.95, 0.032 * H), (-0.028 * H, 0.032 * H)]
        pts = [add(an, rotp((f * x, y), rot)) for x, y in loc]
        inkp(self.a, pts)

    def hem_pts(self, y, back=0.06, front=0.07):
        xs = [p[0] for p in self.an]
        if self.facing > 0:
            return (min(xs) - back * self.H, y), (max(xs) + front * self.H, y)
        return (max(xs) + back * self.H, y), (min(xs) - front * self.H, y)

    def skirt(self, top_t=0.4, hem=None, back=0.06, front=0.07, depth=0.05, belly=0.0):
        """A long skirt or robe hanging from top_t to the hem (default: just above the ground)."""
        hem = self.gy - 0.01 * self.H if hem is None else hem
        hb, hf = self.hem_pts(hem, back, front)
        mid = lerp(hb, hf, 0.5)
        pts = [self.T(top_t, -depth), self.T(0.0, -depth - 0.012), hb, add(mid, (0, 0.006 * self.H)), hf,
               self.T(0.0, depth + 0.014 + belly), self.T(top_t, depth)]
        inkp(self.a, pts)
        return hb, hf

    def eye_point(self, dx=0.0, dy=0.0):
        return self.Hd(1.0 + dx, -0.15 + dy)


def head_extra(s, kind, color=None):
    """Hair and headwear outlines (ink) for a Sil."""
    a = s.a
    if kind == "bun_high":
        ink(a, ellipse(s.Hd(-0.55, -0.9), s.P["hrx"] * s.H * 0.48, s.P["hry"] * s.H * 0.36, n=10))
    elif kind == "sanggul":
        ink(a, ellipse(s.Hd(-1.05, 0.38), s.P["hrx"] * s.H * 0.55, s.P["hry"] * s.H * 0.42, n=10))
    elif kind == "ponytail":
        ink(a, ribbon([s.Hd(-0.7, -0.62), s.Hd(-1.45, -0.35), s.Hd(-1.62, 0.25), s.Hd(-1.45, 0.75)], s.H * 0.05,
                      s.H * 0.016))
        ink(a, ellipse(s.Hd(-0.82, -0.6), s.P["hrx"] * s.H * 0.3, s.P["hry"] * s.H * 0.26, n=8))
    elif kind == "turban":
        ink(a, ellipse(s.Hd(-0.06, -0.62), s.P["hrx"] * s.H * 1.2, s.P["hry"] * s.H * 0.72, s.nod * s.facing, n=14))
        ink(a, ellipse(s.Hd(-0.15, -1.18), s.P["hrx"] * s.H * 0.55, s.P["hry"] * s.H * 0.35, n=10))
    elif kind == "headwrap":
        ink(a, ellipse(s.Hd(-0.1, -0.55), s.P["hrx"] * s.H * 1.12, s.P["hry"] * s.H * 0.62, s.nod * s.facing, n=12))
        ink(a, ribbon([s.Hd(-0.95, -0.3), s.Hd(-1.35, 0.4), s.Hd(-1.25, 1.3), s.Hd(-1.4, 2.1)], s.H * 0.045,
                      s.H * 0.03))
    elif kind == "headscarf":
        pts = [s.Hd(0.62, -0.98), s.Hd(0.1, -1.14), s.Hd(-0.6, -1.0), s.Hd(-1.12, -0.4), s.Hd(-1.25, 0.5),
               s.T(0.8, -0.075), s.T(0.62, -0.07), s.T(0.66, 0.0), s.T(0.82, 0.07), s.Hd(0.6, 1.25), s.Hd(0.8, 0.9),
               s.Hd(0.86, 0.3), s.Hd(0.86, -0.5)]
        ink(a, pts)
    elif kind == "beard":
        ink(a, [s.Hd(0.86, 0.42), s.Hd(0.98, 0.7), s.Hd(0.72, 1.18), s.Hd(0.3, 1.25), s.Hd(-0.05, 1.0),
                s.Hd(0.1, 0.6)])


def hair_line(s, kind="short"):
    """A paper line marking where hair or cloth meets the plain head (not a facial feature)."""
    if kind == "short":
        pline(s.a, [s.Hd(0.66, -0.72), s.Hd(0.2, -0.62), s.Hd(-0.2, -0.3), s.Hd(-0.35, 0.25), s.Hd(-0.62, 0.55)], FW * 1.2,
              0.5)
    elif kind == "back_hair":
        pline(s.a, [s.Hd(0.7, -0.7), s.Hd(0.15, -0.58), s.Hd(-0.25, -0.2), s.Hd(-0.3, 0.3), s.Hd(-0.55, 0.62)], FW * 1.2,
              0.5)


def draw_flask(a, c, s=1.0, liquid="sage", tilt=0.0):
    """A small round-bottomed glass flask with a coloured liquid (held props on silhouettes, the lab flask)."""
    T = Tf(c, s, tilt)
    neck = T.pts([(-3.2, -30), (3.2, -30), (3.4, -12), (-3.4, -12)])
    bulb = T.pts(ellipse((0, 0), 14, 13.5, n=12))
    a.fill_smooth(bulb, "paper", 0.92, off=(0, 0), jit=0.1)
    a.fill_poly(neck, "paper", 0.92, off=(0, 0), jit=0.1)
    liq = T.pts([(-13.2, 2), (13.2, 2), (11, 8), (0, 13.4), (-11, 8)])
    a.fill_smooth(liq, liquid, 0.95, jit=0.1)
    a.ell_outline(T((0, 0)), 14 * s, 13.5 * s, w=MW * 1.1, second=0, wob=0.02)
    a.lines([(T((-3.2, -30)), T((-3.4, -12.5))), (T((3.2, -30)), T((3.4, -12.5)))], MW * 1.1, amp=0.2)
    a.line(T((-5, -31)), T((5, -31)), MW * 1.2, amp=0.1)
    a.curve(T.pts([(-8, -6), (-10, 0), (-8, 5)]), FW, "paper", 0.9, jit=0.1)


def draw_fanoos(a, top, s=1.0, handle=True):
    """Nightingale's lamp: a Turkish folding lantern (fanoos), a pleated cylinder between metal caps, candle-lit."""
    T = Tf(top, s)
    if handle:
        a.curve(T.pts([(-7, 8), (-6, -2), (0, -6), (6, -2), (7, 8)]), MW * 1.2, jit=0.1)
    cap = T.pts([(-10, 8), (10, 8), (12, 14), (-12, 14)])
    body = T.pts([(-13, 14), (13, 14), (14, 30), (13.5, 46), (-13.5, 46), (-14, 30)])
    base = T.pts([(-12, 46), (12, 46), (10, 53), (-10, 53)])
    a.fill_smooth(body, "paper", 0.95, off=(0, 0), jit=0.1)
    a.fill_smooth(T.pts(ellipse((0, 32), 8, 11, n=10)), "ochre", 0.75, jit=0.1)
    a.fill_smooth(T.pts([(0, 22), (3, 30), (0, 36), (-3, 30)]), "clay", 0.8, jit=0.05)
    a.lines([(T((-13.5, y)), T((13.5, y))) for y in (19, 24, 29, 34, 39, 43)], FW, alpha=0.55, amp=0.1)
    a.outline(body, MW * 1.1, second=0, jit=0.15)
    for p in (cap, base):
        a.fill_poly(p, "slate", 0.95, jit=0.1)
        a.outline_poly(p, MW, second=0, over=1.0, gap=0.8)


def held_book(a, c, s=1.0, rot=0.0, open_=True, col="clay"):
    """A small book held by a silhouette: open (paper pages over a coloured cover) or closed."""
    T = Tf(c, s, rot)
    if open_:
        cover = T.pts([(-24, -3), (0, -8), (24, -3), (25, 4), (0, 0), (-25, 4)])
        a.fill_poly(cover, col, 0.95, jit=0.1)
        for sd in (-1, 1):
            pg = T.pts([(0, -7), (sd * 10, -11), (sd * 22, -9), (sd * 23, 1), (sd * 10, -2), (0, 1)])
            a.fill_poly(pg, "paper", off=(0, 0), jit=0.1)
            a.outline_poly(pg, FW * 1.3, second=0, over=0.8, gap=0.8)
        a.outline_poly(cover, MW, second=0, over=0.8, gap=0.6)
    else:
        bk = T.pts([(-9, -14), (9, -14), (9, 14), (-9, 14)])
        a.fill_poly(bk, col, 0.95, jit=0.1)
        a.outline_poly(bk, MW, second=0, over=1.0, gap=0.8)
        a.line(T((-6, -14)), T((-6, 14)), FW * 1.2, "paper", 0.7, amp=0.1)


# ---- the twelve silhouettes (240 x 240; facing right, feet on y = 236)


@art_key("hist_sil_man", 240, 240)
def hist_sil_man(a):
    """A man standing in profile: hip-length jacket, trousers, short hair."""
    s = Sil(a, 112, lean=1.5, arms=((4, 10), (-10, -4)), legs=((5, 1), (-5, -2)))
    for i in (0, 1):
        s.leg(i, 1.15, 1.12)
    ink(a, [s.T(1.0, -0.038), s.T(0.8, -0.074), s.T(0.3, -0.07), s.T(-0.2, -0.074), s.T(-0.22, 0.072), s.T(0.3, 0.066),
            s.T(0.72, 0.08), s.T(1.0, 0.036)])
    s.arm(1, 1.25)
    s.head()
    s.arm(0, 1.25)
    hair_line(s)
    pline(a, [s.T(0.98, 0.034), s.T(0.82, 0.062), s.T(0.55, 0.06), s.T(0.1, 0.058), s.T(-0.2, 0.068)])
    pline(a, [s.T(-0.21, -0.058), s.T(-0.22, 0.0), s.T(-0.21, 0.058)], FW * 1.2, 0.55)
    pline(a, [s.T(0.96, 0.0), s.T(0.82, 0.03), s.T(0.7, 0.05)], FW * 1.2, 0.6)
    pline(a, [lerp(s.el[0], s.hd[0], 0.62), add(lerp(s.el[0], s.hd[0], 0.62), mul(s.fw, 8))], FW * 1.2, 0.6)
    pline(a, [s.T(0.25, 0.01), s.T(0.25, 0.035)], MW, 0.55)


@art_key("hist_sil_woman", 240, 240)
def hist_sil_woman(a):
    """A woman of about 1900 in profile: high-necked blouse, long full skirt, hair in a high bun, hands together."""
    s = Sil(a, 110, lean=1.0, arms=((4, 40), (2, 44)), legs=((4, 0), (-4, -2)))
    for i in (0, 1):
        s.foot(i)
    s.skirt(0.42, back=0.09, front=0.075, depth=0.06, belly=0.012)
    s.arm(1, 1.2)
    s.torso()
    s.head()
    head_extra(s, "bun_high")
    s.arm(0, 1.25)
    hair_line(s, "back_hair")
    pline(a, [s.T(0.42, -0.06), s.T(0.42, 0.06)], MW, 0.55)
    for f, y0 in ((0.01, 0.5), (0.05, 0.62)):
        pline(a, [add(s.T(0.0, f), (0, 6)), (s.T(0.0, f)[0] + s.facing * (y0 * 14), s.gy - 12)], FW * 1.2, 0.5)
    pline(a, [s.Hd(0.25, 0.92), s.Hd(0.0, 1.35), s.T(1.0, 0.0)], FW * 1.2, 0.5)


def kebaya_woman(a, s, hands="together"):
    """A woman in kebaya and kain with a sanggul (Kartini's era), drawn on a Sil whose skirt is the kain."""
    for i in (0, 1):
        s.foot(i, 0.9)
    hb, hf = s.skirt(0.36, back=0.035, front=0.04, depth=0.052, belly=0.0)
    s.arm(1, 1.12)
    # kebaya panjang: a long blouse to mid-thigh, its front panel falling a little lower
    keb = [s.T(1.0, -0.034), s.T(0.8, -0.058), s.T(0.3, -0.058), s.T(-0.4, -0.066), s.T(-0.52, 0.0),
           s.T(-0.62, 0.064), s.T(0.3, 0.06), s.T(0.72, 0.066), s.T(1.0, 0.03)]
    ink(a, keb)
    s.head()
    head_extra(s, "sanggul")
    s.arm(0, 1.12)
    # batik dots on the kain, below the kebaya
    pts = []
    y = s.T(-0.6, 0)[1] + 10
    while y < s.gy - 10:
        span0, span1 = lerp(s.T(-0.4, -0.05), hb, (y - s.T(-0.4, 0)[1]) / max(1, hb[1] - s.T(-0.4, 0)[1])), \
            lerp(s.T(-0.4, 0.05), hf, (y - s.T(-0.4, 0)[1]) / max(1, hf[1] - s.T(-0.4, 0)[1]))
        x0, x1 = sorted((span0[0], span1[0]))
        x = x0 + 5 + (int(y) % 2) * 3
        while x < x1 - 4:
            pts.append((x + a.j(0.8), y + a.j(0.8)))
            x += 7.5
        y += 8
    a.dots(pts, 2.2, "ochre", 0.85)
    # kebaya front edge, hem, cuffs; the wiru pleats of the kain at the front
    pline(a, [s.T(0.98, 0.028), s.T(0.82, 0.04), s.T(0.5, 0.03), s.T(-0.1, 0.02), s.T(-0.6, 0.06)], FW * 1.3, 0.7)
    pline(a, [s.T(-0.4, -0.064), s.T(-0.5, -0.01), s.T(-0.6, 0.06)], FW * 1.2, 0.6)
    wx = hf[0] - s.facing * 4
    for k in range(3):
        x = wx - s.facing * k * 3.2
        pline(a, [(x - s.facing * 2, s.T(-0.75, 0)[1] + k * 6), (x, s.gy - 8)], FW * 1.1, 0.6)
    pline(a, [s.Hd(-1.35, 0.25), s.Hd(-1.05, 0.0), s.Hd(-0.75, 0.3)], FW * 1.1, 0.55)
    hair_line(s, "back_hair")
    return hb, hf


@art_key("hist_sil_woman_kebaya", 240, 240)
def hist_sil_woman_kebaya(a):
    """A woman in a long kebaya and batik kain, hair in a low sanggul, hands folded in front (Kartini's era)."""
    s = Sil(a, 112, lean=0.5, arms=((4, 40), (2, 44)), legs=((2, 0), (-2, -1)))
    kebaya_woman(a, s)


@art_key("hist_sil_woman_headscarf", 240, 240)
def hist_sil_woman_headscarf(a):
    """A woman standing tall in a long dress and a headscarf over head and shoulders, one hand open forward
    (leadership and care: Cut Nyak Dhien, Fatima al-Fihri)."""
    s = Sil(a, 104, lean=-1.0, arms=((38, 72), (-6, 2)), legs=((4, 0), (-6, -3)))
    for i in (0, 1):
        s.foot(i)
    s.skirt(0.45, back=0.075, front=0.065, depth=0.058)
    s.arm(1, 1.25)
    ink(a, [s.T(1.0, -0.035), s.T(0.7, -0.062), s.T(-0.6, -0.074), s.T(-0.66, 0.072), s.T(0.3, 0.062), s.T(0.72, 0.068),
            s.T(1.0, 0.03)])
    s.head()
    head_extra(s, "headscarf")
    s.arm(0, 1.3)
    a.fill_smooth([s.Hd(0.1, -1.12), s.Hd(-0.6, -0.98), s.Hd(-1.12, -0.4), s.Hd(-1.25, 0.5), s.T(0.8, -0.075),
                   s.T(0.62, -0.07), s.T(0.66, 0.0), s.T(0.82, 0.07), s.Hd(0.6, 1.25), s.Hd(0.2, 0.6), s.Hd(0.2, -0.6)],
                  "sage", 0.4, jit=0.3)
    pline(a, [s.Hd(0.6, -0.95), s.Hd(0.25, -0.55), s.Hd(0.18, 0.1), s.Hd(0.3, 0.75), s.Hd(0.62, 1.2)], FW * 1.3, 0.7)
    pline(a, [s.T(-0.62, -0.07), s.T(-0.64, 0.0), s.T(-0.66, 0.07)], FW * 1.2, 0.6)
    pline(a, [lerp(s.el[0], s.hd[0], 0.75), add(lerp(s.el[0], s.hd[0], 0.75), rotp(mul(s.fw, 7), -60 * s.facing))],
          FW * 1.2, 0.6)


@art_key("hist_sil_boy", 240, 240)
def hist_sil_boy(a):
    """A boy of about eight in profile, shirt and shorts, one hand raised high (asking a question)."""
    s = Sil(a, 112, kid=True, lean=-1.0, arms=((146, 172), (-6, 4)), legs=((6, 1), (-5, -2)))
    for i in (0, 1):
        s.leg(i, 0.9, 0.85)
    shorts = [s.T(0.1, -0.07), add(s.T(-0.05, -0.07), (0, 2)), add(lerp(s.hip, s.kn[1], 0.62), mul(s.fw, -0.05 * s.H)),
              add(lerp(s.hip, s.kn[1], 0.62), mul(s.fw, 0.02 * s.H)), s.T(-0.3, 0.0),
              add(lerp(s.hip, s.kn[0], 0.62), mul(s.fw, -0.02 * s.H)), add(lerp(s.hip, s.kn[0], 0.62), mul(s.fw, 0.05 * s.H)),
              s.T(0.1, 0.072)]
    inkp(a, shorts)
    s.arm(1, 1.0)
    s.torso(0.08)
    s.head()
    s.arm(0, 1.0)
    for p0, p1 in ((s.sj, s.el[1]), (s.sj, s.el[0])):
        ink(a, capsule(p0, lerp(p0, p1, 0.5), s.P["arm0"] * s.H * 1.35, s.P["arm0"] * s.H * 1.2, n=4))
    hair_line(s)
    pline(a, [s.T(0.02, -0.066), s.T(0.0, 0.0), s.T(0.02, 0.07)], FW * 1.3, 0.65)

    pline(a, [s.T(0.98, 0.03), s.T(0.9, 0.0), s.T(0.98, -0.03)], FW * 1.2, 0.6)
    e = s.el[0]
    pline(a, [lerp(s.sj, e, 0.5), add(lerp(s.sj, e, 0.5), mul(s.fw, 5))], FW * 1.2, 0.6)


@art_key("hist_sil_girl", 240, 240)
def hist_sil_girl(a):
    """A girl of about eight in profile, knee-length dress, ponytail, a book held to her chest."""
    s = Sil(a, 114, kid=True, lean=-1.0, arms=((10, 60), (-6, 4)), legs=((3, 0), (-4, -1)))
    s.reach(0, s.T(0.72, 0.1), -1)
    for i in (0, 1):
        s.leg(i, 0.85, 0.85)
    hem_y = (s.kn[0][1] + s.kn[1][1]) / 2 + 3
    xs = sorted(p[0] for p in s.kn)
    inkp(a, [s.T(0.32, -0.064), s.T(0.0, -0.08), (xs[0] - 15, hem_y), ((xs[0] + xs[1]) / 2, hem_y + 2), (xs[1] + 15, hem_y),
             s.T(0.0, 0.08), s.T(0.32, 0.066)])
    s.arm(1, 1.0)
    s.torso(0.06)
    s.head()
    head_extra(s, "ponytail")
    held_book(a, s.T(0.68, 0.12), 0.75, -84 * s.facing, open_=False, col="clay")
    s.arm(0, 1.0)
    ink(a, capsule(s.sj, lerp(s.sj, s.el[0], 0.45), s.P["arm0"] * s.H * 1.35, s.P["arm0"] * s.H * 1.2, n=4))
    hair_line(s, "back_hair")
    pline(a, [s.T(0.32, -0.064), s.T(0.3, 0.0), s.T(0.32, 0.066)], FW * 1.3, 0.6)
    pline(a, [s.T(0.98, 0.035), s.T(0.9, 0.0), s.T(0.98, -0.035)], FW * 1.2, 0.6)
    pline(a, [lerp(s.T(0.0, 0.03), (xs[1] + 10, hem_y), 0.3), lerp(s.T(0.0, 0.03), (xs[1] + 10, hem_y), 0.9)], FW * 1.1,
          0.5)


def seated_kid(a, cx, gy, facing=1, hair="short", scarf=False, H=KID_H):
    """A child sitting cross-legged on the floor in profile (for the class), hands on the knees."""
    s = Sil(a, cx, kid=True, H=H, facing=facing, lean=-2.0, legs=((84, -96), (80, -100)), arms=((14, 74), (8, 80)),
            gy=gy, hip=(cx, gy - 0.07 * H))
    for i in (0, 1):
        ink(a, capsule(s.hip, s.kn[i], s.P["leg0"] * H, s.P["leg0"] * H * 0.8, n=4))
        ink(a, capsule(s.kn[i], add(s.hip, mul(s.fw, 0.02 * H)), s.P["leg0"] * H * 0.75, s.P["leg1"] * H, n=4))
    s.arm(1)
    s.torso(0.06)
    s.head()
    if scarf:
        head_extra(s, "headscarf")
    elif hair == "ponytail":
        head_extra(s, "ponytail")
    s.arm(0)
    return s


@art_key("hist_sil_teacher_class", 320, 240)
def hist_sil_teacher_class(a):
    """A teacher in kebaya (right, facing left) holding an open book, three children sitting on the floor listening."""
    t = Sil(a, 262, facing=-1, lean=2.5, arms=((34, 64), (16, 96)), legs=((2, 0), (-2, -1)))
    t.reach(1, t.T(0.5, 0.14), 1)
    kebaya_woman(a, t)
    held_book(a, add(t.T(0.52, 0.17), (0, -2)), 0.85, 18, open_=True, col="sage")
    for x, hair, scarf, h in ((40, "short", False, 150), (104, "ponytail", False, 146), (166, "short", True, 152)):
        seated_kid(a, x, SIL_GY, 1, hair, scarf, h)
    for x in (40, 104, 166):
        pass


@art_key("hist_sil_sailor", 240, 240)
def hist_sil_sailor(a):
    """A sailor looking out to sea, one hand shading the eyes, a coil of rope in the other; loose tunic and rolled
    trousers, barefoot, a cloth headband (Zheng He's and Nusantara voyages alike)."""
    s = Sil(a, 104, lean=4.0, arms=((10, 20), (-4, 12)), legs=((12, 4), (-12, -7)))
    s.reach(0, s.Hd(1.3, -0.5), 1)
    for i in (0, 1):
        k, an = s.kn[i], s.an[i]
        hp = add(s.hip, mul(s.fw, (0.01 if i == 0 else -0.01) * s.H))
        ink(a, capsule(hp, k, s.P["leg0"] * s.H * 1.3, s.P["leg0"] * s.H * 1.05, n=4))
        roll = lerp(k, an, 0.42)
        ink(a, capsule(k, roll, s.P["leg0"] * s.H * 1.05, s.P["leg0"] * s.H * 1.15, n=4))
        ink(a, capsule(roll, an, s.P["leg0"] * s.H * 0.6, s.P["leg1"] * s.H * 0.95, n=4))
        s.foot(i, 0.95)
    s.arm(1, 1.3)
    ink(a, [s.T(1.0, -0.035), s.T(0.75, -0.064), s.T(0.2, -0.066), s.T(-0.3, -0.07), s.T(-0.3, 0.068), s.T(0.3, 0.062),
            s.T(0.72, 0.07), s.T(1.0, 0.03)])
    s.head()
    s.arm(0, 1.3)
    # headband with a knot and two short tails (the one colour plate)
    band = [s.Hd(0.86, -0.5), s.Hd(0.1, -0.66), s.Hd(-0.98, -0.38), s.Hd(-0.98, -0.12), s.Hd(0.1, -0.4),
            s.Hd(0.88, -0.25)]
    a.fill_smooth(band, "clay", 0.95, jit=0.2)
    for tail in ([s.Hd(-0.95, -0.3), s.Hd(-1.5, -0.2), s.Hd(-1.9, 0.1)], [s.Hd(-0.95, -0.25), s.Hd(-1.4, 0.2),
                                                                          s.Hd(-1.62, 0.62)]):
        a.fill_smooth(ribbon(tail, 4.5, 1.6), "clay", 0.95, jit=0.2)
    # coil of rope held in the far hand
    c = add(s.hd[1], (s.facing * 4, 12))
    for k, (rx, ry) in enumerate(((15, 19), (12.5, 16.5), (10, 14))):
        a.stroke(a.ell_path(add(c, (s.facing * k * 1.6, k * 0.8)), rx, ry, wob=0.04), 3.0 + 0.2 * k, "ochre", 0.95)
    a.ell_outline(c, 16.5, 20.5, w=FW * 1.2, second=0)
    a.curve([add(c, (s.facing * 5, 18)), add(c, (s.facing * 10, 30)), add(c, (s.facing * 4, 40))], 3.0, "ochre", 0.95)
    pline(a, [s.T(-0.29, -0.066), s.T(-0.3, 0.0), s.T(-0.29, 0.066)], FW * 1.3, 0.6)
    pline(a, [s.T(0.0, -0.066), s.T(0.02, 0.0), s.T(0.0, 0.066)], MW * 0.9, 0.55)
    for i in (0, 1):
        r = lerp(s.kn[i], s.an[i], 0.42)
        pline(a, [add(r, mul(s.fw, -6)), add(r, mul(s.fw, 6))], FW * 1.2, 0.55)


@art_key("hist_sil_scholar", 240, 240)
def hist_sil_scholar(a):
    """A medieval scholar in a long robe and cloak, turban and short beard, reading an open book held at the chest
    (Al-Khwarizmi, Ibn Sina, Ibn al-Haytham)."""
    s = Sil(a, 104, lean=3.0, nod=10, arms=((20, 80), (16, 84)), legs=((3, 0), (-4, -2)))
    book = s.T(0.5, 0.15)
    s.reach(0, add(book, mul(s.fw, -6)), 1)
    s.reach(1, add(book, mul(s.fw, 8)), 1)
    for i in (0, 1):
        s.foot(i, 0.95)
    hb, hf = s.skirt(0.8, back=0.085, front=0.075, depth=0.07, belly=0.01)
    s.arm(1, 1.4)
    s.torso(0.2)
    s.head()
    head_extra(s, "turban")
    head_extra(s, "beard")
    held_book(a, add(book, (0, -2)), 0.8, 14 * s.facing, open_=True, col="clay")
    s.arm(0, 1.45)
    # the sash (one colour plate), the cloak's front edge, turban wraps
    sash = [s.T(0.36, -0.07), s.T(0.36, 0.072), s.T(0.27, 0.074), s.T(0.27, -0.072)]
    a.fill_poly(sash, "ochre", 0.9, jit=0.2)
    pline(a, [s.T(0.98, 0.04), s.T(0.6, 0.075), s.T(0.0, 0.08), (hf[0] - s.facing * 12, hf[1] - 4)], FW * 1.3, 0.7)
    pline(a, [s.T(0.2, -0.06), lerp(s.T(0.0, -0.08), hb, 0.6), (hb[0] + s.facing * 14, hb[1] - 3)], FW * 1.2, 0.5)
    for y in (-0.82, -0.55, -0.3):
        pline(a, [s.Hd(1.05, y + 0.12), s.Hd(0.0, y - 0.1), s.Hd(-1.05, y + 0.1)], FW * 1.2, 0.6)


@art_key("hist_sil_traveler", 240, 240)
def hist_sil_traveler(a):
    """A traveller walking with a staff: knee-length tunic over trousers, a cloak, a head-wrap with a tail and a bag at
    the hip (Ibn Battuta)."""
    s = Sil(a, 108, lean=5.0, arms=((24, 40), (-26, -14)), legs=((26, 6), (-20, -36)))
    staff_top = add(s.hd[0], (s.facing * 4, -46))
    staff_bot = (s.hd[0][0] + s.facing * 26, s.gy - 1)
    a.line(staff_top, staff_bot, 4.2, amp=0.6)
    for i in (1, 0):
        s.leg(i, 1.15, 1.1)
    s.arm(1, 1.3)
    tun = [s.T(1.0, -0.035), s.T(0.7, -0.062), s.T(0.1, -0.066), add(s.kn[1], mul(s.fw, -0.03 * s.H)),
           add(lerp(s.kn[0], s.kn[1], 0.5), (0, 0.04 * s.H)), add(s.kn[0], mul(s.fw, 0.04 * s.H)), s.T(0.1, 0.07),
           s.T(0.7, 0.07), s.T(1.0, 0.03)]
    inkp(a, tun)
    cloak = [s.T(1.0, -0.04), s.T(0.85, -0.08), s.T(0.3, -0.1), s.T(-0.55, -0.12), s.T(-0.5, -0.04), s.T(0.4, -0.02)]
    ink(a, cloak)
    s.head()
    head_extra(s, "headwrap")
    s.arm(0, 1.3)
    # the bag at the hip (one colour plate) and its strap
    bag = [s.T(0.12, -0.075), s.T(0.12, -0.005), s.T(-0.16, -0.0), s.T(-0.2, -0.05), s.T(-0.12, -0.088)]
    a.fill_smooth(bag, "clay", 0.95, jit=0.2)
    a.outline(bag, MW, second=0, jit=0.2)
    pline(a, [s.T(1.0, 0.03), s.T(0.6, -0.02), s.T(0.12, -0.04)], FW * 1.4, 0.7)
    pline(a, [s.T(0.35, -0.066), s.T(0.35, 0.07)], MW * 0.9, 0.6)
    pline(a, [s.T(0.95, -0.04), s.T(0.4, -0.06), s.T(-0.45, -0.1)], FW * 1.2, 0.5)
    pline(a, [s.Hd(1.0, -0.62), s.Hd(0.0, -0.75), s.Hd(-1.0, -0.4)], FW * 1.2, 0.6)
    # a water gourd tied below the top of the staff
    g = lerp(staff_top, staff_bot, 0.1)
    a.line(g, add(g, (s.facing * -9, 8)), FW * 1.3, amp=0.2)
    gc = add(g, (s.facing * -10, 18))
    gourd = [add(gc, p) for p in ((0, -11), (3, -7), (4, -3), (8, 2), (8, 8), (3, 12), (-3, 12), (-8, 8), (-8, 2), (-4, -3),
                                  (-3, -7))]
    a.fill_smooth(gourd, "ochre", 0.95, jit=0.1)
    a.outline(gourd, MW, second=0, jit=0.15)


@art_key("hist_sil_scientist", 240, 240)
def hist_sil_scientist(a):
    """A scientist (a woman, hair in a high bun) in a knee-length lab coat over a long skirt, holding up a flask to look
    at it (Marie Curie's work)."""
    s = Sil(a, 100, lean=-1.0, nod=-6, arms=((40, 160), (4, 12)), legs=((3, 0), (-4, -2)))
    flask = s.Hd(2.5, 0.25)
    s.reach(0, add(flask, (0, 16)), 1)
    for i in (0, 1):
        s.foot(i, 0.95)
    s.skirt(0.4, back=0.06, front=0.06, depth=0.055)
    s.arm(1, 1.3)
    coat = [s.T(1.0, -0.035), s.T(0.75, -0.062), s.T(0.2, -0.066), s.T(-0.75, -0.078), s.T(-0.8, 0.0),
            s.T(-0.75, 0.075), s.T(0.3, 0.064), s.T(0.72, 0.07), s.T(1.0, 0.03)]
    inkp(a, coat)
    s.head()
    head_extra(s, "bun_high")
    s.arm(0, 1.3)
    draw_flask(a, flask, 0.85, "sage", 8)
    # coat: lapel, front edge, pocket, hem, cuff
    pline(a, [s.T(0.98, 0.03), s.T(0.66, 0.05), s.T(0.5, 0.068)], FW * 1.3, 0.7)
    pline(a, [s.T(0.5, 0.066), s.T(0.0, 0.07), s.T(-0.76, 0.074)], FW * 1.3, 0.7)
    pline(a, [s.T(-0.78, -0.07), s.T(-0.8, 0.0), s.T(-0.77, 0.07)], FW * 1.2, 0.6)
    pk = [s.T(-0.08, 0.0), s.T(-0.08, 0.045), s.T(-0.28, 0.045), s.T(-0.28, 0.0)]
    pline(a, pk, FW * 1.2, 0.6)
    pline(a, [s.T(0.25, -0.03), s.T(0.25, 0.0)], MW, 0.6)
    hair_line(s, "back_hair")
    cuff = lerp(s.el[0], s.hd[0], 0.78)
    pline(a, [add(cuff, rotp(mul(s.fw, 5), -70 * s.facing)), add(cuff, rotp(mul(s.fw, -5), -70 * s.facing))], FW * 1.2,
          0.6)


@art_key("hist_sil_nurse", 240, 240)
def hist_sil_nurse(a):
    """A nurse of the 1850s walking softly with a lantern held out: long full dress, white apron and cap (Florence
    Nightingale)."""
    s = Sil(a, 92, lean=3.0, nod=4, arms=((52, 64), (-8, 6)), legs=((10, 3), (-10, -8)))
    for i in (0, 1):
        s.foot(i, 0.9)
    hb, hf = s.skirt(0.42, back=0.1, front=0.075, depth=0.065, belly=0.02)
    s.arm(1, 1.25)
    s.torso(0.05)
    s.head()
    head_extra(s, "bun_high")
    s.arm(0, 1.25)
    # cap (a paper plate on the hair), apron (a pale plate down the front of the skirt), the lantern
    cap = [s.Hd(0.3, -1.05), s.Hd(-0.4, -1.12), s.Hd(-0.98, -0.75), s.Hd(-1.05, -0.3), s.Hd(-0.6, -0.55),
           s.Hd(0.0, -0.78)]
    a.fill_smooth(cap, "paper", 0.85, off=(0, 0), jit=0.2)
    apron = [s.T(0.4, 0.0), s.T(0.4, 0.062), s.T(0.0, 0.082), (hf[0] - s.facing * 3, hf[1] - 10),
             lerp(hb, hf, 0.5), s.T(0.0, 0.0)]
    a.fill_smooth(apron, "paper", 0.3, off=(0, 0), jit=0.3)
    pline(a, [apron[0], apron[5], lerp(hb, hf, 0.5)], FW * 1.3, 0.65)
    pline(a, [s.T(0.42, -0.065), s.T(0.42, 0.065)], MW, 0.6)
    pline(a, [s.T(0.72, -0.03), s.T(0.42, 0.0)], FW * 1.2, 0.5)
    draw_fanoos(a, add(s.hd[0], (s.facing * 1, 2)), 0.95)


# ============================================================================================= shared props (layers)


def squiggle(a, p0, p1, amp=1.4, waves=None, w=FW * 1.2, color="ink", alpha=0.5):
    """An abstract hand-written line (never letters): a gentle wave from p0 to p1."""
    d = sub(p1, p0)
    L = vlen(d)
    n = waves or max(2, int(L / 9))
    nrm = perp(unit(d))
    pts = [add(lerp(p0, p1, i / (2 * n)), mul(nrm, amp * a.u(0.5, 1.2) * (1 if i % 2 else -1))) for i in range(2 * n + 1)]
    a.curve(pts, w, color, alpha, jit=0.2)


def side_hatch(a, pts, x_from, ang=72, spacing=4.2, alpha=0.4):
    """Hatching on the right part of a shape (the side away from the light)."""
    a.hatch(clip_half(pts, (x_from, 0), (1, 0)), ang, spacing, alpha=alpha)


@art_key("hist_oil_lamp", 240, 240, PK)
def hist_oil_lamp(a):
    """A kerosene table lamp of about 1900: brass foot and fuel font, burner collar, a glass chimney, a small flame."""
    cx = 118
    foot = [(cx - 42, 222), (cx + 44, 221), (cx + 31, 210), (cx + 14, 204), (cx + 12, 188), (cx - 12, 188), (cx - 14, 204),
            (cx - 31, 210)]
    a.block(foot, "ochre", w=LW, second=0.4)
    side_hatch(a, foot, cx + 8, 70, 4.0)
    font = ellipse((cx, 164), 40, 27, n=16)
    a.fill_smooth(font, "ochre")
    a.hatch(clip_half(ellipse((cx, 164), 37, 24, n=24), (cx + 14, 170), (0.7, 0.7)), 55, 4.2, alpha=0.45)
    a.curve([(cx - 28, 158), (cx - 18, 150), (cx - 6, 148)], MW, "paper", 0.8, jit=0.2)
    a.outline(font, LW, second=0.4)
    collar = [(cx - 17, 128), (cx + 17, 128), (cx + 19, 140), (cx - 19, 140)]
    a.block(collar, "slate", w=MW * 1.4, second=0)
    a.ell((cx + 26, 134), 5, 5, "slate", w=MW, second=0)
    a.line((cx + 19, 134), (cx + 22, 134), MW)
    chim = [(cx - 12, 128), (cx - 20, 116), (cx - 21, 100), (cx - 13, 82), (cx - 10, 60), (cx - 11, 36), (cx + 11, 35),
            (cx + 10, 60), (cx + 13, 82), (cx + 21, 100), (cx + 20, 116), (cx + 12, 128)]
    a.fill_smooth(chim, "paper", 0.9, off=(0, 0))
    a.fill_smooth(chim, "slate", 0.12, off=(0, 0))
    flame = [(cx, 78), (cx + 7, 94), (cx + 9, 106), (cx + 4, 116), (cx - 4, 116), (cx - 9, 106), (cx - 7, 94)]
    a.fill_smooth(flame, "ochre")
    a.fill_smooth([(cx, 96), (cx + 4, 106), (cx + 2, 114), (cx - 2, 114), (cx - 4, 106)], "clay", 0.9)
    a.outline(flame, MW, second=0, jit=0.15)
    a.line((cx, 116), (cx, 126), MW, amp=0.2)
    a.outline(chim, MW * 1.3, second=0.5)
    a.curve([(cx + 15, 112), (cx + 15, 100), (cx + 8, 84)], FW * 1.3, "paper", 0.95, jit=0.1)
    a.ell_outline((cx, 36), 11, 3, w=MW, second=0)


@art_key("hist_compass_old", 240, 240, PK)
def hist_compass_old(a):
    """An old ship's compass on a square wooden board: rings of tick marks (no characters) and a floating needle."""
    c = (118, 122)
    T = Tf(c, 1, -7)
    board = T.pts([(-86, -84), (88, -84), (86, 88), (-88, 86)])
    lip = T.pts([(-88, 86), (86, 88), (86, 100), (-88, 98)])
    a.fill_poly(lip, "clay", 0.95)
    a.hatch(lip, 80, 4.4, alpha=0.5)
    a.outline_poly(lip, MW * 1.3, second=0)
    a.block(board, "clay", 0.8, second=0.4)
    a.hatch(clip_half(board, T((40, 0)), T.v((1, 0.3))), T.ang(65), 5.5, alpha=0.3)
    a.dots(T.pts([(-72, -70), (74, -70), (72, 72), (-74, 72)]), 9, "ochre")
    a.fill_smooth(ellipse(c, 70, 70, n=18), "ochre")
    a.fill_smooth(ellipse(c, 58, 58, n=16), "paper", off=(0, 0))
    a.fill_smooth(ellipse(c, 44, 44, n=14), "ochre", 0.55)
    a.fill_smooth(ellipse(c, 32, 32, n=12), "paper", off=(0, 0))
    a.ell_outline(c, 70, 70)
    a.ell_outline(c, 58, 58, w=MW, second=0)
    a.ell_outline(c, 44, 44, w=FW * 1.3, second=0)
    a.ell_outline(c, 32, 32, w=MW, second=0)
    big, small = Path(), Path()
    for i in range(32):
        t = i * 11.25
        a.seg(polar(c, 56, t), polar(c, 47 if i % 4 == 0 else 51, t), 0.2, big if i % 4 == 0 else small)
    a.stroke(big, MW * 1.2)
    a.stroke(small, FW)
    a.dots([polar(c, 38, t) for t in range(5, 360, 30)], 3.2, "clay")
    ang = -62
    tipn, tips = polar(c, 28, ang), polar(c, 28, ang + 180)
    sl, sr = polar(c, 6, ang - 90), polar(c, 6, ang + 90)
    a.block([tipn, sr, sl], "clay", w=MW * 1.2, second=0)
    a.block([tips, sl, sr], "slate", w=MW * 1.2, second=0)
    a.dots([c], 6, "ochre")


@art_key("hist_astrolabe", 240, 240, PK)
def hist_astrolabe(a):
    """A brass astrolabe: hanging ring and throne, a limb of tick marks, the openwork rete with star pointers and the
    sighting rule across (no letters or numerals)."""
    c, R = (120, 136), 80
    a.ell_outline((120, 30), 9, 9, w=LW, second=0)
    throne = [(-24, -76), (-20, -88), (-10, -96), (0, -100), (10, -96), (20, -88), (24, -76)]
    th = [add(c, p) for p in throne] + [add(c, (0, -70))]
    a.fill_smooth(th, "ochre")
    a.outline(th, MW * 1.4, second=0)
    a.ell((120, 42), 5, 5, "ochre", w=MW, second=0)
    a.fill_smooth(ellipse(c, R, R, n=20), "ochre")
    a.fill_smooth(ellipse(c, R - 12, R - 12, n=18), "ochre", 0.45)
    a.hatch(clip_half(ellipse(c, R - 2, R - 2, n=30), add(c, (34, 30)), (0.6, 0.8)), 50, 4.4, alpha=0.4)
    a.ell_outline(c, R, R)
    a.ell_outline(c, R - 12, R - 12, w=MW, second=0)
    big, small = Path(), Path()
    for i in range(48):
        t = i * 7.5
        a.seg(polar(c, R - 2, t), polar(c, R - 10 if i % 3 == 0 else R - 6, t), 0.2, big if i % 3 == 0 else small)
    a.stroke(big, MW)
    a.stroke(small, FW)
    # rete: the ecliptic ring off-centre, a tropic circle, star pointers
    ec = add(c, (0, -18))
    a.stroke(a.ell_path(ec, 44, 44, wob=0.01), 6, "ochre", 1.0)
    a.ell_outline(ec, 47, 47, w=FW * 1.2, second=0)
    a.ell_outline(ec, 41, 41, w=FW * 1.2, second=0)
    a.ell_outline(c, 58, 58, w=FW * 1.3, second=0)
    for t in (20, 75, 140, 205, 250, 320):
        base = polar(c, 52, t)
        tip = polar(c, 62, t + 8)
        a.curve([base, lerp(base, tip, 0.5), tip], MW * 1.2, jit=0.1)
        a.dots([tip], 4.5, "clay")
    a.lines([(polar(c, 58, 90), polar(c, 58, 270)), (polar(c, 58, 0), polar(c, 58, 180))], FW * 1.2, alpha=0.7)
    # the rule (alidade)
    ang = -28
    pa, pb = polar(c, R - 4, ang), polar(c, R - 4, ang + 180)
    rule = [add(pa, mul(dirv(ang + 90), 1)), add(lerp(pa, pb, 0.12), mul(dirv(ang + 90), 7)),
            add(lerp(pa, pb, 0.88), mul(dirv(ang + 90), 7)), add(pb, mul(dirv(ang + 90), 1)),
            add(lerp(pa, pb, 0.88), mul(dirv(ang - 90), 7)), add(lerp(pa, pb, 0.12), mul(dirv(ang - 90), 7))]
    a.block(rule, "slate", w=MW * 1.4, second=0)
    a.dots([c], 9, "ochre")
    a.dots([c], 3)


def book_box(a, x, y, w, h, rot, col, face="spine"):
    """One closed book in a stack: spine facing out (bands, a blank label) or fore-edge out (page lines)."""
    T = Tf((x + w / 2, y + h / 2), 1, rot)
    body = T.pts([(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)])
    if face == "spine":
        a.block(body, col, second=0.4)
        a.lines([(T((-w / 2 + k, -h / 2 + 2)), T((-w / 2 + k, h / 2 - 2))) for k in (12, 16, w - 16, w - 12)], MW, "paper",
                0.65, amp=0.2)
        lab = T.pts([(-14, -h / 2 + 6), (14, -h / 2 + 6), (14, h / 2 - 6), (-14, h / 2 - 6)])
        a.fill_poly(lab, "paper", 0.75, off=(0, 0), jit=0.2)
        a.outline_poly(lab, FW * 1.2, second=0)
    else:
        a.fill_poly(body, "paper", off=(0, 0))
        board_t = T.pts([(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, -h / 2 + 5), (-w / 2, -h / 2 + 5)])
        board_b = T.pts([(-w / 2, h / 2 - 5), (w / 2, h / 2 - 5), (w / 2, h / 2), (-w / 2, h / 2)])
        for bb in (board_t, board_b):
            a.fill_poly(bb, col)
        a.lines([(T((-w / 2 + 4, yy)), T((w / 2 - 4, yy))) for yy in frange(-h / 2 + 8, h / 2 - 8, 3.4)], FW, alpha=0.4,
                amp=0.2)
        a.outline_poly(body, LW, second=0.4)


@art_key("hist_book_stack", 240, 240, PK)
def hist_book_stack(a):
    """A stack of four old books, two showing their spines and two their page edges, a ribbon hanging from the top one."""
    book_box(a, 30, 182, 172, 32, 0.5, "clay", "spine")
    book_box(a, 46, 152, 152, 30, -2.0, "sage", "edge")
    book_box(a, 36, 126, 146, 26, 2.5, "slate", "spine")
    book_box(a, 62, 96, 128, 30, -4.0, "ochre", "edge")
    a.blob([(150, 118), (158, 118), (160, 150), (154, 144), (148, 152)], "clay", w=MW * 1.2, second=0)
    a.line((18, 216), (214, 215), MW, alpha=0.6)


@art_key("hist_globe_old", 240, 240, PK)
def hist_globe_old(a):
    """An old globe on a wooden stand with a brass meridian ring; continents are loose blobs, not a survey map."""
    c, R = (116, 104), 66
    base = ellipse((118, 218), 50, 10, n=14)
    a.blob(base, "clay", second=0.3)
    ped = [(104, 210), (132, 210), (126, 196), (124, 178), (112, 178), (110, 196)]
    a.block(ped, "clay", w=MW * 1.4, second=0)
    a.hatch(ped, 80, 3.6, alpha=0.4)
    a.stroke(a.ell_path(c, R + 12, R + 12, a0=60, sweep=250, wob=0.01), 7.5, "ochre", 1.0)
    a.arc(c, R + 15.5, 60, 310, FW * 1.3)
    a.arc(c, R + 8.5, 60, 310, FW * 1.3)
    sph = ellipse(c, R, R, n=20)
    a.fill_smooth(sph, "paper", off=(0, 0))
    a.fill_smooth(sph, "ochre", 0.3, off=(0, 0))
    lands = [[(-40, -40), (-14, -50), (-4, -30), (-18, -12), (-10, 8), (-26, 26), (-40, 10), (-48, -14)],
             [(6, -46), (36, -42), (52, -24), (40, -8), (20, -14), (8, -28)],
             [(14, 4), (34, 8), (40, 30), (24, 50), (10, 34)]]
    T = Tf(c, 1, -23)
    for l in lands:
        a.fill_smooth(T.pts(l), "sage", 0.95)
        a.outline(T.pts(l), FW * 1.3, second=0, jit=0.3)
    for rx in (24, 48):
        a.stroke(a.ell_path(c, rx, R - 1, rot=-23, wob=0.01), FW * 1.1, "ink", 0.5)
    a.arc(c, R - 2, 0, 180, FW * 1.1, alpha=0.5, ry=16, rot=-23)
    a.hatch(clip_half(ellipse(c, R - 3, R - 3, n=30), add(c, (28, 26)), (0.6, 0.8)), 50, 4.6, alpha=0.4)
    a.ell_outline(c, R, R)
    a.line(polar(c, R + 14, -113), polar(c, R + 22, -113), LW, amp=0.2)
    a.line(polar(c, R + 12, 67), (124, 178), LW * 1.1, amp=0.3)


@art_key("hist_quill", 240, 240, PK)
def hist_quill(a):
    """A feather quill standing in a small ink pot."""
    shaft = [(98, 168), (128, 120), (162, 70), (196, 22)]
    vane_l = [(118, 132), (124, 108), (138, 84), (158, 58), (180, 34), (196, 22)]
    vane_r = [(196, 22), (186, 46), (170, 72), (154, 98), (138, 124), (124, 140)]
    vane = vane_l + vane_r[1:]
    a.fill_smooth(vane, "paper", off=(0, 0))
    a.fill_smooth(vane, "ochre", 0.4)
    segs = []
    for t in frange(0.08, 0.92, 0.07):
        p = lerp((120, 136), (196, 22), t)
        segs.append((p, add(p, (-14 + 6 * t, -10 + 2 * t))))
        segs.append((p, add(p, (14 - 6 * t, 4))))
    a.lines(segs, FW, alpha=0.55, amp=0.2)
    a.outline(vane, MW * 1.3, second=0.3, jit=0.3)
    a.curve(shaft, MW * 1.4, jit=0.2)
    a.zig([(150, 78), (146, 84), (152, 86)], FW * 1.2)
    pot = [(62, 222), (140, 222), (146, 200), (138, 176), (118, 168), (84, 168), (64, 176), (56, 200)]
    a.fill_smooth(pot, "slate")
    side_hatch(a, pot, 116, 70, 4.2, 0.45)
    a.curve([(70, 186), (72, 200), (78, 210)], MW, "paper", 0.7, jit=0.2)
    a.outline(pot, LW, second=0.4)
    mouth = ellipse((101, 168), 24, 6, n=10)
    a.fill_smooth(mouth, "ink", 0.85, off=(0, 0))
    a.ell_outline((101, 168), 24, 6, w=MW * 1.2, second=0)
    a.line((44, 223), (162, 222), MW, alpha=0.6)


@art_key("hist_small_boat", 240, 240, PK)
def hist_small_boat(a):
    """A small Nusantara sailing boat (perahu) with a tilted tanja sail and a bamboo outrigger, on a few ripples."""
    a.line((118, 162), (110, 40), LW, amp=0.5)
    sail = [(30, 98), (174, 26), (212, 104), (112, 150)]
    a.fill_poly(sail, "ochre")
    a.lines([(lerp(sail[0], sail[3], t), lerp(sail[1], sail[2], t)) for t in (0.25, 0.5, 0.75)], FW * 1.2, alpha=0.5)
    side_hatch(a, sail, 150, 62, 4.6, 0.35)
    a.outline_poly(sail, MW * 1.4, second=0)
    a.line((24, 102), (180, 22), LW, amp=0.4, over=(2, 2))
    a.line((106, 154), (218, 100), LW, amp=0.4, over=(2, 2))
    a.lines([((111, 52), (170, 24)), ((114, 150), (116, 110))], FW, alpha=0.6)
    float_ = capsule((64, 188), (172, 188), 3.4, n=4)
    a.blob(float_, "ochre", w=MW * 1.1, second=0)
    for x in (88, 148):
        a.curve([(x - 8, 166), (x - 2, 174), (x + 2, 188)], MW * 1.2, jit=0.2)
    hull = [(22, 140), (40, 160), (118, 170), (192, 160), (220, 134), (214, 156), (190, 178), (118, 184), (50, 178),
            (28, 160)]
    a.fill_smooth(hull, "clay")
    a.curve([(36, 160), (118, 172), (204, 156)], 3.2, "paper", 0.85)
    a.hatch(clip_half(hull, (0, 172), (0, 1)), 8, 4.2, alpha=0.4)
    a.outline(hull, LW, second=0.4)
    a.dots([(48, 166), (192, 162)], 5, "ochre")
    for k, y in enumerate((200, 212, 224)):
        x0 = 30 + k * 20
        a.curve([(x0 + i * 16, y + 3 * math.sin(i * 1.6 + k)) for i in range(11 - 2 * k)], MW, "slate", 0.9)


@art_key("hist_sunrise", 320, 240, PK)
def hist_sunrise(a):
    """The sun rising over a horizon (a new day): a half disc, rays, a reflection on calm water."""
    c, R, hy = (164, 166), 58, 166
    for i in range(11):
        t = 192 + i * 15.6
        L = 34 if i % 2 == 0 else 20
        ray = [polar(c, R + 10, t - 4.5), polar(c, R + 10 + L, t), polar(c, R + 10, t + 4.5)]
        a.fill_poly(ray, "ochre")
        a.outline_poly(ray, MW * 1.1, second=0, over=0.8, gap=1.0)
    half = [polar(c, R, t) for t in range(180, 361, 12)]
    a.fill_smooth(half + [(c[0] + R, hy), (c[0] - R, hy)], "ochre")
    a.fill_smooth([polar(c, R * 0.66, t) for t in range(180, 361, 18)] + [(c[0] + R * 0.66, hy), (c[0] - R * 0.66, hy)],
                  "clay", 0.25)
    a.hatch(clip_half(half + [(c[0] + R, hy - 1), (c[0] - R, hy - 1)], add(c, (20, -14)), (0.7, 0.7)), 50, 4.4, alpha=0.4)
    a.curve(half, LW)
    a.curve([(c[0] - R - 60, 130), (c[0] - 30, 128), (c[0] + 10, 131)], MW * 1.2, "slate", 0.7)
    a.curve([(c[0] + 30, 112), (c[0] + 90, 109), (c[0] + 128, 113)], MW * 1.2, "slate", 0.7)
    a.line((14, hy), (306, hy + a.j(1)), LW, over=(1, 1))
    refl = [((c[0] - 44, hy + 12), (c[0] + 40, hy + 12)), ((c[0] - 30, hy + 24), (c[0] + 34, hy + 24)),
            ((c[0] - 16, hy + 36), (c[0] + 18, hy + 36))]
    a.lines(refl, 4.2, "ochre", 0.85, amp=0.5)
    for k, y in enumerate((hy + 18, hy + 32, hy + 48)):
        x0 = 24 + k * 14
        a.curve([(x0 + i * 22, y + 2.5 * math.sin(i * 1.5 + k)) for i in range(6)], MW, "slate", 0.8)
        a.curve([(214 + k * 10 + i * 22, y + 2.5 * math.sin(i * 1.5 + k)) for i in range(4)], MW, "slate", 0.8)


# ============================================================================================= per-figure layers


def tiled(a, pts, col="clay", ang=0.0, spacing=6.0, alpha=0.35, line=LW):
    """A roof plane: colour plate, rows of tile or thatch lines, a contour."""
    a.fill_poly(pts, col)
    a.hatch(pts, ang, spacing, alpha=alpha, inset=(0.4, 1.4), skip=0.02)
    a.outline_poly(pts, line, second=0.4)


def post(a, x, y0, y1, w=9, col="ochre", foot=True):
    p = [(x - w / 2, y0), (x + w / 2, y0), (x + w / 2, y1), (x - w / 2, y1)]
    a.block(p, col, w=MW * 1.4, second=0)
    a.hatch(clip_half(p, (x + w * 0.1, 0), (1, 0)), 80, 3.0, alpha=0.4)
    if foot:
        f = [(x - w * 0.9, y1), (x + w * 0.9, y1), (x + w * 0.7, y1 - 6), (x - w * 0.7, y1 - 6)]
        a.block(f, "slate", 0.8, w=MW, second=0)


@art_key("hist_ki_hajar_school", 320, 240, PK)
def hist_ki_hajar_school(a):
    """Taman Siswa (Yogyakarta, 1922): an open Javanese pendopo under a joglo roof on a stone floor, a small chalkboard
    inside and three children sitting on the floor in front of it."""
    plat = [(18, 196), (302, 196), (305, 214), (15, 214)]
    a.block(plat, "slate", 0.35, second=0.3)
    a.lines([((x, 199), (x + 2, 212)) for x in frange(44, 290, 48)], FW, alpha=0.4)
    steps = [(132, 214), (188, 214), (193, 225), (127, 225)]
    a.block(steps, "ochre", 0.7, w=MW * 1.3, second=0)
    a.fill_poly(rect(30, 140, 260, 56), "ochre", 0.24, off=(0, 0))
    # chalkboard on an easel, children sitting in front of it
    a.lines([((64, 196), (72, 150)), ((92, 196), (84, 150)), ((78, 150), (80, 196))], MW * 1.3, amp=0.3)
    board = rect(54, 146, 50, 32)
    a.block(board, "slate", w=MW * 1.3, second=0)
    a.curve(ellipse((68, 160), 6, 6, n=8)[:8], FW * 1.2, "paper", 0.85)
    a.curve([(80, 166), (86, 156), (92, 166), (98, 156)], FW * 1.2, "paper", 0.85, jit=0.1)
    for x, hair, scarf, h in ((136, "short", False, 82), (176, "ponytail", False, 80), (218, "short", True, 84)):
        seated_kid(a, x, 196, -1, hair, scarf, h)
    for x in (34, 108, 212, 286):
        post(a, x, 136, 196)
    emper = [(12, 144), (308, 144), (272, 122), (48, 122)]
    pen = [(48, 124), (272, 124), (222, 96), (98, 96)]
    brun = [(98, 98), (222, 98), (186, 44), (134, 44)]
    for r in (emper, pen, brun):
        tiled(a, r, "clay", 0, 7.0)
    a.line((126, 44), (194, 44), LW * 1.3, over=(1, 1))
    for x in (124, 196):
        a.curve([(x, 44), (x + (-5 if x < 160 else 5), 38), (x + (-4 if x < 160 else 4), 32)], MW * 1.3, jit=0.1)
    a.line((8, 145), (312, 145), MW * 1.4, amp=0.6)


@art_key("hist_slate_board", 240, 240, PK)
def hist_slate_board(a):
    """A pupil's writing slate (batu tulis) in a wooden frame, abstract chalk marks, a slate pencil and a small sponge on
    a string (no letters or digits)."""
    T = Tf((114, 112), 1, -6)
    frame = T.pts(rect(-88, -68, 176, 136))
    a.block(frame, "ochre", second=0.4)
    a.lines([(T((-80, y)), T((80, y + 1))) for y in (-64, 62)], FW, alpha=0.4)
    inner = T.pts(rect(-74, -54, 148, 108))
    a.fill_poly(inner, "slate", off=(0, 0))
    a.hatch(inner, T.ang(28), 7, alpha=0.18)
    a.outline_poly(inner, MW * 1.3, second=0)
    a.lines([(T((sx * 88, sy * 68)), T((sx * 74, sy * 54))) for sx in (-1, 1) for sy in (-1, 1)], FW * 1.3, alpha=0.7)
    chalk = dict(w=MW * 1.1, color="paper", alpha=0.9)
    a.curve(T.pts(ellipse((-44, -22), 14, 13, n=9)[:9]), jit=0.3, **chalk)
    a.curve(T.pts([(-6, -8), (8, -36), (24, -8), (-8, -8)]), jit=0.3, **chalk)
    a.curve(T.pts([(36, -30), (44, -38), (52, -30), (60, -38), (66, -30)]), jit=0.2, **chalk)
    a.dots(T.pts([(-56 + 9 * i, 18) for i in range(6)] + [(-56 + 9 * i, 30) for i in range(4)]), 3.4, "paper", 0.9)
    a.curve(T.pts([(10, 26), (26, 18), (42, 28), (60, 20)]), jit=0.3, **chalk)
    # hole, string and sponge
    hole = T((0, -61))
    a.ell(hole, 3, 3, "paper", w=FW * 1.2, second=0)
    a.curve([hole, T((40, -92)), T((96, -80)), T((112, -44))], FW * 1.3, jit=0.3)
    sp = T.pts(ellipse((112, -30), 12, 15, n=10))
    a.fill_smooth(sp, "sage")
    a.stipple(sp, 8, 2.2, alpha=0.6)
    a.outline(sp, MW * 1.2, second=0, jit=0.3)
    # the slate pencil
    pen = [(128, 196), (210, 168), (213, 175), (131, 203)]
    a.fill_poly(pen, "paper", off=(0, 0))
    a.fill_poly(pen, "slate", 0.35, off=(0, 0))
    a.fill_poly([(168, 182), (190, 175), (193, 182), (171, 189)], "ochre", 0.95)
    a.outline_poly(pen, MW * 1.2, second=0)
    a.line((210, 168), (220, 168), MW, amp=0.1)


def envelope(a, c, w, h, rot, seal=True):
    T = Tf(c, 1, rot)
    body = T.pts(rect(-w / 2, -h / 2, w, h))
    a.fill_poly(body, "paper", off=(0, 0))
    a.fill_poly(body, "ochre", 0.12, off=(0, 0))
    a.lines([(T((-w / 2 + 2, -h / 2 + 2)), T((0, h * 0.05))), (T((w / 2 - 2, -h / 2 + 2)), T((0, h * 0.05)))], FW * 1.3,
            alpha=0.7)
    stamp = T.pts(rect(w / 2 - 26, -h / 2 + 8, 16, 18))
    a.fill_poly(stamp, "clay", 0.85)
    a.outline_poly(stamp, FW * 1.2, second=0)
    for k in range(2):
        squiggle(a, T((-w * 0.18, h * 0.18 + k * 10)), T((w * 0.3, h * 0.18 + k * 10)), 1.2, w=FW * 1.2, alpha=0.5)
    a.outline_poly(body, MW * 1.4, second=0.4)
    if seal:
        a.ell(T((0, h * 0.05)), 7, 7, "clay", w=MW, second=0)


@art_key("hist_kartini_letters", 240, 240, PK)
def hist_kartini_letters(a):
    """Kartini's letters: a bundle of envelopes tied with a ribbon, one open letter of hand-writing (abstract lines,
    never readable text) and a dip pen."""
    sheet = Tf((160, 98), 1, 9)
    pg = sheet.pts(rect(-46, -64, 92, 128))
    a.fill_poly(pg, "paper", off=(0, 0))
    a.outline_poly(pg, MW * 1.4, second=0.4)
    for k in range(9):
        y = -50 + k * 11
        x1 = 34 if k not in (3, 8) else 4
        squiggle(a, sheet((-36 if k != 4 else -26, y)), sheet((x1, y)), 1.3, w=FW * 1.25, alpha=0.6)
    a.curve(sheet.pts([(6, 52), (14, 46), (22, 54), (32, 46)]), FW * 1.4, alpha=0.7, jit=0.2)
    envelope(a, (92, 158), 150, 92, -11, seal=False)
    envelope(a, (98, 146), 150, 92, 3, seal=False)
    envelope(a, (96, 134), 150, 92, -5)
    T = Tf((96, 134), 1, -5)
    a.fill_poly(T.pts(rect(18, -50, 12, 102)), "clay", 0.95)
    a.fill_poly(T.pts(rect(-78, -2, 156, 10)), "clay", 0.95)
    a.outline_poly(T.pts(rect(18, -50, 12, 102)), FW * 1.3, second=0)
    for lp in ([(24, 3), (4, -16), (0, -4), (24, 3)], [(24, 3), (46, -14), (50, -2), (24, 3)]):
        q = T.pts(lp)
        a.fill_smooth(q, "clay", 0.95)
        a.outline(q, MW, second=0, jit=0.2)
    for tl in ([(24, 4), (12, 22), (6, 34)], [(24, 4), (34, 22), (42, 30)]):
        a.stroke(a.open_curve(T.pts(tl), 0.3), 4.5, "clay", 0.95)
    # dip pen
    a.blob(capsule((26, 218), (122, 196), 4.2, 3.4, n=3), "clay", w=MW * 1.2, second=0)
    nib = [(122, 192), (144, 190), (122, 200)]
    a.block(nib, "slate", w=MW, second=0)


@art_key("hist_dewi_sartika_school", 320, 240, PK)
def hist_dewi_sartika_school(a):
    """Sakola Istri (Bandung, 1904): a small Sundanese school house on low posts, woven bamboo (bilik) walls, a
    julang ngapak roof with crossed capit gunting at the ridge, a wooden step at the door (a blank board, no sign text)."""
    fy = 178
    for x in (98, 132, 188, 222):
        post(a, x, fy, 206, 8)
    a.fill_poly(rect(88, fy - 2, 144, 8), "clay", 0.9)
    a.outline_poly(rect(88, fy - 2, 144, 8), MW * 1.2, second=0)
    wall = rect(94, 104, 132, fy - 104)
    a.fill_poly(wall, "ochre", 0.6)
    a.hatch(wall, 45, 7, alpha=0.28, skip=0.0)
    a.hatch(wall, -45, 7, alpha=0.28, skip=0.0)
    a.outline_poly(wall, LW, second=0.4)
    for x in (94, 226):
        a.line((x, 104), (x, fy), MW * 1.6, "clay", amp=0.2)
    door = rect(148, 126, 26, fy - 128)
    a.block(door, "clay", 0.9, w=MW * 1.3, second=0)
    a.line((161, 126), (161, fy - 2), FW * 1.2)
    a.dots([(166, 152)], 3, "ochre")
    for x in (106, 190):
        win = rect(x, 124, 26, 22)
        a.block(win, "slate", 0.85, w=MW * 1.2, second=0)
        a.lines([((x + 6.5 * k, 125), (x + 6.5 * k, 145)) for k in (1, 2, 3)], FW * 1.2, "ochre", amp=0.1)
    a.block([(140, fy + 6), (182, fy + 6), (184, fy + 14), (138, fy + 14)], "ochre", w=MW * 1.2, second=0)
    a.lines([((146, fy + 14), (146, 206)), ((176, fy + 14), (176, 206))], MW, amp=0.2)
    board = rect(140, 108, 42, 12)
    a.block(board, "paper", w=FW * 1.3, second=0)
    gable = [(160, 64), (206, 104), (114, 104)]
    a.fill_poly(gable, "ochre", 0.75)
    a.lines([((x, 104), (x, 104 - (46 - abs(x - 160)) * 0.85)) for x in frange(126, 196, 8) if abs(x - 160) < 44],
            FW, alpha=0.4, amp=0.1)
    a.ell((160, 90), 5, 5, "slate", w=FW * 1.2, second=0)
    roof = [(160, 38), (212, 90), (270, 114), (264, 122), (208, 101), (160, 62), (112, 101), (56, 122), (50, 114),
            (108, 90)]
    a.fill_poly(roof, "clay")
    a.hatch(clip_half(roof, (160, 0), (1, 0)), -24, 5, alpha=0.38)
    a.hatch(clip_half(roof, (160, 0), (-1, 0)), 24, 5, alpha=0.38)
    a.outline_poly(roof, LW, second=0.4)
    a.lines([((146, 52), (178, 18)), ((174, 52), (142, 18))], LW, amp=0.3)


@art_key("hist_sewing_kit", 240, 240, PK)
def hist_sewing_kit(a):
    """A woven sewing basket: an embroidered cloth, a spool of thread with a threaded needle, a pincushion, a thimble."""
    cloth = [(34, 172), (46, 132), (88, 116), (128, 122), (120, 168)]
    a.fill_smooth(cloth, "paper", off=(0, 0))
    a.outline(cloth, MW * 1.3, second=0, jit=0.3)
    xs = []
    for c in ((80, 140), (70, 134), (90, 134), (74, 148), (88, 148)):
        x, y = c
        xs += [((x - 3, y - 3), (x + 3, y + 3)), ((x - 3, y + 3), (x + 3, y - 3))]
    a.lines(xs, FW * 1.4, "clay", 0.95, amp=0.1)
    a.lines([((80, 154), (78, 166)), ((76, 160), (68, 164))], FW * 1.4, "sage", 0.95, amp=0.1)
    for k in range(7):
        x = 52 + k * 9
        a.line((x, 126 - k * 0.5 + (k > 3) * 2), (x + 5, 125 - k * 0.5 + (k > 3) * 2), FW * 1.2, "slate", amp=0.1)
    pin = ellipse((190, 150), 22, 18, n=12)
    for px, py, hx, hy in ((180, 140, 172, 116), (192, 136, 196, 112), (202, 142, 214, 122)):
        a.line((px, py), (hx, hy), FW * 1.3, amp=0.1)
        a.dots([(hx, hy)], 6, "ochre")
    a.fill_smooth(pin, "sage")
    a.hatch(clip_half(pin, (196, 0), (1, 0)), 70, 4, alpha=0.4)
    a.outline(pin, MW * 1.4, second=0.3)
    a.curve([(176, 148), (190, 156), (206, 146)], FW * 1.2, alpha=0.6)
    # spool and threaded needle
    sc = (146, 140)
    a.fill_poly(rect(sc[0] - 12, sc[1] - 16, 24, 32), "clay", off=(0, 0))
    a.lines([((sc[0] - 11, sc[1] - 12 + 4 * k), (sc[0] + 11, sc[1] - 13 + 4 * k)) for k in range(7)], FW, "paper", 0.5)
    a.outline_poly(rect(sc[0] - 12, sc[1] - 16, 24, 32), MW * 1.2, second=0)
    for y in (sc[1] - 18, sc[1] + 18):
        a.ell((sc[0], y), 16, 4.5, "ochre", w=MW * 1.2, second=0)
    th = [(92, 162), (108, 162), (106, 176), (94, 176)]
    a.blob(th, "slate", w=MW * 1.2, second=0)
    a.dots([(96, 166), (101, 167), (104, 171), (98, 171)], 1.8, "paper", 0.8)
    # basket
    bk = [(26, 172), (214, 172), (200, 216), (40, 216)]
    a.fill_poly(bk, "ochre")
    a.hatch(bk, 40, 6, alpha=0.4, skip=0.0)
    a.hatch(bk, -40, 6, alpha=0.4, skip=0.0)
    a.outline_poly(bk, LW, second=0.4)
    a.fill_poly([(22, 168), (218, 168), (218, 178), (22, 178)], "ochre", off=(0, 0))
    a.outline_poly([(22, 168), (218, 168), (218, 178), (22, 178)], MW * 1.3, second=0)
    a.curve([(sc[0] + 12, sc[1] + 4), (168, 168), (186, 186), (208, 192), (222, 182)], FW * 1.4, "clay", jit=0.3)
    a.line((196, 200), (232, 176), MW * 1.2, "slate", amp=0.1)
    a.ell_outline((229, 178), 2.2, 3.4, rot=-34, w=FW, second=0)


@art_key("hist_rumoh_aceh", 320, 240, PK)
def hist_rumoh_aceh(a):
    """Rumoh Aceh: the Acehnese stilt house, raised on round wooden posts, plank walls with a carved band, a steep
    thatched (rumbia) roof, a carved gable screen (tulak angen) and a front ladder with an odd number of rungs."""
    fy, gy = 136, 214
    for x in (40, 74, 108, 166, 200, 234, 268, 286):
        post(a, x, fy, gy, 8 if x < 260 else 6)
    a.fill_poly(rect(28, fy - 4, 266, 9), "clay", 0.95)
    a.outline_poly(rect(28, fy - 4, 266, 9), MW * 1.2, second=0)
    wall = rect(34, 94, 200, fy - 94)
    a.fill_poly(wall, "clay", 0.75)
    a.lines([((x, 103), (x, fy - 3)) for x in frange(46, 230, 16)], FW, alpha=0.4, amp=0.1)
    band = rect(34, 94, 200, 9)
    a.fill_poly(band, "ochre", 0.9)
    a.dots([(40 + 8 * k, 98.5) for k in range(25)], 2.4, "clay")
    end = [(234, 94), (290, 88), (290, 130), (234, fy - 2)]
    a.fill_poly(end, "clay", 0.85)
    a.hatch(end, 80, 4.2, alpha=0.4)
    a.outline_poly(end, MW * 1.4, second=0)
    for x in (58, 96, 196):
        win = rect(x, 108, 18, 18)
        a.block(win, "slate", 0.85, w=MW * 1.1, second=0)
        a.line((x + 9, 108), (x + 9, 126), FW * 1.2, "ochre", amp=0.1)
    door = rect(132, 106, 22, fy - 108)
    a.block(door, "ochre", 0.9, w=MW * 1.2, second=0)
    a.outline_poly(wall, LW, second=0.4)
    # ladder up to the door (nine rungs)
    a.lines([((128, gy), (132, fy + 4)), ((158, gy), (154, fy + 4))], LW * 0.9, amp=0.3)
    a.lines([((129 + 0.5 * (1 - t), gy - (gy - fy - 6) * t), (157 - 0.5 * (1 - t), gy - (gy - fy - 6) * t))
             for t in [k / 9 for k in range(1, 10)]], MW, "ochre", amp=0.2)
    # roof: the long thatched plane and the carved gable screen
    roof = [(16, 98), (238, 98), (266, 24), (48, 28)]
    a.fill_poly(roof, "ochre")
    a.fill_poly(roof, "sage", 0.25, off=(0, 0))
    a.hatch(roof, 84, 5, alpha=0.4)
    a.lines([(lerp(roof[0], roof[3], t), lerp(roof[1], roof[2], t)) for t in (0.25, 0.5, 0.75)], FW * 1.2, alpha=0.5)
    a.outline_poly(roof, LW, second=0.4)
    gab = [(238, 98), (266, 24), (298, 90)]
    a.fill_poly(gab, "clay")
    a.outline_poly(gab, LW, second=0.3)
    inner = [(246, 90), (266, 40), (288, 86)]
    a.fill_poly(inner, "ochre", 0.8)
    holes = []
    for row, y in enumerate((50, 62, 74, 84)):
        half = (y - 40) * 0.42
        for k in range(-(row + 1), row + 2):
            x = 266 + k * (half / (row + 1.2))
            if abs(x - 266) < half - 2:
                holes.append((x, y))
    a.dots(holes, 3.2, "clay")
    a.outline_poly(inner, MW, second=0)
    a.line((44, 28), (270, 23), LW * 1.2, over=(2, 2))


@art_key("hist_hatta_books", 240, 240, PK)
def hist_hatta_books(a):
    """Mohammad Hatta's books: an open wooden trunk packed with books (he took his library into exile), round reading
    glasses resting on top."""
    lid = [(34, 126), (192, 126), (206, 52), (50, 46)]
    a.fill_poly(lid, "ochre", 0.75)
    a.lines([(lerp(lid[0], lid[3], t), lerp(lid[1], lid[2], t)) for t in (0.33, 0.66)], FW * 1.2, alpha=0.5)
    a.outline_poly(lid, LW, second=0.4)
    a.fill_poly([(40, 52), (54, 50), (52, 120), (40, 124)], "clay", 0.6)
    cols = ["clay", "sage", "slate", "ochre", "clay", "slate", "sage", "clay", "ochre", "slate", "sage", "clay"]
    x = 38
    for i, col in enumerate(cols):
        w = 10 + (i * 7) % 6
        h = 22 + (i * 11) % 14
        b = [(x, 132), (x + w, 132), (x + w, 132 - h), (x, 132 - h)]
        a.fill_poly(b, col, 0.95, jit=0.3)
        a.outline_poly(b, MW, second=0, over=0.8, gap=1.0)
        a.line((x + 2, 132 - h * 0.6), (x + w - 2, 132 - h * 0.6), FW, "paper", 0.7, amp=0.1)
        x += w + 1.2
        if x > 180:
            break
    front = [(30, 130), (196, 130), (196, 214), (30, 214)]
    a.fill_poly(front, "clay")
    a.lines([((32, y), (194, y + 1)) for y in (158, 186)], FW * 1.2, alpha=0.5)
    a.hatch(clip_half(front, (0, 196), (0, 1)), 8, 4.4, alpha=0.3)
    a.outline_poly(front, LW, second=0.4)
    side = [(196, 130), (220, 118), (220, 198), (196, 214)]
    a.fill_poly(side, "clay", 0.85)
    a.hatch(side, 80, 3.8, alpha=0.45)
    a.outline_poly(side, LW, second=0)
    for c in ((30, 130), (196, 130), (30, 214), (196, 214)):
        x, y = c
        sx = 1 if x < 100 else -1
        sy = 1 if y < 170 else -1
        corner = [(x, y), (x + sx * 16, y), (x + sx * 16, y + sy * 5), (x + sx * 5, y + sy * 5), (x + sx * 5, y + sy * 16),
                  (x, y + sy * 16)]
        a.fill_poly(corner, "slate", 0.95, jit=0.2)
    lat = rect(104, 132, 18, 24)
    a.block(lat, "ochre", w=MW * 1.2, second=0)
    a.dots([(113, 148)], 4, "ink")
    # round glasses resting on the books
    for c in ((134, 106), (164, 104)):
        a.fill_smooth(ellipse(c, 12, 11, n=10), "paper", 0.55, off=(0, 0))
        a.ell_outline(c, 12, 11, w=MW * 1.3, second=0, wob=0.01)
    a.curve([(146, 104), (149, 100), (152, 103)], MW * 1.2, jit=0.1)
    a.curve([(122, 104), (110, 110), (100, 108)], MW * 1.1, jit=0.2)
    a.curve([(176, 102), (186, 108), (196, 106)], MW * 1.1, jit=0.2)


def produce_basket(a, c, w, h, fill="clay", n=5):
    x, y = c
    bk = [(x - w / 2, y), (x + w / 2, y), (x + w / 2 - 6, y + h), (x - w / 2 + 6, y + h)]
    for k in range(n):
        bx = x - w / 2 + 8 + k * (w - 16) / max(1, n - 1)
        a.ell((bx, y - 4 - (k % 2) * 4), 7, 7, fill, w=MW, second=0)
    a.fill_poly(bk, "ochre")
    a.hatch(bk, 35, 5, alpha=0.45)
    a.hatch(bk, -35, 5, alpha=0.45)
    a.outline_poly(bk, MW * 1.3, second=0)


def sack(a, c, w, h):
    x, y = c
    pts = [(x - w * 0.42, y - h), (x - w * 0.2, y - h * 0.9), (x + w * 0.2, y - h * 0.9), (x + w * 0.42, y - h),
           (x + w * 0.5, y - h * 0.4), (x + w * 0.45, y), (x - w * 0.45, y), (x - w * 0.5, y - h * 0.4)]
    a.fill_smooth(pts, "paper", off=(0, 0))
    a.fill_smooth(pts, "ochre", 0.3, off=(0, 0))
    a.hatch(clip_half(pts, (x + w * 0.1, 0), (1, 0)), 75, 4, alpha=0.35)
    a.outline(pts, MW * 1.3, second=0)
    a.line((x - w * 0.24, y - h * 0.86), (x + w * 0.24, y - h * 0.86), MW * 1.3, "clay", amp=0.2)


@art_key("hist_coop_shop", 320, 240, PK)
def hist_coop_shop(a):
    """A village cooperative shop (koperasi, Hatta): a wooden kiosk with a striped awning, shelves of jars, a counter
    with a two-pan balance, sacks of rice and a basket of produce; the board above is blank."""
    back = rect(44, 74, 232, 136)
    a.fill_poly(back, "ochre", 0.55)

    a.outline_poly(back, LW, second=0.4)
    for y in (112, 142):
        a.fill_poly(rect(52, y, 216, 4), "clay", 0.95, jit=0.2)
        a.line((52, y), (268, y), MW, amp=0.3)
    jars = [(64, 112, "clay"), (84, 112, "sage"), (104, 112, "ochre"), (210, 112, "slate"), (232, 112, "clay"),
            (252, 112, "sage"), (70, 142, "slate"), (92, 142, "ochre"), (220, 142, "sage"), (246, 142, "clay")]
    for x, y, col in jars:
        j = [(x - 7, y), (x + 7, y), (x + 8, y - 14), (x + 4, y - 18), (x - 4, y - 18), (x - 8, y - 14)]
        a.fill_smooth(j, col, 0.9)
        a.outline(j, MW, second=0, jit=0.2)
    counter = rect(48, 158, 224, 52)
    a.fill_poly(counter, "clay")
    a.lines([((50, y), (270, y)) for y in (176, 194)], FW * 1.2, alpha=0.45)
    a.outline_poly(counter, LW, second=0.4)
    a.line((44, 158), (276, 158), LW * 1.2, over=(2, 2))
    # balance on the counter
    a.line((160, 156), (160, 118), MW * 1.4, amp=0.2)
    a.line((132, 120), (188, 120), MW * 1.4, amp=0.2)
    a.block([(150, 156), (170, 156), (166, 150), (154, 150)], "slate", w=MW, second=0)
    for x in (132, 188):
        a.lines([((x, 120), (x - 9, 140)), ((x, 120), (x + 9, 140))], FW * 1.2, amp=0.1)
        pan = [(x - 13, 140), (x + 13, 140), (x + 8, 146), (x - 8, 146)]
        a.block(pan, "slate", w=MW, second=0)
    a.ell((160, 116), 4, 4, "ochre", w=FW * 1.2, second=0)
    awn = [(30, 74), (290, 74), (290, 92), (30, 92)]
    xs = frange(30, 290, 26)
    for i in range(len(xs) - 1):
        strip = [(xs[i], 74), (xs[i + 1], 74), (xs[i + 1], 92), ((xs[i] + xs[i + 1]) / 2, 100), (xs[i], 92)]
        a.fill_poly(strip, "sage" if i % 2 == 0 else "paper", off=(0, 0) if i % 2 else None)
    sc = []
    for i in range(len(xs) - 1):
        sc += [(xs[i], 92), ((xs[i] + xs[i + 1]) / 2, 100)]
    sc.append((xs[-1], 92))
    a.curve(sc, MW * 1.2)
    a.line((26, 74), (294, 74), LW, over=(1, 1))
    roof = [(20, 76), (300, 76), (272, 42), (48, 42)]
    tiled(a, roof, "clay", 0, 6)
    board = rect(118, 50, 84, 20)
    a.block(board, "paper", w=MW * 1.2, second=0)
    for x, w, h in ((40, 46, 52), (82, 40, 44)):
        sack(a, (x, 226), w, h)
    produce_basket(a, (262, 206), 56, 20, "sage", 5)


@art_key("hist_habibie_plane", 320, 240, PK)
def hist_habibie_plane(a):
    """Habibie's N-250 (1995): a high-wing, T-tailed twin-turboprop regional airliner in flight, side view, six-bladed
    propeller; plain livery, no logos or registration."""
    T = Tf((158, 136), 0.88, -6)
    fin = T.pts([(96, -22), (136, -30), (146, -34), (160, -94), (146, -96), (118, -38)])
    a.block(fin, "clay", second=0.3)
    a.hatch(fin, T.ang(70), 4.2, alpha=0.35)
    stab = T.pts([(132, -96), (180, -98), (178, -89), (138, -88)])
    a.block(stab, "slate", w=MW * 1.4, second=0)
    fus = T.pts([(-150, 2), (-146, -8), (-134, -17), (-112, -23), (80, -23), (116, -27), (138, -33), (150, -36),
                 (152, -27), (140, -13), (100, 4), (-120, 11), (-142, 9)])
    a.fill_smooth(fus, "paper", off=(0, 0))
    a.hatch(clip_half(fus, T((0, 2)), T.v((0, 1))), T.ang(4), 4.4, alpha=0.35)
    band = T.pts([(-136, -6), (120, -12), (122, -7), (-134, 0)])
    a.fill_poly(band, "slate", 0.85)
    a.dots(T.pts([(x, -14.5) for x in range(-96, 100, 13)]), 5, "slate")
    a.block(T.pts([(-140, -10), (-128, -17), (-118, -17), (-122, -9)]), "slate", w=MW, second=0)
    a.outline(fus, LW, second=0.4)
    a.line(T((-104, -21)), T((-104, 6)), FW * 1.2, alpha=0.6)
    a.line(T((-92, -21)), T((-92, 6)), FW * 1.2, alpha=0.6)
    # high wing seen edge-on on the roof, the engine nacelle slung under it, the propeller in front
    wing = T.pts([(-30, -24), (-18, -31), (34, -31), (50, -25)])
    a.block(wing, "slate", w=MW * 1.4, second=0)
    nac = T.pts([(-40, -24), (-28, -30), (24, -30), (40, -26), (36, -14), (-30, -12), (-42, -16)])
    a.fill_smooth(nac, "paper", off=(0, 0))
    a.fill_smooth(nac, "slate", 0.3, off=(0, 0))
    a.outline(nac, MW * 1.4, second=0)
    sp = T.pts([(-42, -26), (-52, -21), (-42, -14)])
    a.fill_smooth(sp, "ochre")
    a.outline(sp, MW, second=0, jit=0.1)
    hub = T((-48, -20))
    a.stroke(a.ell_path(hub, 5, 34, rot=-6, wob=0.01), FW * 1.2, "ink", 0.5)
    for tip in ((-51, -54), (-45, 14), (-50, -42), (-46, 2), (-49, -30), (-47, -8)):
        blade = [T((-48.5, -20)), T(tip), T((tip[0] + 2.5, tip[1] + (3 if tip[1] < -20 else -3)))]
        a.fill_poly(blade, "slate", 0.9, jit=0.1)
    a.lines([(hub, T((-51, -54))), (hub, T((-45, 14)))], MW, amp=0.2)


@art_key("hist_blueprint", 240, 240, PK)
def hist_blueprint(a):
    """A blueprint: a pinned sheet with a pale line drawing of an aeroplane in side view, construction circles and
    dimension arrows (no numbers), a ruler and a pencil."""
    T = Tf((118, 112), 1, -4)
    sheet = T.pts([(-92, -72), (92, -72), (92, 52), (72, 72), (-92, 72)])
    a.fill_poly(sheet, "slate", off=(0, 0))
    curl = T.pts([(92, 52), (72, 72), (76, 52)])
    a.fill_poly(curl, "paper", off=(0, 0))
    a.outline_poly(curl, MW, second=0)
    a.lines([(T((-86, y)), T((86, y))) for y in (-48, -24, 0, 24, 48)] + [(T((x, -66)), T((x, 66))) for x in
                                                                          (-60, -30, 0, 30, 60)], FW, "paper", 0.25)
    pl = dict(w=MW * 1.0, color="paper", alpha=0.9, jit=0.2)
    a.curve(T.pts([(-70, 4), (-64, -6), (-48, -12), (40, -12), (56, -16), (66, -20), (68, -12), (58, -2), (30, 6),
                   (-60, 8), (-70, 4)]), **pl)
    a.curve(T.pts([(48, -14), (60, -44), (70, -44), (64, -16)]), **pl)
    a.curve(T.pts([(56, -46), (78, -47)]), **pl)
    a.curve(T.pts([(-20, -14), (-12, -18), (14, -18), (22, -14)]), **pl)
    a.ell_outline(T((-26, -6)), 10, 10, w=FW * 1.2, color="paper", alpha=0.8, second=0)
    a.ell_outline(T((-58, 36)), 14, 14, w=FW * 1.2, color="paper", alpha=0.8, second=0)
    for p0, p1 in (((-70, 26), (68, 26)), ((-80, 12), (-80, -12))):
        a.line(T(p0), T(p1), FW * 1.2, "paper", 0.85, amp=0.1)
        for p, q in ((p0, p1), (p1, p0)):
            d = unit(sub(q, p))
            a.zig([T(add(p, add(mul(d, 6), mul(perp(d), 3)))), T(p), T(add(p, add(mul(d, 6), mul(perp(d), -3))))], FW * 1.2,
                  "paper", 0.85, jit=0.1)
    a.outline_poly(sheet, LW, second=0.4)
    a.dots(T.pts([(-84, -64), (84, -64), (-84, 64)]), 8, "clay")
    ruler = [(40, 204), (206, 170), (210, 184), (44, 218)]
    a.fill_poly(ruler, "ochre")
    ticks = []
    for k in range(18):
        t = 0.05 + k * 0.052
        p = lerp((40, 204), (206, 170), t)
        ticks.append((p, add(p, (1.5, 6 if k % 3 == 0 else 3.5))))
    a.lines(ticks, FW * 1.2, amp=0.1)
    a.outline_poly(ruler, MW * 1.3, second=0)
    pen = [(170, 26), (226, 68), (221, 74), (165, 32)]
    a.fill_poly(pen, "ochre")
    a.fill_poly([(226, 68), (234, 80), (221, 74)], "paper", off=(0, 0))
    a.outline_poly(pen, MW * 1.2, second=0)
    a.dots([(232, 78)], 3.5)


def junk_sail(a, x, top, bot, w, col):
    """A battened lug sail (Chinese junk): a tilted yard, a curved leech, horizontal battens."""
    pts = [(x - w * 0.28, top + 6), (x + w * 0.7, top - 4), (x + w * 0.8, (top + bot) / 2), (x + w * 0.74, bot),
           (x - w * 0.26, bot + 2)]
    a.fill_poly(pts, col)
    bat = []
    n = int((bot - top) / 11)
    for k in range(1, n + 1):
        t = k / (n + 1)
        y0 = top + 6 + (bot + 2 - top - 6) * t
        y1 = top - 4 + (bot - top + 4) * t
        bat.append(((x - w * 0.27, y0), (x + w * (0.7 + 0.1 * math.sin(math.pi * t)), y1)))
    a.lines(bat, MW, alpha=0.8, amp=0.3)
    a.outline_poly(pts, MW * 1.4, second=0)


@art_key("hist_treasure_ship", 320, 240, PK)
def hist_treasure_ship(a):
    """Zheng He's treasure ship (baochuan, early 1400s): a great multi-masted junk with battened lug sails, a high stern
    and a square bow, on the waves (no cannons, no flags with symbols)."""
    masts = [(46, 58, 112, 30, "clay"), (92, 30, 116, 52, "ochre"), (138, 10, 120, 62, "ochre"), (182, 20, 118, 58, "clay"),
             (222, 36, 118, 50, "ochre"), (262, 56, 120, 38, "ochre")]
    for x, top, bot, w, col in masts:
        a.line((x, bot + 8), (x, top - 8), MW * 1.6, amp=0.4)
    for x, top, bot, w, col in masts:
        junk_sail(a, x, top, bot, w, col)
    for x, top, bot, w, col in masts:
        a.fill_poly([(x, top - 8), (x + 12, top - 5), (x, top - 2)], "clay", 0.95, jit=0.2)
    castle = [(14, 94), (66, 100), (66, 126), (18, 124)]
    a.fill_poly(castle, "clay")
    a.fill_poly(rect(18, 106, 46, 6), "paper", 0.85, off=(0, 0))
    a.outline_poly(castle, LW, second=0.4)
    a.lines([((14, 94), (12, 86)), ((40, 97), (40, 89)), ((66, 100), (66, 92))], MW, amp=0.1)
    a.line((10, 86), (68, 92), MW * 1.3, amp=0.2)
    hull = [(16, 122), (66, 126), (250, 130), (296, 112), (304, 116), (296, 142), (262, 166), (80, 170), (40, 158),
            (20, 140)]
    a.fill_poly(hull, "clay")
    a.fill_poly([(18, 128), (290, 124), (298, 130), (22, 136)], "paper", 0.9, off=(0, 0))
    a.fill_poly([(30, 146), (284, 140), (276, 148), (40, 154)], "ochre", 0.9)
    a.hatch(clip_half(hull, (0, 150), (0, 1)), 6, 4.4, alpha=0.4)
    a.outline_poly(hull, LW, second=0.4)
    a.dots([(x, 132) for x in range(70, 270, 22)], 4.2, "slate")
    rud = [(20, 140), (34, 150), (30, 176), (12, 172)]
    a.block(rud, "slate", w=MW * 1.4, second=0)
    for k, y in enumerate((172, 186, 200)):
        x0 = 6 + k * 18
        a.curve([(x0 + i * 22, y + 3 * math.sin(i * 1.6 + k)) for i in range(14 - k)], MW * 1.1, "slate", 0.9)


def brush_marks(a, x, y0, y1, step=13):
    """A column of abstract ink dabs (a placeholder for writing, never a real script): short soft strokes of varied
    length with gaps, like text seen from too far away to read."""
    y = y0
    while y < y1 - 4:
        L = a.u(5, 16)
        if y + L > y1:
            break
        a.line((x + a.j(0.6), y), (x + a.j(0.6), y + L), 3.4, "ink", 0.8, amp=0.3)
        y += L + a.u(3.5, 7)


@art_key("hist_sejong_scroll", 240, 240, PK)
def hist_sejong_scroll(a):
    """A hanging scroll (King Sejong's new writing for everyone): columns of abstract brush marks, not a readable
    script, wooden rollers and a small red seal."""
    a.zig([(84, 34), (120, 10), (156, 34)], MW * 1.2, jit=0.2)
    a.ell((120, 10), 4, 4, "ochre", w=FW * 1.2, second=0)
    sheet = rect(76, 38, 88, 166)
    a.fill_poly(sheet, "paper", off=(0, 0))
    a.fill_poly(sheet, "ochre", 0.14, off=(0, 0))
    for y in (38, 186):
        a.fill_poly(rect(76, y, 88, 18), "sage", 0.75)
    a.outline_poly(sheet, MW * 1.4, second=0.4)
    for k, x in enumerate((148, 128, 108, 92)):
        brush_marks(a, x, 64, 178 - (k == 3) * 40)
    seal = rect(88, 162, 13, 13)
    a.fill_poly(seal, "clay", 0.95)
    a.lines([((91, 166), (98, 166)), ((94.5, 166), (94.5, 172))], FW * 1.2, "paper", 0.8, amp=0.1)
    for y, col in ((34, "ochre"), (204, "clay")):
        a.blob(capsule((66, y), (174, y), 5.5, n=4), col, w=MW * 1.4, second=0)
        for x in (62, 178):
            a.ell((x, y), 6, 7.5, "slate", w=MW, second=0)


@art_key("hist_rain_gauge", 240, 240, PK)
def hist_rain_gauge(a):
    """King Sejong's rain gauge (cheugugi, 1441): a bronze cylinder on a carved stone stand, rain falling into it."""
    base = [(52, 212), (188, 212), (192, 224), (48, 224)]
    a.block(base, "slate", 0.5, second=0.3)
    body = [(66, 140), (174, 140), (174, 212), (66, 212)]
    a.fill_poly(body, "slate", 0.45)
    a.stipple(body, 26, 2.0, alpha=0.45)
    a.hatch(clip_half(body, (150, 0), (1, 0)), 75, 4.2, alpha=0.4)
    a.outline_poly(body, LW, second=0.4)
    a.outline_poly(rect(80, 154, 80, 44), FW * 1.3, second=0)
    lip = [(56, 128), (184, 128), (180, 140), (60, 140)]
    a.block(lip, "slate", 0.6, second=0.3)
    cyl = [(96, 56), (144, 56), (146, 128), (94, 128)]
    a.fill_poly(cyl, "ochre")
    a.fill_poly(cyl, "clay", 0.2, off=(0, 0))
    a.hatch(clip_half(cyl, (132, 0), (1, 0)), 78, 3.8, alpha=0.45)
    a.outline_poly(cyl, LW, second=0.4)
    for y in (82, 106):
        a.curve([(95, y), (120, y + 4), (145, y)], MW * 1.6, "ochre", jit=0.2)
        a.curve([(95, y + 2), (120, y + 6), (145, y + 2)], FW * 1.2, jit=0.2)
    a.fill_smooth(ellipse((120, 56), 24, 6, n=12), "slate", 0.85, off=(0, 0))
    a.ell_outline((120, 56), 24, 6, w=MW * 1.4, second=0)
    for i, (x, y) in enumerate(((104, 20), (126, 34), (140, 12), (86, 40), (156, 42), (116, 8))):
        drop(a, (x, y), 4.2, "slate", 14)


@art_key("hist_spinning_wheel", 320, 240, PK)
def hist_spinning_wheel(a):
    """Gandhi's charkha: a hand spinning wheel whose rim is a zigzag of string between two sets of spokes, a crank, the
    drive band to the spindle and a thread drawn from a tuft of cotton."""
    base = rect(26, 196, 270, 14)
    a.block(base, "ochre", second=0.4)
    a.hatch(base, 4, 4, alpha=0.35)
    for x in (40, 280):
        a.block([(x - 8, 210), (x + 8, 210), (x + 6, 218), (x - 6, 218)], "ochre", w=MW, second=0)
    c, R = (104, 112), 74
    a.blob([(96, 196), (112, 196), (108, 112), (100, 112)], "ochre", w=MW * 1.4, second=0)
    spokes = []
    for i in range(12):
        t = i * 30 + 8
        spokes.append((polar(c, 9, t), polar(c, R - (0 if i % 2 == 0 else 7), t + 3)))
    p = Path()
    for s0, s1 in spokes:
        a.seg(add(s0, a.reg("ochre")), add(s1, a.reg("ochre")), 0.4, p)
    a.stroke(p, 4.5, "ochre")
    a.lines(spokes, FW * 1.2, amp=0.4)
    zz = [s1 for _, s1 in spokes]
    a.zig(zz + [zz[0]], FW * 1.4, jit=0.3)
    a.ell(c, 11, 11, "slate", w=MW * 1.3, second=0)
    crank = polar(c, 34, 62)
    a.line(c, crank, LW * 1.1, amp=0.2)
    a.blob(capsule(crank, add(crank, (4, 14)), 4.5, n=3), "clay", w=MW, second=0)
    # spindle on its post and the drive band
    sp = (246, 150)
    a.blob([(240, 196), (252, 196), (250, 156), (242, 156)], "ochre", w=MW * 1.3, second=0)
    a.line((228, 150), (300, 147), MW * 1.3, "slate", amp=0.2)
    a.ell(sp, 7, 7, "ochre", w=MW, second=0)
    a.lines([(polar(c, R, -100), (sp[0], sp[1] - 7)), (polar(c, R, 70), (sp[0], sp[1] + 7))], FW * 1.2, alpha=0.8, amp=0.4)
    pc = (298, 172)
    puff = [polar(pc, (13 if i % 2 == 0 else 10) * a.u(0.9, 1.1), i * 30) for i in range(12)]
    puff = [(x, min(y, 186)) for x, y in puff]
    a.fill_smooth(puff, "paper", off=(0, 0))
    a.outline(puff, MW * 1.1, second=0.3, jit=0.6)
    a.curve([(300, 147), (296, 154), (298, 160)], FW * 1.2, jit=0.1)


@art_key("hist_sandals_path", 320, 240, PK)
def hist_sandals_path(a):
    """A long dusty road walked on foot (the Salt March, 1930): a pair of simple leather sandals and footprints going
    into the distance."""
    left = [(40, 236), (90, 180), (124, 120), (144, 70), (152, 36)]
    right = [(280, 236), (222, 180), (190, 120), (172, 70), (166, 36)]
    road = left + right[::-1]
    a.fill_smooth(road, "ochre", 0.5)
    a.stipple(road, 40, 1.8, alpha=0.45)
    a.curve(left, MW * 1.3, jit=0.4)
    a.curve(right, MW * 1.3, jit=0.4)
    tufts(a, [(30, 226), (66, 176), (100, 126), (240, 186), (286, 222), (206, 110)], 8, MW, 0.7)
    prints = []
    for k in range(9):
        t = k / 9
        y = 170 - 128 * (1 - (1 - t) ** 1.6)
        x = 160 + (6 if k % 2 else -6) * (1 - t * 0.7)
        s = 1.0 - t * 0.8
        prints.append(((x, y), s))
    for (x, y), s in prints:
        a.fill_smooth(ellipse((x, y), 4.2 * s, 9 * s, n=8), "clay", 0.55)
    # the sandals: leather soles, a toe post and a cross strap
    for cx, rot in ((128, -8), (184, 10)):
        T = Tf((cx, 206), 1, rot)
        sole = T.pts([(0, -26), (9, -22), (12, -6), (10, 10), (11, 22), (5, 28), (-5, 28), (-10, 20), (-9, 8), (-12, -8),
                      (-9, -22)])
        a.fill_smooth(sole, "clay")
        a.hatch(clip_half(sole, T((4, 0)), T.v((1, 0))), T.ang(80), 3.6, alpha=0.4)
        a.outline(sole, LW, second=0.3, jit=0.3)
        a.curve(T.pts([(-11, -4), (-2, -14), (11, -6)]), 4.2, "ochre")
        a.curve(T.pts([(-11, -4), (-2, -14), (11, -6)]), FW, jit=0.1)
        a.line(T((-2, -14)), T((-2, -22)), MW * 1.3, amp=0.1)
        a.dots([T((-2, -23))], 5, "ochre")


@art_key("hist_khwarizmi_board", 240, 240, PK)
def hist_khwarizmi_board(a):
    """Al-Khwarizmi's dust board: a wooden tray of fine sand with marks drawn by a stick, a square completed with
    rectangles (his geometric way of solving), dots and a circle; no digits."""
    T = Tf((118, 116), 1, -5)
    frame = T.pts(rect(-96, -72, 192, 144))
    a.block(frame, "ochre", second=0.4)
    a.hatch(clip_half(frame, T((70, 0)), T.v((1, 0))), T.ang(75), 4, alpha=0.4)
    sand = T.pts(rect(-82, -58, 164, 116))
    a.fill_poly(sand, "ochre", 0.45, off=(0, 0))
    a.fill_poly(sand, "paper", 0.35, off=(0, 0))
    a.stipple(sand, 40, 1.6, alpha=0.4)
    a.outline_poly(sand, MW * 1.2, second=0)
    groove = dict(w=MW * 1.2, alpha=0.8, jit=0.4)
    sq = [(-66, -42), (-4, -42), (-4, 20), (-66, 20)]
    a.curve(T.pts(sq + [(-66, -40)]), **groove)
    a.curve(T.pts([(-24, -42), (-24, 20)]), **groove)
    a.curve(T.pts([(-66, 0), (-4, 0)]), **groove)
    a.fill_poly(T.pts([(-23, 1), (-5, 1), (-5, 19), (-23, 19)]), "clay", 0.45, off=(0, 0))
    a.dots(T.pts([(16 + 10 * i, -40 + 10 * j) for i in range(4) for j in range(3) if (i + j) % 3 != 2]), 3.4, "ink", 0.7)
    a.curve(T.pts(ellipse((44, 30), 18, 18, n=10)[:10]), **groove)
    a.curve(T.pts([(26, 30), (62, 30)]), **groove)
    a.curve(T.pts([(-60, 40), (-40, 34), (-20, 44), (-2, 36)]), **groove)
    sty = [(150, 214), (226, 176), (229, 181), (154, 219)]
    a.block(sty, "clay", w=MW * 1.2, second=0)
    a.zig([(226, 176), (236, 172), (229, 181)], MW, jit=0.1)


@art_key("hist_ibn_sina_book", 240, 240, PK)
def hist_ibn_sina_book(a):
    """Ibn Sina's Canon of Medicine: a large open book with lines of writing (abstract) and a drawing of a medicinal
    plant, a tooled leather cover and a ribbon."""
    a.blob([(116, 168), (126, 168), (126, 222), (121, 214), (116, 222)], "sage", w=MW * 1.2, second=0)
    T = Tf((120, 120), 0.98)
    cover = T.pts([(-110, -46), (-4, -60), (4, -60), (108, -50), (112, 38), (4, 50), (-4, 50), (-112, 42)])
    a.block(cover, "clay", second=0)
    a.dots(T.pts([(-106 + 8 * k, 40 - 0.1 * k * 8) for k in range(1, 13)] + [(8 + 8 * k, 44 - 0.08 * k * 8)
                                                                               for k in range(12)]), 2.4, "ochre")
    for side in (-1, 1):
        page = T.pts([(0, -58), (side * 30, -70), (side * 70, -71), (side * 100, -58), (side * 102, 30), (side * 62, 23),
                      (side * 26, 28), (0, 42)])
        a.fill_poly(page, "paper", off=(0, 0), step=12)
        a.outline_poly(page, MW * 1.4, second=0)
        a.curve(T.pts([(side * 101, 34), (side * 60, 28), (side * 24, 33), (0, 46)]), FW * 1.2)
    border = T.pts([(14, -58), (90, -58), (90, 18), (14, 22)])
    a.outline_poly(border, FW * 1.2, second=0)
    for k in range(7):
        y = -48 + k * 10
        squiggle(a, T((22, y)), T((82, y - 1)), 1.1, w=FW * 1.2, alpha=0.55)
    stem = T.pts([(-52, 18), (-54, -10), (-50, -40), (-56, -58)])
    a.curve(stem, MW * 1.2, "sage")
    for base, tip in (((-54, -6), (-84, -18)), ((-53, -22), (-24, -36)), ((-52, -40), (-78, -54)), ((-54, 6), (-26, -2))):
        lf = T.pts(leaf_pts(base, tip, 8))
        a.fill_smooth(lf, "sage")
        a.outline(lf, FW * 1.3, second=0, jit=0.2)
    a.dots(T.pts([(-56, -60), (-60, -56), (-52, -57)]), 5, "ochre")
    for k in range(3):
        squiggle(a, T((-88, 4 + k * 8)), T((-62 if k < 2 else -70, 4 + k * 8)), 0.9, w=FW * 1.1, alpha=0.5)
    a.line(T((0, -58)), T((0, 42)), MW, amp=0.4)


@art_key("hist_herbs_mortar", 240, 240, PK)
def hist_herbs_mortar(a):
    """A bronze mortar and pestle with medicinal herbs: leafy sprigs, dried flowers and seeds (Ibn Sina's medicines)."""
    pest = capsule((136, 132), (196, 58), 7, 11, n=4)
    a.blob(pest, "clay", second=0.3)
    a.hatch(clip_half(pest, (170, 90), (0.8, 0.6)), 30, 3.6, alpha=0.4)
    for base, tip in (((100, 136), (82, 104)), ((112, 134), (116, 98)), ((90, 138), (64, 118))):
        lf = leaf_pts(base, tip, 9)
        a.fill_smooth(lf, "sage")
        a.outline(lf, MW, second=0, jit=0.2)
        a.line(base, lerp(base, tip, 0.8), FW, amp=0.2)
    rim = ellipse((120, 138), 62, 13, n=16)
    a.fill_smooth(rim, "slate", 0.75, off=(0, 0))
    bowl = [(58, 138), (182, 138), (176, 170), (154, 198), (86, 198), (64, 170)]
    a.fill_smooth(bowl + [(120, 150)], "ochre")
    a.hatch(clip_half(bowl, (150, 0), (1, 0)), 70, 4.2, alpha=0.45)
    a.dots([(74 + 9.5 * k, 158 + 0.6 * abs(k - 5)) for k in range(11)], 3.2, "clay")
    a.curve([(62, 140), (70, 172), (92, 196), (148, 196), (170, 172), (178, 140)], LW)
    a.ell_outline((120, 138), 62, 13, w=LW)
    a.block([(92, 198), (148, 198), (156, 214), (84, 214)], "ochre", w=MW * 1.4, second=0)
    sprig = [(18, 222), (40, 208), (64, 204)]
    a.curve(sprig, MW * 1.2, "sage")
    for base, tip in (((30, 214), (22, 196)), ((42, 207), (40, 188)), ((52, 205), (62, 190)), ((36, 212), (48, 224))):
        lf = leaf_pts(base, tip, 6)
        a.fill_smooth(lf, "sage")
        a.outline(lf, FW * 1.3, second=0, jit=0.2)
    a.dots([(186, 216), (194, 220), (200, 214), (190, 210), (204, 222)], 4.2, "clay")
    for c in ((206, 196), (218, 204)):
        for t in range(0, 360, 72):
            a.dots([polar(c, 4, t)], 4.5, "ochre")
        a.dots([c], 3, "clay")
    a.line((10, 225), (230, 224), MW, alpha=0.5)


@art_key("hist_camera_obscura", 320, 240, PK)
def hist_camera_obscura(a):
    """Ibn al-Haytham's camera obscura: a candle outside a dark box, light through a small hole, the flame's image
    upside down on the back wall."""
    hole = (116, 124)
    top, base = (50, 102), (50, 150)
    box = [(116, 42), (296, 42), (296, 196), (116, 196)]
    a.fill_poly(box, "slate", 0.85)
    a.hatch(box, 30, 9, alpha=0.18)
    side = [(116, 42), (130, 30), (306, 30), (296, 42)]
    a.block(side, "slate", 0.55, w=MW * 1.3, second=0)
    side2 = [(296, 42), (306, 30), (306, 184), (296, 196)]
    a.block(side2, "slate", 0.65, w=MW * 1.3, second=0)
    a.outline_poly(box, LW, second=0.4)
    a.fill_poly(rect(112, 42, 8, 154), "ochre", 0.9)
    a.outline_poly(rect(112, 42, 8, 154), MW * 1.2, second=0)
    a.fill_poly([(111, 120), (121, 120), (121, 128), (111, 128)], "paper", off=(0, 0), jit=0.1)
    # rays: from the flame top and the candle foot, crossing at the hole
    for p in (top, base):
        d = unit(sub(hole, p))
        far = add(hole, mul(d, (290 - hole[0]) / d[0]))
        a.line(p, hole, MW, "ochre", 0.95, amp=0.2)
        a.line(hole, far, MW, "ochre", 0.95, amp=0.2)
    # candle
    a.block([(40, 120), (60, 120), (60, 152), (40, 152)], "paper", w=MW * 1.3, second=0)
    a.block([(30, 152), (70, 152), (66, 160), (34, 160)], "ochre", w=MW * 1.2, second=0)
    fl = [(50, 100), (56, 110), (55, 117), (50, 120), (45, 117), (44, 110)]
    a.fill_smooth(fl, "ochre")
    a.fill_smooth([(50, 108), (53, 114), (50, 118), (47, 114)], "clay", 0.9)
    a.outline(fl, MW, second=0, jit=0.1)
    # the image on the back wall: the same candle, upside down and larger
    T = Tf((282, 124), 1.6, 180)
    img = [((-6, -4), (6, -4)), ((6, -4), (6, 20)), ((6, 20), (-6, 20)), ((-6, 20), (-6, -4))]
    a.lines([(T(p), T(q)) for p, q in img], MW, "paper", 0.85, amp=0.2)
    a.fill_smooth(T.pts([(0, -24), (4, -16), (3.5, -10), (0, -7), (-3.5, -10), (-4, -16)]), "ochre", 0.95, off=(0, 0))


@art_key("hist_lens", 240, 240, PK)
def hist_lens(a):
    """A glass lens in a brass rim (Ibn al-Haytham's optics): parallel rays of light bend through it and meet at one
    bright point."""
    c, H, t = (112, 120), 74, 18
    focus = (212, 120)
    ys = (66, 92, 148, 174)
    for y in ys:
        a.line((10, y), (c[0] - 6, y), MW * 1.1, "ochre", amp=0.2)
        a.zig([(40, y - 5), (48, y), (40, y + 5)], MW, "ochre", jit=0.1)
        a.line((c[0] + 6, y), focus, MW * 1.1, "ochre", amp=0.2)
    left = [(c[0] - t * math.cos(math.radians(th)) * 1.0, c[1] + H * math.sin(math.radians(th))) for th in
            range(-90, 91, 15)]
    right = [(c[0] + t * math.cos(math.radians(th)), c[1] - H * math.sin(math.radians(th))) for th in range(-90, 91, 15)]
    lens = left + right
    a.fill_smooth(lens, "paper", 0.75, off=(0, 0))
    a.fill_smooth(lens, "slate", 0.2, off=(0, 0))
    a.curve([(c[0] - 8, c[1] - 52), (c[0] - 12, c[1] - 20), (c[0] - 11, c[1] + 6)], MW, "paper", 0.95, jit=0.1)
    a.outline(lens, LW, second=0.4, jit=0.2)
    for y in (c[1] - H - 4, c[1] + H + 4):
        rim = [(c[0] - 12, y - 5), (c[0] + 12, y - 5), (c[0] + 12, y + 5), (c[0] - 12, y + 5)]
        a.block(rim, "ochre", w=MW * 1.2, second=0)
    sc = focus
    a.fill_smooth([polar(sc, 9 if i % 2 == 0 else 3.5, i * 45) for i in range(8)], "ochre")
    a.outline([polar(sc, 9 if i % 2 == 0 else 3.5, i * 45) for i in range(8)], FW * 1.2, second=0, jit=0.1)


def camel(a, x, gy, s=1.0, load=("clay", "sage"), step=0):
    """A dromedary walking right, carrying a blanket and two bundles."""
    T = Tf((x, gy), s)
    leg_sets = [((-24, -46), (-28, -24), (-30, 0)), ((-16, -46), (-12, -24), (-8, 0)), ((20, -46), (24, -22), (30, 0)),
                ((28, -46), (24, -22), (20, 0))]
    if step:
        leg_sets = [leg_sets[1], leg_sets[0], leg_sets[3], leg_sets[2]]
    for i, (h, k, f) in enumerate(leg_sets):
        leg = T.pts(ribbon([h, k, f], 9, 5, steps=1))
        if i in (1, 3):
            a.fill_smooth(leg, "ochre")
            a.outline(leg, MW, second=0, jit=0.2)
        else:
            a.fill_smooth(leg, "clay", 0.7)
    body = T.pts([(-40, -50), (-30, -64), (-14, -86), (2, -80), (14, -66), (30, -62), (38, -54), (32, -42), (-30, -42),
                  (-40, -46)])
    a.fill_smooth(body, "ochre")
    a.outline(body, LW, second=0)
    neck = T.pts(ribbon([(30, -58), (46, -52), (56, -66), (60, -78)], 16, 9, steps=1))
    a.fill_smooth(neck, "ochre")
    a.outline(neck, MW * 1.3, second=0, jit=0.2)
    head = T.pts([(54, -82), (66, -86), (76, -80), (76, -74), (64, -72), (56, -74)])
    a.fill_smooth(head, "ochre")
    a.outline(head, MW * 1.3, second=0, jit=0.2)
    a.line(T((58, -84)), T((56, -90)), MW, amp=0.1)
    a.curve(T.pts([(-40, -50), (-46, -40), (-44, -30)]), MW * 1.2, jit=0.2)
    blanket = T.pts([(-26, -82), (8, -84), (18, -62), (12, -46), (-28, -46), (-36, -60)])
    a.fill_poly(blanket, load[0], 0.95)
    a.lines([(T((-30, -52)), T((14, -52)))], MW, "paper", 0.7)
    a.outline_poly(blanket, MW * 1.3, second=0)
    for bx, by, col in ((-30, -50, load[1]), (12, -50, "ochre")):
        bun = T.pts(ellipse((bx, by), 9, 12, n=9))
        a.fill_smooth(bun, col)
        a.outline(bun, MW * 1.2, second=0, jit=0.2)
    return T((70, -76)), T((-40, -48))


@art_key("hist_caravan", 320, 240, PK)
def hist_caravan(a):
    """A caravan crossing the desert (Ibn Battuta): three loaded camels tied in a line, a walker leading them."""
    gy = 206
    a.fill_smooth([(0, gy + 2), (60, gy - 4), (150, gy), (240, gy - 6), (320, gy), (320, 230), (0, 230)], "ochre", 0.45)
    a.curve([(0, gy + 2), (60, gy - 4), (150, gy), (240, gy - 6), (320, gy)], MW * 1.2, jit=0.4)
    heads, tails = [], []
    for k, (x, ld, st) in enumerate(((48, ("sage", "clay"), 0), (134, ("clay", "sage"), 1), (220, ("slate", "ochre"), 0))):
        h, t = camel(a, x, gy, 0.82, ld, st)
        heads.append(h)
        tails.append(t)
    for k in range(2):
        a.curve([heads[k], lerp(heads[k], tails[k + 1], 0.5), tails[k + 1]], FW * 1.3, jit=0.4)
    s = Sil(a, 290, H=82, lean=6, arms=((-20, -40), (30, 20)), legs=((22, 6), (-18, -30)), gy=gy + 2)
    for i in (1, 0):
        s.leg(i, 1.2, 1.1)
    s.arm(1, 1.3)
    inkp(a, [s.T(1.0, -0.035), s.T(0.6, -0.066), s.T(0.0, -0.07), add(s.kn[1], mul(s.fw, -0.03 * s.H)),
             add(s.kn[0], mul(s.fw, 0.05 * s.H)), s.T(0.0, 0.07), s.T(0.7, 0.072), s.T(1.0, 0.03)])
    s.head()
    head_extra(s, "headwrap")
    s.arm(0, 1.3)
    a.curve([heads[2], lerp(heads[2], s.hd[0], 0.5), s.hd[0]], FW * 1.3, jit=0.3)


@art_key("hist_route_map", 320, 240, PK)
def hist_route_map(a):
    """An old travel map with rolled ends: coasts and islands, a dotted route joining ports, a little ship and a compass
    rose (no names, no letters)."""
    sheet = [(40, 34), (282, 30), (284, 206), (38, 210)]
    a.fill_poly(sheet, "paper", off=(0, 0))
    a.fill_poly(sheet, "ochre", 0.35, off=(0, 0))
    lands = [[(40, 34), (150, 32), (140, 52), (120, 60), (110, 84), (84, 98), (60, 92), (40, 100)],
             [(160, 210), (176, 178), (198, 168), (210, 150), (232, 160), (236, 182), (226, 210)],
             [(240, 70), (262, 62), (276, 76), (264, 92), (244, 88)],
             [(200, 104), (214, 98), (222, 110), (208, 118)],
             [(282, 120), (266, 132), (270, 150), (284, 156)],
             [(38, 150), (60, 156), (74, 176), (62, 196), (38, 200)]]
    for l in lands:
        a.fill_smooth(l, "sage", 0.85)
    for l in lands:
        a.outline(l, MW * 1.1, second=0, jit=0.3)
    wav = []
    for x, y in ((150, 80), (180, 130), (110, 150), (240, 120), (96, 128), (196, 64)):
        wav.append([(x, y), (x + 6, y - 3), (x + 12, y)])
    for w_ in wav:
        a.curve(w_, FW * 1.2, "slate", 0.7, jit=0.1)
    route = [(70, 176), (104, 118), (160, 104), (206, 140), (252, 82)]
    pts = []
    for i in range(len(route) - 1):
        for t in frange(0, 1, 0.12)[:-1]:
            pts.append(lerp(route[i], route[i + 1], t))
    pts.append(route[-1])
    a.dots(pts, 3.4, "clay")
    for p in route:
        a.ell(p, 6, 6, "ochre", w=MW * 1.2, second=0)
    bc = (134, 100)
    a.fill_poly([(bc[0] - 9, bc[1]), (bc[0] + 9, bc[1]), (bc[0] + 6, bc[1] + 5), (bc[0] - 6, bc[1] + 5)], "ink", 0.9)
    a.fill_poly([(bc[0] - 1, bc[1] - 1), (bc[0] - 1, bc[1] - 14), (bc[0] + 8, bc[1] - 2)], "ink", 0.9)
    c = (250, 182)
    star = [polar(c, 14 if i % 2 == 0 else 4, -90 + 45 * i) for i in range(8)]
    a.fill_smooth(star, "clay", 0.8)
    a.outline(star, FW * 1.3, second=0, jit=0.1)
    a.outline_poly(sheet, MW * 1.4, second=0.4)
    for x, d in ((38, -1), (284, 1)):
        roll = [(x - 9, 26), (x + 9, 24), (x + 9, 214), (x - 9, 216)]
        a.fill_poly(roll, "paper", off=(0, 0))
        a.fill_poly(roll, "ochre", 0.55, off=(0, 0))
        a.hatch(clip_half(roll, (x + 2 * d, 0), (d, 0)), 85, 3.4, alpha=0.4)
        a.outline_poly(roll, LW, second=0.3)
        a.ell((x, 25), 9, 3.5, "ochre", w=MW, second=0)


def horseshoe_arch(cx, top, half, base_y, n=14):
    """A horseshoe arch opening: a circle drawn past its half, then straight jambs down to the floor."""
    r = half * 1.12
    c = (cx, top + r)
    a0, a1 = 150, 390
    arc = [polar(c, r, a0 + (a1 - a0) * i / n) for i in range(n + 1)]
    return [(arc[0][0], base_y)] + arc + [(arc[-1][0], base_y)]


@art_key("hist_qarawiyyin", 320, 240, PK)
def hist_qarawiyyin(a):
    """The Qarawiyyin in Fez (founded 859 by Fatima al-Fihri): a courtyard of horseshoe arches under green tiled roofs,
    a band of geometric zellige tiles and a round fountain (no religious symbols, no inscriptions)."""
    wall = rect(14, 64, 292, 132)
    a.fill_poly(wall, "paper", off=(0, 0))
    a.fill_poly(wall, "ochre", 0.18, off=(0, 0))
    for cx in (52, 122, 198, 268):
        op = horseshoe_arch(cx, 84, 26, 170)
        a.fill_smooth(op, "slate", 0.55)
        a.outline(op, MW * 1.4, second=0.3, jit=0.2)
        a.curve(horseshoe_arch(cx, 79, 31, 170)[1:-1], FW * 1.3, jit=0.2)
    a.outline_poly(wall, LW, second=0.4)
    # zellige band: a row of small diamonds and squares
    band = rect(14, 170, 292, 22)
    a.fill_poly(band, "paper", off=(0, 0))
    cols = ("sage", "ochre", "slate")
    for k, x in enumerate(frange(22, 300, 14)):
        d = [(x, 172), (x + 6, 181), (x, 190), (x - 6, 181)]
        a.fill_poly(d, cols[k % 3], 0.95, jit=0.2)
    a.dots([(x + 7, 181) for x in frange(22, 296, 14)], 3, "clay")
    a.outline_poly(band, MW * 1.3, second=0)
    frieze = rect(14, 64, 292, 9)
    a.fill_poly(frieze, "ochre", 0.85)
    a.dots([(x, 68.5) for x in frange(20, 302, 9)], 2.2, "clay")
    roof = [(4, 66), (316, 66), (294, 34), (26, 34)]
    a.fill_poly(roof, "sage")
    a.hatch(roof, 90, 6, alpha=0.4)
    a.lines([((10, 56), (310, 56)), ((18, 46), (302, 46))], FW * 1.2, alpha=0.5)
    a.outline_poly(roof, LW, second=0.4)
    a.line((22, 34), (298, 34), LW * 1.2, over=(2, 2))
    # floor and the fountain
    a.line((10, 196), (310, 196), MW * 1.2)
    a.lines([((x, 198), (x - 14, 224)) for x in frange(40, 300, 40)], FW, alpha=0.4)
    fc = (160, 210)
    a.fill_smooth(ellipse(fc, 52, 12, n=16), "slate", 0.6)
    a.fill_smooth([(108, 210), (212, 210), (206, 226), (114, 226)], "sage")
    a.dots([(118 + 8 * k, 218) for k in range(12)], 3, "ochre")
    a.curve([(108, 210), (110, 222), (116, 227), (204, 227), (210, 222), (212, 210)], LW)
    a.ell_outline(fc, 52, 12, w=LW)
    a.block([(156, 210), (164, 210), (163, 186), (157, 186)], "sage", w=MW, second=0)
    a.fill_smooth(ellipse((160, 184), 14, 4, n=10), "sage")
    a.ell_outline((160, 184), 14, 4, w=MW, second=0)
    for sx in (-1, 1):
        a.curve([(160, 180), (160 + sx * 10, 168), (160 + sx * 22, 178), (160 + sx * 26, 204)], MW, "slate", jit=0.1)


def hand_shape(a, T, tone, pts):
    a.tone = tone
    skin_parts(a, [T.pts(pts)])
    a.outline(T.pts(pts), MW * 1.4, second=0, jit=0.2)


@art_key("hist_handshake", 240, 240, PK)
def hist_handshake(a):
    """Two hands of different skin tones clasped in a handshake (Mandela: reconciliation): one cuff patterned, one
    plain."""
    h = Tf((120 * (1 - 1.32), 138 * (1 - 1.32)), 1.32)  # scale the hands about the clasp
    a.tone = "deep"
    # left person's fingers, wrapped under the other hand (deep)
    fingers = [h.pts(capsule((124 + 7 * k, 142 + 2 * k), (134 + 8 * k, 160 + 1 * k), 4.6, n=3)) for k in range(4)]
    skin_parts(a, fingers)
    for f in fingers:
        a.outline(f, MW * 1.1, second=0, jit=0.15)
    # left person's palm and wrist (deep)
    palmL = h.pts([(78, 132), (92, 120), (118, 118), (124, 140), (118, 160), (88, 166), (78, 160)])
    skin_parts(a, [palmL])
    a.outline(palmL, MW * 1.4, second=0, jit=0.2)
    # right person's hand (light): the back of the hand and four fingers curling round
    a.tone = "light"
    back = h.pts([(164, 128), (150, 116), (120, 116), (104, 122), (98, 136), (100, 152), (112, 160), (150, 160),
                  (164, 158)])
    skin_parts(a, [back])
    a.outline(back, MW * 1.4, second=0, jit=0.2)
    a.lines([(h((118 - 2 * k, 120 + 9 * k)), h((104 - k, 124 + 9 * k))) for k in range(4)], MW * 0.9, amp=0.2)
    a.curve(h.pts([(128, 120), (124, 136), (126, 152)]), FW * 1.2, alpha=0.6, jit=0.2)
    # left person's thumb lying over the back of the other hand
    a.tone = "deep"
    thumb = h.pts(capsule((96, 126), (138, 110), 7, 5.5, n=4))
    skin_parts(a, [thumb])
    a.outline(thumb, MW * 1.3, second=0, jit=0.15)
    a.curve(h.pts([(130, 108), (136, 108), (140, 112)]), FW * 1.2, alpha=0.7, jit=0.1)
    # sleeves: a patterned cuff (left) and a plain cuff (right)
    sl = [(0, 176), (2, 124), (50, 120), (52, 182), (0, 222)]
    a.fill_poly(sl, "clay")
    a.dots([(x, y) for x in frange(12, 64, 10) for y in frange(132, 196, 12) if inside((x, y), sl)], 3.0, "ochre", 0.95)
    a.outline_poly(sl, LW, second=0.3)
    a.fill_poly([(46, 116), (58, 116), (58, 186), (46, 186)], "paper", off=(0, 0))
    a.outline_poly([(46, 116), (58, 116), (58, 186), (46, 186)], MW * 1.2, second=0)
    sr = [(240, 176), (238, 120), (190, 118), (188, 182), (240, 222)]
    a.fill_poly(sr, "slate")
    a.hatch(sr, 70, 5, alpha=0.3)
    a.outline_poly(sr, LW, second=0.3)
    a.fill_poly([(180, 114), (192, 114), (192, 186), (180, 186)], "paper", off=(0, 0))
    a.outline_poly([(180, 114), (192, 114), (192, 186), (180, 186)], MW * 1.2, second=0)


def polybag(a, c, w=30, h=30):
    x, y = c
    bag = [(x - w / 2, y - h), (x + w / 2, y - h), (x + w / 2 + 2, y), (x - w / 2 - 2, y)]
    a.fill_poly(bag, "slate", 0.9)
    a.lines([((x - w / 4, y - h + 4), (x - w / 4 + 2, y - 4)), ((x + w / 5, y - h + 6), (x + w / 5 - 1, y - 6))], FW,
            "paper", 0.55)
    a.outline_poly(bag, MW * 1.3, second=0)
    a.fill_smooth(ellipse((x, y - h), w / 2, 4, n=8), "clay", 0.95)


def seedling(a, base, h=34, s=1.0):
    top = add(base, (2, -h))
    a.curve([base, add(base, (-1, -h * 0.5)), top], MW * 1.2, "sage")
    for k, (dx, dy, ang) in enumerate(((0, 0, -40), (0, 0, 220), (0, h * 0.4, -20), (0, h * 0.4, 200))):
        b = add(top, (dx, dy))
        tip = add(b, mul(dirv(ang), 16 * s * (0.8 if k > 1 else 1)))
        lf = leaf_pts(b, tip, 6 * s)
        a.fill_smooth(lf, "sage")
        a.outline(lf, FW * 1.3, second=0, jit=0.15)


@art_key("hist_tree_seedlings", 240, 240, PK)
def hist_tree_seedlings(a):
    """Planting trees (Wangari Maathai's Green Belt Movement): a young tree just planted in a ring of soil, seedlings
    waiting in small bags, a watering can."""
    a.fill_smooth([(20, 214), (40, 202), (110, 200), (150, 206), (156, 218), (24, 222)], "clay", 0.55)
    a.curve([(22, 214), (40, 202), (110, 200), (150, 206)], MW * 1.2, jit=0.3)
    a.stipple([(30, 214), (40, 206), (140, 206), (150, 216)], 10, 2.0, alpha=0.5)
    trunk = [(84, 206), (86, 150), (82, 110), (90, 110), (94, 150), (96, 206)]
    a.blob(trunk, "clay", w=MW * 1.4, second=0)
    a.curve([(88, 140), (70, 120), (62, 112)], MW * 1.3, jit=0.1)
    a.curve([(90, 128), (108, 112), (114, 100)], MW * 1.3, jit=0.1)
    can = [(86, 30), (116, 34), (136, 52), (142, 76), (132, 100), (108, 112), (78, 112), (50, 102), (38, 80), (44, 54),
           (60, 36)]
    a.fill_smooth(can, "sage")
    a.hatch(clip_half(can, (110, 90), (0.6, 0.8)), 55, 4.4, alpha=0.4)
    a.outline(can, LW, second=0.4)
    for c in ((70, 62), (104, 54), (118, 84), (76, 92)):
        a.arc(c, 11, 200, 340, MW, alpha=0.7)
    for x in (150, 182, 214):
        polybag(a, (x, 222), 26, 26)
        seedling(a, (x, 196), 30 + (x % 7), 0.9)
    wc = [(34, 152), (64, 152), (66, 188), (32, 188)]
    a.fill_poly(wc, "slate", 0.8)
    a.outline_poly(wc, MW * 1.3, second=0)
    a.curve([(64, 160), (82, 146), (94, 136)], MW * 1.6, "slate")
    a.curve([(64, 160), (82, 146), (94, 136)], FW, jit=0.1)
    a.fill_poly([(90, 132), (100, 130), (98, 140)], "slate", jit=0.1)
    a.arc((49, 150), 13, 190, 350, MW * 1.3)


@art_key("hist_curie_flask", 240, 240, PK)
def hist_curie_flask(a):
    """Marie Curie's work: a round-bottomed flask on a cork ring holding a faintly shining sage liquid (drawn marks
    only, no glow effect), and a test tube."""
    c = (112, 140)
    R = 56
    neck = [(c[0] - 12, c[1] - R - 64), (c[0] + 12, c[1] - R - 64), (c[0] + 13, c[1] - R + 6), (c[0] - 13, c[1] - R + 6)]
    bulb = ellipse(c, R, R * 0.96, n=20)
    a.fill_smooth(bulb, "paper", 0.9, off=(0, 0))
    a.fill_poly(neck, "paper", 0.9, off=(0, 0))
    liq = [(c[0] - R + 3, c[1] + 6), (c[0] - 30, c[1] - 2), (c[0], c[1] + 2), (c[0] + 30, c[1] - 2),
           (c[0] + R - 3, c[1] + 6), (c[0] + 40, c[1] + 40), (c[0], c[1] + R * 0.94), (c[0] - 40, c[1] + 40)]
    a.fill_smooth(liq, "sage")
    a.dots([(c[0] - 20, c[1] + 22), (c[0] + 12, c[1] + 30), (c[0] + 26, c[1] + 14), (c[0] - 6, c[1] + 40)], 3.6, "paper",
           0.9)
    rays = [(polar(c, R + 10, t), polar(c, R + 22, t)) for t in (-150, -120, -60, -30, 10, 170, 200)]
    a.lines(rays, MW * 1.2, "sage", 0.95, amp=0.2)
    a.ell_outline(c, R, R * 0.96, w=LW, wob=0.015)
    a.lines([((c[0] - 12, c[1] - R - 64), (c[0] - 13, c[1] - R + 4)), ((c[0] + 12, c[1] - R - 64), (c[0] + 13, c[1] - R + 4))],
            LW, amp=0.3)
    a.ell_outline((c[0], c[1] - R - 64), 14, 4, w=MW * 1.3, second=0)
    stop = [(c[0] - 10, c[1] - R - 80), (c[0] + 10, c[1] - R - 80), (c[0] + 9, c[1] - R - 64), (c[0] - 9, c[1] - R - 64)]
    a.block(stop, "clay", w=MW * 1.2, second=0)
    a.curve([(c[0] - 34, c[1] - 30), (c[0] - 44, c[1] - 10), (c[0] - 44, c[1] + 10)], MW * 1.2, "paper", 0.95, jit=0.1)
    ring = ellipse((c[0], c[1] + R * 0.96 + 4), 36, 8, n=12)
    a.blob(ring, "ochre", w=MW * 1.4, second=0)
    tt = [(196, 104), (212, 104), (212, 196), (204, 204), (196, 196)]
    a.fill_poly(tt, "paper", 0.9, off=(0, 0))
    a.fill_poly([(197, 160), (211, 160), (211, 196), (204, 203), (197, 196)], "clay", 0.85)
    a.outline_poly(tt, MW * 1.4, second=0)
    a.line((192, 104), (216, 104), MW * 1.3, amp=0.1)
    a.line((20, 214), (228, 213), MW, alpha=0.6)


@art_key("hist_notebook", 240, 240, PK)
def hist_notebook(a):
    """A scientist's open notebook: lines of hand-writing (abstract), a small sketched apparatus and a rising
    measurement curve with dots (no numbers), a pencil."""
    T = Tf((118, 118), 1, -4)
    cover = T.pts([(-104, -74), (104, -74), (106, 78), (-106, 78)])
    a.block(cover, "slate", second=0)
    for sd in (-1, 1):
        pg = T.pts([(0, -70), (sd * 98, -70), (sd * 99, 72), (0, 72)])
        a.fill_poly(pg, "paper", off=(0, 0))
        a.lines([(T((sd * 8, y)), T((sd * 92, y))) for y in frange(-54, 64, 11)], FW, "slate", 0.35, amp=0.1)
        a.outline_poly(pg, MW * 1.3, second=0)
    for k in range(8):
        y = -56 + k * 11
        squiggle(a, T((-90, y - 3)), T((-14 if k % 3 else -40, y - 3)), 1.3, w=FW * 1.25, alpha=0.65)
    # right page: axes, a rising curve with dots, a sketched apparatus
    a.lines([(T((16, -10)), T((16, -62))), (T((16, -10)), T((88, -10)))], MW, amp=0.2)
    pts = [(24, -16), (36, -22), (48, -32), (60, -38), (72, -48), (84, -52)]
    a.curve(T.pts(pts), MW * 1.1, "clay", jit=0.2)
    a.dots(T.pts(pts), 4.2)
    a.ell_outline(T((40, 34)), 14, 13, w=MW, second=0)
    a.curve(T.pts([(40, 21), (40, 6), (46, 2)]), MW, jit=0.1)
    a.lines([(T((26, 50)), T((54, 50))), (T((30, 50)), T((30, 62))), (T((50, 50)), T((50, 62)))], MW, amp=0.2)
    for k in range(3):
        squiggle(a, T((64, 20 + k * 11)), T((90, 20 + k * 11)), 1.1, w=FW * 1.2, alpha=0.55)
    a.line(T((0, -70)), T((0, 72)), MW * 1.3, amp=0.3)
    pen = [(150, 214), (226, 166), (230, 172), (154, 220)]
    a.fill_poly(pen, "ochre")
    a.fill_poly([(150, 214), (138, 226), (154, 220)], "paper", off=(0, 0))
    a.outline_poly(pen, MW * 1.2, second=0)
    a.dots([(140, 224)], 3.4)


@art_key("hist_nightingale_lamp", 240, 240, PK)
def hist_nightingale_lamp(a):
    """Florence Nightingale's lamp: a Turkish folding lantern (fanoos), pleated, between metal caps, with a candle
    inside and a carrying ring."""
    draw_fanoos(a, (118, 26), 3.4)


@art_key("hist_hospital_bed", 320, 240, PK)
def hist_hospital_bed(a):
    """A 19th-century hospital bed, empty and freshly made: an iron frame, white sheets, a folded blanket, a pillow;
    a small bedside table with a cup and a cloth."""
    leg_y = 212
    a.lines([((92, 150), (92, leg_y)), ((292, 150), (292, leg_y))], LW, amp=0.3)
    head = [(86, 70), (100, 70), (100, leg_y), (86, leg_y)]
    a.lines([((88, 70), (88, leg_y)), ((100, 66), (100, leg_y))], LW, amp=0.3)
    a.arc((94, 74), 8, 180, 360, LW)
    a.lines([((100, 86 + 16 * k), (88, 86 + 16 * k)) for k in range(4)], MW, amp=0.1)
    a.lines([((280, 112), (280, leg_y)), ((296, 108), (296, leg_y))], LW, amp=0.3)
    a.arc((288, 112), 8, 180, 360, LW)
    a.lines([((282, 124 + 12 * k), (294, 124 + 12 * k)) for k in range(3)], MW, amp=0.1)
    mat = [(96, 140), (286, 140), (286, 164), (96, 164)]
    a.fill_poly(mat, "paper", off=(0, 0))
    a.fill_poly(mat, "slate", 0.15, off=(0, 0))
    a.outline_poly(mat, MW * 1.4, second=0)
    blanket = [(150, 136), (288, 136), (290, 176), (152, 178)]
    a.fill_poly(blanket, "sage")
    a.hatch(blanket, 80, 6, alpha=0.3)
    a.outline_poly(blanket, LW, second=0.4)
    fold = [(146, 130), (164, 132), (166, 180), (148, 182)]
    a.block(fold, "paper", w=MW * 1.3, second=0)
    pil = [(104, 120), (140, 116), (148, 130), (140, 140), (104, 142), (100, 130)]
    a.fill_smooth(pil, "paper", off=(0, 0))
    a.outline(pil, MW * 1.4, second=0.3, jit=0.2)
    a.curve([(116, 126), (124, 130), (132, 126)], FW * 1.2, alpha=0.6, jit=0.1)
    a.line((86, 152), (296, 152), MW * 1.4, amp=0.4)
    for x in (92, 292):
        a.ell((x, leg_y + 4), 5, 5, "slate", w=MW, second=0)
    # bedside table
    a.block(rect(20, 130, 54, 10), "ochre", w=MW * 1.4, second=0)
    a.lines([((26, 140), (26, 214)), ((68, 140), (68, 214))], LW * 0.9, amp=0.3)
    a.block(rect(26, 172, 42, 7), "ochre", 0.8, w=MW, second=0)
    cup = [(32, 108), (48, 108), (46, 130), (34, 130)]
    a.block(cup, "clay", w=MW * 1.2, second=0)
    a.arc((49, 118), 5, -80, 80, MW)
    a.block([(52, 124), (70, 122), (70, 130), (52, 130)], "paper", w=MW, second=0)


def raised_dot(a, c, r=3.4):
    """A raised Braille dot: a pale bump with a darker lower rim."""
    a.fill_smooth(ellipse(c, r, r, n=8), "paper", off=(0, 0), jit=0.05)
    a.ell_outline(c, r, r, w=FW * 1.2, second=0, wob=0.02)


@art_key("hist_braille_dots", 240, 240, PK)
def hist_braille_dots(a):
    """Braille: rows of raised six-dot cells on a card (the pattern is abstract), a fingertip reading them."""
    card = [(22, 74), (210, 54), (226, 196), (36, 214)]
    a.fill_poly(card, "paper", off=(0, 0))
    a.fill_poly(card, "ochre", 0.2, off=(0, 0))
    a.outline_poly(card, LW, second=0.4)
    rng = a.rng
    pts = []
    for row in range(4):
        for cell in range(6):
            u0, v0 = 0.1 + cell * 0.14, 0.14 + row * 0.2
            pattern = [i for i in range(6) if rng.random() < 0.5] or [0]
            for i in pattern:
                uu = u0 + (i // 3) * 0.045
                vv = v0 + (i % 3) * 0.05
                top = lerp(card[0], card[1], uu)
                bot = lerp(card[3], card[2], uu)
                pts.append(lerp(top, bot, vv))
    a.dots(pts, 6.6, "slate", 0.5)
    a.dots([add(p, (-0.8, -0.8)) for p in pts], 3.2, "paper", 0.95)
    a.tone = "mid"
    fing = [(168, 2), (196, 2), (196, 64), (188, 84), (176, 88), (166, 80), (164, 60)]
    skin_parts(a, [fing])
    a.outline(fing, LW, second=0.3, jit=0.2)
    nail = [(172, 70), (186, 70), (186, 80), (179, 84), (172, 80)]
    a.fill_smooth(nail, "paper", 0.7, off=(0, 0))
    a.outline(nail, FW * 1.2, second=0, jit=0.1)
    a.curve([(166, 40), (180, 44), (195, 40)], FW * 1.2, alpha=0.6)
    motion_arcs(a, (180, 92), 14, 40, 140, n=2, w=FW * 1.3, alpha=0.7)


@art_key("hist_braille_book", 240, 240, PK)
def hist_braille_book(a):
    """A thick Braille book lying open: heavy pages covered in rows of raised dots, no ink writing."""
    T = Tf((120, 124), 1)
    a.fill_poly(T.pts([(-112, 40), (112, 40), (112, 56), (-112, 56)]), "clay")
    a.outline_poly(T.pts([(-112, 40), (112, 40), (112, 56), (-112, 56)]), MW * 1.3, second=0)
    for sd in (-1, 1):
        stack = T.pts([(0, 44), (sd * 106, 44), (sd * 108, 30), (0, 36)])
        a.fill_poly(stack, "paper", off=(0, 0))
        a.lines([(T((sd * 8, y)), T((sd * 104, y - 2))) for y in (38, 41)], FW, alpha=0.5)
        a.outline_poly(stack, MW, second=0)
        pg = T.pts([(0, -62), (sd * 40, -72), (sd * 100, -68), (sd * 104, 30), (sd * 50, 26), (0, 36)])
        a.fill_poly(pg, "paper", off=(0, 0), step=14)
        a.fill_poly(pg, "ochre", 0.15, off=(0, 0), step=14)
        a.outline_poly(pg, MW * 1.4, second=0)
    pts = []
    for sd in (-1, 1):
        for row in range(6):
            y = -52 + row * 14
            x = 14
            while x < 88:
                cell = [i for i in range(6) if a.rng.random() < 0.5] or [1]
                for i in cell:
                    pts.append(T((sd * (x + (i // 3) * 4.5), y + (i % 3) * 4.2)))
                x += 13
    a.dots(pts, 4.0, "slate", 0.6)
    a.dots([add(p, (-0.6, -0.6)) for p in pts], 1.6, "paper", 0.9)
    a.line(T((0, -62)), T((0, 36)), MW * 1.2, amp=0.3)


@art_key("hist_telescope", 240, 240, PK)
def hist_telescope(a):
    """Galileo's telescope (1609-10): a long leather-covered tube with tooled bands, a small eyepiece, on a simple
    wooden stand pointing at the sky."""
    for p0, p1 in (((122, 132), (82, 222)), ((122, 132), (166, 222)), ((122, 132), (124, 226))):
        a.blob(capsule(p0, p1, 4, 3.4, n=3), "ochre", w=MW * 1.2, second=0)
    a.blob(capsule((122, 116), (122, 138), 6, n=3), "ochre", w=MW * 1.3, second=0)
    ang = -38
    e, o = (34, 170), (212, 32)
    d = unit(sub(o, e))
    n = perp(d)
    tube = [add(e, mul(n, 7)), add(o, mul(n, 12)), add(o, mul(n, -12)), add(e, mul(n, -7))]
    a.fill_poly(tube, "clay")
    a.hatch(clip_half(tube, lerp(e, o, 0.5), mul(n, -1)), ang + 90, 3.6, alpha=0.45)
    for t in (0.18, 0.42, 0.66, 0.88):
        p = lerp(e, o, t)
        wd = 7 + 5 * t + 1
        band = [add(add(p, mul(d, -4)), mul(n, wd)), add(add(p, mul(d, 4)), mul(n, wd)), add(add(p, mul(d, 4)), mul(n, -wd)),
                add(add(p, mul(d, -4)), mul(n, -wd))]
        a.fill_poly(band, "ochre", 0.95, jit=0.2)
        a.dots([add(p, mul(n, k * 4)) for k in (-1, 0, 1)], 2.2, "clay")
    a.outline_poly(tube, LW, second=0.4)
    a.fill_smooth(ellipse(add(o, mul(d, 2)), 5, 13, ang, n=10), "ochre")
    a.ell_outline(add(o, mul(d, 2)), 5, 13, ang, w=MW * 1.3, second=0)
    a.fill_smooth(ellipse(add(o, mul(d, 3)), 2.5, 8, ang, n=8), "slate", 0.9)
    ep = [add(e, mul(n, 5)), add(add(e, mul(d, -16)), mul(n, 4)), add(add(e, mul(d, -16)), mul(n, -4)), add(e, mul(n, -5))]
    a.block(ep, "slate", w=MW * 1.3, second=0)
    cr = lerp(e, o, 0.48)
    a.curve([add(cr, mul(n, -14)), add(add(cr, mul(n, -18)), (0, 8)), (122, 116)], MW * 1.4, jit=0.1)
    a.line(add(cr, mul(n, 10)), add(cr, mul(n, -14)), MW * 1.4, amp=0.1)


@art_key("hist_jupiter_moons", 240, 240, PK)
def hist_jupiter_moons(a):
    """Jupiter and its four large moons in a row, as Galileo saw them in 1610: a banded planet, four small discs on a
    faint line."""
    c, R = (116, 118), 52
    a.line((6, 124), (234, 112), FW * 1.2, "slate", 0.6, amp=0.4)
    moons = ((22, 123, 4.5), (50, 121.5, 5.5), (184, 114.5, 6.5), (216, 113, 4.8))
    for x, y, r in moons:
        a.fill_smooth(ellipse((x, y), r, r, n=8), "paper", off=(0, 0))
        a.fill_smooth(ellipse((x, y), r, r, n=8), "ochre", 0.4, off=(0, 0))
        a.ell_outline((x, y), r, r, w=MW, second=0, wob=0.02)
    disc = ellipse(c, R, R * 0.94, n=20)
    a.fill_smooth(disc, "ochre")
    T = Tf(c, 1, -4)
    for y0, y1, col, al in ((-38, -26, "clay", 0.55), (-14, -4, "clay", 0.8), (6, 14, "paper", 0.7), (22, 32, "clay", 0.5),
                            (-24, -16, "paper", 0.6)):
        band = clip_convex(T.pts([(-60, y0), (60, y0), (60, y1), (-60, y1)]), ellipse(c, R - 1, R * 0.94 - 1, n=28))
        if len(band) > 2:
            a.fill_poly(band, col, al, off=(0, 0), jit=0.2)
    a.fill_smooth(T.pts(ellipse((18, 18), 9, 5.5, n=8)), "clay", 0.9)
    a.hatch(clip_half(ellipse(c, R - 3, R * 0.94 - 3, n=28), add(c, (22, 20)), (0.6, 0.8)), 50, 4.4, alpha=0.4)
    a.ell_outline(c, R, R * 0.94)


@art_key("hist_wright_flyer", 320, 240, PK)
def hist_wright_flyer(a):
    """The Wright Flyer (1903) in flight, seen from the front and a little above: a muslin biplane with the elevator in
    front (canard), twin rudders behind, two pusher propellers, the pilot lying on the lower wing, skids not wheels."""
    C = (156, 132)
    S = unit((1.0, -0.26))
    F = unit((0.5, 0.42))
    U = (0, -1)

    def P(s, f, u):
        return add(C, add(mul(S, s), add(mul(F, f), mul(U, u))))

    half, ch, gap = 124, 13, 34

    def wing(u):
        return [P(-half, ch, u), P(half, ch, u), P(half, -ch, u), P(-half, -ch, u)]

    # rudders behind, propellers, booms
    for sp in (-5, 5):
        rd = [P(sp, -66, 8), P(sp, -54, 8), P(sp, -54, 36), P(sp, -66, 36)]
        a.fill_poly(rd, "paper", off=(0, 0))
        a.fill_poly(rd, "ochre", 0.3, off=(0, 0))
        a.outline_poly(rd, MW * 1.3, second=0)
    a.lines([(P(-12, -ch, 2), P(-5, -56, 10)), (P(12, -ch, 2), P(5, -56, 10)), (P(-12, -ch, gap), P(-5, -56, 34)),
             (P(12, -ch, gap), P(5, -56, 34)), (P(-30, -ch, gap * 0.5), P(-30, -ch - 22, gap * 0.5)),
             (P(30, -ch, gap * 0.5), P(30, -ch - 22, gap * 0.5))], FW * 1.2, amp=0.2)
    lower = wing(0)
    a.fill_poly(lower, "paper", off=(0, 0))
    a.fill_poly(lower, "ochre", 0.32, off=(0, 0))
    a.lines([(P(s, ch, 0), P(s, -ch, 0)) for s in frange(-116, 118, 14)], FW, alpha=0.45, amp=0.1)
    a.outline_poly(lower, LW, second=0.4)
    for sp in (-30, 30):
        hub = P(sp, -ch - 22, gap * 0.5)
        for sgn in (-1, 1):
            tip = add(hub, mul(unit(add(mul(S, 0.35), mul(U, 1.0))), 24 * sgn))
            blade = ribbon([hub, lerp(hub, tip, 0.5), tip], 7, 3)
            a.fill_smooth(blade, "slate", 0.9)
            a.outline(blade, MW, second=0, jit=0.1)
        a.dots([hub], 4.5)
    # pilot lying on the lower wing, left of centre; the engine right of centre
    pc = P(-14, 0, 4)
    body = [add(pc, mul(F, -12)), add(pc, mul(F, 10))]
    a.fill_smooth(ribbon(body, 9, 7), "ink")
    a.fill_smooth(ellipse(add(pc, add(mul(F, 15), mul(U, 2))), 5, 5, n=8), "ink", off=(0, 0))
    eng = [P(8, 6, 2), P(20, 6, 2), P(20, -6, 2), P(8, -6, 2), P(8, -6, 12), P(8, 6, 12)]
    a.fill_poly([P(8, 6, 2), P(20, 6, 2), P(20, 6, 12), P(8, 6, 12)], "slate", 0.9)
    a.outline_poly([P(8, 6, 2), P(20, 6, 2), P(20, 6, 12), P(8, 6, 12)], MW, second=0)
    # struts
    struts = []
    for s in (-116, -84, -52, -22, 22, 52, 84, 116):
        struts += [(P(s, ch - 2, 0), P(s, ch - 2, gap)), (P(s, -ch + 2, 0), P(s, -ch + 2, gap))]
    a.lines(struts, MW * 0.9, amp=0.1)
    upper = wing(gap)
    a.fill_poly(upper, "paper", off=(0, 0))
    a.fill_poly(upper, "ochre", 0.32, off=(0, 0))
    a.lines([(P(s, ch, gap), P(s, -ch, gap)) for s in frange(-116, 118, 14)], FW, alpha=0.45, amp=0.1)
    a.outline_poly(upper, LW, second=0.4)
    # canard elevator in front on its outriggers, skids below
    a.lines([(P(-14, ch, 0), P(-6, 58, 10)), (P(14, ch, 0), P(6, 58, 10)), (P(-14, ch, gap), P(-6, 58, 24)),
             (P(14, ch, gap), P(6, 58, 24))], FW * 1.2, amp=0.2)
    for u in (10, 24):
        cn = [P(-26, 64, u), P(26, 64, u), P(26, 54, u), P(-26, 54, u)]
        a.fill_poly(cn, "paper", off=(0, 0))
        a.fill_poly(cn, "ochre", 0.3, off=(0, 0))
        a.outline_poly(cn, MW * 1.3, second=0)
    a.lines([(P(-10, 58, 10), P(-10, 58, 24)), (P(10, 58, 10), P(10, 58, 24))], FW, amp=0.1)
    a.lines([(P(-10, -10, -8), P(-10, 66, -4)), (P(10, -10, -8), P(10, 66, -4))], MW, amp=0.2)
    a.lines([(P(-10, 0, -7), P(-10, 0, 0)), (P(10, 0, -7), P(10, 0, 0))], FW, amp=0.1)


@art_key("hist_bicycle_shop", 320, 240, PK)
def hist_bicycle_shop(a):
    """The Wright Cycle Company (Dayton, 1890s): a small shop front with a striped awning, a display window with a
    bicycle, a door, a blank sign board, and a safety bicycle leaning outside."""
    wall = rect(30, 56, 260, 158)
    a.fill_poly(wall, "clay", 0.8)
    a.lines([((32, y), (288, y + a.j(1))) for y in frange(64, 212, 10)], FW, "paper", 0.35, amp=0.3)
    a.outline_poly(wall, LW, second=0.4)
    sign = rect(84, 32, 152, 22)
    a.block(sign, "paper", w=MW * 1.3, second=0)
    a.line((20, 56), (300, 56), LW * 1.2, over=(2, 2))
    win = rect(46, 100, 132, 84)
    a.fill_poly(win, "slate", 0.35)
    a.lines([((112, 100), (112, 184))], MW, amp=0.2)
    for c in ((76, 166), (148, 166)):
        a.ell_outline(c, 18, 18, w=MW, second=0, wob=0.02)
    a.lines([((76, 166), (106, 168)), ((106, 168), (98, 142)), ((98, 142), (76, 166)), ((98, 142), (138, 140)),
             ((138, 140), (106, 168)), ((138, 140), (148, 166)), ((94, 138), (104, 138)), ((136, 136), (144, 132))],
            FW * 1.3, amp=0.2)
    a.curve([(54, 110), (66, 104), (76, 106)], MW, "paper", 0.8, jit=0.1)
    a.block(rect(40, 184, 144, 10), "ochre", w=MW * 1.2, second=0)
    a.outline_poly(win, LW, second=0.3)
    door = rect(204, 100, 50, 114)
    a.block(door, "slate", 0.85, second=0)
    a.block(rect(214, 110, 30, 34), "paper", 0.5, w=MW, second=0)
    a.dots([(246, 160)], 4, "ochre")
    xs = frange(30, 290, 26)
    for i in range(len(xs) - 1):
        strip = [(xs[i], 62), (xs[i + 1], 62), (xs[i + 1] + 4, 84), ((xs[i] + xs[i + 1]) / 2 + 4, 92), (xs[i] + 4, 84)]
        a.fill_poly(strip, "sage" if i % 2 == 0 else "paper", off=(0, 0) if i % 2 else None)
    sc = []
    for i in range(len(xs) - 1):
        sc += [(xs[i] + 4, 84), ((xs[i] + xs[i + 1]) / 2 + 4, 92)]
    sc.append((xs[-1] + 4, 84))
    a.curve(sc, MW * 1.2)
    a.line((28, 62), (292, 62), MW * 1.4, amp=0.2)
    # a safety bicycle leaning outside, right
    rh, fh = (198, 206), (282, 206)
    for c in (rh, fh):
        a.stroke(a.ell_path(c, 24, 24, wob=0.015), 4.0)
        a.lines([(polar(c, 3, t), polar(c, 22, t)) for t in range(0, 360, 45)], FW, alpha=0.6, amp=0.2)
    bb, seat, head = (232, 208), (224, 172), (268, 168)
    frame = [(rh, bb), (bb, seat), (seat, rh), (seat, head), (head, bb), (head, fh)]
    p = Path()
    for s0, s1 in frame:
        a.seg(add(s0, a.reg("ochre")), add(s1, a.reg("ochre")), 0.5, p)
    a.stroke(p, 4.6, "ochre")
    a.lines(frame, MW, amp=0.4)
    a.ell((222, 168), 10, 3.5, "ink", 0.85, w=MW, second=0)
    a.curve([head, (264, 156), (252, 154), (246, 158)], MW * 1.4)


def palm_up(a, wrist, s, rot, tone):
    """An open hand with the palm up (OPEN_HAND turned so the fingers point along rot)."""
    T = Tf(wrist, s, rot)
    pts = T.pts(OPEN_HAND)
    a.tone = tone
    skin_parts(a, [pts])
    a.curve(pts, MW * 1.3, jit=0.2)
    a.curve(T.pts([(-0.22, -0.55), (0.0, -0.4), (0.22, -0.6)]), FW * 1.2, alpha=0.6, jit=0.1)
    return T


@art_key("hist_water_pump", 240, 240, PK)
def hist_water_pump(a):
    """The water pump (Helen Keller, 1887): an old cast-iron hand pump, water pouring from the spout over an open
    hand."""
    base = [(24, 200), (110, 200), (114, 214), (20, 214)]
    a.block(base, "slate", 0.5, second=0.3)
    col = [(52, 66), (80, 66), (82, 200), (50, 200)]
    a.fill_poly(col, "slate")
    a.hatch(clip_half(col, (70, 0), (1, 0)), 80, 3.6, alpha=0.45)
    a.outline_poly(col, LW, second=0.4)
    for y in (90, 176):
        a.block([(48, y), (84, y), (84, y + 8), (48, y + 8)], "slate", w=MW * 1.2, second=0)
    cap = [(46, 66), (86, 66), (80, 52), (52, 52)]
    a.block(cap, "slate", w=MW * 1.3, second=0)
    spout = [(80, 100), (126, 106), (132, 116), (124, 120), (118, 114), (80, 112)]
    a.fill_smooth(spout, "slate")
    a.outline(spout, MW * 1.4, second=0, jit=0.2)
    a.curve([(66, 50), (40, 30), (18, 26)], LW * 1.6, "slate")
    a.curve([(66, 50), (40, 30), (18, 26)], FW * 1.2, jit=0.1)
    a.ell((66, 50), 5, 5, "ochre", w=MW, second=0)
    a.line((66, 50), (66, 66), MW * 1.4, amp=0.1)
    T = palm_up(a, (206, 176), 70, -112, "light")
    a.blob(capsule((206, 176), (244, 204), 13, n=4), "clay", w=MW * 1.4, second=0)
    stream = [(122, 120), (128, 120), (132, 140), (136, 156), (128, 158), (124, 140)]
    a.fill_smooth(stream, "slate", 0.75)
    a.curve([(125, 124), (128, 142), (130, 154)], FW * 1.2, "paper", 0.9, jit=0.1)
    for x, y, r in ((110, 162, 4), (100, 174, 3.2), (150, 170, 3.6), (118, 184, 3), (142, 186, 3.2), (96, 192, 2.8)):
        drop(a, (x, y), r, "slate", a.j(30))
    a.curve([(112, 160), (124, 156), (140, 158), (152, 164)], MW * 1.2, "slate", 0.9)


@art_key("hist_hands_spelling", 240, 240, PK)
def hist_hands_spelling(a):
    """Finger-spelling into a hand (Anne Sullivan and Helen Keller): one open palm, another hand pressing letters into
    it with a fingertip; small marks show the touch."""
    palm_up(a, (210, 186), 92, -104, "light")
    a.blob(capsule((210, 186), (244, 210), 15, n=4), "sage", w=MW * 1.4, second=0)
    a.tone = "mid"
    a.blob(capsule((240, 18), (198, 54), 15, 13, n=4), "slate", w=MW * 1.4, second=0)
    curled = [capsule((158 + 9 * k, 92 - 3 * k), (166 + 9 * k, 104 - 3 * k), 6, 5.5, n=3) for k in range(3)]
    thumb = capsule((190, 78), (172, 112), 7, 6, n=3)
    back = [(206, 50), (184, 44), (162, 52), (148, 70), (150, 88), (170, 96), (192, 86), (208, 66)]
    index = capsule((154, 84), (126, 140), 7, 5.6, n=4)
    skin_parts(a, curled + [thumb])
    for c_ in curled + [thumb]:
        a.outline(c_, MW * 1.2, second=0, jit=0.15)
    skin_parts(a, [back, index])
    a.outline(index, MW * 1.3, second=0, jit=0.15)
    a.outline(back, MW * 1.4, second=0, jit=0.2)
    a.curve([(160, 62), (174, 58), (186, 62)], FW * 1.2, alpha=0.6, jit=0.1)
    a.fill_smooth(ellipse((130, 134), 3.5, 4.5, 25, n=7), "paper", 0.6, off=(0, 0))
    motion_arcs(a, (124, 146), 10, 120, 240, n=2, w=FW * 1.4, alpha=0.8)
    motion_arcs(a, (126, 146), 10, -60, 60, n=2, w=FW * 1.4, alpha=0.8)


@art_key("hist_peanut_plant", 240, 240, PK)
def hist_peanut_plant(a):
    """A peanut plant lifted to show what grows below (George Washington Carver): leaves of four leaflets and small
    yellow flowers above the soil line, pegs, roots and peanut pods below."""
    gy = 116
    soil = [(18, gy), (222, gy), (226, 170), (212, 214), (120, 228), (30, 214), (14, 170)]
    a.fill_smooth(soil, "clay", 0.4)
    a.stipple(soil, 14, 2.0, alpha=0.4)
    a.curve([(14, gy + 1), (120, gy - 2), (226, gy + 1)], LW, jit=0.4)
    roots = [[(120, gy), (118, 160), (124, 210)], [(118, 140), (96, 166), (88, 192)], [(122, 150), (148, 172), (156, 196)],
             [(118, 176), (104, 196)], [(124, 188), (140, 206)]]
    for r in roots:
        a.curve(r, FW * 1.4, jit=0.3)
    pods = [((76, 150), 20), ((96, 180), -30), ((150, 154), 30), ((168, 184), -10), ((126, 214), 80)]
    for (x, y), rot in pods:
        a.curve([(120 + (x - 120) * 0.3, gy + 2), (x * 0.6 + 48, y - 18), (x, y - 8)], FW * 1.3, jit=0.2)
        T = Tf((x, y), 1, rot)
        pod = T.pts([(-14, 0), (-12, -6), (-5, -7), (0, -4), (5, -7), (12, -6), (14, 0), (12, 6), (5, 7), (0, 4), (-5, 7),
                     (-12, 6)])
        a.fill_smooth(pod, "ochre")
        a.hatch(pod, T.ang(60), 3.6, alpha=0.4)
        a.outline(pod, MW * 1.2, second=0, jit=0.15)
    stems = [[(120, gy), (112, 86), (90, 60)], [(120, gy), (126, 80), (146, 50)], [(120, gy), (108, 100), (62, 92)],
             [(120, gy), (140, 102), (186, 90)], [(120, gy), (118, 70), (116, 34)]]
    for st in stems:
        a.curve(st, MW * 1.2, jit=0.2)
    for st in stems:
        tip = st[-1]
        d = unit(sub(st[-1], st[-2]))
        for k, t in enumerate((0.0, 16.0)):
            b = add(tip, mul(d, -t))
            for sd in (-1, 1):
                ang = math.degrees(math.atan2(d[1], d[0])) + sd * 55
                lf = leaf_pts(b, add(b, mul(dirv(ang), 17)), 7.5, n=4)
                a.fill_smooth(lf, "sage")
                a.outline(lf, FW * 1.3, second=0, jit=0.15)
    for c in ((104, 104), (134, 100), (124, 90)):
        fl = [polar(c, 5 if i % 2 == 0 else 2.5, i * 72) for i in range(5)]
        a.dots(fl, 5, "ochre")
        a.dots([c], 2.4, "clay")


@art_key("hist_soil_field", 320, 240, PK)
def hist_soil_field(a):
    """A field in rows (Carver's crop rotation): ridged brown soil going into the distance, rows of young peanut plants
    between rows of sweet-potato vines, a blank wooden marker."""
    top, bot = 96, 226
    vp = (160, 8)
    field = [(4, bot), (316, bot), (252, top), (68, top)]
    a.fill_poly(field, "clay", 0.45)
    a.fill_poly(field, "ochre", 0.25, off=(0, 0))
    rows = 10

    def at(u, y):
        """x on the converging row line u (0..1 across the front edge) at height y."""
        bx = 4 + u * 312
        t = (bot - y) / (bot - vp[1])
        return (bx + (vp[0] - bx) * t, y)

    for i in range(rows):
        u0, u1 = (i + 0.36) / rows, (i + 0.64) / rows
        ridge = [at(u0, bot), at(u1, bot), at(u1, top), at(u0, top)]
        a.fill_poly(ridge, "clay", 0.6, off=(0, 0), jit=0.3)
    for i in range(rows + 1):
        a.line(at(i / rows, bot), at(i / rows, top), FW * 1.2, alpha=0.6, amp=0.4)
    for i in range(rows):
        u = (i + 0.5) / rows
        for y in ((206, 160, 122) if i % 2 == 0 else (184, 140, 110)):
            p = at(u, y)
            sc_ = 0.35 + 0.65 * (y - top) / (bot - top)
            if i % 2 == 0:
                tufts(a, [p], 10 * sc_, MW * sc_ + 0.4, 1.0, "sage")
            else:
                for sd in (-1, 1):
                    lf = ellipse(add(p, (sd * 5 * sc_, -3 * sc_)), 5 * sc_, 3.4 * sc_, sd * 20, n=7)
                    a.fill_smooth(lf, "sage", 0.95)
    a.curve([(64, top + 2), (160, top - 3), (256, top + 2)], MW * 1.4, "sage")
    tufts(a, [(x, top) for x in frange(76, 244, 18)], 7, FW * 1.3, 0.8, "sage")
    a.outline_poly(field, LW, second=0.3)
    stake = [(286, 150), (298, 150), (298, 190), (286, 190)]
    a.blob(capsule((292, 190), (292, 218), 3.2, n=3), "ochre", w=MW, second=0)
    a.block(stake, "ochre", w=MW * 1.3, second=0)


# contact sheets for review (draw.py writes them light and night on a full run)
SHEETS.append(("hist_1_scenes", lambda k: k.startswith("hist_bg_"), 3, 380))
SHEETS.append(("hist_2_silhouettes", lambda k: k.startswith("hist_sil_"), 6, 150))
SHEETS.append(("hist_3_props_figures", lambda k: k in HIST_PROPS or k in HIST_FIG, 8, 128))
