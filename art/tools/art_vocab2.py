"""Follow-up 12, art group C: picture vocabulary for the new levels (MODULES_LEVELS_STORIES §6.4).

82 keys in the family of the follow-up 11 pic_* drawings in draw.py: one object or one figure per picture, 240 x 240,
readable at 48 dp, <= 6 palette colours, two or more stroke weights, wobble, colour plates off the ink, no text,
digits, logos, gradients or shadows. People use the posable figure (figure / Fig) and the family face, with light /
mid / deep skin tones and a kerudung on some women. DRAFT art (ART_DIRECTION §6): placeholders until a human
illustrator redraws or approves them (§7). Brief: art/briefs/follow-up-12-vocabulary.md.
"""

from draw import *  # noqa: F401,F403

VOCAB2_GROUPS = {
    "clothes": ["pic_pants", "pic_dress", "pic_skirt", "pic_jacket", "pic_socks", "pic_uniform", "pic_sarong",
                "pic_glasses"],
    "jobs": ["pic_farmer", "pic_chef", "pic_driver", "pic_nurse", "pic_pilot", "pic_firefighter", "pic_police",
             "pic_fisher", "pic_seller", "pic_mechanic"],
    "nature": ["pic_snow", "pic_wind", "pic_storm", "pic_spring_blossom", "pic_autumn_leaves", "pic_snowman",
               "pic_river", "pic_forest", "pic_volcano", "pic_beach", "pic_lake", "pic_moon"],
    "routine": ["pic_wake_up", "pic_shower", "pic_brush_teeth", "pic_get_dressed", "pic_breakfast", "pic_go_school",
                "pic_study", "pic_tidy_room", "pic_watch_tv", "pic_go_home"],
    "hobbies": ["pic_draw_paint", "pic_guitar", "pic_football", "pic_badminton", "pic_dance", "pic_camera",
                "pic_gardening", "pic_fishing"],
    "town": ["pic_bank", "pic_post_office", "pic_restaurant", "pic_library", "pic_hotel", "pic_airport",
             "pic_suitcase", "pic_ticket", "pic_map_paper", "pic_traffic_light", "pic_bridge", "glyph_arrow_left",
             "glyph_arrow_right", "glyph_arrow_straight"],
    "tech": ["pic_computer", "pic_tv", "pic_radio", "pic_tablet", "pic_headphones", "pic_robot_toy"],
    "health": ["pic_fever", "pic_cough", "pic_medicine", "pic_heart_organ", "pic_lungs", "pic_teeth", "pic_exercise",
               "pic_healthy_plate"],
    "animals": ["pic_tiger", "pic_frog", "pic_butterfly", "pic_snake", "pic_turtle", "pic_orangutan"],
}


# --------------------------------------------------------------------------------------------- shared helpers


def garment(a, pts, col, shade_x=None, alpha=1.0, step=24, w=LW, hatch_ang=75):
    """A flat-lay garment: colour plate, hatching on the right (shade) side, open-cornered contour."""
    a.fill_poly(pts, col, alpha, step=step)
    if shade_x is not None:
        a.hatch(clip_half(pts, (shade_x, 0), (1, 0)), hatch_ang, 4.6, alpha=0.35)
    a.outline_poly(pts, w, second=0.4)


def stitches(a, p0, p1, color="ochre", n=None, w=FW * 1.4, alpha=0.95):
    """A dashed stitch line (short drawn dashes) from p0 to p1."""
    L = vlen(sub(p1, p0))
    n = n or max(2, int(L / 9))
    segs = [(lerp(p0, p1, (i + 0.15) / n), lerp(p0, p1, (i + 0.6) / n)) for i in range(n)]
    a.lines(segs, w, color, alpha, amp=0.15)


def outlines(a, shapes, w=MW * 1.3, jit=0.4):
    """Several closed hand contours stroked as one path (one VectorDrawable path instead of many)."""
    p = Path()
    for pts in shapes:
        p.extend(a.closed_curve(pts, jit))
    a.stroke(p, w)


def drops(a, centres, s, color="slate", rot=0.0, w=FW * 1.3):
    """Several small drops (as drop()) staged: all fills, then one contour path, to keep the drawable small."""
    shapes = [Tf(c, s, rot).pts([(0, -1.5), (0.5, -0.4), (0.66, 0.3), (0.34, 0.8), (-0.34, 0.8), (-0.66, 0.3),
                                 (-0.5, -0.4)]) for c in centres]
    for sh in shapes:
        a.fill_smooth(sh, color, 0.95)
    outlines(a, shapes, w, jit=0.1)


def small_plane(a, c, s=0.42, rot=-14, windows=True):
    """The pic_plane silhouette, small, for a corner (pilot, airport): fills first, then one contour path."""
    T = Tf(c, s, rot)
    wing = T.pts([(-14, 10), (22, 10), (-2, 64), (-22, 64)])
    wing2 = T.pts([(-6, -4), (30, -4), (6, -40), (-10, -40)])
    fus = T.pts([(-96, 2), (-90, -12), (-60, -18), (70, -18), (96, -10), (104, 0), (96, 10), (70, 16), (-80, 16),
                 (-94, 10)])
    fin = T.pts([(-60, -16), (-88, -60), (-74, -62), (-40, -16)])
    a.fill_smooth(wing, "slate")
    a.fill_smooth(wing2, "slate", 0.7)
    a.fill_smooth(fus, "paper", off=(0, 0))
    a.fill_poly(fin, "clay")
    if windows:
        a.dots([T((x, -4)) for x in range(-40, 70, 22)], 3.6, "slate")
    outlines(a, [wing, fus, fin, wing2], MW * 1.2)


# --------------------------------------------------------------------------------------------- clothes


@art_key("pic_pants")
def pic_pants(a):
    """Long trousers, flat: slate with ochre stitching, a waistband with loops and a button, a fly, two pockets."""
    T = Tf((120 + a.j(2), 0), 1, a.j(1.5))
    legs = T.pts([(-52, 52), (52, 52), (58, 128), (66, 212), (16, 214), (2, 100), (-12, 214), (-62, 212), (-58, 128)])
    garment(a, legs, "slate", T((26, 0))[0], step=20)
    band = T.pts([(-53, 34), (53, 34), (53, 54), (-53, 54)])
    a.fill_poly(band, "slate")
    a.fill_poly(band, "ink", 0.25, off=a.reg("slate"))
    a.outline_poly(band, MW * 1.4, second=0)
    for x in (-38, -4, 30):
        a.outline_poly(T.pts(rect(x, 31, 7, 26)), FW * 1.4, second=0, over=0.6, gap=0.6)
    a.dots([T((10, 44))], 7, "ochre")
    a.curve(T.pts([(4, 56), (6, 82), (0, 96)]), MW, jit=0.2)
    a.curve(T.pts([(-46, 56), (-30, 64), (-24, 78)]), MW, jit=0.2)
    a.curve(T.pts([(46, 56), (32, 64), (28, 78)]), MW, jit=0.2)
    stitches(a, T((-52, 60)), T((-64, 204)))
    stitches(a, T((56, 60)), T((64, 204)))
    stitches(a, T((10, 58)), T((12, 84)))
    for x0, x1 in ((-60, -14), (18, 64)):
        a.line(T((x0, 198)), T((x1, 199)), MW, amp=0.3)


@art_key("pic_dress")
def pic_dress(a):
    """A girl's dress (one piece): puff sleeves, a round paper collar, an ochre waist sash and a flared skirt with paper
    dots. The top half is what tells it from pic_skirt."""
    cx = 120 + a.j(2)
    for sx in (-1, 1):
        slv = [(cx + sx * 26, 42), (cx + sx * 52, 52), (cx + sx * 60, 78), (cx + sx * 34, 84)]
        a.blob(slv, "clay", w=MW * 1.4, second=0)
        a.curve([(cx + sx * 36, 80), (cx + sx * 46, 84), (cx + sx * 58, 76)], FW * 1.3, alpha=0.6)
    body = [(cx - 32, 40), (cx - 14, 46), (cx, 54), (cx + 14, 46), (cx + 32, 40), (cx + 34, 70), (cx + 30, 104),
            (cx + 76, 206), (cx + 40, 214), (cx, 210), (cx - 40, 214), (cx - 78, 206), (cx - 30, 104), (cx - 34, 70)]
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(body, (cx + 30, 0), (1, 0)), 72, 4.6, alpha=0.35)
    a.outline(body, LW, second=0.4)
    a.dots([(cx + dx, y) for dx, y in ((-40, 150), (-14, 136), (12, 158), (36, 140), (-30, 184), (2, 186), (40, 178),
                                         (58, 196), (-56, 196))], 6.5, "paper", 0.95)
    sash = [(cx - 32, 98), (cx + 32, 98), (cx + 33, 112), (cx - 33, 112)]
    a.block(sash, "ochre", w=MW * 1.3, second=0)
    a.blob([(cx + 6, 104), (cx + 22, 120), (cx + 14, 132)], "ochre", w=MW, second=0)
    for sx in (-1, 1):
        col = [(cx, 56), (cx + sx * 16, 46), (cx + sx * 26, 48), (cx + sx * 22, 62), (cx + sx * 8, 66)]
        a.blob(col, "paper", w=MW * 1.2, second=0)
    for x0, x1 in ((-14, -34), (12, 26)):
        a.curve([(cx + x0, 116), (cx + (x0 + x1) / 2, 160), (cx + x1, 204)], FW * 1.4, alpha=0.6)


@art_key("pic_skirt")
def pic_skirt(a):
    """A pleated skirt on its own: waistband with a button, wide A-line, pleat lines fanning to a slightly wavy hem.
    Shorter and wider than pic_dress, no top."""
    cx, top, hem = 118 + a.j(2), 70, 190
    band = [(cx - 44, top - 14), (cx + 44, top - 14), (cx + 45, top + 2), (cx - 45, top + 2)]
    xs = [cx - 92 + i * 23 for i in range(9)]
    hemp = [(x, hem + (5 if i % 2 else 0) + a.j(1.5)) for i, x in enumerate(xs)]
    sk = [(cx - 45, top), (cx + 45, top)] + hemp[::-1]
    a.fill_poly(sk, "sage", step=20)
    a.hatch(clip_half(sk, (cx + 40, 0), (1, 0)), 75, 4.6, alpha=0.35)
    tops = [cx - 45 + i * 11.25 for i in range(9)]
    a.lines([((tops[i], top + 2), (xs[i], hemp[i][1] - 2)) for i in range(1, 8)], MW, amp=0.5)
    a.outline_poly(sk, LW, second=0.4)
    a.block(band, "sage", w=MW * 1.4, second=0)
    a.fill_poly(band, "ink", 0.2, off=a.reg("sage"))
    a.dots([(cx + 30, top - 6)], 7.5, "ochre")


@art_key("pic_jacket")
def pic_jacket(a):
    """A zip jacket with long sleeves and a hood down: ochre, slate rib cuffs and hem, zip teeth, slanted pockets."""
    cx = 120 + a.j(2)
    hood = [(cx - 34, 50), (cx - 30, 30), (cx, 22), (cx + 30, 28), (cx + 36, 48), (cx, 60)]
    a.fill_smooth(hood, "ochre")
    a.fill_smooth(ellipse((cx + 1, 42), 22, 12, n=10), "slate", 0.7)
    a.outline(hood, MW * 1.5, second=0)
    for sx in (-1, 1):
        slv = [(cx + sx * 36, 46), (cx + sx * 60, 60), (cx + sx * 84, 172), (cx + sx * 60, 180), (cx + sx * 42, 96)]
        a.fill_poly(slv, "ochre")
        if sx > 0:
            a.hatch(slv, 70, 4.6, alpha=0.35)
        a.outline_poly(slv, LW, second=0.3)
        cuff = [(cx + sx * 84, 172), (cx + sx * 60, 180), (cx + sx * 62, 194), (cx + sx * 86, 186)]
        a.block(cuff, "slate", w=MW * 1.3, second=0)
        a.lines([(lerp(cuff[0], cuff[1], t), lerp(cuff[3], cuff[2], t)) for t in (0.3, 0.6)], FW, alpha=0.6)
    body = [(cx - 38, 44), (cx - 14, 52), (cx, 62), (cx + 14, 52), (cx + 38, 44), (cx + 44, 96), (cx + 44, 196),
            (cx - 44, 196), (cx - 44, 96)]
    garment(a, body, "ochre", cx + 22, step=20)
    hemb = [(cx - 44, 192), (cx + 44, 192), (cx + 44, 208), (cx - 44, 208)]
    a.block(hemb, "slate", w=MW * 1.3, second=0)
    a.lines([((cx + x, 194), (cx + x + 1, 206)) for x in range(-36, 40, 10)], FW, alpha=0.6, amp=0.2)
    a.line((cx, 62), (cx + 1, 206), MW * 1.3, amp=0.4)
    a.zig([(cx - 3 + (i % 2) * 6, 66 + i * 6) for i in range(22)], FW, alpha=0.7, jit=0.2)
    a.block([(cx - 5, 70), (cx + 5, 70), (cx + 4, 88), (cx - 4, 88)], "slate", w=MW, second=0)
    for sx in (-1, 1):
        a.line((cx + sx * 30, 132), (cx + sx * 20, 168), MW * 1.4, amp=0.3)
        a.line((cx + sx * 26, 130), (cx + sx * 16, 166), FW, alpha=0.6, amp=0.2)


@art_key("pic_socks")
def pic_socks(a):
    """A pair of socks, one in front of the other: ribbed cuffs with an ochre stripe, clay heel and toe."""

    def sock(T, col):
        pts = T.pts([(-22, -80), (0, -82), (22, -80), (23, -40), (24, 8), (34, 22), (66, 26), (84, 38), (80, 58),
                     (56, 62), (2, 58), (-18, 50), (-26, 26), (-24, -40)])
        sp = spline(pts, True, 3)
        a.fill_smooth(pts, col)
        toe = clip_half(sp, T((54, 0)), T.v((1, 0)))
        heel = clip_half(clip_half(sp, T((0, 18)), T.v((0, 1))), T((-6, 0)), T.v((-1, 0)))
        stripe = clip_half(clip_half(sp, T((0, -63)), T.v((0, 1))), T((0, -55)), T.v((0, -1)))
        for part, c_, al in ((toe, "clay", 0.95), (heel, "clay", 0.95), (stripe, "ochre", 0.95)):
            if len(part) > 2:
                a.fill_smooth(part, c_, al, off=a.reg(col))
        a.lines([(T((x, -77)), T((x, -64))) for x in range(-15, 20, 7)], FW * 1.2, alpha=0.6, amp=0.1)
        a.hatch(clip_half(pts, T((8, 0)), T.v((1, 0))), T.ang(70), 4.4, alpha=0.35)
        a.outline(pts, LW, second=0.4)
        a.curve([T((-23, -54)), T((0, -52)), T((23, -54))], MW, jit=0.2)

    sock(Tf((134, 112), 1.0, 6), "slate")
    sock(Tf((94, 150), 1.0, -4), "sage")


@art_key("pic_uniform")
def pic_uniform(a):
    """An Indonesian primary-school uniform on a hanger: white short-sleeved shirt with collar, a clay tie, a plain ochre
    badge on the pocket (no text, no emblem) and the clay (merah hati) shorts hanging behind."""
    cx = 120 + a.j(2)
    a.curve([(cx, 44), (cx - 1, 30), (cx + 8, 20), (cx + 15, 26)], MW * 1.4, "slate")
    shorts = [(cx - 40, 62), (cx + 40, 62), (cx + 46, 212), (cx + 6, 214), (cx, 186), (cx - 6, 214), (cx - 46, 212)]
    a.fill_poly(shorts, "clay", step=20)
    a.hatch(clip_half(shorts, (cx + 26, 0), (1, 0)), 75, 4.6, alpha=0.35)
    a.outline_poly(shorts, LW, second=0.3)
    for sx in (-1, 1):
        slv = [(cx + sx * 34, 58), (cx + sx * 62, 74), (cx + sx * 72, 104), (cx + sx * 48, 112), (cx + sx * 42, 84)]
        a.fill_poly(slv, "paper", off=(0, 0))
        a.hatch(slv, 70 if sx > 0 else 110, 5, color="slate", alpha=0.3)
        a.outline_poly(slv, LW, second=0)
    shirt = [(cx - 40, 58), (cx - 14, 50), (cx, 58), (cx + 14, 50), (cx + 40, 58), (cx + 44, 100), (cx + 46, 172),
             (cx - 46, 172), (cx - 44, 100)]
    a.fill_poly(shirt, "paper", off=(0, 0), step=20)
    a.hatch(clip_half(shirt, (cx + 26, 0), (1, 0)), 75, 4.6, color="slate", alpha=0.3)
    a.outline_poly(shirt, LW, second=0.4)
    a.line((cx - 50, 50), (cx + 50, 50), LW * 1.3, "ochre", amp=0.3)
    a.line((cx - 50, 50), (cx + 50, 50), FW, amp=0.3)
    for sx in (-1, 1):
        col = [(cx, 60), (cx + sx * 16, 48), (cx + sx * 26, 54), (cx + sx * 14, 74)]
        a.block(col, "paper", w=MW * 1.3, second=0)
    tie = [(cx - 6, 62), (cx + 6, 62), (cx + 4, 70), (cx + 10, 130), (cx, 142), (cx - 10, 130), (cx - 4, 70)]
    a.blob(tie, "clay", w=MW * 1.3, second=0)
    pk = rect(cx + 14, 92, 22, 24)
    a.outline_poly(pk, MW * 1.2, second=0)
    badge = [(cx + 18, 98), (cx + 32, 98), (cx + 31, 108), (cx + 25, 113), (cx + 19, 108)]
    a.blob(badge, "ochre", w=FW * 1.3, second=0)
    a.dots([(cx - 2, 150), (cx - 2, 164)], 3.6, "slate")


@art_key("pic_sarong")
def pic_sarong(a):
    """A checked sarung hung over a wooden rod: slate cloth with a clay and ochre check, the kepala (head) band of
    ochre tumpal triangles, soft drape folds."""
    a.line((14, 48), (226, 46), LW * 1.8, "ochre", amp=0.4)
    a.line((14, 48), (226, 46), MW, amp=0.4)
    for x in (16, 224):
        a.ell((x, 47), 6, 6, "ochre", w=MW * 1.2, second=0)
    x0, x1, y0, y1 = 56 + a.j(2), 186, 50, 206
    back = [(x1 - 6, y0), (x1 + 14, y0 + 6), (x1 + 16, y1 - 22), (x1 - 4, y1 - 16)]
    a.fill_poly(back, "slate", 0.85)
    a.fill_poly(back, "ink", 0.25, off=a.reg("slate"))
    a.outline_poly(back, MW * 1.3, second=0)
    cloth = [(x0, y0 - 6), (x1, y0 - 6), (x1 + 2, y1 - 12), (x1 - 30, y1 - 6), (x0 + 50, y1 + 2), (x0 + 16, y1 - 4),
             (x0 - 2, y1)]
    a.fill_poly(cloth, "slate", step=20)
    vs = [x0 + 14 + i * 22 for i in range(6)]
    a.lines([((x, y0 - 4), (x + a.j(1), y1 - 4)) for x in vs], MW * 1.6, "clay", 0.9, amp=0.6)
    hs = [y0 + 18 + i * 26 for i in range(6)]
    a.lines([((x0 + 1, y), (x1 - 1, y + a.j(1))) for y in hs], MW * 1.6, "clay", 0.9, amp=0.6)
    a.lines([((x + 7, y0 - 4), (x + 7, y1 - 6)) for x in vs[:-1]], FW * 1.2, "ochre", 0.9, amp=0.5)
    a.lines([((x0 + 1, y + 9), (x1 - 1, y + 9)) for y in hs[:-1]], FW * 1.2, "ochre", 0.9, amp=0.5)
    kb = [(x0 + 70, y0 - 5), (x0 + 106, y0 - 5), (x0 + 106, y1 - 5), (x0 + 70, y1 - 5)]
    a.fill_poly(kb, "ink", 0.35, off=(0, 0))
    tri = []
    for k in range(6):
        yy = y0 + 4 + k * 25
        tri += [((x0 + 74, yy + 18), (x0 + 88, yy)), ((x0 + 88, yy), (x0 + 102, yy + 18))]
    a.lines(tri, MW * 1.3, "ochre", amp=0.2)
    a.hatch(clip_half(cloth, (x1 - 26, 0), (1, 0)), 75, 5, alpha=0.3)
    for x in (x0 + 30, x0 + 116):
        a.curve([(x, y0 + 8), (x + 4, y0 + 70), (x - 2, y1 - 12)], FW * 1.4, alpha=0.6)
    a.outline_poly(cloth, LW, second=0.4)
    a.curve([(x0 - 2, y0 - 6), (x0 + 60, y0 - 12), (x1 + 2, y0 - 6)], MW * 1.3, jit=0.4)


@art_key("pic_glasses")
def pic_glasses(a):
    """A pair of glasses seen from the front and a little above, temples open and going back, lenses with a glint."""
    cy = 126 + a.j(2)
    for p0, p1, p2 in (((44, cy - 14), (58, cy - 46), (64, cy - 42)), ((198, cy - 16), (182, cy - 48), (176, cy - 44))):
        for w_, col, al in ((LW * 1.5, "slate", 1.0), (FW, "ink", 0.7)):
            a.curve([p0, lerp(p0, p1, 0.5), p1, p2], w_, col, al, jit=0.2)
    lenses = []
    for c in ((82, cy), (160, cy - 2)):
        L = [add(c, p) for p in ((-40, -26), (-10, -30), (30, -26), (40, -12), (36, 16), (16, 28), (-22, 28),
                                  (-38, 14))]
        lenses.append(L)
        a.fill_smooth(L, "sage", 0.35)
        a.curve([add(c, (-24, -14)), add(c, (-14, -20))], MW * 1.3, "paper", 0.9, jit=0.1)
        a.curve([add(c, (-28, -4)), add(c, (-24, -10))], MW * 1.1, "paper", 0.9, jit=0.1)
    for L in lenses:
        off = a.reg("slate")
        a.stroke(a.closed_curve([add(p, off) for p in L], 0.3), 8, "slate", 0.95)
        a.outline(L, LW, second=0.3, jit=0.3)
    a.curve([(120, cy - 12), (121, cy - 20), (124, cy - 12)], LW * 1.4, "slate", jit=0.1)
    a.curve([(120, cy - 12), (121, cy - 20), (124, cy - 12)], MW, jit=0.1)
# --------------------------------------------------------------------------------------------- jobs
# People in work clothes with one tool each; five women and five men, three skin tones, a kerudung on two women.
# No weapons, no flame, no emblems: badges are plain shapes.


def caping(a, hc, r, tilt=-4):
    """The conical bamboo farmer's hat (caping), worn: wide flat cone with woven ribs and a thin rim."""
    T = Tf(hc, r, tilt)
    apex = T((0.05, -1.85))
    rim = [T((x, -0.42 + 0.22 * (1 - (x / 2.45) ** 2))) for x in (2.45, 1.8, 1.0, 0.0, -1.0, -1.8, -2.45)]
    cone = [apex] + rim
    a.fill_poly(cone, "ochre")
    a.lines([(lerp(apex, q, 0.12), lerp(apex, q, 0.96)) for q in rim[1:-1]], FW * 1.3, "clay", 0.8, amp=0.3)
    a.hatch(clip_half(cone, T((0.8, 0)), T.v((1, 0))), T.ang(70), 4.2, alpha=0.35)
    a.outline_poly(cone, LW, second=0.4)
    a.curve(rim, MW * 1.2, jit=0.3)
    return apex


def toque(a, hc, r):
    """A chef's white toque: pleated band and a puffed top."""
    T = Tf(hc, r, -3)
    band = T.pts([(-0.86, -0.5), (0.86, -0.56), (0.9, -1.25), (-0.9, -1.2)])
    puff = T.pts([(-0.95, -1.15), (-1.3, -1.6), (-1.05, -2.15), (-0.45, -2.35), (0.1, -2.2), (0.6, -2.42), (1.18, -2.1),
                  (1.32, -1.6), (0.98, -1.2)])
    a.fill_smooth(puff, "paper", off=(0, 0))
    a.hatch(clip_half(puff, T((0.5, 0)), T.v((1, 0.4))), T.ang(70), 4.6, color="slate", alpha=0.3)
    a.outline(puff, LW, second=0.3)
    a.curve(T.pts([(-0.4, -1.3), (-0.3, -1.8), (-0.45, -2.2)]), FW * 1.3, alpha=0.6)
    a.curve(T.pts([(0.35, -1.3), (0.45, -1.8), (0.6, -2.3)]), FW * 1.3, alpha=0.6)
    a.fill_poly(band, "paper", off=(0, 0))
    a.lines([(T((x, -0.55)), T((x, -1.18))) for x in (-0.5, -0.1, 0.3, 0.65)], FW * 1.2, alpha=0.55, amp=0.1)
    a.outline_poly(band, MW * 1.4, second=0)


def peaked_cap(a, hc, r, crown="slate", band="ochre", badge="ochre", tilt=0):
    """A peaked uniform cap (pilot, police): wide crown, coloured band, dark visor and a plain badge (no emblem)."""
    T = Tf(hc, r, tilt)
    top = T.pts([(-1.12, -0.9), (-1.22, -1.32), (-0.6, -1.6), (0.4, -1.62), (1.24, -1.38), (1.14, -0.9)])
    a.blob(top, crown, w=LW, second=0)
    bd = T.pts([(-1.02, -0.62), (1.04, -0.66), (1.12, -0.96), (-1.1, -0.92)])
    a.block(bd, band, w=MW * 1.3, second=0)
    visor = T.pts([(-0.98, -0.62), (1.0, -0.66), (0.86, -0.36), (0.1, -0.24), (-0.84, -0.34)])
    a.fill_smooth(visor, "ink", 0.85, off=(0, 0))
    a.outline(visor, MW * 1.2, second=0)
    a.blob(T.pts(ellipse((0.02, -1.14), 0.24, 0.2, n=8)), badge, w=FW * 1.3, second=0)


def nurse_cap(a, hc, r):
    """A small folded white nurse cap with a plain sage plus (never the Red Cross emblem)."""
    T = Tf(hc, r, -4)
    cap = T.pts([(-0.82, -0.72), (0.82, -0.76), (0.66, -1.32), (-0.64, -1.28)])
    a.fill_poly(cap, "paper", off=(0, 0))
    a.hatch(clip_half(cap, T((0.3, 0)), T.v((1, 0))), T.ang(75), 4, color="slate", alpha=0.3)
    a.outline_poly(cap, MW * 1.4, second=0.3)
    c = T((0, -1.02))
    s = r * 0.2
    a.lines([(add(c, (-s, 0)), add(c, (s, 0))), (add(c, (0, -s)), add(c, (0, s)))], r * 0.13, "sage", amp=0.1)


def helmet(a, hc, r, col="ochre", shield="clay", tilt=0):
    """A firefighter's helmet: rounded dome, ridge, long back brim and a plain front shield."""
    T = Tf(hc, r, tilt)
    brim = T.pts([(-1.55, -0.2), (-1.2, -0.42), (1.1, -0.48), (1.3, -0.32), (1.0, -0.2), (-1.2, -0.06)])
    dome = T.pts([(-1.08, -0.36), (-1.14, -0.95), (-0.7, -1.38), (0.1, -1.5), (0.82, -1.3), (1.12, -0.86), (1.08, -0.4)])
    a.blob(brim, col, w=MW * 1.4, second=0)
    a.fill_smooth(dome, col)
    a.hatch(clip_half(dome, T((0.45, 0)), T.v((1, 0.2))), T.ang(65), 4.2, alpha=0.4)
    a.outline(dome, LW, second=0.3)
    a.curve(T.pts([(-0.75, -1.3), (0.05, -1.52), (0.8, -1.3)]), LW * 1.2, col, jit=0.2)
    a.curve(T.pts([(-0.75, -1.3), (0.05, -1.52), (0.8, -1.3)]), MW, jit=0.2)
    sh = T.pts([(-0.32, -0.5), (0.32, -0.5), (0.36, -0.98), (0, -1.16), (-0.36, -0.98)])
    a.block(sh, shield, w=MW * 1.2, second=0)


@art_key("pic_farmer")
def pic_farmer(a):
    """A farmer (petani) in a caping, long sleeves, barefoot, a hoe (cangkul) carried on the shoulder; young rice at
    the feet."""
    cx = 100 + a.j(2)

    def hoe(F):
        h = F.hd[1]
        top = add(h, (46, -92))
        a.blob(ribbon([add(h, (-14, 22)), lerp(h, top, 0.5), top], 7, 6), "ochre", w=MW * 1.3, second=0)
        d = unit(sub(top, h))
        n = perp(d)
        blade = [add(top, mul(d, 8)), add(top, add(mul(n, 40), mul(d, 16))), add(top, add(mul(n, 42), mul(d, -18))),
                 add(top, mul(d, -8))]
        a.fill_poly(blade, "slate")
        a.hatch(blade, 30, 3.6, alpha=0.4)
        a.line(add(top, add(mul(n, 34), mul(d, 14))), add(top, add(mul(n, 36), mul(d, -15))), MW, "paper", 0.8)
        a.outline_poly(blade, MW * 1.5, second=0)
        a.ell(top, 6, 6, "ochre", w=MW * 1.2, second=0)

    F = figure(a, cx, 220, 22.5, top="shirt", top_col="sage", sleeve="long", bottom="trousers", bottom_col="slate",
               shoes=None, ground_line=False, extras={"collar": "sage"}, mid=hoe, lite=True,
               pose={"arms": ((100, 92), ("ik", (cx + 24, 118), -1))}, tone="deep")
    caping(a, F.hc, 22.5)
    ground(a, 36, 214, 223, marks=4)
    for x in (30, 172, 204):
        a.lines([((x, 224), (x - 9, 196)), ((x, 224), (x + 1, 192)), ((x, 224), (x + 10, 198))], MW * 1.3, "sage",
                amp=0.4)


@art_key("pic_chef")
def pic_chef(a):
    """A chef (koki), a woman in a white toque and double-breasted white jacket with a clay neckerchief, holding a
    ladle up. Tells from pic_cook (a man at a wok in an apron) by the toque and jacket."""
    cx = 112 + a.j(2)

    def ladle_and_buttons(F):
        for k in range(3):
            a.dots([add(F.nb, (-9, 22 + k * 15)), add(F.nb, (11, 22 + k * 15))], 4.2, "slate")
        nk = [add(F.nb, p) for p in ((-14, -2), (0, 8), (14, -2), (8, 14), (0, 22), (-8, 14))]
        a.blob(nk, "clay", w=MW * 1.2, second=0)
        h = F.hd[1]
        top = add(h, (14, -50))
        a.blob(capsule(add(h, (-2, 14)), top, 3.2, 2.8), "slate", w=MW * 1.2, second=0)
        bowl = [add(top, (-8, -12))] + [polar(add(top, (6, -14)), 15, t, 12) for t in range(-10, 190, 25)]
        a.fill_smooth(bowl, "slate")
        a.outline(bowl, MW * 1.4, second=0)

    F = figure(a, cx, 224, 22.5, top="shirt", top_col="paper", sleeve="long", bottom="trousers", bottom_col="slate",
               shoes="slate", hair="bob", mid=ladle_and_buttons,
               pose={"arms": ((101, 94), (20, -70))}, hands=("round", "round"), tone="light", lite=True)
    toque(a, F.hc, 22.5)


@art_key("pic_driver")
def pic_driver(a):
    """A driver (sopir) seen through the windscreen: cap, collared shirt, both hands on a big steering wheel."""
    cx = 118 + a.j(2)
    wc = (cx + 4, 196)

    def wheel_(F):
        a.fill_poly([(0, 214), (240, 208), (240, 240), (0, 240)], "slate", 0.85, off=(0, 0))
        a.line((0, 214), (240, 208), LW)
        a.stroke(a.ell_path(wc, 66, 50, wob=0.01), 13, "ink", 0.92)
        a.stroke(a.ell_path(wc, 66, 50, wob=0.01), 3, "slate", 0.7)
        hub = ellipse(add(wc, (0, 8)), 18, 14, n=10)
        for t in (200, 340, 90):
            a.blob(capsule(add(wc, (0, 8)), polar(wc, 62, t, 47), 5, 4.5, n=3), "slate", w=MW, second=0)
        a.fill_smooth(hub, "ochre")
        a.outline(hub, MW * 1.4, second=0)

    F = figure(a, r=34, head=(cx, 88), cut=236, top="shirt", top_col="sage", hair="short", expr="smile",
               extras={"collar": "sage", "placket": True}, mid=wheel_,
               pose={"arms": (("ik", polar(wc, 64, 205, 48), 1), ("ik", polar(wc, 64, 335, 48), -1))}, tone="mid")
    T = Tf(F.hc, 34, 0)
    crown = T.pts([(-1.02, -0.3), (-1.0, -0.86), (-0.5, -1.16), (0.3, -1.18), (0.92, -0.9), (1.04, -0.32)])
    a.fill_smooth(crown, "clay")
    a.hatch(clip_half(crown, T((0.4, 0)), T.v((1, 0))), 70, 4.2, alpha=0.4)
    a.outline(crown, LW, second=0.3)
    visor = T.pts([(-0.9, -0.36), (1.04, -0.34), (1.44, -0.2), (1.2, -0.08), (-0.8, -0.18)])
    a.blob(visor, "clay", w=MW * 1.4, second=0)
    a.ell(T((0, -1.12)), 5, 3.5, "ochre", w=MW, second=0)


@art_key("pic_nurse")
def pic_nurse(a):
    """A nurse (perawat), a woman in a white cap with a sage plus, a sage scrub tunic and slate trousers, holding a
    clipboard; a small watch pinned at the chest. Tells from pic_doctor (white coat, stethoscope, glasses)."""
    cx = 118 + a.j(2)

    def board(F):
        T = Tf(add(F.nb, (8, 50)), 1, 8)
        b = T.pts(rect(-20, -24, 40, 50))
        a.block(b, "ochre", w=MW * 1.4, second=0)
        pg = T.pts(rect(-15, -16, 30, 38))
        a.fill_poly(pg, "paper", off=(0, 0))
        a.outline_poly(pg, FW * 1.3, second=0)
        a.lines([(T((-10, -8 + k * 9)), T((10 - (k % 2) * 6, -8 + k * 9))) for k in range(4)], FW * 1.2, alpha=0.55)
        a.block(T.pts(rect(-8, -28, 16, 8)), "slate", w=FW * 1.3, second=0)
        a.ell(add(F.nb, (-20, 22)), 5, 5, "ochre", w=FW * 1.3, second=0)

    F = figure(a, cx, 224, 23, top="tshirt", top_col="sage", sleeve="short", bottom="trousers", bottom_col="slate",
               shoes="paper", hair="bun", mid=board, extras={"collar": "sage"},
               pose={"arms": ((101, 94), ("ik", (cx + 2, 128), -1))}, tone="deep")
    nurse_cap(a, F.hc, 23)


@art_key("pic_pilot")
def pic_pilot(a):
    """A pilot, a woman in a peaked cap, white shirt with ochre epaulette stripes and a slate tie, a flight bag in one
    hand; a small plane flies in the corner."""
    cx = 100 + a.j(2)

    def tie(F):
        t = [add(F.nb, p) for p in ((-4, 2), (4, 2), (3, 8), (7, 42), (0, 50), (-7, 42), (-3, 8))]
        a.blob(t, "slate", w=MW * 1.2, second=0)
        a.lines([(add(F.nb, (sx * 12, -3)), add(F.nb, (sx * 25, -1))) for sx in (-1, 1)], 4.4, "slate", amp=0.1)
        a.lines([(add(F.nb, (sx * 14, -3)), add(F.nb, (sx * 23, -1))) for sx in (-1, 1)], 1.6, "ochre", amp=0.1)
        h = F.hd[1]
        bag = [add(h, p) for p in ((-18, 6), (20, 6), (22, 40), (-20, 40))]
        a.block(bag, "slate", w=LW, second=0)
        a.curve([add(h, (-8, 8)), add(h, (0, -4)), add(h, (8, 8))], MW * 1.2)

    F = figure(a, cx, 224, 22.5, top="shirt", top_col="paper", sleeve="short", bottom="trousers", bottom_col="slate",
               shoes="slate", hair="bun", mid=tie, extras={"collar": "paper"}, tone="mid", lite=True,
               pose={"arms": ((101, 94), (82, 86))})
    peaked_cap(a, F.hc, 22.5, "slate", "ochre", "ochre")
    small_plane(a, (190, 52), windows=False)


@art_key("pic_firefighter")
def pic_firefighter(a):
    """A firefighter (pemadam kebakaran): a clay helmet with an ochre front shield, slate jacket and trousers with
    ochre reflective bands, both hands on the nozzle of an ochre hose; the water arcs away. No flame anywhere."""
    cx = 86 + a.j(2)
    noz = (cx + 50, 118)

    def hose(F):
        a.curve([(18, 222), (10, 196), (26, 176), (cx - 16, 172), (cx + 12, 150), noz], 9, "ochre")
        a.curve([(18, 222), (10, 196), (26, 176), (cx - 16, 172), (cx + 12, 150), noz], FW, alpha=0.6)
        T = Tf(F.nb, 1, F.lean)
        for y0 in (28, 60):
            band = clip_half(clip_half(ellipse(T((0, y0)), 40, 30, n=12), T((0, y0 - 3)), T.v((0, 1))), T((0, y0 + 4)),
                             T.v((0, -1)))
            a.fill_poly(clip_convex(band, T.pts(rect(-20, y0 - 6, 40, 14))), "ochre", 0.95)
        nz = [add(noz, p) for p in ((-6, 6), (14, -6), (22, 4), (4, 14))]
        a.block(nz, "slate", w=MW * 1.3, second=0)

    F = figure(a, cx, 224, 22.5, facing=1, top="shirt", top_col="slate", sleeve="long", bottom="trousers",
               bottom_col="slate", shoes="ink", hair="short", mid=hose, lite=True,
               pose={"arms": (("ik", add(noz, (-16, 6)), 1), ("ik", add(noz, (2, 2)), -1))}, tone="light")
    for i in (0, 1):
        k, an = F.kn[i], F.an[i]
        m, nn = lerp(k, an, 0.55), perp(unit(sub(an, k)))
        a.line(add(m, mul(nn, -7)), add(m, mul(nn, 7)), 5, "ochre", amp=0.1)
    helmet(a, F.hc, 22.5, col="clay", shield="ochre")
    jet = [add(noz, (20, -6)), (178, 84), (210, 86), (232, 112)]
    a.curve(jet, 14, "slate", 0.8)
    a.curve(jet, MW, "paper", 0.9)
    for c, s_ in (((224, 134), 6), ((208, 146), 4.5), ((234, 154), 4), ((216, 166), 3.5)):
        drop(a, c, s_, "slate", 170)


@art_key("pic_police")
def pic_police(a):
    """A traffic police officer (polisi lalu lintas): peaked cap, khaki shirt under a sage reflective vest with paper
    bands, one open palm raised to say stop, a whistle at the lips. No weapon, no emblem."""
    cx = 112 + a.j(2)

    def vest(F):
        T = Tf(F.nb, 1, F.lean)
        v = T.pts([(-12, -2), (-24, 2), (-27, 30), (-28, 60), (28, 60), (27, 30), (24, 2), (12, -2), (0, 26)])
        a.fill_poly(v, "sage")
        for y0 in (30, 44):
            band = clip_convex(v, T.pts(rect(-30, y0, 60, 6)))
            if len(band) > 2:
                a.fill_poly(band, "paper", 0.95, off=(0, 0))
        a.outline_poly(v, MW * 1.4, second=0)
        a.curve([T((-5, 6)), T((-14, 24)), T((-14, 30))], FW * 1.3, "paper", 0.9)

    F = figure(a, cx, 224, 23, top="shirt", top_col="ochre", sleeve="long", bottom="trousers", bottom_col="slate",
               shoes="ink", hair="short", mid=vest, extras={"collar": "ochre"}, lite=True,
               pose={"arms": ((100, 93), (-8, -88))}, hands=("round", "none"), tone="mid")
    palm = Tf(add(F.hd[1], (0, 8)), 23 * 0.8, 4, True).pts(OPEN_HAND)
    skin_parts(a, [palm])
    a.curve(palm, MW * 1.3, jit=0.2)
    peaked_cap(a, F.hc, 23, "slate", "ochre", "ochre")
    m = add(F.hc, (2, 23 * 0.46))
    wh = [add(m, p) for p in ((-3, -4), (14, -5), (16, 4), (-2, 5))]
    a.block(wh, "slate", w=MW * 1.2, second=0)
    a.ell(add(m, (13, 0)), 3.6, 3.6, "paper", w=FW, second=0)
    a.curve([add(m, (-2, 3)), add(F.nb, (-6, 10)), add(F.nb, (-10, 22))], FW * 1.3, "slate", 0.9)


@art_key("pic_fisher")
def pic_fisher(a):
    """A fisher (nelayan) standing in a small wooden boat on the sea, casting a round net (jala); a clay head band.
    Tells from pic_fishing (a child with a rod on the bank) by the boat and the net."""
    wy = 190
    cx = 84 + a.j(2)

    def net(F):
        top = add(F.hd[1], (6, -2))
        rim = [(128, 196), (164, 212), (206, 210), (238, 192)]
        a.fill_poly([top] + rim[::-1], "slate", 0.25, off=(0, 0))
        a.lines([(top, q) for q in [lerp(rim[0], rim[-1], t) for t in (0.0, 0.17, 0.34, 0.5, 0.67, 0.84, 1.0)]],
                MW * 0.9, alpha=0.85, amp=0.6)
        for t in (0.3, 0.55, 0.8):
            a.curve([lerp(top, q, t) for q in rim], MW * 0.9, alpha=0.85, jit=0.3)
        a.curve(rim, MW * 1.5, jit=0.3)
        a.dots(rim + [lerp(rim[0], rim[1], 0.5), lerp(rim[2], rim[3], 0.5)], 4.4, "slate")

    F = figure(a, cx, 206, 23, facing=1, top="tshirt", top_col="ochre", sleeve="short", bottom="trousers",
               bottom_col="slate", shoes=None, hair="short", mid=net, ground_line=False, lite=True,
               pose={"lean": 4, "arms": (("ik", (cx + 50, 104), 1), ("ik", (cx + 58, 112), -1)), "behind": ("arm0",)},
               tone="deep")
    band = [add(F.hc, p) for p in ((-22, -9), (22, -11), (22, -4), (-22, -2))]
    a.block(band, "clay", w=FW * 1.3, second=0)
    a.blob([add(F.hc, (-22, -6)), add(F.hc, (-34, 0)), add(F.hc, (-30, 6))], "clay", w=FW * 1.3, second=0)
    water = [(0, wy)] + [(x, wy + 3 * math.sin(x / 13)) for x in range(10, 241, 15)] + [(240, 240), (0, 240)]
    a.fill_poly(water, "slate", 0.4, off=(0, 0), step=40)
    hull = [(8, 178), (164, 178), (148, 214), (30, 216)]
    a.fill_poly(hull, "clay")
    a.fill_poly([(9, 178), (163, 178), (160, 187), (12, 187)], "ochre", 0.95)
    a.hatch(clip_half(hull, (0, 202), (0, 1)), 10, 4.4, alpha=0.4)
    a.outline_poly(hull, LW, second=0.4)
    a.curve([(4, 172), (8, 178), (14, 180)], MW * 1.3)
    for k, y in enumerate((wy + 18, 230)):
        a.curve([(4 + (k % 2) * 16 + i * 22, y + 3 * math.sin(i * 1.7 + k)) for i in range(11)], MW, "slate", 0.85)
    a.curve([(150, 212), (176, 206), (206, 210), (236, 204)], MW * 1.2, "ink", 0.85)


@art_key("pic_seller")
def pic_seller(a):
    """A seller (pedagang), a woman in a kerudung and apron behind her counter of fruit, holding an orange out to a
    buyer. Tells from pic_market (the stall, no person) and pic_chef (toque, no produce)."""
    cx = 100 + a.j(2)

    def counter(F):
        top = [(0, 184), (240, 180), (240, 240), (0, 240)]
        a.fill_poly(top, "ochre", 0.85, off=(0, 0))
        a.hatch(top, 90, 9, w=MW, alpha=0.3)
        a.line((0, 184), (240, 180), LW * 1.1)
        for bx, fill in ((40, "clay"), (196, "sage")):
            for dx, dy in ((-16, 168), (0, 164), (16, 168), (-8, 154), (8, 154)):
                round_ball(a, (bx + dx, dy), 10, fill, hatch=False, w=MW * 1.2)
            bk = [(bx - 30, 188), (bx + 30, 188), (bx + 23, 166), (bx - 23, 166)]
            a.fill_poly(bk, "ochre")
            a.hatch(bk, 30, 5, alpha=0.45)
            a.hatch(bk, -30, 5, alpha=0.45)
            a.outline_poly(bk, MW * 1.4, second=0)
        h = F.hd[1]
        round_ball(a, add(h, (10, -12)), 13, "ochre")
        a.fill_smooth(leaf_pts(add(h, (12, -24)), add(h, (24, -31)), 4), "sage")

    F = figure(a, r=28, head=(cx, 76), cut=236, top="blouse", top_col="slate", sleeve="long", hair="kerudung",
               ker_col="clay", expr="grin", extras={"apron": "paper"}, mid=counter,
               pose={"arms": ((104, 96), ("ik", (cx + 74, 142), 1))}, tone="light")


@art_key("pic_mechanic")
def pic_mechanic(a):
    """A mechanic (montir), a woman in a kerudung and sage coverall, a big wrench in her hand and a tyre beside her.
    The wrench is a tool, drawn plain (never like a weapon)."""
    cx = 92 + a.j(2)
    tc = (182, 186)
    a.stroke(a.ell_path(tc, 34, 34, wob=0.015), 14, "ink", 0.9)
    a.ell_outline(tc, 26, 26, w=FW * 1.3, second=0)
    a.fill_smooth(ellipse(tc, 15, 15, n=10), "slate", 0.9)
    a.ell_outline(tc, 15, 15, w=MW, second=0)
    a.dots([polar(tc, 9, t) for t in range(0, 360, 72)], 3.4, "paper", 0.9)

    def wrench(F):
        h = F.hd[1]
        d = unit((1.0, -0.8))
        tip = add(h, mul(d, 50))
        a.blob(capsule(add(h, mul(d, -12)), tip, 5, 4, n=3), "slate", w=MW * 1.3, second=0)
        jaw = [polar(tip, 14, t) for t in range(-150, 150, 30)]
        jaw = [add(tip, rotp(p, math.degrees(math.atan2(d[1], d[0])))) for p in
               [(4, -6), (16, -12), (22, -6), (14, -3), (14, 3), (22, 6), (16, 12), (4, 6)]]
        a.fill_smooth(jaw, "slate")
        a.outline(jaw, MW * 1.3, second=0, jit=0.2)
        a.line(add(h, mul(d, 8)), add(h, mul(d, 38)), FW * 1.3, "paper", 0.8)

    F = figure(a, cx, 224, 23, top="shirt", top_col="sage", sleeve="long", bottom="trousers", bottom_col="sage",
               shoes="ink", hair="kerudung", ker_col="clay", mid=wrench, extras={"collar": "sage", "placket": True},
               lite=True, pose={"arms": ((101, 94), (-20, -100))}, tone="mid")
    a.block([add(F.nb, (8, 30)), add(F.nb, (22, 30)), add(F.nb, (22, 44)), add(F.nb, (8, 44))], "sage", w=FW * 1.3,
            second=0)
    ground(a, 30, 220, 227, marks=4)


# --------------------------------------------------------------------------------------------- weather, seasons, nature


def snowflake(a, c, r, rot=0.0, under="paper"):
    """A six-armed snow crystal: a broad paper (or other) stroke under thin ink arms with small V branches."""
    arms, ticks = [], []
    for k in range(6):
        t = rot + 60 * k
        tip = polar(c, r, t)
        arms.append((c, tip))
        for f, L in ((0.55, 0.32), (0.8, 0.22)):
            b = polar(c, r * f, t)
            ticks += [(b, polar(b, r * L, t - 45)), (b, polar(b, r * L, t + 45))]
    if under:
        a.lines(arms + ticks, max(3.4, r * 0.2), under, 0.95, amp=0.2)
    a.lines(arms, MW * 1.2 if r > 12 else MW, amp=0.3)
    a.lines(ticks, FW * 1.3, amp=0.2)


def snow_ground(a, y, col="slate"):
    """Snow on the ground: a soft paper mound with a slate-hatched underside edge."""
    mound = [(0, y + 6)] + [(x, y + 7 * math.sin(x / 34 + 1)) for x in range(20, 241, 22)] + [(240, 240), (0, 240)]
    a.fill_poly(mound, "paper", off=(0, 0), step=30)
    a.hatch(clip_half(mound, (0, y + 14), (0, 1)), 8, 6, color=col, alpha=0.35)
    a.curve(mound[:-2], LW, jit=0.4)


def maple_leaf(a, c, s, rot, col, col2=None, w=LW):
    """A five-lobed maple-type leaf with serrations, veins and a stem."""
    T = Tf(c, s, rot)
    tips = {-90: 1.0, -28: 0.9, 32: 0.62, 148: 0.62, 208: 0.9}
    notch = {-60: 0.38, 2: 0.36, 90: 0.22, 178: 0.36, 240: 0.38}
    pts = []
    for ang in sorted(list(tips) + list(notch)):
        if ang in tips:
            r = tips[ang]
            pts += [polar((0, 0), r * 0.68, ang - 16), polar((0, 0), r, ang), polar((0, 0), r * 0.68, ang + 16)]
        else:
            pts.append(polar((0, 0), notch[ang], ang))
    P = T.pts(pts)
    a.fill_poly(P, col, step=40)
    if col2:
        a.fill_poly(clip_half(P, T((0.1, 0)), T.v((1, 0.3))), col2, 0.5, off=a.reg(col), step=40)
    a.outline_poly(P, w, second=0.3, over=1.2, gap=1.2)
    a.lines([(T((0, 0.22)), T(polar((0, 0), tips[t] * 0.82, t))) for t in tips], FW * 1.4, alpha=0.7, amp=0.3)
    a.line(T((0, 0.2)), T((0.04, 0.78)), MW * 1.3, amp=0.3)


@art_key("pic_snow")
def pic_snow(a):
    """Snow: big and small snowflakes falling on a pale winter sky patch, a snow-capped pine and snow on the ground."""
    tint_patch(a, (120, 104), 116, 100, "slate", 0.28)
    tc = (176 + a.j(2), 0)
    a.blob(capsule((tc[0], 196), (tc[0], 176), 6), "clay", 0.85, w=MW * 1.2, second=0)
    for y, w_ in ((84, 22), (116, 32), (150, 42)):
        tier = [(tc[0], y - 30), (tc[0] + w_, y + 24), (tc[0] - w_, y + 24)]
        a.fill_poly(tier, "sage")
        cap = [(tc[0], y - 30), (tc[0] + w_ * 0.62, y + 6), (tc[0] + w_ * 0.3, y + 2), (tc[0], y + 8),
               (tc[0] - w_ * 0.35, y + 2), (tc[0] - w_ * 0.62, y + 6)]
        a.fill_smooth(cap, "paper", off=(0, 0))
        a.outline_poly(tier, MW * 1.4, second=0, over=1.0, gap=1.0)
    snow_ground(a, 190)
    snowflake(a, (66 + a.j(2), 72), 28, 8)
    snowflake(a, (120, 32), 15, 20)
    snowflake(a, (96, 148), 17, -6)
    for c in ((34, 130), (138, 92), (210, 40), (50, 26), (130, 160), (28, 176), (222, 104), (162, 18)):
        a.ell(c, 4.2, 4.2, "paper", w=FW * 1.3, second=0)


@art_key("pic_wind")
def pic_wind(a):
    """Wind: a tree bending, leaves blown away, three curling gust lines. Bright and dry (no cloud, no rain), which
    tells it from pic_storm."""
    ground(a, 14, 120, 214, marks=3)
    trunk = ribbon([(56, 214), (60, 176), (74, 144), (96, 122)], 15, 8)
    a.blob(trunk, "clay", 0.85, w=LW, second=0)
    can = [(70, 60), (104, 54), (142, 70), (170, 98), (160, 122), (128, 132), (92, 134), (62, 120), (52, 92)]
    a.fill_smooth(can, "sage")
    a.hatch(clip_half(can, (0, 112), (0, 1)), 20, 4.4, alpha=0.4)
    a.outline(can, LW, second=0.4)
    for c in ((86, 86), (122, 80), (140, 104)):
        a.arc(c, 12, 200, 330, MW, alpha=0.7)
    for c, rot in (((190, 70), -30), ((214, 124), 20), ((178, 150), 60), ((222, 176), -10)):
        lf = leaf_pts(add(c, rotp((-9, 0), rot)), add(c, rotp((9, 0), rot)), 5)
        a.fill_smooth(lf, "sage")
        a.outline(lf, MW, second=0, jit=0.2)
    for y, x0, x1, cr in ((40, 120, 214, 12), (156, 92, 196, 14), (190, 128, 222, 10)):
        pts = [(x0, y + 6), ((x0 + x1) / 2, y - 4), (x1 - cr, y + 2)]
        curl = [polar((x1 - cr, y + 2 - cr), cr, t) for t in range(90, -200, -55)]
        line = pts + curl
        glyph_under(a, line, 9, "slate", 0.6)
        a.curve(line, MW * 1.4, jit=0.4)


@art_key("pic_storm")
def pic_storm(a):
    """A storm: a dark heavy cloud, an ochre lightning bolt and slanting rain. Darker and busier than pic_rain."""
    for k in range(9):
        x = 34 + k * 21 + a.j(3)
        y0 = 120 + (k % 3) * 10
        a.line((x, y0), (x - 16, y0 + 46), MW * 1.3, "slate", 0.9, amp=0.3)
        if k % 2 == 0:
            a.line((x - 22, y0 + 58), (x - 30, y0 + 78), MW * 1.3, "slate", 0.9, amp=0.3)
    sh = puff_cloud(a, (118 + a.j(2), 92), 168, 68, "slate", 0.6, LW)
    a.fill_smooth(sh, "slate", 0.85)
    a.hatch(clip_half(sh, (0, 70), (0, 1)), 20, 4.6, alpha=0.45)
    a.curve([(60, 72), (80, 64), (100, 70)], MW * 1.2, "paper", 0.7)
    a.curve([(128, 56), (150, 50), (168, 58)], MW * 1.2, "paper", 0.7)
    bolt = [(126, 98), (158, 98), (142, 134), (162, 132), (114, 204), (126, 152), (104, 154)]
    a.fill_poly(bolt, "ochre")
    a.outline_poly(bolt, LW, second=0, over=1.0, gap=0.8)
    for y in (44, 62):
        a.curve([(10, y), (28, y - 4), (44, y)], MW * 1.2, alpha=0.7)


@art_key("pic_spring_blossom")
def pic_spring_blossom(a):
    """Spring blossom: a branch with five-petalled pink (blush) flowers and buds, two petals drifting down. Many small
    blossoms on a branch, which tells it from pic_flower (one flower on a stem)."""
    br = ribbon([(6, 220), (60, 178), (112, 140), (168, 100), (232, 70)], 13, 5, steps=3)
    a.blob(br, "clay", 0.85, w=MW * 1.4, second=0)
    for p0, p1 in (((92, 154), (78, 98)), ((150, 112), (176, 160)), ((180, 92), (190, 46))):
        a.blob(ribbon([p0, lerp(p0, p1, 0.5), p1], 6, 3), "clay", 0.85, w=MW * 1.2, second=0)
    flowers = [((52, 176), 19), ((80, 104), 17), ((126, 134), 21), ((178, 158), 16), ((188, 54), 17), ((218, 82), 14)]
    for c, r in flowers:
        petals = [ellipse(polar(c, r * 0.62, t), r * 0.5, r * 0.42, t, n=8) for t in range(-80, 280, 72)]
        for pt in petals:
            a.fill_smooth(pt, "blush", 0.95)
        outlines(a, petals, MW * 1.1, jit=0.3)
        a.fill_smooth(ellipse(c, r * 0.28, r * 0.28, n=7), "clay", 0.9)
        a.dots([polar(c, r * 0.36, t) for t in range(0, 360, 60)], 2.6, "ochre")
    for c in ((138, 92), (40, 140), (204, 118)):
        a.ell(c, 6, 8, "blush", w=MW, second=0)
    for c, rot in (((30, 70), 30), ((120, 40), -20), ((90, 214), 60)):
        p = ellipse(c, 6, 4, rot, n=6)
        a.fill_smooth(p, "blush", 0.95)
        a.outline(p, FW * 1.3, second=0, jit=0.1)


@art_key("pic_autumn_leaves")
def pic_autumn_leaves(a):
    """Autumn leaves: three big maple-type leaves in clay and ochre drifting down, a few more fallen on the ground."""
    a.line((14, 214), (226, 212), MW * 1.1, alpha=0.7)
    for c, s, rot, col in (((60, 206), 14, 100, "ochre"), ((96, 210), 12, -60, "clay"), ((186, 207), 13, 20, "ochre")):
        maple_leaf(a, c, s, rot, col, w=MW * 1.2)
    maple_leaf(a, (82 + a.j(2), 72), 52, -18, "clay", "ochre")
    maple_leaf(a, (172, 104), 42, 24, "ochre", "clay")
    maple_leaf(a, (110, 156), 30, -46, "clay")


@art_key("pic_snowman")
def pic_snowman(a):
    """A snowman: two snowballs, coal eyes and buttons, a clay carrot nose, a clay scarf, twig arms, an ochre knitted
    cap; on a pale sky patch so the white reads."""
    tint_patch(a, (122, 112), 108, 102, "slate", 0.26)
    snow_ground(a, 196)
    cx = 118 + a.j(2)
    for p0, p1, tw in (((cx - 38, 138), (cx - 86, 104), (cx - 78, 92)), ((cx + 38, 136), (cx + 84, 100), (cx + 92, 110))):
        a.line(p0, p1, MW * 1.6, "clay", amp=0.4)
        a.line(lerp(p0, p1, 0.75), tw, MW * 1.2, "clay", amp=0.3)
    for c, r in (((cx, 166), 50), ((cx + 2, 92), 34)):
        a.fill_smooth(ellipse(c, r, r * 0.94, n=16), "paper", off=(0, 0))
        a.hatch(clip_half(ellipse(c, r - 3, r * 0.94 - 3, n=24), add(c, (r * 0.3, r * 0.2)), (0.7, 0.6)), 50, 4.4,
                color="slate", alpha=0.4)
        a.ell_outline(c, r, r * 0.94, w=LW)
    a.dots([(cx + 1, 150), (cx, 170), (cx + 2, 190)], 7.5)
    hc = (cx + 2, 92)
    a.dots([(hc[0] - 12, hc[1] - 6), (hc[0] + 12, hc[1] - 7)], 7)
    a.dots([(hc[0] - 12 + k * 6, hc[1] + 14 + abs(k - 2) * -2) for k in range(5)], 3.6)
    nose = [(hc[0] - 1, hc[1] - 2), (hc[0] + 30, hc[1] + 4), (hc[0] - 1, hc[1] + 7)]
    a.fill_poly(nose, "clay")
    a.outline_poly(nose, MW * 1.2, second=0, over=0.6, gap=0.6)
    sc = [(cx - 34, 116), (cx, 124), (cx + 36, 116), (cx + 36, 130), (cx, 138), (cx - 34, 130)]
    a.blob(sc, "clay", w=MW * 1.4, second=0)
    tail = [(cx + 18, 128), (cx + 32, 130), (cx + 36, 168), (cx + 22, 168)]
    a.block(tail, "clay", w=MW * 1.3, second=0)
    a.lines([((cx + 24 + k * 4, 168), (cx + 24 + k * 4, 176)) for k in range(4)], MW, "clay")
    cap = [(cx - 32, 76), (cx - 30, 52), (cx - 12, 38), (cx + 14, 38), (cx + 32, 52), (cx + 36, 74)]
    a.fill_smooth(cap, "ochre")
    a.lines([((cx - 24 + k * 10, 70), (cx - 22 + k * 10, 48)) for k in range(6)], FW * 1.2, alpha=0.5)
    a.outline(cap, LW, second=0)
    a.block([(cx - 36, 68), (cx + 38, 66), (cx + 38, 80), (cx - 36, 82)], "ochre", w=MW * 1.4, second=0)
    a.ell((cx + 2, 34), 10, 9, "clay", w=MW * 1.2, second=0)


@art_key("pic_river")
def pic_river(a):
    """A river winding from the hills towards us between grassy banks, stones and reeds. Water that flows (narrow far
    away, wide near), which tells it from pic_lake (closed) and pic_sea (horizon)."""
    hills = [(0, 84), (40, 62), (86, 74), (130, 56), (180, 70), (240, 58), (240, 92), (0, 92)]
    a.fill_smooth(hills, "sage", 0.55)
    a.curve(hills[:6], MW * 1.3, jit=0.4)
    land = [(0, 86), (240, 86), (240, 240), (0, 240)]
    a.fill_poly(land, "sage", 0.35, off=(0, 0), step=60)
    left, right = [], []
    for i in range(13):
        t = i / 12
        y = 86 + 154 * t
        xc = 120 + 46 * math.sin(t * math.pi * 1.25 + 0.2) - 10 * t
        w = 8 + 118 * t ** 1.3
        left.append((xc - w / 2, y))
        right.append((xc + w / 2, y))
    left[-1] = (left[-1][0], 242)
    right[-1] = (right[-1][0], 242)
    river = left + right[::-1]
    a.fill_poly(river, "slate", 0.6, step=40)
    for t in (0.35, 0.55, 0.75, 0.9):
        i = int(t * 12)
        c = lerp(left[i], right[i], 0.5)
        w = (right[i][0] - left[i][0]) * 0.3
        a.curve([add(c, (-w, 2)), add(c, (-w * 0.3, -2)), add(c, (w * 0.4, 2)), add(c, (w, -1))], MW * (0.8 + t),
                "paper", 0.85)
    a.curve(left, LW, jit=0.4)
    a.curve(right, LW, jit=0.4)
    for c, r in (((40, 200), 9), ((58, 214), 6), ((206, 150), 8), ((196, 166), 5)):
        a.ell(c, r, r * 0.7, "slate", 0.7, w=MW * 1.2, second=0)
    for x, y in ((24, 150), (60, 120), (182, 112), (214, 200)):
        a.lines([((x, y), (x - 5, y - 12)), ((x, y), (x + 1, y - 14)), ((x, y), (x + 6, y - 11))], MW, "sage", amp=0.3)


@art_key("pic_forest")
def pic_forest(a):
    """A forest: many trees close together, pines and round trees in two rows, the back row lighter."""
    ground(a, 6, 234, 214, marks=6)

    def pine(x, base, h, w, alpha):
        a.blob(capsule((x, base), (x, base - 16), 4.5), "clay", 0.85, w=MW * 1.2, second=0)
        tri = [(x, base - h), (x + w, base - 14), (x - w, base - 14)]
        a.fill_poly(tri, "sage", alpha)
        a.hatch(clip_half(tri, (x + w * 0.2, 0), (1, 0)), 70, 4.2, alpha=0.4)
        a.zig([(x - w * 0.45, base - h * 0.45), (x - w * 0.15, base - h * 0.52), (x + w * 0.15, base - h * 0.45),
               (x + w * 0.45, base - h * 0.52)], FW * 1.3, alpha=0.6)
        a.outline_poly(tri, LW, second=0.3, over=1.0, gap=1.0)

    def round_tree(x, base, r, alpha):
        a.blob(capsule((x, base), (x, base - r * 0.9), 6, 5), "clay", 0.85, w=MW * 1.3, second=0)
        can = [polar((x, base - r * 1.5), r * (1 + 0.08 * math.sin(t * 3)), t, r * 0.92) for t in range(0, 360, 30)]
        a.fill_smooth(can, "sage", alpha)
        a.hatch(clip_half(can, (x + r * 0.3, base - r), (0.7, 0.7)), 55, 4.4, alpha=0.4)
        a.outline(can, LW, second=0.3)
        a.arc((x - r * 0.3, base - r * 1.6), r * 0.32, 200, 330, MW, alpha=0.6)

    pine(56, 190, 136, 30, 0.6)
    round_tree(120, 186, 36, 0.6)
    pine(184, 192, 150, 32, 0.6)
    round_tree(34, 214, 28, 1.0)
    pine(96, 216, 128, 34, 1.0)
    round_tree(156, 214, 32, 1.0)
    pine(214, 216, 104, 24, 1.0)


@art_key("pic_volcano")
def pic_volcano(a):
    """A volcano (gunung berapi): a broad cone with a flat crater top, a little glowing clay lava at the rim and a
    plume of grey smoke puffs. Tells from pic_mountain by the crater and smoke; calm, not an eruption."""
    for c, w, h in (((128, 64), 44, 24), ((162, 46), 74, 34)):
        sh = puff_cloud(a, c, w, h, "slate", 0.3, MW * 1.3)
        a.fill_smooth(sh, "slate", 0.4)
    cone = [(6, 214), (52, 148), (84, 92), (98, 76), (142, 74), (156, 92), (190, 148), (234, 214)]
    a.fill_smooth(cone + [(120, 220)], "clay", 0.55)
    a.fill_smooth(cone + [(120, 220)], "slate", 0.45, off=a.reg("clay"))
    a.hatch(clip_half(cone + [(120, 220)], (140, 0), (1, -0.2)), 65, 4.6, alpha=0.4)
    a.curve(cone, LW)
    crater = ellipse((120, 76), 22, 6, n=12)
    a.fill_smooth(crater, "ink", 0.7, off=(0, 0))
    a.outline(crater, MW * 1.2, second=0)
    for pts in ([(110, 80), (104, 98), (108, 116)], [(130, 80), (138, 100), (134, 112)]):
        a.blob(ribbon(pts, 8, 3), "clay", w=MW * 1.1, second=0)
    a.fill_smooth([(6, 214), (40, 190), (80, 196), (120, 186), (170, 194), (234, 214), (234, 220), (6, 220)], "sage")
    a.curve([(6, 214), (40, 190), (80, 196), (120, 186), (170, 194), (234, 214)], MW * 1.3, jit=0.4)
    a.line((2, 218), (238, 216), MW * 1.1)


@art_key("pic_beach")
def pic_beach(a):
    """A beach (pantai): ochre sand, the sea with a foam edge behind it, a leaning coconut palm and a starfish on the
    sand. The sand is the subject, which tells it from pic_sea."""
    hy = 86
    a.fill_poly([(0, hy), (240, hy), (240, 150), (0, 172)], "slate", 0.45, off=(0, 0))
    a.line((1, hy), (239, hy + a.j(1)), MW * 1.3)
    for k, y in enumerate((106, 128)):
        a.curve([(10 + (k % 2) * 14 + i * 30, y + 3 * math.sin(i * 1.5 + k)) for i in range(8)], MW, "ink", 0.6)
    sand = spline([(0, 172), (60, 160), (130, 150), (240, 142)], False, 4) + [(240, 240), (0, 240)]
    a.fill_poly(sand, "ochre", 0.75, step=40)
    a.stipple(sand, 26, 2.2, "clay", 0.5)
    a.curve([(0, 168), (60, 156), (130, 146), (240, 138)], 6, "paper", 0.95)
    a.curve(sand[:4], MW * 1.3, jit=0.4)
    trunk = ribbon([(60, 226), (66, 170), (84, 112), (112, 66)], 14, 8)
    a.fill_smooth(trunk, "clay", 0.8)
    a.lines([(lerp(p, q, 0.0), lerp(p, q, 1.0)) for p, q in
             [((58 + k * 4, 214 - k * 26), (72 + k * 4, 216 - k * 26)) for k in range(5)]], FW * 1.3, alpha=0.6)
    a.outline(trunk, LW, second=0)
    top = (114, 64)
    for tip, w_ in (((60, 40), 13), ((80, 88), 11), ((170, 40), 13), ((178, 92), 12), ((128, 18), 10)):
        fr = leaf_pts(top, tip, w_, asym=0.6)
        a.fill_smooth(fr, "sage")
        a.outline(fr, MW * 1.3, second=0, jit=0.3)
        a.line(top, lerp(top, tip, 0.9), FW * 1.2, amp=0.5)
    a.ell((108, 74), 7, 7, "clay", w=MW, second=0)
    a.ell((120, 76), 7, 7, "clay", w=MW, second=0)
    sc = (178, 196)
    star = [polar(sc, 20 if i % 2 == 0 else 8, -90 + 36 * i + 8) for i in range(10)]
    a.blob(star, "clay", w=MW * 1.3, second=0)
    a.dots([polar(sc, 10, -90 + 72 * i + 8) for i in range(5)], 2.6, "paper", 0.9)


@art_key("pic_lake")
def pic_lake(a):
    """A lake (danau): still water closed in by grassy shores all round, hills behind, reeds in front, a mirrored
    line. The shore all round tells it from pic_river and pic_sea."""
    hills = [(0, 104), (34, 70), (74, 56), (112, 74), (150, 48), (196, 64), (240, 84), (240, 118), (0, 118)]
    a.fill_smooth(hills, "sage", 0.75)
    a.hatch(clip_half(hills, (150, 0), (1, 0)), 65, 5, alpha=0.3)
    a.curve(hills[:7], LW, jit=0.4)
    land = [(0, 108), (240, 108), (240, 240), (0, 240)]
    a.fill_poly(land, "sage", 0.35, off=(0, 0), step=60)
    lake = ellipse((122, 156), 104, 40, -2, n=18)
    a.fill_smooth(lake, "slate", 0.6)
    a.outline(lake, LW, second=0.3)
    for y, x0, x1 in ((140, 72, 132), (156, 128, 196), (172, 60, 120)):
        a.line((x0, y), (x1, y + a.j(1)), MW * 1.2, "paper", 0.85, amp=0.3)
    a.curve([(150, 128), (170, 124), (196, 130)], MW, "sage", 0.9)
    for x, h in ((22, 52), (34, 64), (44, 46), (206, 48), (218, 60)):
        a.line((x, 228), (x + 2, 228 - h), MW * 1.3, "sage", amp=0.5)
        a.blob(capsule((x + 2, 228 - h + 4), (x + 2, 228 - h + 18), 3.6), "clay", w=FW * 1.3, second=0)
    for x in (28, 212):
        a.blob(leaf_pts((x, 228), (x + 22, 192), 6), "sage", w=MW, second=0)


@art_key("pic_moon")
def pic_moon(a):
    """The moon: a big ochre crescent with small stars on a dusk-slate patch of night sky."""
    tint_patch(a, (120, 116), 110, 104, "slate", 0.32)
    c = (112 + a.j(2), 116)
    moon = crescent(c, 70, add(c, (36, -24)), 62, n=60)[::2]
    a.fill_smooth(moon, "ochre")
    a.hatch(clip_half(moon, add(c, (-30, 30)), (-0.6, 0.8)), 40, 4.4, alpha=0.4)
    a.outline(moon, LW, second=0.4)
    for cc, r in (((60, 96), 7), ((78, 150), 5), ((54, 128), 4)):
        a.ell(cc, r, r * 0.9, "clay", 0.35, w=FW * 1.3, second=0)
    for sc, s in (((182, 154), 11), ((206, 62), 8), ((150, 196), 6)):
        st = [polar(sc, s if i % 2 == 0 else s * 0.4, -90 + 36 * i) for i in range(10)]
        a.blob(st, "ochre", w=MW, second=0)
    a.dots([(200, 112), (168, 36), (222, 200), (30, 40)], 3.6, "ochre")


# --------------------------------------------------------------------------------------------- daily routine

WALK_R = {"lean": 4, "arms": ((116, 102), (58, 40)), "legs": ((62, 80), (118, 102)), "behind": ("arm0", "leg0")}
WALK_L = {"lean": -4, "arms": ((122, 140), (64, 78)), "legs": ((62, 78), (118, 100)), "behind": ("arm1", "leg1")}


def backpack(a, F, side=-1, col="clay"):
    """A school backpack on a walking child's back (side -1 = the viewer's left), with a strap over the shoulder."""
    T = Tf(F.nb, 1, F.lean)
    r = F.r
    x0 = side * r * 0.62
    bag = T.pts([(x0, r * 0.05), (x0 + side * r * 0.95, r * 0.15), (x0 + side * r * 1.05, r * 1.55),
                 (x0 + side * r * 0.1, r * 1.65)])
    a.blob(bag, col, w=LW, second=0)
    pk = T.pts([(x0 + side * r * 0.3, r * 0.85), (x0 + side * r * 0.95, r * 0.85), (x0 + side * r * 0.95, r * 1.4),
                (x0 + side * r * 0.3, r * 1.45)])
    a.outline_poly(pk, MW * 1.2, second=0)
    a.curve([T((x0 + side * r * 0.05, r * 0.02)), T((-side * r * 0.05, r * 0.25)), T((-side * r * 0.05, r * 1.0))],
            MW * 2.2, "slate")


def window_sun(a, x, y, w, h, rising=True):
    """A small wooden window with a half sun on the sill line (morning or late afternoon)."""
    win = rect(x, y, w, h)
    a.fill_poly(win, "slate", 0.25, off=(0, 0))
    sc = (x + w * 0.5, y + h * 0.82)
    sun = [polar(sc, w * 0.26, t) for t in range(180, 361, 20)]
    a.fill_smooth(sun + [sc], "ochre")
    a.lines([(polar(sc, w * 0.33, t), polar(sc, w * 0.42, t)) for t in range(200, 341, 35)], MW, "ochre", amp=0.2)
    a.line((x + 2, y + h * 0.82), (x + w - 2, y + h * 0.82), MW, amp=0.2)
    a.outline_poly(win, MW * 1.6, second=0)
    a.line((x + w / 2, y), (x + w / 2, y + h * 0.4), MW, amp=0.2)
    a.line((x, y + h * 0.4), (x + w, y + h * 0.4), MW, amp=0.2)


@art_key("pic_wake_up")
def pic_wake_up(a):
    """Waking up: a child sitting up in bed, arms stretched high in a yawn, the blanket still over the legs; the
    morning sun at the window. Sitting up and stretching tells it from pic_sleep (lying, z marks)."""
    window_sun(a, 162, 26, 58, 58)
    a.block([(14, 70), (34, 66), (36, 206), (16, 206)], "ochre", w=LW, second=0.3)
    a.blob([(30, 112), (70, 104), (80, 136), (36, 144)], "paper", w=MW * 1.4, second=0)
    cx = 98 + a.j(2)
    F = figure(a, r=30, kid=True, head=(cx, 86), cut=200, top_col="sage", hair="short", expr="yawn",
               pose={"arms": ((-122, -100), (-58, -80))}, hands=("open", "open"), tone="mid")
    blanket = [(30, 150), (60, 156), (110, 150), (160, 156), (214, 150), (222, 196), (24, 200)]
    a.fill_smooth(blanket, "clay")
    a.hatch(blanket, 75, 9, w=MW, color="paper", alpha=0.35)
    a.outline(blanket, LW, second=0.4)
    a.curve([(70, 168), (120, 162), (170, 170)], MW, alpha=0.6)
    a.block([(18, 196), (226, 194), (226, 208), (18, 210)], "ochre", w=MW * 1.4, second=0)
    a.lines([((26, 210), (26, 224)), ((218, 208), (218, 224))], LW)
    motion_arcs(a, add(F.hc, (0, -6)), 56, -150, -122, w=MW * 1.2)
    motion_arcs(a, add(F.hc, (0, -6)), 56, -58, -30, w=MW * 1.2)


@art_key("pic_shower")
def pic_shower(a):
    """Taking a shower, kept modest: the whole body is behind a shower curtain; only the smiling head peeks out at the
    curtain's edge, shampoo bubbles on the hair, the shower spraying drops behind the curtain."""
    a.line((14, 40), (196, 38), LW * 1.1, amp=0.4)
    a.curve([(150, 0), (150, 12), (140, 18)], MW * 1.6, "slate")
    head_ = [(124, 16), (146, 14), (150, 24), (122, 26)]
    a.block(head_, "slate", w=MW * 1.3, second=0)
    for k, x in enumerate((122, 130, 138, 146)):
        for j in range(2):
            drop(a, (x - 4 - j * 3 + k, 30 + j * 4 + (k % 2) * 3), 3.4, "slate", 160)
    hc = (188 + a.j(2), 106)
    neck = capsule((hc[0] - 12, hc[1] + 26), (150, hc[1] + 44), 10)
    a.tone = "light"
    skin_parts(a, [neck])
    cur = [(18, 42), (40, 46), (64, 42), (88, 46), (112, 42), (136, 46), (158, 42), (162, 120), (156, 226), (130, 230),
           (102, 226), (74, 230), (46, 226), (20, 230)]
    a.fill_poly(cur, "sage", step=30)
    for x in (40, 64, 88, 112, 136):
        a.curve([(x, 50), (x + 3, 130), (x - 2, 222)], MW, alpha=0.5)
    a.dots([(x + 12, y) for x in (40, 64, 88, 112) for y in (80, 130, 180)], 5, "paper", 0.85)
    a.outline_poly(cur, LW, second=0.3)
    a.dots([(x, 40) for x in (30, 54, 78, 102, 126, 150)], 7, "ochre")
    draw_head(a, hc, 34, "short", "grin", -0.3, -8)
    for c, r in (((166, 76), 10), ((184, 68), 12), ((204, 72), 9), ((218, 84), 7)):
        a.ell(c, r, r * 0.9, "paper", w=MW * 1.2, second=0)
    hand = [(148, 132), (166, 128), (170, 138), (168, 154), (148, 156)]
    skin_parts(a, [hand])
    a.outline(hand, MW * 1.3, second=0, jit=0.2)
    a.lines([((150, 138), (162, 137)), ((150, 146), (162, 146))], FW * 1.2, alpha=0.7)
    for c in ((214, 120), (222, 140), (206, 150)):
        drop(a, c, 4.4, "slate", 10)


@art_key("pic_brush_teeth")
def pic_brush_teeth(a):
    """Brushing teeth: a child holding a toothbrush at the mouth, a little white foam, eyes smiling; a cup in the
    corner. A person brushing, which tells it from toothbrush (the brush and cup alone)."""
    cx = 104 + a.j(2)

    def brush(F):
        m = add(F.hc, (4, 40 * 0.46))
        h = F.hd[1]
        a.blob(capsule(add(h, (8, 6)), add(m, (12, 2)), 4.6, 3.8), "sage", w=MW * 1.3, second=0)
        bh = [add(m, p) for p in ((-14, -6), (14, -6), (14, 3), (-14, 3))]
        a.block(bh, "sage", w=MW * 1.2, second=0)
        for c, r in (((-16, 4), 6), ((-6, 10), 7), ((8, 9), 6), ((-22, -4), 4.5)):
            a.ell(add(m, c), r, r * 0.9, "paper", w=MW, second=0)

    figure(a, r=40, kid=True, head=(cx, 100), cut=236, top_col="ochre", hair="bob", expr="happy", mid=brush,
           pose={"arms": ((101, 94), ("ik", (cx + 54, 148), -1))}, tone="deep")
    cup = [(186, 176), (226, 176), (222, 230), (190, 230)]
    a.block(cup, "clay", w=LW, second=0.3)
    a.hatch(clip_half(cup, (212, 0), (1, 0)), 75, 4, alpha=0.45)
    a.blob(capsule((200, 178), (192, 140), 3.4, 3), "slate", w=MW, second=0)


@art_key("pic_get_dressed")
def pic_get_dressed(a):
    """Getting dressed: a child pulling a clay shirt on over a paper singlet, arms up in the sleeves, the shirt still
    bunched at the chest; small down arrows show the pull."""
    cx = 116 + a.j(2)
    r = 30

    def bunched(F):
        T = Tf(F.nb, 1, 0)
        sw = 1.0 * r
        vest = T.pts([(-sw * 0.8, r * 0.7), (sw * 0.8, r * 0.7), (sw * 0.98, 1.55 * r + r * 0.2),
                      (-sw * 0.98, 1.55 * r + r * 0.2)])
        a.fill_poly(vest, "paper", off=(0, 0))
        a.outline_poly(vest, MW * 1.4, second=0)
        roll = T.pts([(-sw * 1.12, r * 0.1), (-sw * 0.4, r * 0.0), (sw * 0.4, r * 0.02), (sw * 1.12, r * 0.12),
                      (sw * 1.06, r * 0.78), (sw * 0.3, r * 0.9), (-sw * 0.3, r * 0.86), (-sw * 1.08, r * 0.74)])
        a.fill_smooth(roll, "clay")
        a.hatch(clip_half(roll, T((sw * 0.4, 0)), T.v((1, 0))), 75, 4.4, alpha=0.4)
        a.outline(roll, LW, second=0.3)
        for x0 in (-0.6, -0.1, 0.45):
            a.curve(T.pts([(sw * x0, r * 0.2), (sw * (x0 + 0.12), r * 0.45), (sw * x0, r * 0.7)]), FW * 1.4, alpha=0.6)

    F = figure(a, cx, 222, r, kid=True, top_col="clay", sleeve="long", bottom="shorts", bottom_col="slate",
               shoes="ochre", hair="short", expr="grin", mid=bunched,
               pose={"arms": ((-118, -96), (-62, -84))}, tone="light")
    for sx in (-1, 1):
        x = F.nb[0] + sx * 50
        a.line((x, 118), (x, 152), MW * 1.3, amp=0.3)
        a.zig([(x - 6, 144), (x, 153), (x + 6, 144)], MW * 1.3, jit=0.2)


@art_key("pic_breakfast")
def pic_breakfast(a):
    """Breakfast (sarapan): a morning table with a plate of nasi goreng topped with a fried egg, spoon and fork, a cup
    of sweet tea, and the morning sun rising in the corner."""
    sc = (196, 62)
    a.fill_smooth([polar(sc, 26, t) for t in range(180, 361, 20)] + [sc], "ochre")
    a.curve([polar(sc, 26, t) for t in range(180, 361, 20)], MW * 1.3, jit=0.2)
    a.lines([(polar(sc, 33, t), polar(sc, 44, t)) for t in range(196, 345, 30)], MW * 1.2, "ochre", amp=0.2)
    a.line((150, 62), (238, 62), MW, amp=0.3)
    top = [(0, 132), (240, 124), (240, 240), (0, 240)]
    a.fill_poly(top, "ochre", 0.45, off=(0, 0))
    a.hatch(top, 4, 9, alpha=0.25)
    a.line((0, 132), (240, 124), LW)
    pc = (92 + a.j(2), 178)
    plate(a, pc, 70, 26)
    heap = heap_pts((pc[0], pc[1] + 2), 50, 24)
    a.fill_smooth(heap + [(pc[0], pc[1] + 10)], "clay", 0.6)
    a.fill_smooth(heap + [(pc[0], pc[1] + 10)], "ochre", 0.6)
    a.stipple(heap, 18, 2.2, "clay", 0.7)
    a.curve(heap, MW * 1.3, jit=0.3)
    egg = [(pc[0] - 30, pc[1] - 14), (pc[0] - 18, pc[1] - 26), (pc[0] + 2, pc[1] - 28), (pc[0] + 26, pc[1] - 22),
           (pc[0] + 30, pc[1] - 10), (pc[0] + 6, pc[1] - 4), (pc[0] - 22, pc[1] - 6)]
    a.blob(egg, "paper", w=MW * 1.4, second=0)
    a.fill_smooth(ellipse((pc[0] - 2, pc[1] - 16), 10, 7, n=8), "ochre")
    a.ell_outline((pc[0] - 2, pc[1] - 16), 10, 7, w=MW, second=0)
    a.blob(capsule((pc[0] - 76, 206), (pc[0] - 66, 160), 3, 2.6), "slate", w=MW, second=0)
    a.blob(capsule((pc[0] + 76, 206), (pc[0] + 72, 158), 3, 2.6), "slate", w=MW, second=0)
    cup_body(a, (196, 146), 24, 44, "sage")
    a.fill_smooth(ellipse((196, 146), 20, 5, n=10), "clay", 0.85)
    a.ell_outline((196, 146), 24, 6, w=MW * 1.2, second=0)
    a.arc((222, 168), 10, -80, 80, MW * 1.4)
    steam(a, (190, 202), 138, 30)


@art_key("pic_go_school")
def pic_go_school(a):
    """Going to school: a child in the primary-school uniform (white shirt, clay shorts) walking with a backpack,
    the school flag (plain red over white) ahead. Walking away from home, which tells it from pic_go_home."""
    a.line((214, 214), (212, 60), LW, amp=0.4)
    a.dots([(212, 56)], 7, "ochre")
    flag = [(212, 62), (238, 64), (237, 82), (212, 80)]
    a.fill_poly(flag[:2] + [lerp(flag[1], flag[2], 0.5), lerp(flag[0], flag[3], 0.5)], "clay")
    a.fill_poly([lerp(flag[0], flag[3], 0.5), lerp(flag[1], flag[2], 0.5), flag[2], flag[3]], "paper", off=(0, 0))
    a.outline_poly(flag, MW * 1.3, second=0)
    F = figure(a, 112 + a.j(2), 222, 29, kid=True, facing=1, top="shirt", top_col="paper", bottom="shorts",
               bottom_col="clay", shoes="slate", hair="short", expr="grin", ground_line=False, extras={"collar": "paper"},
               pose=WALK_R, tone="deep")
    backpack(a, F, -1)
    ground(a, 30, 228, 225, marks=4)
    a.dots([(x, 224 + a.j(1)) for x in (14, 28, 42)], 4.2, "ink", 0.5)


@art_key("pic_go_home")
def pic_go_home(a):
    """Going home: a child with a backpack walking towards a small house with an open door, the late sun low on the
    horizon behind. Walking to the house tells it from pic_go_school."""
    sc = (214, 224)
    a.fill_smooth([polar(sc, 20, t) for t in range(180, 361, 20)] + [sc], "clay", 0.85)
    wall = rect(14, 132, 72, 90)
    roof = [(4, 136), (96, 136), (70, 90), (24, 90)]
    door = rect(40, 168, 26, 54)
    a.fill_poly(wall, "ochre", 0.7)
    a.fill_poly(roof, "clay")
    a.fill_poly(door, "ink", 0.6, off=(0, 0))
    house = Path()
    for pts in (wall, roof, door):
        house.extend(a.sketch_poly(pts))
    a.stroke(house, LW)
    F = figure(a, 146 + a.j(2), 222, 28, kid=True, facing=-1, top_col="sage", bottom="shorts", bottom_col="slate",
               shoes="clay", hair="bob", expr="grin", ground_line=False, pose=WALK_L, tone="mid", lite=True)
    backpack(a, F, 1, "ochre")
    ground(a, 6, 232, 225, marks=4)


@art_key("pic_study")
def pic_study(a):
    """Studying (belajar): a boy at a desk under an ochre desk lamp, an open book, a stack of books, a pencil in hand
    and the other hand at the chin, thinking. The lamp and the book stack tell it from pic_read and pic_write."""
    cx = 128 + a.j(2)

    def desk(F):
        top = [(0, 192), (240, 186), (240, 240), (0, 240)]
        a.fill_poly(top, "ochre", 0.9, off=(0, 0))
        a.hatch(top, 4, 7, alpha=0.3)
        a.line((1, 192), (239, 186), LW)
        draw_open_book(a, Tf((cx + 8, 206), 0.42, -4), lines=False)
        books = []
        for k, (col, w_) in enumerate((("slate", 64), ("clay", 58), ("sage", 60))):
            y = 190 - k * 12
            bk = [(186, y), (186 + w_ * 0.8, y - 2), (186 + w_ * 0.8, y - 13), (186, y - 11)]
            a.fill_poly(bk, col)
            books.append(bk)
        pb = Path()
        for bk in books:
            pb.extend(a.sketch_poly(bk, over=1.0, gap=1.0))
        a.stroke(pb, MW * 1.3)
        a.blob([(20, 192), (52, 192), (50, 182), (22, 182)], "slate", w=MW * 1.3, second=0)
        a.lines([((36, 184), (30, 110)), ((30, 110), (64, 84))], MW * 2.2, "slate", amp=0.3)
        shade = [(52, 70), (82, 90), (98, 128), (54, 116), (40, 98)]
        a.blob(shade, "ochre", w=LW, second=0)
        a.lines([((84, 130), (90, 146)), ((70, 128), (70, 146)), ((98, 132), (110, 144))], MW, "ochre", amp=0.2)

    F = figure(a, r=36, kid=True, head=(cx, 92), cut=236, top_col="sage", hair="short", expr="smile",
               mid=desk, look=-0.25,
               pose={"head": 6, "arms": (("ik", (cx - 26, 188), 1), ("ik", (cx + 20, 124), -1))}, tone="deep")
    h = F.hd[0]
    a.blob(capsule(add(h, (6, 4)), add(h, (-14, -24)), 3, 2.4), "ochre", w=MW, second=0)


@art_key("pic_tidy_room")
def pic_tidy_room(a):
    """Tidying up (merapikan kamar): a child putting a toy block into a toy box that already holds a ball, blocks and
    a toy car."""
    bx = 150
    box_back = [(bx, 150), (bx + 80, 144), (bx + 80, 156), (bx, 162)]
    a.fill_poly(box_back, "ink", 0.4, off=(0, 0))
    round_ball(a, (bx + 26, 146), 15, "sage", hatch=False, w=MW * 1.3)
    a.block([(bx + 44, 132), (bx + 66, 128), (bx + 70, 150), (bx + 46, 152)], "ochre", w=MW * 1.3, second=0)
    a.blob([(bx + 6, 150), (bx + 12, 136), (bx + 24, 132)], "slate", w=MW, second=0)
    front = [(bx - 4, 156), (bx + 84, 150), (bx + 82, 222), (bx - 2, 224)]
    a.fill_poly(front, "clay")
    a.hatch(clip_half(front, (bx + 60, 0), (1, 0)), 75, 4.6, alpha=0.4)
    a.lines([((bx, 180), (bx + 82, 176)), ((bx, 202), (bx + 82, 198))], FW * 1.4, alpha=0.6)
    a.outline_poly(front, LW, second=0.4)
    def block_(F):
        cube = [add((bx + 14, 112), p) for p in ((-12, -12), (12, -14), (14, 10), (-10, 12))]
        a.block(cube, "slate", w=MW * 1.4, second=0)
        a.dots([(bx + 15, 110)], 6, "paper", 0.9)

    figure(a, 84 + a.j(2), 222, 28, kid=True, facing=1, top_col="ochre", bottom="trousers", bottom_col="sage",
           shoes="slate", hair="bob", expr="grin", ground_line=False, mid=block_, lite=True,
           pose={"lean": 6, "arms": (("ik", (bx + 4, 122), 1), ("ik", (bx + 24, 116), -1)), "behind": ("arm0",)},
           tone="deep")
    ground(a, 30, 236, 225, marks=4)
    a.arc((bx + 30, 132), 30, -170, -110, MW, alpha=0.6)


@art_key("pic_watch_tv")
def pic_watch_tv(a):
    """Watching TV: a child sitting on a floor cushion, remote in hand, turned to a TV on a low cabinet; the screen
    shows a simple sun and hill. A child watching, which tells it from pic_tv (the set alone)."""
    cab = [(150, 160), (236, 160), (236, 214), (150, 214)]
    a.block(cab, "ochre", w=LW, second=0.3)
    a.line((193, 164), (193, 210), MW, amp=0.2)
    a.dots([(186, 186), (200, 186)], 4, "ink")
    tv = [(146, 70), (238, 70), (238, 152), (146, 152)]
    a.fill_poly(tv, "slate")
    a.fill_poly(tv, "ink", 0.45, off=a.reg("slate"))
    scr = [(154, 78), (230, 78), (230, 144), (154, 144)]
    a.fill_poly(scr, "slate", 0.95)
    a.fill_poly([(154, 144), (154, 124), (180, 110), (206, 120), (230, 112), (230, 144)], "sage", 0.95)
    a.fill_smooth(ellipse((208, 96), 9, 9, n=8), "ochre")
    a.outline_poly(scr, MW * 1.2, second=0)
    a.outline_poly(tv, LW, second=0.3)
    cush = ellipse((70, 212), 58, 13, n=14)
    a.fill_smooth(cush, "clay")
    a.hatch(clip_half(cush, (90, 0), (1, 0)), 75, 4.2, alpha=0.4)
    a.outline(cush, LW, second=0.3)
    r = 28
    pose = {"arms": ((76, 34), (70, 28)), "legs": ((-6, 76), (0, 80)), "behind": ("arm0", "leg0")}
    F0 = Fig(70, 224, r, True, dict(STAND, **pose), 1)
    F = figure(a, 70, 224 - (F0.hip[1] + r * 0.32 - 202), r, kid=True, facing=1, look=1, top_col="slate",
               bottom="trousers", bottom_col="sage", shoes=None, hair="short", ground_line=False, pose=pose,
               tone="light", lite=True)
    rc = add(F.hd[1], (4, -6))
    a.block([add(rc, p) for p in ((-4, -12), (5, -13), (6, 8), (-3, 9))], "ink", 0.85, w=MW, second=0)
    a.dots([add(rc, (1, -7))], 3.4, "clay")
    ground(a, 6, 140, 226, marks=3)
    ground(a, 146, 236, 216, marks=2)


# --------------------------------------------------------------------------------------------- hobbies


def soccer_ball(a, c, R, w=LW):
    """A small football: paper ball, slate patches clipped to the circle, seams, one contour."""
    a.fill_smooth(ellipse(c, R, R, n=16), "paper", off=(0, 0))
    C = add(c, (R * 0.06, R * 0.04))
    th = [-90 + 72 * i + 12 for i in range(5)]
    cen = [polar(C, R * 0.27, t) for t in th]
    outer = [[polar(polar(C, R * 0.76, t), R * 0.24, t + 180 + 72 * j) for j in range(5)] for t in th]
    for pent in [cen] + outer:
        q = clip_convex(pent, ellipse(c, R - 1.5, R - 1.5, n=32))
        if len(q) > 2:
            a.fill_poly(q, "slate", step=10)
    a.lines([(cen[i], outer[i][0]) for i in range(5)], MW, amp=0.3)
    a.ell_outline(c, R, R, w=w, second=0)


@art_key("pic_draw_paint")
def pic_draw_paint(a):
    """Drawing and painting: a sheet with a painted sun and hill, a brush loaded with clay paint, and a wooden palette
    with four paint daubs."""
    T = Tf((96 + a.j(2), 92), 1, -6)
    sheet = T.pts(rect(-70, -62, 140, 112))
    a.fill_poly(sheet, "paper", off=(0, 0))
    a.outline_poly(sheet, LW, second=0.3)
    hill = T.pts([(-62, 44), (-50, 10), (-20, -4), (14, 6), (40, 0), (62, 18), (62, 44)])
    a.fill_smooth(hill, "sage", 0.9)
    a.curve(hill[:-1], MW * 1.2, jit=0.3)
    a.fill_smooth(T.pts(ellipse((30, -32), 15, 15, n=10)), "clay", 0.9)
    a.lines([(T(polar((30, -32), 20, t)), T(polar((30, -32), 27, t))) for t in range(0, 360, 45)], MW, "clay", amp=0.2)
    pc = (166, 176)
    pal = [polar(pc, 62, t, 42) for t in range(0, 360, 30)]
    a.fill_smooth(pal, "ochre")
    a.hatch(clip_half(pal, (186, 0), (1, 0)), 70, 4.6, alpha=0.35)
    a.outline(pal, LW, second=0.3)
    a.fill_smooth(ellipse((196, 194), 9, 7, n=8), "paper", off=(0, 0))
    a.ell_outline((196, 194), 9, 7, w=MW, second=0)
    for c, col in (((132, 160), "clay"), ((156, 150), "slate"), ((184, 154), "sage"), ((140, 190), "blush")):
        a.fill_smooth([a.jit(p, 1.5) for p in ellipse(c, 12, 9, n=8)], col)
    outlines(a, [ellipse(c, 12, 9, n=8) for c in ((132, 160), (156, 150), (184, 154), (140, 190))], MW * 1.1, jit=0.6)
    B = Tf((70, 200), 1, -38)
    a.blob(B.pts([(0, -4), (96, -5), (96, 5), (0, 4)]), "slate", w=MW * 1.3, second=0)
    a.block(B.pts([(96, -5), (112, -6), (112, 6), (96, 5)]), "ochre", w=MW * 1.2, second=0)
    tip = B.pts([(112, -7), (128, -6), (140, 0), (128, 6), (112, 7)])
    a.blob(tip, "clay", w=MW * 1.3, second=0)


@art_key("pic_guitar")
def pic_guitar(a):
    """An acoustic guitar, tilted: ochre figure-eight body, sound hole, bridge, a long clay neck with frets, six
    pegs."""
    T = Tf((104 + a.j(2), 150), 1, 38)
    body = T.pts([(0, -46), (24, -50), (34, -34), (28, -14), (46, 4), (52, 30), (40, 56), (0, 66), (-40, 56), (-52, 30),
                  (-46, 4), (-28, -14), (-34, -34), (-24, -50)])
    a.fill_smooth(body, "ochre")
    a.hatch(clip_half(body, T((20, 0)), T.v((1, 0))), T.ang(80), 4.6, alpha=0.4)
    a.outline(body, LW, second=0.4)
    neck = T.pts([(-7, -150), (7, -150), (8, -16), (-8, -16)])
    a.fill_poly(neck, "clay")
    a.lines([(T((-7, y)), T((7, y))) for y in range(-138, -40, 16)], FW * 1.3, "paper", 0.8, amp=0.1)
    a.outline_poly(neck, MW * 1.4, second=0)
    head = T.pts([(-11, -186), (11, -186), (9, -150), (-9, -150)])
    a.block(head, "clay", w=MW * 1.4, second=0)
    a.dots([T((sx * 15, y)) for sx in (-1, 1) for y in (-180, -170, -160)], 6, "slate")
    a.fill_smooth(T.pts(ellipse((0, 4), 14, 14, n=10)), "ink", 0.85, off=(0, 0))
    a.ell_outline(T((0, 4)), 18, 18, w=MW, second=0)
    a.block(T.pts(rect(-16, 34, 32, 8)), "clay", w=MW * 1.2, second=0)
    a.lines([(T((x, -150)), T((x * 1.6, 38))) for x in (-5, -3, -1, 1, 3, 5)], 0.9, alpha=0.8, amp=0.1)


@art_key("pic_football")
def pic_football(a):
    """Football (sepak bola) the game: a ball flying into a goal net, grass, speed lines. The goal tells it from
    pic_ball (the ball alone) and pic_play (a child kicking)."""
    gnd = [(0, 204), (240, 198), (240, 240), (0, 240)]
    a.fill_poly(gnd, "sage", 0.45, off=(0, 0))
    a.line((0, 204), (240, 198), MW * 1.2)
    back = [(78, 64), (226, 58), (232, 186), (84, 192)]
    a.hatch(back, 90, 12, w=FW * 1.2, color="slate", alpha=0.7)
    a.hatch(back, 0, 12, w=FW * 1.2, color="slate", alpha=0.7)
    a.lines([((62, 40), (78, 64)), ((214, 36), (226, 58)), ((78, 64), (226, 58)), ((80, 200), (84, 192)),
             ((228, 196), (232, 186))], MW, alpha=0.8)
    for p0, p1 in (((60, 38), (62, 204)), ((214, 34), (216, 198)), ((58, 38), (218, 32))):
        a.line(p0, p1, 7, "paper", amp=0.4)
        a.line(p0, p1, LW, amp=0.4)
        a.line(add(p0, (3, 3)), add(p1, (3, 3)), FW, alpha=0.6, amp=0.3)
    soccer_ball(a, (140 + a.j(2), 130), 28)
    a.lines([((22, 120), (90, 126)), ((14, 140), (84, 144)), ((30, 160), (92, 160))], MW * 1.3, alpha=0.7)


@art_key("pic_badminton")
def pic_badminton(a):
    """Badminton: a racket with a strung oval head and an ochre grip, and a shuttlecock in flight."""
    T = Tf((96 + a.j(2), 112), 1, -36)
    head = T.pts(ellipse((0, -30), 40, 52, n=18))
    a.fill_smooth(head, "slate", 0.18, off=(0, 0))
    a.hatch(clip_convex(head, T.pts(ellipse((0, -30), 37, 49, n=24))), T.ang(0), 7, w=FW * 1.1, alpha=0.75)
    a.hatch(clip_convex(head, T.pts(ellipse((0, -30), 37, 49, n=24))), T.ang(90), 7, w=FW * 1.1, alpha=0.75)
    a.stroke(a.ell_path(T((0, -30)), 40, 52, rot=-36, wob=0.012), 7, "clay")
    a.ell_outline(T((0, -30)), 40, 52, rot=-36, w=MW, second=0)
    a.blob(T.pts([(-4, 20), (4, 20), (3, 70), (-3, 70)]), "slate", w=MW * 1.2, second=0)
    grip = T.pts([(-6, 70), (6, 70), (7, 122), (-7, 122)])
    a.fill_poly(grip, "ochre")
    a.lines([(T((-6, y)), T((6, y + 6))) for y in range(76, 118, 8)], FW * 1.3, alpha=0.6, amp=0.1)
    a.outline_poly(grip, MW * 1.4, second=0)
    S = Tf((178, 82), 1, 30)
    skirt = S.pts([(-10, 0), (10, 0), (24, -56), (-24, -56)])
    a.fill_poly(skirt, "paper", off=(0, 0))
    a.lines([(S((x * 0.42, 0)), S((x, -56))) for x in (-16, -6, 4, 14)], FW * 1.3, alpha=0.7, amp=0.2)
    a.curve(S.pts([(-22, -40), (0, -36), (22, -40)]), FW * 1.3, alpha=0.7)
    a.outline_poly(skirt, MW * 1.4, second=0)
    cork = S.pts([(-11, 0), (11, 0), (10, 8), (0, 16), (-10, 8)])
    a.blob(cork, "ochre", w=MW * 1.4, second=0)
    motion_arcs(a, S((0, 22)), 14, S.ang(60), S.ang(120), w=MW * 1.1)


@art_key("pic_dance")
def pic_dance(a):
    """Dancing: a girl in a traditional dance pose, one arm curved high, a clay selendang (sash) swirling from her
    hands, one knee lifted; flowers in her bun."""
    cx = 118 + a.j(2)

    def sash(F):
        h0, h1 = F.hd
        a.blob(ribbon([h0, add(h0, (-18, 30)), add(h0, (-4, 70)), add(h0, (-26, 110))], 8, 6), "clay", w=MW * 1.3,
               second=0)
        a.blob(ribbon([h1, add(h1, (24, 18)), add(h1, (20, 52)), add(h1, (40, 80))], 8, 6), "clay", w=MW * 1.3,
               second=0)

    F = figure(a, cx, 222, 27, kid=True, top="dress", top_col="sage", bottom="none", hair="bun", shoes="clay",
               expr="happy", mid=sash, extras={"stripe": "ochre"}, lite=True,
               pose={"lean": -4, "head": -8, "arms": ((-160, -100), (14, 40)), "legs": ((96, 92), (40, 112))},
               hands=("open", "round"), tone="deep")
    for c, col in ((add(F.hc, (-14, -36)), "clay"), (add(F.hc, (2, -40)), "ochre")):
        a.ell(c, 5.5, 5.5, col, w=FW * 1.3, second=0)
    motion_arcs(a, add(F.hd[0], (-6, -4)), 20, -200, -150, w=MW * 1.2)
    motion_arcs(a, add(F.an[1], (8, 0)), 16, -40, 20, w=MW * 1.2)


@art_key("pic_camera")
def pic_camera(a):
    """A camera: slate body with a raised viewfinder, a big lens with a glint, a clay shutter button, a flash window
    and strap lugs. No logo."""
    cy = 128 + a.j(2)
    hump = [(84, cy - 50), (92, cy - 70), (148, cy - 70), (156, cy - 50)]
    a.block(hump, "slate", w=LW, second=0)
    body = [(28, cy - 52), (212, cy - 52), (218, cy - 44), (218, cy + 58), (210, cy + 64), (30, cy + 64), (22, cy + 56),
            (22, cy - 44)]
    a.fill_smooth(body, "slate")
    grip = [(24, cy - 44), (58, cy - 44), (58, cy + 60), (24, cy + 60)]
    a.fill_poly(grip, "ink", 0.35, off=a.reg("slate"))
    a.hatch(grip, 90, 4, alpha=0.4)
    a.outline(body, LW, second=0.4)
    a.block([(160, cy - 66), (186, cy - 66), (186, cy - 52), (160, cy - 52)], "clay", w=MW * 1.3, second=0)
    a.block([(174, cy - 40), (204, cy - 40), (204, cy - 24), (174, cy - 24)], "paper", w=MW * 1.2, second=0)
    for sx in (18, 222):
        a.block([(sx - 4, cy - 34), (sx + 4, cy - 34), (sx + 4, cy - 20), (sx - 4, cy - 20)], "ink", 0.7, w=MW,
                second=0)
    lc = (124, cy + 8)
    a.fill_smooth(ellipse(lc, 50, 50, n=16), "ochre", 0.9)
    a.ell_outline(lc, 50, 50, w=LW)
    a.fill_smooth(ellipse(lc, 38, 38, n=14), "ink", 0.85, off=(0, 0))
    a.ell_outline(lc, 38, 38, w=MW * 1.2, second=0)
    a.fill_smooth(ellipse(lc, 22, 22, n=12), "slate")
    a.curve([polar(lc, 28, t) for t in (200, 225, 250)], 4, "paper", 0.9, jit=0.1)
    a.dots([polar(lc, 12, 230)], 6, "paper", 0.9)


@art_key("pic_gardening")
def pic_gardening(a):
    """Gardening: a child watering flowers in a raised bed with a watering can, drops falling on the plants."""
    bed = [(120, 182), (236, 178), (236, 214), (120, 216)]
    fl = ((146, "clay", 44), (180, "ochre", 58), (214, "clay", 40))
    stems = Path()
    for x, col, h in fl:
        smooth(stems, [a.jit(p, 0.4) for p in ((x, 182), (x + 2, 182 - h * 0.5), (x - 1, 182 - h))])
    a.stroke(stems, MW * 1.3, "sage")
    leaves = [leaf_pts((x + 1, 182 - h * 0.4), (x + 14, 182 - h * 0.6), 5) for x, col, h in fl]
    for lf in leaves:
        a.fill_smooth(lf, "sage")
    for want in ("clay", "ochre"):
        for x, col, h in fl:
            if col == want:
                c = (x - 1, 182 - h)
                a.fill_smooth([polar(c, 11 * (0.62 + 0.38 * math.cos(math.radians(5 * t))), t) for t in range(0, 360, 24)],
                              col)
    a.dots([(x - 1, 182 - h) for x, col, h in fl], 6, "ink", 0.8)
    a.fill_poly(bed, "clay", 0.85)
    a.outline_poly(bed, LW, second=0)
    can_c = (108, 130)

    def can(F):
        body = [add(can_c, p) for p in ((-22, -16), (18, -18), (20, 22), (-20, 24))]
        a.fill_poly(body, "slate")
        spout = ribbon([add(can_c, (16, 8)), add(can_c, (34, -4)), add(can_c, (48, -20))], 6, 4)
        a.blob(spout, "slate", w=MW * 1.2, second=0)
        rose = [add(can_c, p) for p in ((44, -26), (56, -30), (60, -18), (50, -12))]
        a.block(rose, "slate", w=MW * 1.2, second=0)
        a.outline_poly(body, LW, second=0)
        a.curve([add(can_c, (-16, -16)), add(can_c, (-4, -36)), add(can_c, (12, -18))], MW * 1.6, "slate")

    figure(a, 62 + a.j(2), 222, 27, kid=True, facing=1, top_col="ochre", bottom="trousers", bottom_col="slate",
           shoes="clay", hair="short", expr="grin", mid=can, ground_line=False, lite=True,
           pose={"arms": (("ik", add(can_c, (-12, -24)), 1), ("ik", add(can_c, (-20, 6)), -1)), "behind": ("arm0",)},
           tone="light")
    drops(a, [add(can_c, (62 + (k % 2) * 10, -6 + k * 14)) for k in range(3)], 4, "slate", 170)
    ground(a, 14, 234, 224, marks=3)


@art_key("pic_fishing")
def pic_fishing(a):
    """Fishing (memancing) as a hobby: a child sitting on a wooden jetty with a rod, the line down to a clay and white
    float on the water, a small fish below. Tells from pic_fisher (an adult with a net in a boat)."""
    wy = 168
    water = [(96, wy)] + [(x, wy + 3 * math.sin(x / 13)) for x in range(106, 241, 15)] + [(240, 240), (96, 240)]
    a.fill_poly(water, "slate", 0.45, off=(0, 0), step=40)
    for k, y in enumerate((wy + 1, 200, 224)):
        a.curve([(100 + (k % 2) * 12 + i * 22, y + 3 * math.sin(i * 1.7 + k)) for i in range(7)], MW, "slate", 0.85)
    fc = (196, 210)
    fish = [add(fc, p) for p in ((-18, 0), (-8, -8), (8, -8), (16, 0), (8, 8), (-8, 8))]
    a.fill_smooth(fish, "ochre", 0.9)
    a.blob([add(fc, (14, 0)), add(fc, (26, -9)), add(fc, (26, 9))], "ochre", 0.9, w=MW, second=0)
    a.outline(fish, MW * 1.2, second=0, jit=0.2)
    a.dots([add(fc, (-10, -2))], 3.6)
    jet = [(0, 160), (112, 160), (112, 174), (0, 174)]
    a.lines([((x, 174), (x + 1, 236)) for x in (22, 90)], 9, "ochre", 0.75, amp=0.3)
    a.lines([((x - 4, 174), (x - 3, 236)) for x in (22, 90)], MW, amp=0.3)
    a.block(jet, "ochre", w=LW, second=0)
    r = 27
    pose = {"arms": (("ik", (98, 120), 1), ("ik", (110, 112), -1)), "legs": ((-4, 80), (4, 86)),
            "behind": ("arm0", "leg0")}
    F0 = Fig(64, 200, r, True, dict(STAND, **pose), 1)
    dy = 160 - (F0.hip[1] + r * 0.3)
    rod_a, rod_b = (90, 132), (188, 50)

    def rod(F):
        a.line(rod_a, rod_b, MW * 1.5, "slate", amp=0.6)
        a.ell((92, 128), 5, 5, "slate", w=FW * 1.3, second=0)

    figure(a, 64, 200 + dy, r, kid=True, facing=1, top_col="clay", bottom="shorts", bottom_col="slate", shoes="ochre",
           hair="short", expr="smile", ground_line=False, mid=rod, pose=pose, tone="deep", lite=True)
    a.curve([rod_b, (194, 100), (198, 164)], FW * 1.2, alpha=0.9, jit=0.2)
    fl = (198, 166)
    a.fill_smooth([add(fl, p) for p in ((-6, 0), (0, -9), (6, 0))], "clay")
    a.fill_smooth([add(fl, p) for p in ((-6, 0), (0, 8), (6, 0))], "paper", off=(0, 0))
    a.outline(ellipse(fl, 6.5, 8.5, n=8), MW, second=0, jit=0.1)


# --------------------------------------------------------------------------------------------- town & travel
# Buildings say what they are by shape and one object (a coin, an envelope and mailbox, a plate with spoon and fork,
# shelves of books, a bed sign, a control tower), never by words or real logos.


def coin_mark(a, c, r, col="ochre"):
    """A plain coin: a disc, an inner ring and a small raised dot (no denomination, no emblem)."""
    a.fill_smooth(ellipse(c, r, r, n=12), col)
    a.ell_outline(c, r, r, w=MW * 1.4, second=0)
    a.ell_outline(c, r * 0.66, r * 0.66, w=FW * 1.3, second=0)
    a.dots([c], r * 0.35, "clay", 0.9)


def envelope(a, pts, col="paper"):
    """A closed envelope from its four corners (tl, tr, br, bl): flap V and the two lower folds."""
    tl, tr, br, bl = pts
    a.block(pts, col, w=MW * 1.4, second=0)
    mid = lerp(lerp(tl, tr, 0.5), lerp(bl, br, 0.5), 0.58)
    a.zig([tl, mid, tr], MW * 1.2, jit=0.2)
    a.lines([(bl, lerp(bl, mid, 0.45)), (br, lerp(br, mid, 0.45))], FW * 1.3, alpha=0.7)


def plate_sign(a, c, r):
    """A plate with a spoon and fork beside it: the restaurant sign (shapes only)."""
    a.fill_smooth(ellipse(c, r, r, n=12), "paper", off=(0, 0))
    a.ell_outline(c, r, r, w=MW * 1.3, second=0)
    a.ell_outline(c, r * 0.62, r * 0.62, w=FW * 1.2, second=0)
    for sx in (-1, 1):
        x = c[0] + sx * r * 1.42
        a.line((x, c[1] - r * 0.9), (x, c[1] + r * 0.95), MW * 1.4, amp=0.2)
    a.fill_smooth(ellipse((c[0] - r * 1.42, c[1] - r * 0.6), r * 0.22, r * 0.36, n=7), "ink", 0.9, off=(0, 0))
    a.lines([((c[0] + r * 1.42 + dx, c[1] - r * 0.95), (c[0] + r * 1.42 + dx, c[1] - r * 0.45)) for dx in (-3, 0, 3)],
            FW * 1.2, amp=0.1)


@art_key("pic_bank")
def pic_bank(a):
    """A bank: a pillared building with a pediment, steps, and a big plain coin in the pediment (no words)."""
    ground(a, 10, 230, 212, marks=5)
    steps = [((24, 196), (216, 196), 8), ((16, 204), (224, 204), 8)]
    for (x0, y0), (x1, y1), h in steps:
        a.block([(x0, y0), (x1, y1), (x1, y1 + h), (x0, y0 + h)], "slate", 0.6, w=MW * 1.3, second=0)
    base = [(30, 184), (210, 184), (210, 196), (30, 196)]
    a.block(base, "ochre", 0.8, w=MW * 1.3, second=0)
    for x in (44, 84, 140, 180):
        col = [(x, 94), (x + 18, 94), (x + 18, 184), (x, 184)]
        a.fill_poly(col, "paper", off=(0, 0))
        a.lines([((x + 6, 98), (x + 6, 180)), ((x + 12, 98), (x + 12, 180))], FW * 1.2, alpha=0.5, amp=0.2)
        a.hatch(clip_half(col, (x + 13, 0), (1, 0)), 90, 3, color="slate", alpha=0.4)
        a.outline_poly(col, MW * 1.4, second=0)
        a.block([(x - 4, 88), (x + 22, 88), (x + 22, 96), (x - 4, 96)], "ochre", 0.8, w=MW, second=0)
    door = [(108, 120), (132, 120), (132, 184), (108, 184)]
    a.block(door, "slate", w=MW * 1.4, second=0)
    beam = [(24, 76), (216, 76), (216, 90), (24, 90)]
    a.block(beam, "ochre", w=LW, second=0.3)
    ped = [(18, 76), (120, 20), (222, 76)]
    a.fill_poly(ped, "clay")
    a.hatch(clip_half(ped, (150, 0), (1, 0)), 65, 5, alpha=0.35)
    a.outline_poly(ped, LW, second=0.3)
    coin_mark(a, (120 + a.j(1.5), 54), 17)


@art_key("pic_post_office")
def pic_post_office(a):
    """A post office (kantor pos): a building with a big envelope sign over the door and a clay pillar mailbox with a
    slot in front."""
    ground(a, 10, 230, 214, marks=5)
    wall = rect(40, 92, 160, 120)
    a.fill_poly(wall, "ochre", 0.6)
    a.hatch(clip_half(wall, (178, 0), (1, 0)), 75, 4.6, alpha=0.3)
    a.outline_poly(wall, LW, second=0.3)
    roof = [(28, 96), (212, 96), (196, 66), (44, 66)]
    a.block(roof, "slate", w=LW, second=0.3)
    envelope(a, [(78, 26), (162, 22), (164, 76), (80, 80)])
    a.line((84, 80), (84, 92), MW * 1.4, amp=0.1)
    a.line((158, 77), (158, 92), MW * 1.4, amp=0.1)
    door = rect(104, 150, 34, 62)
    a.block(door, "slate", w=MW * 1.4, second=0)
    pane_window(a, 154, 120, 30, 30)
    mb = [(52, 214), (52, 150), (60, 138), (82, 138), (90, 150), (90, 214)]
    a.fill_poly(mb, "clay")
    a.hatch(clip_half(mb, (80, 0), (1, 0)), 75, 4, alpha=0.4)
    a.outline_poly(mb, LW, second=0.3)
    a.block([(58, 160), (84, 160), (84, 166), (58, 166)], "ink", 0.85, w=FW * 1.3, second=0)
    a.block([(48, 134), (94, 134), (94, 142), (48, 142)], "clay", w=MW * 1.3, second=0)
    a.line((52, 196), (90, 196), MW, amp=0.2)


@art_key("pic_restaurant")
def pic_restaurant(a):
    """A restaurant (rumah makan): a shopfront with a scalloped sage awning, a sign showing a plate with spoon and
    fork, and a window with a table and steaming bowl."""
    ground(a, 10, 230, 214, marks=5)
    wall = rect(22, 70, 196, 142)
    a.fill_poly(wall, "clay", 0.55)
    a.outline_poly(wall, LW, second=0.3)
    sign = [(60, 18), (180, 16), (182, 60), (62, 62)]
    a.block(sign, "ochre", w=LW, second=0.3)
    plate_sign(a, (121, 39), 14)
    a.lines([((80, 62), (80, 70)), ((162, 60), (162, 70))], MW * 1.3, amp=0.1)
    xs = [22 + i * 24.5 for i in range(9)]
    aw = [(22, 74), (218, 74), (218, 96)] + [p for i in range(8, 0, -1) for p in ((xs[i] - 12.25, 106), (xs[i - 1], 96))]
    a.fill_poly(aw, "sage")
    a.lines([((x, 76), (x, 96)) for x in xs[1:-1:2]], MW, "paper", 0.7)
    a.outline_poly(aw, MW * 1.5, second=0)
    win = rect(34, 118, 104, 66)
    a.fill_poly(win, "slate", 0.35)
    a.line((40, 166), (132, 164), MW * 1.4, amp=0.3)
    a.lines([((52, 166), (52, 184)), ((120, 165), (120, 184))], MW * 1.2)
    bwl = ellipse((86, 160), 16, 5, n=10, a0=0, sweep=180) + ellipse((86, 160), 16, 11, n=8, a0=180, sweep=-180)
    a.blob(bwl, "ochre", w=MW * 1.2, second=0)
    steam(a, (80, 92), 150, 22)
    a.outline_poly(win, LW, second=0)
    door = rect(156, 118, 44, 94)
    a.block(door, "slate", w=MW * 1.4, second=0)
    a.dots([(192, 166)], 5, "ochre")


@art_key("pic_library")
def pic_library(a):
    """A library (perpustakaan): tall shelves full of coloured books, a small reading table with an open book."""
    cols = ("clay", "ochre", "sage", "slate", "blush")
    for x0 in (14, 124):
        case = rect(x0, 18, 102, 196)
        a.fill_poly(case, "ochre", 0.55)
        a.outline_poly(case, LW, second=0.3)
        for k, y in enumerate((60, 106, 152, 198)):
            a.line((x0 + 2, y), (x0 + 100, y), MW * 1.6, amp=0.2)
        by_col = {c: [] for c in cols}
        for k, y in enumerate((60, 106, 152, 198)):
            x = x0 + 6
            i = (k * 2 + x0) % 5
            while x < x0 + 92:
                w_ = 8 + ((i * 7 + k * 3) % 4) * 2
                h = 30 + ((i * 5 + k) % 3) * 4
                lean = 4 if (i + k) % 6 == 5 else 0
                if x + w_ > x0 + 96:
                    break
                by_col[cols[i % 5]].append([(x, y - 1), (x + w_, y - 1), (x + w_ + lean, y - h), (x + lean, y - h)])
                x += w_ + 1
                i += 1
        for c, books in by_col.items():
            for b in books:
                a.fill_poly(b, c, 0.95, step=60)
        pth = Path()
        for c, books in by_col.items():
            for b in books:
                pth.extend(a.sketch_poly(b, amp=0.3, over=0.6, gap=0.6))
        a.stroke(pth, FW * 1.3)
    top = [(70, 186), (170, 186), (176, 196), (64, 196)]
    a.block(top, "clay", w=LW, second=0)
    a.lines([((76, 196), (74, 226)), ((164, 196), (166, 226))], LW)
    draw_open_book(a, Tf((120, 176), 0.3, -2))


@art_key("pic_hotel")
def pic_hotel(a):
    """A hotel: a tall warm building with rows of windows and little balconies, three stars over the entrance canopy,
    a suitcase at the door and a sign showing a bed (no letters). The stars and suitcase tell it from pic_hospital."""
    ground(a, 10, 230, 218, marks=5)
    bld = rect(48, 44, 146, 172)
    a.fill_poly(bld, "clay", 0.5)
    a.hatch(clip_half(bld, (172, 0), (1, 0)), 75, 4.6, alpha=0.3)
    a.outline_poly(bld, LW, second=0.3)
    a.line((42, 44), (200, 44), LW * 1.2, over=(1, 1))
    for y in (60, 96):
        for x in (60, 100, 140, 172):
            if x == 172 and y == 60:
                continue
            a.block(rect(x, y, 16, 20), "slate", 0.85, w=MW * 1.1, second=0)
        a.line((56, y + 24), (190, y + 24), MW * 1.3, alpha=0.8, amp=0.3)
    for k in range(3):
        sc = (98 + k * 23, 142)
        st = [polar(sc, 9 if i % 2 == 0 else 3.8, -90 + 36 * i) for i in range(10)]
        a.blob(st, "ochre", w=MW, second=0)
    can = [(80, 162), (162, 162), (170, 176), (72, 176)]
    a.block(can, "sage", w=MW * 1.4, second=0)
    a.lines([((88, 176), (88, 216)), ((154, 176), (154, 216))], MW * 1.3)
    door = rect(102, 176, 38, 40)
    a.block(door, "slate", 0.9, w=MW * 1.3, second=0)
    a.line((121, 176), (121, 216), FW * 1.3)
    case = [(160, 190), (182, 190), (182, 216), (160, 216)]
    a.block(case, "ochre", w=MW * 1.3, second=0)
    a.curve([(166, 190), (171, 182), (176, 190)], MW)
    sign = [(150, 10), (230, 8), (232, 58), (152, 60)]
    a.block(sign, "paper", w=LW, second=0.3)
    a.block([(160, 46), (220, 44), (220, 51), (160, 53)], "clay", w=MW, second=0)
    a.block([(160, 28), (171, 28), (171, 46), (160, 46)], "clay", w=MW, second=0)
    a.blob([(176, 33), (216, 31), (218, 44), (176, 46)], "sage", w=MW, second=0)
    a.ell((180, 32), 6, 4.5, "paper", w=FW * 1.3, second=0)
    a.lines([((162, 53), (162, 59)), ((218, 51), (218, 57))], MW, amp=0.1)


@art_key("pic_airport")
def pic_airport(a):
    """An airport (bandara): a control tower with its glass cab, a low terminal, the runway, a plane taking off."""
    a.fill_poly([(0, 196), (240, 192), (240, 240), (0, 240)], "slate", 0.45, off=(0, 0))
    a.line((0, 196), (240, 192), MW * 1.3)
    a.lines([((20 + k * 46, 218), (46 + k * 46, 217)) for k in range(5)], 4, "paper", 0.9)
    term = rect(80, 150, 150, 46)
    a.fill_poly(term, "ochre", 0.7)
    a.fill_poly(rect(86, 158, 138, 18), "slate", 0.7)
    a.lines([((86 + k * 17, 158), (86 + k * 17, 176)) for k in range(1, 9)], FW * 1.2, alpha=0.6)
    a.outline_poly(term, LW, second=0.3)
    a.line((74, 150), (236, 148), LW, amp=0.2)
    shaft = [(34, 196), (34, 82), (54, 82), (54, 196)]
    a.fill_poly(shaft, "paper", off=(0, 0))
    a.hatch(clip_half(shaft, (47, 0), (1, 0)), 90, 3.4, color="slate", alpha=0.4)
    a.outline_poly(shaft, LW, second=0.3)
    cab = [(20, 82), (68, 82), (76, 54), (12, 54)]
    a.fill_poly(cab, "slate", 0.85)
    a.lines([((28, 56), (30, 80)), ((44, 55), (44, 81)), ((60, 56), (58, 80))], MW, "paper", 0.8)
    a.outline_poly(cab, LW, second=0.3)
    a.block([(8, 46), (80, 46), (76, 54), (12, 54)], "clay", w=MW * 1.3, second=0)
    a.line((44, 46), (44, 26), MW * 1.3, amp=0.2)
    a.dots([(44, 24)], 6, "clay")
    small_plane(a, (160, 76), 0.56, -18)
    a.lines([((84, 120), (108, 112)), ((92, 132), (112, 126))], MW, alpha=0.6)


@art_key("pic_suitcase")
def pic_suitcase(a):
    """A travel suitcase on wheels: clay shell with ribs, a pulled-up slate handle, a blank luggage tag."""
    T = Tf((118 + a.j(2), 140), 1, 4)
    a.lines([(T((-20, -64)), T((-20, -112))), (T((20, -64)), T((20, -112)))], 6, "slate", amp=0.2)
    a.lines([(T((-20, -64)), T((-20, -112))), (T((20, -64)), T((20, -112)))], FW, alpha=0.6, amp=0.2)
    a.blob(T.pts([(-26, -116), (26, -116), (26, -106), (-26, -106)]), "slate", w=MW * 1.4, second=0)
    body = T.pts([(-50, -60), (50, -60), (56, -54), (56, 70), (50, 76), (-50, 76), (-56, 70), (-56, -54)])
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(body, T((30, 0)), T.v((1, 0))), T.ang(80), 4.6, alpha=0.4)
    a.outline(body, LW, second=0.4)
    a.lines([(T((x, -56)), T((x, 72))) for x in (-26, 0, 26)], MW * 1.3, alpha=0.7)
    a.block(T.pts([(-14, -54), (14, -54), (14, -40), (-14, -40)]), "slate", w=MW, second=0)
    for x in (-40, 40):
        a.ell(T((x, 86)), 9, 9, "slate", w=MW * 1.3, second=0)
    tag = T.pts([(-60, -30), (-80, -26), (-84, 6), (-62, 4)])
    a.curve([T((-56, -46)), T((-64, -40)), T((-68, -28))], FW * 1.4)
    a.block(tag, "ochre", w=MW * 1.3, second=0)
    a.dots([T((-70, -24))], 4, "paper")


@art_key("pic_ticket")
def pic_ticket(a):
    """A travel ticket: ochre with notched ends, a dotted tear line to the stub, a small train shape, blank lines,
    a bar pattern on the stub (no letters or digits)."""
    T = Tf((120 + a.j(2), 124), 1, -10)
    pts = [(-96, -46), (96, -46), (96, -14)] + [polar((96, 0), 14, t) for t in range(-90, -271, -30)][1:-1] + \
          [(96, 14), (96, 46), (-96, 46), (-96, 14)] + [polar((-96, 0), 14, t) for t in range(90, -91, -30)][1:-1] + \
          [(-96, -14)]
    P = T.pts(pts)
    a.fill_poly(P, "ochre", step=30)
    a.hatch(clip_half(P, T((60, 0)), T.v((1, 0))), T.ang(75), 5, alpha=0.3)
    a.outline_poly(P, LW, second=0.3, over=1.0, gap=1.0)
    a.dots([T((44, y)) for y in range(-40, 44, 9)], 3.2, "ink", 0.8)
    a.lines([(T((x, -28)), T((x, 28))) for x in (58, 62, 67, 70, 76, 80, 85)], FW * 1.4, alpha=0.8, amp=0.1)
    tr = T.pts([(-80, -6), (-46, -6), (-38, 4), (-38, 20), (-80, 20)])
    a.block(tr, "slate", w=MW * 1.2, second=0)
    a.block(T.pts(rect(-74, 0, 10, 8)), "paper", w=FW, second=0)
    a.block(T.pts(rect(-58, 0, 10, 8)), "paper", w=FW, second=0)
    a.lines([(T((-30, -24)), T((24, -24))), (T((-30, -10)), T((10, -10))), (T((-30, 4)), T((20, 4))),
             (T((-30, 20)), T((4, 20)))], MW * 1.2, alpha=0.6, amp=0.3)
    a.dots([T((-70, 22)), T((-48, 22))], 6, "ink")


@art_key("pic_map_paper")
def pic_map_paper(a):
    """A folded paper map: four zigzag panels, green land, a slate river, a dotted route that ends at a clay pin."""
    xs = [26, 74, 122, 170, 218]
    tops = [52, 40, 52, 40, 52]
    bots = [204, 192, 204, 192, 204]
    for i in range(4):
        pan = [(xs[i], tops[i]), (xs[i + 1], tops[i + 1]), (xs[i + 1], bots[i + 1]), (xs[i], bots[i])]
        a.fill_poly(pan, "paper", off=(0, 0))
        if i % 2 == 1:
            a.fill_poly(pan, "slate", 0.18)
    land = [(30, 110), (60, 84), (100, 92), (140, 70), (190, 86), (214, 120), (214, 186), (150, 170), (90, 186),
            (30, 176)]
    a.fill_smooth(land, "sage", 0.7)
    a.curve([(26, 150), (70, 134), (110, 150), (150, 128), (218, 140)], 7, "slate", 0.85)
    for i in range(4):
        pan = [(xs[i], tops[i]), (xs[i + 1], tops[i + 1]), (xs[i + 1], bots[i + 1]), (xs[i], bots[i])]
        a.outline_poly(pan, LW if i in (0, 3) else MW * 1.3, second=0)
    route = spline([(48, 184), (80, 160), (106, 112), (148, 104), (176, 86)], False, 5)
    a.dots(route[::2], 5, "clay", 0.95)
    pin = [(176, 84), (164, 66), (164, 54), (176, 44), (188, 54), (188, 66)]
    a.blob(pin, "clay", w=MW * 1.4, second=0)
    a.dots([(176, 56)], 6.5, "paper")
    a.ell((48, 186), 6, 6, "ochre", w=MW, second=0)


@art_key("pic_traffic_light")
def pic_traffic_light(a):
    """A traffic light: a dark housing on a pole with three lamps, clay (red) on top, ochre (amber), sage (green)."""
    cx = 120 + a.j(2)
    a.blob(capsule((cx, 220), (cx, 160), 6), "slate", w=MW * 1.3, second=0)
    a.block([(cx - 22, 218), (cx + 22, 218), (cx + 18, 226), (cx - 18, 226)], "slate", w=MW * 1.3, second=0)
    box = [(cx - 34, 20), (cx + 34, 20), (cx + 36, 166), (cx - 36, 166)]
    a.fill_poly(box, "slate")
    a.fill_poly(box, "ink", 0.45, off=a.reg("slate"))
    a.outline_poly(box, LW, second=0.3)
    for k, col in enumerate(("clay", "ochre", "sage")):
        c = (cx + a.j(0.8), 50 + k * 44)
        a.fill_smooth(ellipse(c, 18, 18, n=12), col)
        a.ell_outline(c, 18, 18, w=MW * 1.3, second=0)
        a.curve([polar(c, 12, t) for t in (200, 225, 250)], 3, "paper", 0.85, jit=0.1)
        hood = [polar(c, 23, t) for t in range(190, 351, 20)]
        a.curve(hood, MW * 1.6, jit=0.2)


@art_key("pic_bridge")
def pic_bridge(a):
    """A bridge (jembatan): a stone arch bridge with a railing across a river, banks on both sides."""
    wy = 182
    water = [(0, wy)] + [(x, wy + 3 * math.sin(x / 13)) for x in range(10, 241, 15)] + [(240, 240), (0, 240)]
    a.fill_poly(water, "slate", 0.5, off=(0, 0), step=40)
    for k, y in enumerate((206, 226)):
        a.curve([(4 + (k % 2) * 16 + i * 22, y + 3 * math.sin(i * 1.7 + k)) for i in range(11)], MW, "paper", 0.8)
    for bank in ([(0, 150), (40, 150), (54, 196), (0, 200)], [(240, 146), (200, 146), (186, 196), (240, 200)]):
        a.blob(bank, "sage", w=MW * 1.4, second=0)
    deck = [(10, 120), (230, 116), (230, 136), (10, 140)]
    arch = [(30, 140)] + [polar((120, 200), 92, t, 70) for t in range(196, 345, 12)] + [(212, 136)]
    span = [(10, 120), (230, 116), (230, 136), (212, 136)] + arch[::-1][1:-1] + [(30, 140), (10, 140)]
    a.fill_poly(span, "ochre", 0.9, step=24)
    a.hatch(clip_half(span, (170, 0), (1, 0)), 75, 4.6, alpha=0.35)
    a.curve(arch[1:-1], LW, jit=0.4)
    a.outline_poly(deck, LW, second=0.3)
    stones = []
    for t in range(200, 341, 20):
        stones.append((polar((120, 200), 92, t, 70), polar((120, 200), 106, t, 84)))
    a.lines(stones, FW * 1.4, alpha=0.6)
    a.line((10, 92), (230, 88), MW * 1.6, amp=0.4)
    a.lines([((x, 118 - (x - 10) * 0.018), (x, 92 - (x - 10) * 0.018)) for x in range(18, 231, 22)], MW * 1.2, amp=0.2)
    a.fill_smooth([(64, 182), (120, 178), (176, 182), (176, 188), (64, 188)], "ink", 0.3, off=(0, 0))


def arrow_glyph(a, pts, col="slate"):
    """The glyph family's arrow: a broad colour stroke under a confident ink line and an open arrowhead."""
    glyph_under(a, pts, 15, col)
    a.curve(pts, 4.4, jit=0.6)
    end, d = pts[-1], unit(sub(pts[-1], pts[-2]))
    a.zig([add(end, mul(rotp(d, 145), 30)), end, add(end, mul(rotp(d, -145), 30))], 4.4, jit=0.5)
    a.curve(pts[:3], 1.6, jit=0.8)


@art_key("glyph_arrow_left")
def glyph_arrow_left(a):
    """Turn left (belok kiri): a road arrow going up, then bending to the left."""
    arrow_glyph(a, [(132, 212), (134, 168), (130, 128), (112, 96), (80, 84), (46, 84)])


@art_key("glyph_arrow_right")
def glyph_arrow_right(a):
    """Turn right (belok kanan): a road arrow going up, then bending to the right."""
    arrow_glyph(a, [(106, 212), (106, 168), (110, 128), (128, 98), (160, 84), (196, 86)])


@art_key("glyph_arrow_straight")
def glyph_arrow_straight(a):
    """Go straight on (lurus): a road arrow going straight up."""
    arrow_glyph(a, [(118, 214), (120, 170), (119, 126), (121, 82), (120, 36)])


# --------------------------------------------------------------------------------------------- technology


def screen_scene(a, scr):
    """A simple picture on a screen (hill and sun), so a screen never shows text: slate sky, sage hill, ochre sun."""
    x0, y0, x1, y1 = bbox(scr)
    w, h = x1 - x0, y1 - y0
    a.fill_poly(scr, "slate", 0.9)
    hill = [(x0, y1), (x0, y0 + h * 0.7), (x0 + w * 0.3, y0 + h * 0.5), (x0 + w * 0.6, y0 + h * 0.62),
            (x1, y0 + h * 0.48), (x1, y1)]
    a.fill_poly(clip_convex(hill, scr), "sage", 0.95, step=40)
    a.fill_smooth(ellipse((x0 + w * 0.72, y0 + h * 0.28), h * 0.13, h * 0.13, n=8), "ochre")


@art_key("pic_computer")
def pic_computer(a):
    """A desktop computer: a monitor on a stand showing a simple picture, a keyboard and a mouse. The keyboard and
    mouse tell it from pic_tv and pic_tablet."""
    mon = [(30, 26), (210, 22), (212, 140), (32, 144)]
    a.fill_poly(mon, "slate")
    a.fill_poly(mon, "ink", 0.45, off=a.reg("slate"))
    scr = [(42, 36), (200, 33), (201, 128), (43, 131)]
    screen_scene(a, scr)
    a.outline_poly(scr, MW * 1.2, second=0)
    a.outline_poly(mon, LW, second=0.3)
    a.block([(108, 144), (134, 143), (138, 170), (104, 171)], "slate", w=MW * 1.3, second=0)
    a.block([(78, 170), (164, 168), (168, 178), (74, 180)], "slate", w=MW * 1.3, second=0)
    kb = [(22, 190), (170, 186), (180, 216), (14, 222)]
    a.fill_poly(kb, "paper", off=(0, 0))
    a.hatch(kb, 90, 9, w=FW * 1.2, alpha=0.6)
    a.hatch(kb, -4, 8, w=FW * 1.2, alpha=0.6)
    a.outline_poly(kb, LW, second=0.3)
    a.line((52, 212), (130, 210), 4, "slate", amp=0.2)
    ms = ellipse((206, 206), 14, 18, -16, n=10)
    a.blob(ms, "ochre", w=MW * 1.4, second=0)
    a.line((204, 190), (210, 202), FW * 1.3)
    a.curve([(198, 189), (190, 176), (176, 172)], MW)


@art_key("pic_tv")
def pic_tv(a):
    """A television: a box set with two antennas, knobs at the side and short legs, a picture on the screen."""
    cy = 128 + a.j(2)
    a.lines([((112, cy - 64), (76, cy - 108)), ((122, cy - 64), (156, cy - 112))], MW * 1.6, amp=0.3)
    a.dots([(76, cy - 108), (156, cy - 112)], 8, "clay")
    a.blob(ellipse((117, cy - 62), 18, 8, n=10, a0=180, sweep=180) + [(135, cy - 60), (99, cy - 60)], "slate",
           w=MW * 1.3, second=0)
    box = [(26, cy - 60), (212, cy - 62), (216, cy + 66), (24, cy + 70)]
    a.fill_poly(box, "ochre")
    a.hatch(clip_half(box, (190, 0), (1, 0)), 75, 4.6, alpha=0.35)
    a.outline_poly(box, LW, second=0.4)
    scr = [(40, cy - 46), (160, cy - 48), (162, cy + 52), (42, cy + 56)]
    screen_scene(a, scr)
    a.outline_poly(scr, LW * 0.9, second=0)
    for y in (cy - 30, cy):
        a.ell((188, y), 10, 10, "slate", w=MW * 1.3, second=0)
        a.line((188, y - 7), (189, y), MW, amp=0.1)
    a.lines([((176, cy + 22 + k * 7), (202, cy + 22 + k * 7)) for k in range(4)], FW * 1.4, alpha=0.7)
    a.lines([((48, cy + 70), (40, cy + 88)), ((192, cy + 66), (200, cy + 86))], LW * 1.3, amp=0.2)


@art_key("pic_radio")
def pic_radio(a):
    """A radio: a portable set with a carry handle, a round speaker grille, a tuning window with a needle, two knobs
    and a telescopic antenna."""
    cy = 138 + a.j(2)
    a.line((176, cy - 56), (214, cy - 124), MW * 1.4, amp=0.3)
    a.dots([(214, cy - 124)], 6, "slate")
    a.curve([(52, cy - 56), (60, cy - 86), (150, cy - 88), (160, cy - 56)], 7, "slate")
    a.curve([(52, cy - 56), (60, cy - 86), (150, cy - 88), (160, cy - 56)], FW, alpha=0.6)
    body = [(20, cy - 58), (220, cy - 60), (224, cy + 64), (18, cy + 68)]
    a.fill_poly(body, "clay")
    a.hatch(clip_half(body, (200, 0), (1, 0)), 75, 4.6, alpha=0.35)
    a.outline_poly(body, LW, second=0.4)
    sc = (78, cy + 8)
    a.fill_smooth(ellipse(sc, 44, 44, n=16), "paper", off=(0, 0))
    a.stipple(ellipse(sc, 38, 38, n=16), 36, 3.2, "ink", 0.7)
    a.ell_outline(sc, 44, 44, w=LW)
    win = [(136, cy - 40), (206, cy - 41), (206, cy - 14), (136, cy - 13)]
    a.fill_poly(win, "ochre")
    a.lines([((142 + k * 8, cy - 38), (142 + k * 8, cy - 32)) for k in range(8)], FW * 1.2, alpha=0.7)
    a.line((166, cy - 40), (168, cy - 14), MW * 1.3, "clay", amp=0.1)
    a.outline_poly(win, MW * 1.4, second=0)
    for c in ((152, cy + 30), (192, cy + 30)):
        a.ell(c, 14, 14, "slate", w=MW * 1.4, second=0)
        a.line(c, add(c, (0, -10)), MW, amp=0.1)


@art_key("pic_tablet")
def pic_tablet(a):
    """A tablet: a wide, flat screen held sideways (landscape) with a thin frame, a picture on the screen and a stylus
    beside it. Landscape and stylus tell it from pic_phone (upright, app squares) and pic_computer."""
    T = Tf((114 + a.j(2), 112), 1, -6)
    body = T.pts([(-96, -62), (96, -62), (102, -56), (102, 56), (96, 62), (-96, 62), (-102, 56), (-102, -56)])
    a.fill_smooth(body, "slate")
    a.fill_smooth(body, "ink", 0.45, off=a.reg("slate"))
    a.outline(body, LW, second=0.4)
    scr = T.pts(rect(-88, -52, 172, 104))
    screen_scene(a, scr)
    a.outline_poly(scr, MW * 1.2, second=0)
    a.dots([T((94, 0))], 6, "slate")
    P = Tf((58, 206), 1, -16)
    a.blob(P.pts([(0, -4), (130, -5), (130, 5), (0, 4)]), "ochre", w=MW * 1.3, second=0)
    a.block(P.pts([(130, -5), (146, 0), (130, 5)]), "slate", w=MW, second=0)
    a.curve([T((-60, 20)), T((-36, 4)), T((-12, 18)), T((12, 2))], MW * 1.4, "paper", 0.9)


@art_key("pic_headphones")
def pic_headphones(a):
    """Over-ear headphones: a padded slate headband and two clay ear cups, a coiled cord."""
    cx, cy = 120 + a.j(2), 126
    band = [polar((cx, cy), 82, t, 86) for t in range(190, 351, 16)]
    a.curve(band, 15, "slate")
    a.curve(band, FW, alpha=0.6)
    a.curve([polar((cx, cy), 89, t, 93) for t in range(196, 345, 16)], MW * 1.2)
    for sx in (-1, 1):
        c = (cx + sx * 80, cy + 22)
        cup = ellipse(c, 24, 36, sx * 6, n=12)
        a.fill_smooth(cup, "clay")
        a.hatch(clip_half(cup, add(c, (6, 0)), (1, 0)), 75, 4, alpha=0.4)
        a.outline(cup, LW, second=0.3)
        pad = ellipse(add(c, (-sx * 14, 0)), 10, 30, sx * 6, n=10)
        a.fill_smooth(pad, "slate", 0.8)
        a.outline(pad, MW * 1.2, second=0)
        a.line(add(c, (0, -36)), add(c, (sx * -2, -54)), LW, amp=0.2)
    a.curve([(cx + 84, cy + 58)] + [(cx + 70 - k * 8, cy + 74 + 6 * math.sin(k * 2.4)) for k in range(6)] +
            [(cx + 8, cy + 92)], MW * 1.2, jit=0.3)


@art_key("pic_robot_toy")
def pic_robot_toy(a):
    """A toy robot: boxy head with an antenna and round eyes, a body with dials, bendy arms with claw hands, wheels
    for feet and a wind-up key. Friendly, a toy."""
    cx = 116 + a.j(2)
    a.line((cx + 2, 42), (cx + 4, 20), MW * 1.4, amp=0.2)
    a.dots([(cx + 4, 16)], 10, "clay")
    for sx in (-1, 1):
        sh = (cx + sx * 46, 118)
        el = (cx + sx * 70, 146)
        hd = (cx + sx * 64, 178)
        a.curve([sh, el, hd], 9, "slate")
        a.curve([sh, el, hd], FW, alpha=0.6)
        a.arc(hd, 9, -30 + (90 if sx < 0 else 0), 200 + (90 if sx < 0 else 0), MW * 1.6)
    body = [(cx - 46, 102), (cx + 46, 100), (cx + 48, 190), (cx - 48, 192)]
    a.fill_poly(body, "ochre")
    a.hatch(clip_half(body, (cx + 28, 0), (1, 0)), 75, 4.4, alpha=0.4)
    a.outline_poly(body, LW, second=0.4)
    panel = [(cx - 30, 118), (cx + 30, 117), (cx + 30, 160), (cx - 30, 161)]
    a.block(panel, "paper", w=MW * 1.3, second=0)
    for c, col in (((cx - 14, 132), "clay"), ((cx + 12, 132), "sage")):
        a.ell(c, 8, 8, col, w=MW * 1.2, second=0)
    a.lines([((cx - 20, 150), (cx + 20, 150))], 4, "slate", amp=0.2)
    head = [(cx - 36, 44), (cx + 38, 42), (cx + 40, 96), (cx - 38, 98)]
    a.fill_poly(head, "slate")
    a.hatch(clip_half(head, (cx + 22, 0), (1, 0)), 75, 4.4, alpha=0.4)
    a.outline_poly(head, LW, second=0.4)
    for ex in (-16, 16):
        a.fill_smooth(ellipse((cx + ex, 66), 11, 11, n=10), "paper", off=(0, 0))
        a.ell_outline((cx + ex, 66), 11, 11, w=MW * 1.2, second=0)
        a.dots([(cx + ex + 2, 67)], 7)
    a.curve([(cx - 12, 84), (cx, 90), (cx + 12, 84)], MW * 1.2, jit=0.1)
    a.block([(cx - 4, 98), (cx + 4, 98), (cx + 4, 102), (cx - 4, 102)], "slate", w=FW, second=0)
    for x in (cx - 26, cx + 26):
        a.block([(x - 14, 190), (x + 14, 190), (x + 14, 200), (x - 14, 200)], "slate", w=MW * 1.2, second=0)
        a.ell((x, 212), 13, 13, "ink", 0.8, w=MW * 1.3, second=0)
        a.dots([(x, 212)], 5, "paper")
    a.line((cx + 48, 150), (cx + 62, 150), MW * 1.4)
    key = [(cx + 62, 140), (cx + 72, 132), (cx + 76, 150), (cx + 72, 168), (cx + 62, 160)]
    a.blob(key, "clay", w=MW * 1.2, second=0)
    ground(a, 60, 190, 226, marks=3)


# --------------------------------------------------------------------------------------------- health
# Gentle, not scary: no needles, no blood, organs as friendly simple anatomical shapes without faces.


@art_key("pic_fever")
def pic_fever(a):
    """A fever (demam): a child with tired eyes and flushed cheeks, a thermometer in the mouth and a folded cool
    cloth on the forehead, a blanket round the shoulders. Tells from pic_hot (sun, fan, sweat)."""
    cx = 116 + a.j(2)

    def blanket(F):
        bl = [add(F.nb, p) for p in ((-70, 20), (-40, -6), (-14, 4), (14, 4), (40, -6), (72, 22), (80, 90), (-80, 90))]
        a.fill_smooth(bl, "sage")
        a.hatch(bl, 70, 9, w=MW, color="paper", alpha=0.35)
        a.outline(bl, LW, second=0.3)
        a.curve([add(F.nb, (-14, 6)), add(F.nb, (-4, 40)), add(F.nb, (-10, 80))], MW, alpha=0.6)

    F = figure(a, r=44, kid=True, head=(cx, 104), cut=236, top_col="slate", hair="short", expr="tired", mid=blanket,
               pose={"head": 6, "arms": ((101, 94), (79, 86))}, tone="mid")
    H = Tf(F.hc, 1, F.tilt)
    for bx in (-26, 24):
        a.fill_smooth(H.pts(ellipse((bx, 12), 10, 6, n=7)), "clay", 0.45)
    m = H((4, 21))
    th = [add(m, p) for p in ((-2, -3), (54, 10), (53, 16), (-3, 3))]
    a.block(th, "paper", w=MW * 1.2, second=0)
    a.ell(add(m, (56, 13)), 5, 5, "clay", w=MW, second=0)
    a.line(add(m, (14, 3)), add(m, (44, 10)), FW * 1.4, "clay", amp=0.1)
    cloth = H.pts([(-40, -40), (38, -46), (42, -28), (-38, -22)])
    a.block(cloth, "paper", w=MW * 1.4, second=0)
    a.hatch(cloth, 0, 5, color="slate", alpha=0.45)


@art_key("pic_cough")
def pic_cough(a):
    """A cough (batuk), with the good habit: a child coughing into the sleeve of the raised arm, eyes squeezed shut,
    small puffs beside. Tells from pic_tired (yawning) and pic_sorry (hand at the back of the head)."""
    cx = 128 + a.j(2)
    r = 44
    figure(a, r=r, kid=True, head=(cx, 104), cut=236, top_col="clay", sleeve="long", hair="bob", expr="sleep",
               pose={"head": -6, "arms": ((101, 94), ("ik", (cx - 46, 106), -1))}, tone="light")
    for c, rr in (((cx - 74, 112), 9), ((cx - 92, 98), 7), ((cx - 96, 122), 6), ((cx - 108, 110), 4.5)):
        a.ell(c, rr, rr * 0.9, "paper", w=MW * 1.2, second=0)
    a.lines([((cx - 64, 88), (cx - 74, 80)), ((cx - 66, 134), (cx - 78, 142))], MW * 1.2, alpha=0.8)


@art_key("pic_medicine")
def pic_medicine(a):
    """Medicine (obat): a clay syrup bottle with a blank label and a small sage plus, a spoon of syrup and two
    capsules. Gentle; no needle."""
    T = Tf((84 + a.j(2), 120), 1, -4)
    cap = T.pts(rect(-22, -94, 44, 24))
    a.block(cap, "slate", w=MW * 1.4, second=0)
    a.lines([(T((x, -92)), T((x, -72))) for x in range(-16, 20, 6)], FW * 1.2, alpha=0.6)
    neck = T.pts([(-16, -70), (16, -70), (18, -58), (-18, -58)])
    a.block(neck, "clay", w=MW * 1.2, second=0)
    body = T.pts([(-18, -58), (18, -58), (46, -34), (48, 86), (40, 94), (-40, 94), (-48, 86), (-46, -34)])
    a.fill_smooth(body, "clay")
    a.hatch(clip_half(body, T((26, 0)), T.v((1, 0))), T.ang(75), 4.6, alpha=0.4)
    a.outline(body, LW, second=0.4)
    lab = T.pts(rect(-36, -10, 72, 66))
    a.block(lab, "paper", w=MW * 1.3, second=0)
    a.lines([(T((-10, 24)), T((10, 24))), (T((0, 14)), T((0, 34)))], 6, "sage", amp=0.1)
    a.lines([(T((-26, 46)), T((26, 46)))], FW * 1.4, alpha=0.6)
    sp = (176, 186)
    a.blob(capsule((128, 214), (162, 194), 4.4, 3.6), "slate", w=MW * 1.2, second=0)
    bowl = ellipse(sp, 24, 14, -20, n=12)
    a.fill_smooth(bowl, "slate")
    a.outline(bowl, MW * 1.4, second=0)
    a.fill_smooth(ellipse(sp, 17, 9, -20, n=10), "clay", 0.95)
    a.dots([add(sp, (-6, -2))], 4, "paper", 0.9)
    for c, rot in (((170, 66), -30), ((196, 106), 20)):
        Tc = Tf(c, 1, rot)
        half1 = Tc.pts([(-20, -8), (0, -8), (0, 8), (-20, 8)] + [polar((-20, 0), 8, t) for t in range(90, 271, 30)])
        half2 = Tc.pts([(0, -8), (20, -8)] + [polar((20, 0), 8, t) for t in range(-90, 91, 30)] + [(20, 8), (0, 8)])
        a.fill_poly(half1, "ochre")
        a.fill_poly(half2, "paper", off=(0, 0))
        pill = Tc.pts([(-20, -8), (20, -8)] + [polar((20, 0), 8, t) for t in range(-90, 91, 30)] + [(-20, 8)] +
                      [polar((-20, 0), 8, t) for t in range(90, 271, 30)])
        a.outline(pill, MW * 1.3, second=0, jit=0.2)
        a.line(Tc((0, -8)), Tc((0, 8)), FW * 1.3, amp=0.1)


@art_key("pic_heart_organ")
def pic_heart_organ(a):
    """The heart (jantung) as a friendly simple organ: a rounded clay body tipped to the left, the aorta arching on
    top, slate veins, a few drawn vessels. No face, nothing gory."""
    T = Tf((118 + a.j(2), 132), 1, 18)
    cava = ribbon(T.pts([(36, -40), (40, -80), (42, -110)]), 18, 16)
    a.blob(cava, "slate", w=MW * 1.4, second=0)
    aorta = ribbon(T.pts([(6, -36), (8, -84), (-10, -108), (-38, -104), (-50, -78)]), 22, 18, steps=3)
    a.fill_smooth(aorta, "clay")
    for p0, p1 in (((-6, -104), (-4, -128)), ((-20, -108), (-22, -130)), ((-34, -104), (-40, -124))):
        a.blob(capsule(T(p0), T(p1), 4.4, 3.6), "clay", w=MW * 1.2, second=0)
    a.outline(aorta, LW, second=0)
    body = T.pts([(-6, -54), (26, -60), (56, -44), (66, -10), (56, 30), (30, 62), (4, 84), (-16, 70), (-46, 40),
                  (-64, 4), (-60, -30), (-36, -52)])
    a.fill_smooth(body, "clay")
    a.fill_smooth(clip_half(spline(body, True, 3), T((-30, 0)), T.v((-1, 0.2))), "blush", 0.6, off=a.reg("clay"))
    a.hatch(clip_half(body, T((30, 0)), T.v((1, 0.3))), T.ang(70), 4.4, alpha=0.4)
    a.outline(body, LW, second=0.4)
    pul = ribbon(T.pts([(-14, -40), (-30, -66), (-58, -70), (-76, -58)]), 15, 12)
    a.blob(pul, "slate", w=MW * 1.4, second=0)
    a.curve(T.pts([(10, -50), (2, -10), (14, 30), (6, 66)]), MW * 1.4, "ochre", 0.9)
    a.curve(T.pts([(10, -50), (2, -10), (14, 30), (6, 66)]), FW, alpha=0.7)
    a.curve(T.pts([(4, -6), (-24, 14), (-40, 30)]), FW * 1.6, "ochre", 0.9)


@art_key("pic_lungs")
def pic_lungs(a):
    """The lungs (paru-paru): two soft blush lungs, the right one a little wider, the windpipe with rings and the
    branching airways drawn inside. Friendly shapes, no face."""
    cx = 120 + a.j(2)
    lungs = []
    for sx, w_ in ((-1, 1.06), (1, 0.94)):
        pts = [(cx + sx * 10, 74), (cx + sx * 30 * w_, 56), (cx + sx * 56 * w_, 66), (cx + sx * 84 * w_, 112),
               (cx + sx * 96 * w_, 168), (cx + sx * 86 * w_, 206), (cx + sx * 52 * w_, 214), (cx + sx * 18, 198),
               (cx + sx * 14, 150), (cx + sx * 24 * w_, 130), (cx + sx * 12, 110)]
        lungs.append(pts)
    for pts in lungs:
        a.fill_smooth(pts, "blush")
    for pts, sx in zip(lungs, (-1, 1)):
        a.hatch(clip_half(pts, (cx + sx * 64, 0), (sx, 0)), 70, 4.4, color="clay", alpha=0.45)
    outlines(a, lungs, LW, jit=0.4)
    tr = [(cx - 9, 16), (cx + 9, 16), (cx + 9, 98), (cx - 9, 98)]
    a.fill_poly(tr, "paper", off=(0, 0))
    a.lines([((cx - 8, y), (cx + 8, y + 1)) for y in range(24, 96, 9)], MW, alpha=0.7, amp=0.1)
    a.outline_poly(tr, MW * 1.5, second=0)
    br = []
    for sx in (-1, 1):
        b0 = (cx, 98)
        b1 = (cx + sx * 34, 128)
        br.append((b0, b1))
        for t, L in ((160, 26), (200, 24), (240, 22)):
            tip = add(b1, mul(dirv(90 + sx * (220 - t) * 0.9), L))
            br.append((b1, tip))
            br.append((tip, add(tip, mul(dirv(90 + sx * (250 - t)), 12))))
    a.lines(br[:1] + br[7:8], 7, "paper", 0.95, amp=0.3)
    a.lines(br, MW * 1.2, amp=0.4)


@art_key("pic_teeth")
def pic_teeth(a):
    """Teeth (gigi): a big molar and a smaller front tooth, white with roots, on a soft sage patch so the white reads;
    a small clean glint. Tells from pic_mouth (lips and a smile)."""
    tint_patch(a, (120, 120), 100, 96, "sage", 0.3)
    mol = [(64, 70), (84, 52), (104, 60), (120, 50), (140, 56), (164, 52), (182, 70), (180, 112), (170, 140),
           (164, 196), (150, 204), (138, 186), (128, 150), (114, 150), (106, 188), (92, 204), (78, 196), (74, 140),
           (64, 112)]
    a.fill_smooth(mol, "paper", off=(0, 0))
    a.hatch(clip_half(mol, (150, 0), (1, 0)), 70, 4.6, color="slate", alpha=0.45)
    a.outline(mol, LW, second=0.4)
    a.curve([(96, 64), (120, 72), (150, 64)], MW, alpha=0.6)
    inc = [(176, 132), (206, 126), (214, 160), (206, 214), (196, 222), (188, 214), (180, 170)]
    a.fill_smooth(inc, "paper", off=(0, 0))
    a.hatch(clip_half(inc, (200, 0), (1, 0)), 70, 4.6, color="slate", alpha=0.45)
    a.outline(inc, MW * 1.5, second=0.3)
    a.curve([(80, 84), (82, 104), (88, 120)], 4, "sage", 0.9)
    for c, s in (((44, 52), 9), ((206, 92), 6)):
        a.lines([(add(c, (-s, 0)), add(c, (s, 0))), (add(c, (0, -s)), add(c, (0, s)))], MW * 1.2, "ochre", amp=0.2)


@art_key("pic_exercise")
def pic_exercise(a):
    """Exercise (olahraga): a child in sports clothes and a headband doing a star jump, feet off the ground, motion
    marks and one sweat drop. Tells from pic_happy (a close-up) and pic_dance (dress and sash)."""
    cx = 118 + a.j(2)
    F = figure(a, cx, 210, 27, kid=True, top_col="sage", bottom="shorts", bottom_col="slate", shoes="ochre",
               hair="short", expr="grin", ground_line=False, lite=True,
               pose={"arms": ((-150, -125), (-30, -55)), "legs": ((115, 100), (65, 80))}, hands=("round", "round"),
               tone="deep")
    band = [add(F.hc, p) for p in ((-26, -12), (26, -14), (26, -6), (-26, -4))]
    a.block(band, "clay", w=FW * 1.3, second=0)
    ground(a, 50, 190, 226, marks=3)
    for x in (cx - 40, cx + 40):
        a.lines([((x - 8, 214), (x - 2, 218)), ((x + 8, 214), (x + 2, 218))], MW, alpha=0.8)
    motion_arcs(a, add(F.hd[0], (4, 8)), 20, -200, -150, w=MW * 1.2)
    motion_arcs(a, add(F.hd[1], (-4, 8)), 20, -30, 20, w=MW * 1.2)
    drop(a, add(F.hc, (34, -18)), 6, "slate", 20)


@art_key("pic_healthy_plate")
def pic_healthy_plate(a):
    """A healthy plate (Isi Piringku), from above: half vegetables and fruit (more vegetables), half rice and a protein
    (fried tempe and fish); a glass of water beside."""
    c = (106 + a.j(2), 124)
    R = 92
    a.fill_smooth(ellipse(c, R, R, n=20), "slate", 0.3)
    well = ellipse(c, R * 0.84, R * 0.84, n=20)
    a.fill_smooth(well, "paper", off=(0, 0))
    for k in range(8):
        t = 100 + k * 14
        p = polar(c, R * (0.42 + 0.3 * (k % 2)), t)
        a.fill_smooth([polar(p, 11 + 2 * math.sin(u * 3), u) for u in range(0, 360, 45)], "sage")
    a.dots([polar(polar(c, R * (0.42 + 0.3 * (k % 2)), 100 + k * 14), 4, 220) for k in range(8)], 3.4, "ink", 0.5)
    for t in (232, 262):
        p = polar(c, R * 0.55, t)
        sl = [polar(p, 15, u) for u in range(0, 181, 30)]
        a.fill_smooth(sl + [p], "ochre")
        a.lines([(p, polar(p, 13, u)) for u in (40, 90, 140)], FW * 1.2, alpha=0.7)
    a.blob(ribbon([polar(c, R * 0.3, 250), polar(c, R * 0.55, 288), polar(c, R * 0.72, 292)], 12, 6), "ochre",
           w=MW * 1.2, second=0)
    rc = polar(c, R * 0.46, 316)
    rice = [polar(rc, 30 + 4 * math.sin(math.radians(t * 5)), t, 26 + 3 * math.sin(math.radians(t * 5))) for t in
            range(0, 360, 20)]
    a.fill_smooth(rice, "paper", off=(0, 0))
    grains = Path()
    for k in range(10):
        p = polar(rc, 6 + (k * 7) % 20, k * 37)
        ang = k * 53
        a.seg(add(p, mul(dirv(ang), -2.6)), add(p, mul(dirv(ang), 2.6)), 0.2, grains)
    a.stroke(grains, MW, alpha=0.6)
    a.outline(rice, MW * 1.3, second=0)
    for k, p in enumerate((polar(c, R * 0.52, 26), polar(c, R * 0.36, 66))):
        tp = [add(p, q) for q in ((-14, -10), (14, -12), (16, 10), (-12, 12))]
        a.block(tp, "ochre", w=MW * 1.2, second=0)
        a.dots([add(p, (-5, -2)), add(p, (5, 3)), add(p, (-2, 6))], 2.6, "clay")
    fc = polar(c, R * 0.62, 62)
    fish = [add(fc, q) for q in ((-18, 0), (-8, -9), (8, -8), (16, 0), (8, 8), (-8, 9))]
    a.blob(fish, "clay", 0.85, w=MW * 1.2, second=0)
    a.blob([add(fc, (14, 0)), add(fc, (26, -9)), add(fc, (26, 9))], "clay", 0.85, w=MW, second=0)
    a.dots([add(fc, (-10, -2))], 3.4)
    a.lines([(c, polar(c, R * 0.84, t)) for t in (90, 0, 220)], MW * 1.3, amp=0.3)
    a.ell_outline(c, R * 0.84, R * 0.84, w=FW * 1.3, second=0)
    a.ell_outline(c, R, R, w=LW)
    g = [(196, 162), (230, 162), (226, 226), (200, 226)]
    a.fill_poly([(198, 176), (229, 176), (226, 225), (200, 225)], "slate", 0.5)
    a.outline_poly(g, LW, closed=False, second=0)
    a.line((196, 162), (230, 162), MW, over=(1, 1))
    a.line((204, 182), (206, 216), FW * 1.4, "paper", 0.9)


# --------------------------------------------------------------------------------------------- animals (friendly)


@art_key("pic_tiger")
def pic_tiger(a):
    """A friendly tiger (harimau) walking, face turned to us: ochre coat with clay and ink stripes, paper muzzle and
    belly, round ears, a soft closed smile. Not menacing: no teeth or claws."""
    ground(a, 16, 226, 210, marks=5)
    tail = ribbon([(186, 140), (206, 128), (214, 100), (206, 84)], 12, 8)
    a.blob(tail, "ochre", w=MW * 1.4, second=0)
    a.lines([(lerp((206, 128), (214, 100), t), add(lerp((206, 128), (214, 100), t), (9, 3))) for t in (0.1, 0.6)],
            MW * 1.3, "ink", 0.8)
    a.fill_smooth(ellipse((206, 84), 7, 7, n=7), "ink", 0.85, off=(0, 0))
    for p0, p1 in (((96, 158), (94, 204)), ((172, 156), (176, 204))):
        leg_post(a, p0, p1, 11, "ochre", 0.75)
    body = [(70, 124), (110, 114), (170, 114), (196, 130), (196, 160), (176, 172), (96, 174), (70, 160)]
    a.fill_smooth(body, "ochre")
    a.fill_smooth([(96, 160), (176, 158), (176, 172), (96, 174)], "paper", 0.9, off=(0, 0))
    stripes = []
    for x in (104, 124, 144, 164, 184):
        stripes.append([(x - 4, 116), (x + 4, 118), (x + 2, 140), (x - 3, 132)])
    for st in stripes:
        a.fill_smooth(st, "ink", 0.8, off=(0, 0))
    a.hatch(clip_half(body, (0, 160), (0, 1)), 20, 4.2, alpha=0.35)
    a.outline(body, LW, second=0.4)
    for p0, p1 in (((82, 162), (80, 208)), ((158, 164), (160, 208))):
        leg_post(a, p0, p1, 11.5, "ochre")
        a.ell(add(p1, (3, 0)), 13, 6.5, "ochre", w=MW * 1.2, second=0)
        a.lines([(add(p0, (-10, 20)), add(p0, (2, 22)))], MW * 1.2, "ink", 0.8)
    hc = (62, 106)
    for sx in (-1, 1):
        ear = ellipse(add(hc, (sx * 24, -28)), 11, 11, n=8)
        a.fill_smooth(ear, "ochre")
        a.fill_smooth(ellipse(add(hc, (sx * 24, -27)), 5.5, 5.5, n=6), "ink", 0.7, off=(0, 0))
        a.outline(ear, MW * 1.3, second=0)
    head = ellipse(hc, 38, 33, n=14)
    a.fill_smooth(head, "ochre")
    a.lines([(add(hc, (dx, -32)), add(hc, (dx * 1.15, -20))) for dx in (-8, 0, 8)], MW * 1.4, "ink", 0.8, amp=0.2)
    a.lines([(add(hc, (sx * 37, -6 + k * 9)), add(hc, (sx * 25, -4 + k * 9))) for sx in (-1, 1) for k in range(2)],
            MW * 1.4, "ink", 0.8, amp=0.2)
    muz = [add(hc, p) for p in ((-22, 8), (-10, 0), (0, 4), (10, 0), (22, 8), (18, 24), (0, 30), (-18, 24))]
    a.fill_smooth(muz, "paper", off=(0, 0))
    a.outline(head, LW, second=0.3)
    a.outline(muz, MW * 1.2, second=0)
    a.dots([add(hc, (-13, -8)), add(hc, (13, -9))], 7.5)
    nose = add(hc, (0, 8))
    a.fill_poly([add(nose, (-6, -3)), add(nose, (6, -3)), add(nose, (0, 4))], "clay", off=(0, 0))
    a.curve([add(nose, (-9, 12)), add(nose, (-3, 15)), add(nose, (0, 7)), add(nose, (3, 15)), add(nose, (9, 12))],
            MW, jit=0.1)
    a.lines([(add(hc, (sx * 16, 16 + dy)), add(hc, (sx * 44, 12 + dy * 2))) for sx in (-1, 1) for dy in (0, 5)],
            FW, alpha=0.7, amp=0.3)


@art_key("pic_frog")
def pic_frog(a):
    """A frog (katak) sitting on a lily pad: sage body, big eyes on top, a wide smile, folded back legs."""
    wy = 176
    water = [(0, wy)] + [(x, wy + 3 * math.sin(x / 13)) for x in range(10, 241, 15)] + [(240, 240), (0, 240)]
    a.fill_poly(water, "slate", 0.4, off=(0, 0), step=40)
    a.curve([(4 + i * 22, 214 + 3 * math.sin(i * 1.7)) for i in range(11)], MW, "slate", 0.85)
    pad = ellipse((120, 186), 96, 24, n=16)
    a.fill_smooth(pad[:13] + [(120, 186)], "sage", 0.75)
    a.outline(pad[:13] + [(120, 186)], MW * 1.4, second=0)
    cx = 118 + a.j(2)
    for sx in (-1, 1):
        leg = [(cx + sx * 30, 150), (cx + sx * 66, 150), (cx + sx * 76, 176), (cx + sx * 40, 182)]
        a.blob(leg, "sage", w=MW * 1.4, second=0)
        foot = [(cx + sx * 56, 178), (cx + sx * 84, 176), (cx + sx * 90, 186), (cx + sx * 56, 186)]
        a.blob(foot, "sage", w=MW * 1.2, second=0)
    body = [(cx - 50, 160), (cx - 46, 120), (cx - 30, 98), (cx, 92), (cx + 30, 98), (cx + 46, 120), (cx + 50, 160),
            (cx + 30, 180), (cx - 30, 180)]
    a.fill_smooth(body, "sage")
    a.fill_smooth([(cx - 30, 150), (cx, 136), (cx + 30, 150), (cx + 24, 176), (cx - 24, 176)], "ochre", 0.55)
    a.hatch(clip_half(body, (cx + 30, 0), (1, 0)), 70, 4.4, alpha=0.4)
    a.outline(body, LW, second=0.4)
    for sx in (-1, 1):
        e = (cx + sx * 26, 92)
        a.fill_smooth(ellipse(e, 19, 18, n=10), "sage")
        a.ell_outline(e, 19, 18, w=LW, second=0)
        a.fill_smooth(ellipse(e, 12, 12, n=9), "paper", off=(0, 0))
        a.dots([add(e, (sx * -1, 2))], 10)
        a.fill_smooth(ellipse((cx + sx * 34, 128), 8, 4.5, n=7), "blush", 0.85)
    a.curve([(cx - 32, 118), (cx - 10, 130), (cx + 12, 130), (cx + 32, 117)], MW * 1.3, jit=0.2)
    for sx in (-1, 1):
        arm = [(cx + sx * 26, 150), (cx + sx * 30, 176)]
        a.blob(capsule(*arm, 6), "sage", w=MW * 1.2, second=0)


@art_key("pic_butterfly")
def pic_butterfly(a):
    """A butterfly (kupu-kupu) from above: four ochre wings edged in clay with ink spots, a slim body, two antennae."""
    T = Tf((120 + a.j(2), 124), 1, -8)
    wings = []
    for sx in (-1, 1):
        up = T.pts([(sx * 6, -10), (sx * 30, -66), (sx * 72, -84), (sx * 96, -64), (sx * 88, -20), (sx * 50, 6)])
        lo = T.pts([(sx * 6, 4), (sx * 52, 12), (sx * 74, 44), (sx * 62, 80), (sx * 30, 82), (sx * 10, 40)])
        wings.append((up, lo, sx))
    for up, lo, sx in wings:
        for wpts in (lo, up):
            a.fill_smooth(wpts, "ochre")
            a.fill_smooth(clip_half(spline(wpts, True, 3), T((sx * 60, 0)), T.v((sx, 0))), "clay", 0.8,
                          off=a.reg("ochre"))
    outlines(a, [w for up, lo, sx in wings for w in (lo, up)], LW, jit=0.4)
    for sx in (-1, 1):
        a.fill_smooth(T.pts(ellipse((sx * 56, -46), 10, 10, n=8)), "ink", 0.85, off=(0, 0))
        a.dots([T((sx * 56, -46))], 6, "paper")
        a.dots([T((sx * 44, 46)), T((sx * 80, -66))], 6, "ink", 0.85)
        a.curve(T.pts([(sx * 10, -6), (sx * 40, -36), (sx * 70, -58)]), FW * 1.3, alpha=0.6)
    body = T.pts(capsule((0, -30), (0, 62), 7, 5, n=5))
    a.blob(body, "slate", w=MW * 1.4, second=0)
    a.lines([(T((-6, y)), T((6, y))) for y in (0, 14, 28, 42)], FW * 1.2, alpha=0.6)
    a.ell(T((0, -40)), 9, 9, "slate", w=MW * 1.3, second=0)
    for sx in (-1, 1):
        a.curve(T.pts([(sx * 3, -46), (sx * 10, -74), (sx * 26, -92)]), MW * 1.3, jit=0.2)
        a.dots([T((sx * 26, -92))], 7)


@art_key("pic_snake")
def pic_snake(a):
    """A friendly snake (ular) coiled on the ground, head up with big round eyes and a smile: sage with an ochre
    pattern. No fangs."""
    ground(a, 24, 220, 214, marks=4)
    coil = [polar((120, 184), 76 - k * 2, t, 26 - k * 0.6) for k, t in enumerate(range(200, 560, 30))]
    body_line = [(196, 196), (180, 210)] + coil[::-1] + [(70, 170), (70, 130), (86, 100), (110, 84)]
    body = ribbon(body_line, 8, 26, steps=3)
    a.fill_smooth(body, "sage")
    a.hatch(clip_half(body, (0, 190), (0, 1)), 15, 4.4, alpha=0.4)
    a.dots(spline(body_line, False, 2)[3:-6:3], 7, "ochre", 0.95)
    a.outline(body, LW, second=0.3)
    hc = (122 + a.j(2), 80)
    head = [add(hc, p) for p in ((-26, 4), (-22, -16), (0, -26), (24, -20), (34, -2), (26, 14), (0, 18), (-20, 14))]
    a.fill_smooth(head, "sage")
    a.outline(head, LW, second=0)
    for e in ((-6, -10), (14, -10)):
        a.fill_smooth(ellipse(add(hc, e), 8, 8, n=8), "paper", off=(0, 0))
        a.ell_outline(add(hc, e), 8, 8, w=MW, second=0)
        a.dots([add(hc, (e[0] + 2, e[1] + 1))], 6.5)
    a.curve([add(hc, (2, 6)), add(hc, (14, 11)), add(hc, (26, 4))], MW * 1.2, jit=0.1)
    a.fill_smooth(ellipse(add(hc, (-14, 4)), 5, 3, n=6), "blush", 0.85)
    a.curve([add(hc, (32, 4)), add(hc, (42, 8)), add(hc, (46, 4))], MW, "clay", jit=0.1)


@art_key("pic_turtle")
def pic_turtle(a):
    """A turtle (kura-kura) walking: a domed sage shell with an ochre plate pattern and rim, head out with a smile,
    four stubby legs, a little tail."""
    ground(a, 20, 222, 200, marks=5)
    for p0, p1 in (((92, 160), (90, 194)), ((178, 158), (184, 192))):
        a.blob(capsule(p0, p1, 10, 9), "ochre", 0.7, w=MW * 1.4, second=0)
    a.blob([(200, 156), (218, 166), (198, 168)], "ochre", 0.8, w=MW * 1.2, second=0)
    for p0, p1 in (((64, 160), (58, 196)), ((148, 162), (150, 198))):
        a.blob(capsule(p0, p1, 11.5, 10.5), "ochre", w=MW * 1.4, second=0)
        a.lines([(add(p1, (dx, 7)), add(p1, (dx, 2))) for dx in (-6, 0, 6)], FW * 1.3, alpha=0.8)
    neck = ribbon([(58, 146), (40, 126), (36, 108)], 22, 18)
    a.blob(neck, "ochre", 0.8, w=MW * 1.4, second=0)
    head = ellipse((38, 100), 24, 19, -10, n=12)
    a.fill_smooth(head, "ochre", 0.8)
    a.outline(head, LW, second=0)
    a.dots([(30, 94)], 7.5)
    a.curve([(18, 104), (24, 110), (32, 108)], MW, jit=0.1)
    a.fill_smooth(ellipse((44, 106), 5, 3, n=6), "blush", 0.85)
    shell = [(46, 158), (54, 120), (82, 88), (124, 76), (166, 86), (196, 116), (208, 156), (176, 170), (126, 174),
             (76, 170)]
    a.fill_smooth(shell, "sage")
    a.hatch(clip_half(shell, (164, 0), (1, 0)), 70, 4.6, alpha=0.4)
    plates = [[(100, 120), (126, 106), (152, 120), (146, 146), (106, 146)],
              [(66, 150), (74, 124), (100, 120), (106, 146), (96, 162)],
              [(152, 120), (180, 126), (190, 154), (158, 162), (146, 146)],
              [(100, 120), (96, 96), (126, 86), (156, 96), (152, 120), (126, 106)]]
    pp = Path()
    for pl in plates:
        pp.extend(a.sketch_poly(pl, amp=0.5, over=1.0, gap=1.0))
    a.stroke(pp, MW * 1.2, "ochre", 0.95)
    a.stroke(pp, FW, alpha=0.7)
    rim = ribbon([(44, 154), (80, 166), (126, 170), (176, 166), (210, 152)], 9, 9)
    a.fill_smooth(rim, "ochre", 0.95)
    a.outline(shell, LW, second=0.4)


@art_key("pic_orangutan")
def pic_orangutan(a):
    """An orangutan hanging from a branch by one long arm: shaggy clay-orange hair, a pale ochre face, small eyes and
    a gentle smile, no tail. Hanging and the long arms tell it from pic_monkey (sitting, tail, banana)."""
    br = ribbon([(0, 34), (80, 28), (160, 34), (240, 26)], 13, 10, steps=3)
    a.blob(br, "clay", 0.6, w=LW, second=0)
    a.fill_smooth(br, "ink", 0.25, off=(0, 0))
    for base, tip in (((40, 30), (24, 58)), ((200, 30), (222, 56)), ((176, 32), (162, 62))):
        a.blob(leaf_pts(base, tip, 9), "sage", w=MW * 1.2, second=0)
    cx = 112 + a.j(2)
    shag = Path()
    arm = ribbon([(cx + 22, 96), (cx + 34, 64), (cx + 38, 34)], 22, 18)
    a.fill_smooth(arm, "clay")
    a.outline(arm, LW, second=0)
    a.ell((cx + 38, 32), 12, 9, "ochre", w=MW * 1.3, second=0)
    arm2 = ribbon([(cx - 26, 104), (cx - 52, 140), (cx - 60, 184)], 22, 18)
    a.fill_smooth(arm2, "clay")
    a.outline(arm2, LW, second=0)
    a.ell((cx - 60, 188), 11, 9, "ochre", w=MW * 1.3, second=0)
    body = [(cx - 34, 98), (cx, 88), (cx + 32, 96), (cx + 40, 140), (cx + 30, 180), (cx, 190), (cx - 30, 180),
            (cx - 40, 140)]
    a.fill_smooth(body, "clay")
    for k in range(9):
        x = cx - 28 + k * 7
        smooth(shag, [a.jit(p, 0.6) for p in ((x, 110 + (k % 3) * 8), (x - 3, 132 + (k % 2) * 10),
                                                (x + 1, 156 + (k % 3) * 6))])
    a.stroke(shag, FW * 1.4, "ink", 0.5)
    a.outline(body, LW, second=0.3)
    for sx in (-1, 1):
        lg = ribbon([(cx + sx * 18, 180), (cx + sx * 30, 204), (cx + sx * 28, 222)], 18, 14)
        a.blob(lg, "clay", w=MW * 1.4, second=0)
        a.ell((cx + sx * 30, 224), 11, 7, "ochre", w=MW * 1.2, second=0)
    hc = (cx - 4, 76)
    hair = ellipse(hc, 34, 30, n=12)
    a.fill_smooth(hair, "clay")
    a.hatch(clip_half(hair, (0, hc[1] - 10), (0, -1)), 80, 4, alpha=0.4)
    a.outline(hair, LW, second=0)
    face = [add(hc, p) for p in ((-22, -6), (-10, -14), (0, -10), (10, -14), (22, -6), (24, 14), (12, 26), (-12, 26),
                                 (-24, 14))]
    a.fill_smooth(face, "ochre")
    a.fill_smooth(face, "blush", 0.3, off=a.reg("ochre"))
    a.outline(face, MW * 1.4, second=0)
    a.dots([add(hc, (-9, -2)), add(hc, (9, -3))], 6.5)
    a.dots([add(hc, (-3, 8)), add(hc, (3, 8))], 3, "ink", 0.8)
    a.curve([add(hc, (-10, 16)), add(hc, (0, 21)), add(hc, (10, 16))], MW * 1.2, jit=0.1)


# --------------------------------------------------------------------------------------------- contact sheets
# (name, predicate, columns, tile) as draw.py's SHEETS; a full run writes art/preview/sheet_<name>(_night).png.
_G = VOCAB2_GROUPS
SHEETS.extend([
    ("13v1_fu12_vocab_clothes_jobs", lambda k: k in _G["clothes"] + _G["jobs"], 8, 128),
    ("13v2_fu12_vocab_nature_routine", lambda k: k in _G["nature"] + _G["routine"], 8, 128),
    ("13v3_fu12_vocab_hobbies_town", lambda k: k in _G["hobbies"] + _G["town"], 8, 128),
    ("13v4_fu12_vocab_tech_health_animals", lambda k: k in _G["tech"] + _G["health"] + _G["animals"], 8, 128),
])
