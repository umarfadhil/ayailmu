"""Follow-up 12, art group A (MODULES_LEVELS_STORIES §3, §6.3): the Nilai (values) scenes. DRAFT art (ART_DIRECTION
§6): placeholders until an illustrator redraws or approves them.

One moment per scene, two or three people at most, 400 x 300 (4:3) so a scene card keeps its people large when the
app caps the picture's height. Everyday Indonesian settings (sekolah, pasar, angkot, warung, rumah, kampung), people
of many ages and skin tones, some women and girls in a kerudung and some not. The "not good" scenes (cut_queue,
litter, interrupt, left_out, copy_answer, phone_unkind, angry_face, late) stay gentle: the action is clear from
posture and objects; nobody cries, nobody is mocked, nothing violent; Nilai never puts a red or negative mark on a
person (§3). People come from figure() in draw.py, so they match the pic_* family.
"""

from draw import *  # noqa: F401,F403
from art_covers import art  # group A shared helper: @art_key + snap + pack + coarse

VW, VH, VK = 400, 300, 1.4
GY = 268  # ground line of the scenes
KR, AR = 27.0, 22.5  # head radius of a child and of an adult in a scene


def scene(key):
    return art(key, VW, VH, VK)


# --------------------------------------------------------------------------------------------- people


def kid(a, cx=0, gy=GY, **kw):
    kw.setdefault("ground_line", False)
    kw.setdefault("lite", True)
    return figure(a, cx, gy, kw.pop("r", KR), kid=True, **kw)


def adult(a, cx=0, gy=GY, **kw):
    kw.setdefault("ground_line", False)
    kw.setdefault("lite", True)
    return figure(a, cx, gy, kw.pop("r", AR), kid=False, **kw)


WALK_R = {"lean": 4, "arms": ((116, 102), (58, 40)), "legs": ((62, 80), (118, 102)), "behind": ("arm0", "leg0")}
WALK_L = {"lean": -4, "arms": ((64, 78), (122, 140)), "legs": ((118, 100), (62, 78)), "behind": ("arm1", "leg1")}


def brows(a, F, kind="angry"):
    """Extra brow marks over the family face: angry = inner ends pulled down; worried = inner ends up."""
    r = F.r
    T = Tf(F.hc, 1, F.tilt)
    ox = (F.facing or 0) * r * 0.3
    sg = 1 if kind == "angry" else -1
    a.lines([(T((ox - r * 0.55, -r * 0.3 - sg * r * 0.06)), T((ox - r * 0.16, -r * 0.2 + sg * r * 0.06))),
             (T((ox + r * 0.5, -r * 0.32 - sg * r * 0.06)), T((ox + r * 0.12, -r * 0.22 + sg * r * 0.06)))],
            MW * 1.3, amp=0.2)


# --------------------------------------------------------------------------------------------- settings and props


def backdrop(a, color="ochre", alpha=0.13, cy=166, ry=104):
    """A soft, irregular tinted patch behind the people (a vignette, not a full background)."""
    tint_patch(a, (200 + a.j(5), cy + a.j(3)), 190, ry, color, alpha, n=18)


def floor(a, y=GY, x0=14, x1=386, marks=7):
    ground(a, x0, x1, y, marks=marks)


def dashes(a, pts, w=FW * 1.3, color="ink", alpha=0.6, on=8.0, off=6.0):
    sp = subdivide(pts, 2, closed=False)
    segs, acc, cur, draw_on = [], 0.0, [sp[0]], True
    for p, q in zip(sp, sp[1:]):
        acc += vlen(sub(q, p))
        cur.append(q)
        if acc >= (on if draw_on else off):
            if draw_on:
                segs.append((cur[0], cur[-1]))
            draw_on, acc, cur = not draw_on, 0.0, [q]
    a.lines(segs, w, color, alpha, amp=0.2)


def loket(a, x0=312):
    """A service window (loket) in a wall at the right edge: wall panel, window with a sill and a small sign board
    (blank), a bell on the sill."""
    wall = [(x0, 36), (398, 34), (398, GY + 2), (x0, GY + 2)]
    a.fill_poly(wall, "ochre", 0.4)
    a.hatch(wall, 80, 9, alpha=0.18)
    win = rect(x0 + 18, 96, 62, 62)
    a.fill_poly(win, "slate", 0.35)
    a.hatch(win, 60, 7, color="paper", alpha=0.35)
    a.outline_poly(win, LW, second=0.3)
    sill = rect(x0 + 8, 156, 82, 12)
    a.block(sill, "clay", w=MW * 1.4, second=0)
    sign = rect(x0 + 24, 56, 50, 24)
    a.block(sign, "paper", w=MW * 1.3, second=0)
    a.curve([(x0 + 32, 68), (x0 + 48, 66), (x0 + 66, 69)], MW, alpha=0.5)
    a.outline_poly(wall, LW, closed=False, second=0)
    a.ell((x0 + 74, 150), 6, 5, "ochre", w=MW, second=0)


def coin(a, c, r=6.5):
    a.ell(c, r, r, "ochre", w=MW * 1.2, second=0)


def note(a, c, rot=0.0, col="sage"):
    T = Tf(c, 1, rot)
    n = T.pts(rect(-16, -9, 32, 18))
    a.fill_poly(n, col, 0.95)
    a.ell(T((0, 0)), 5, 5, w=FW * 1.2, second=0)
    a.outline_poly(n, MW * 1.2, second=0)


def book_closed(a, c, rot=0.0, col="clay", w=30, h=38):
    T = Tf(c, 1, rot)
    cov = T.pts(rect(-w / 2, -h / 2, w, h))
    a.fill_poly(cov, col)
    a.fill_poly(T.pts(rect(-w / 2, -h / 2, 6, h)), "ink", 0.3)
    a.outline_poly(cov, MW * 1.4, second=0)


def bubble(a, c, w, h, tail, color="paper", jag=False):
    """A speech bubble (paper) with a tail pointing at `tail`; jag=True gives a spiky, shouting outline."""
    pts = []
    n = 16
    for i in range(n):
        t = TAU * i / n
        f = (1.18 if i % 2 == 0 else 0.86) if jag else 1.0
        pts.append((c[0] + w / 2 * f * math.cos(t), c[1] + h / 2 * f * math.sin(t)))
    d = unit(sub(tail, c))
    base = add(c, (d[0] * w * 0.36, d[1] * h * 0.36))
    k = min(range(n), key=lambda i: vlen(sub(pts[i], base)))
    pts = pts[:k] + [add(base, mul(perp(d), -8)), tail, add(base, mul(perp(d), 8))] + pts[k + 1:]
    a.fill_poly(pts, color, off=(0, 0), step=12) if jag else a.fill_smooth(pts, color, off=(0, 0))
    if jag:
        a.outline_poly(pts, MW * 1.4, second=0, over=1, gap=1)
    else:
        a.outline(pts, MW * 1.4, second=0, jit=0.3)


def squiggle(a, x0, y, ln, k=0, w=MW, alpha=0.6, color="ink"):
    a.curve([(x0 + i * ln / 5, y + 2.4 * math.sin(i * 1.8 + k)) for i in range(6)], w, color, alpha, jit=0.3)


def small_flower(a, c, s=1.0, col="clay"):
    for k in range(5):
        a.fill_smooth(ellipse(polar(c, 6 * s, -90 + 72 * k), 5 * s, 3.6 * s, -90 + 72 * k, n=7), col, 0.95)
    a.dots([c], 5 * s, "ochre")


def wrapper_bit(a, c, rot=0.0):
    T = Tf(c, 1, rot)
    w = T.pts([(-9, -4), (-4, -7), (3, -5), (9, -7), (8, 3), (2, 6), (-5, 4), (-9, 6)])
    a.fill_poly(w, "clay", 0.95)
    a.outline_poly(w, MW, second=0, over=0.5, gap=0.5)
    a.zig([T((-6, -1)), T((-2, 2)), T((2, -2)), T((6, 1))], FW, "paper", 0.8)


def trash_bin(a, x, y, col="sage", w=44, h=62):
    """A swing-lid public bin (tempat sampah) standing on the ground at (x, y) (bottom centre)."""
    body = [(x - w / 2, y - h), (x + w / 2, y - h), (x + w / 2 - 4, y), (x - w / 2 + 4, y)]
    a.fill_poly(body, col)
    a.hatch(clip_half(body, (x + w * 0.2, 0), (1, 0)), 76, 4.4, alpha=0.4)
    a.lines([((x - w / 2 + 6, y - h + 16), (x + w / 2 - 6, y - h + 16))], FW * 1.4, "paper", 0.7)
    a.outline_poly(body, LW, second=0.3)
    lid = [(x - w / 2 - 4, y - h - 10), (x + w / 2 + 4, y - h - 10), (x + w / 2 + 2, y - h), (x - w / 2 - 2, y - h)]
    a.block(lid, col, w=MW * 1.4, second=0)
    a.fill_poly(rect(x - 10, y - h - 8, 20, 5), "ink", 0.55, off=(0, 0))


def gate_clock(a, c, hh, mm, r=22):
    """A wall clock without numbers: tick marks, an hour hand and a minute hand."""
    a.fill_smooth(ellipse(c, r, r, n=12), "paper", off=(0, 0))
    a.ell_outline(c, r, r, w=LW)
    a.lines([(polar(c, r * 0.78, t), polar(c, r * 0.92, t)) for t in range(-90, 270, 30)], FW * 1.3, amp=0.1)
    ma = -90 + mm * 6
    ha = -90 + (hh % 12) * 30 + mm * 0.5
    a.line(c, polar(c, r * 0.78, ma), MW * 1.3, amp=0.1)
    a.line(c, polar(c, r * 0.52, ha), LW, amp=0.1)
    a.dots([c], 4.0, "clay")


def school_gate(a, x, y=GY, open_=True, clock=None):
    """A school gate: two brick pillars and a low railing gate, a clock on the left pillar."""
    for px in (x, x + 128):
        p = rect(px - 14, y - 128, 28, 128)
        a.fill_poly(p, "clay", 0.85)
        a.hatch(p, 0, 9, alpha=0.3)
        a.outline_poly(p, LW, second=0.3)
        a.block(rect(px - 18, y - 136, 36, 10), "ochre", w=MW * 1.3, second=0)
    if open_:
        g = [(x + 14, y - 74), (x + 52, y - 66), (x + 52, y - 2), (x + 14, y - 2)]
    else:
        g = [(x + 14, y - 74), (x + 98, y - 74), (x + 98, y - 2), (x + 14, y - 2)]
    a.outline_poly(g, MW * 1.4, second=0)
    xs = [g[0][0] + (g[1][0] - g[0][0]) * t / 5 for t in range(1, 5)]
    a.lines([((xx, g[0][1] + 3), (xx, y - 3)) for xx in xs], MW, "slate", amp=0.2)
    if clock:
        gate_clock(a, (x, y - 96), *clock)


# --------------------------------------------------------------------------------------------- scenes 1-12


@scene("val_queue")
def val_queue(a):
    """Antre: three people wait in a line at a service window (loket), one behind the other, a dashed line on the
    floor; the girl at the front is next, holding her coins."""
    backdrop(a, "sage")
    loket(a)
    floor(a)
    dashes(a, [(40, GY + 12), (300, GY + 12)], MW, "slate", 0.6)
    kid(a, 102, facing=1, look=0.6, top_col="ochre", bottom="shorts", bottom_col="slate", shoes="clay",
        extras={"stripe": "paper"}, tone="deep")
    adult(a, 182, facing=1, look=0.6, top="shirt", top_col="slate", bottom="trousers", bottom_col="ochre", shoes="clay",
          extras={"collar": "slate", "placket": True}, hands=("round", "round"), tone="mid")

    def coins(F):
        coin(a, add(F.hd[1], (6, -6)))

    kid(a, 268, facing=1, look=0.7, top="dress", top_col="sage", bottom="none", hair="kerudung", ker_col="clay",
        shoes="slate", mid=coins, pose={"arms": ((104, 96), ("ik", (296, 196), -1))}, tone="light")


@scene("val_cut_queue")
def val_cut_queue(a):
    """Menyerobot antrean (gently): a woman and a child wait at the loket; a boy hurries in from the side and steps in
    front of them. Motion lines show his hurry; the woman lifts a hand in surprise. Nobody is angry."""
    backdrop(a, "ochre", 0.12)
    loket(a)
    floor(a)
    dashes(a, [(30, GY + 12), (300, GY + 12)], MW, "slate", 0.6)
    kid(a, 70, facing=1, look=0.5, top_col="sage", bottom="shorts", bottom_col="clay", shoes="slate", expr="hungry",
        tone="mid")
    adult(a, 150, facing=1, look=0.4, top="blouse", top_col="ochre", sleeve="long", bottom="skirt", bottom_col="slate",
          hair="kerudung", ker_col="sage", shoes="clay", expr="hungry",
          pose={"arms": ((100, 94), ("ik", (196, 150), -1))}, hands=("round", "open"), tone="deep")
    kid(a, 262, facing=1, look=0.8, top_col="clay", bottom="shorts", bottom_col="slate", shoes="ochre", expr="grin",
        pose={"lean": 10, "arms": ((140, 120), (40, 20)), "legs": ((140, 110), (66, 92)), "behind": ("arm0", "leg0")},
        tone="light")
    a.lines([((206, 150), (226, 150)), ((200, 170), (224, 170)), ((208, 190), (226, 190))], MW * 1.3, alpha=0.7)


def bus_inside(a):
    """Inside a bus or angkot: a band of windows, a grab pole, a bench seat on the left."""
    band = [(0, 46), (400, 42), (400, 130), (0, 134)]
    a.fill_poly(band, "ochre", 0.3)
    for x in (16, 140, 264):
        w = [(x, 56), (x + 112, 54), (x + 112, 118), (x, 120)]
        a.fill_poly(w, "slate", 0.3)
        a.hatch(w, 60, 9, color="paper", alpha=0.4)
        a.outline_poly(w, MW * 1.4, second=0)
    a.line((0, 136), (400, 132), LW, amp=0.6)
    a.blob(capsule((160, 30), (162, GY), 4), "slate", w=MW * 1.2, second=0)
    a.line((0, 34), (400, 32), MW * 1.3, amp=0.5)
    for x in (100, 330):
        a.curve([(x, 34), (x, 50)], MW)
        a.ell((x, 58), 7, 8, "ochre", w=MW * 1.2, second=0)


def bench(a, x0, x1, y, col="clay", back=True):
    seat = [(x0, y), (x1, y - 2), (x1, y + 12), (x0, y + 14)]
    a.block(seat, col, w=MW * 1.4, second=0)
    for x in (x0 + 10, x1 - 12):
        a.blob(capsule((x, y + 12), (x, GY), 4), "slate", w=MW * 1.1, second=0)
    if back:
        bk = [(x0, y - 50), (x0 + 10, y - 52), (x0 + 10, y), (x0, y)]
        a.block(bk, col, w=MW * 1.4, second=0)


@scene("val_give_seat")
def val_give_seat(a):
    """Memberi tempat duduk: inside a bus, a boy has stood up from his seat and offers it with an open hand to a
    grandmother with a walking stick, who smiles."""
    bus_inside(a)
    floor(a, marks=6)
    bench(a, 18, 150, 196)
    kid(a, 196, facing=1, look=0.6, top_col="sage", bottom="trousers", bottom_col="slate", shoes="clay", expr="smile",
        pose={"arms": (("ik", (148, 192), -1), (80, 86))}, hands=("open", "round"), extras={"stripe": "ochre"},
        tone="mid")

    def stick(F):
        a.blob(capsule(F.hd[1], (F.hd[1][0] + 6, GY), 3.4), "ochre", w=MW, second=0)
        a.curve([add(F.hd[1], (-6, -4)), add(F.hd[1], (2, -12)), add(F.hd[1], (10, -6))], 5, "ochre")

    adult(a, 300, facing=-1, look=-0.6, top="blouse", top_col="clay", sleeve="long", bottom="skirt",
          bottom_col="sage", hair="kerudung", ker_col="paper", shoes="slate", expr="happy", old=True, mid=stick,
          pose={"lean": -6, "arms": ((86, 80), ("ik", (338, 200), 1))}, tone="light")


def zebra(a, y0=212, y1=GY + 26):
    road = [(0, y0), (400, y0 - 4), (400, 300), (0, 300)]
    a.fill_poly(road, "slate", 0.45, off=(0, 0), step=40)
    for i in range(7):
        x = 40 + i * 48
        st = [(x, y0 + 4), (x + 26, y0 + 3), (x + 34, y1), (x + 4, y1)]
        a.fill_poly(st, "paper", 0.95, off=(0, 0))
    a.line((0, y0), (400, y0 - 4), MW * 1.3, amp=0.5)


@scene("val_help_cross")
def val_help_cross(a):
    """Membantu menyeberang: on the zebra crossing a girl walks an elderly man across the road, his arm through hers;
    he has a peci and a walking stick."""
    backdrop(a, "sage", 0.12, cy=130, ry=80)
    zebra(a)
    gy = 274
    adult(a, 236, gy, facing=1, look=0.5, top="shirt", top_col="sage", bottom="sarung", bottom_col="clay",
          hair="peci", shoes="slate", expr="smile", old=True,
          pose={"lean": 3, "arms": (("ik", (206, 190), 1), ("ik", (270, 214), -1)),
                "legs": ((80, 88), (104, 96)), "behind": ("arm0",)}, tone="deep")
    a.blob(capsule((272, 210), (280, gy + 2), 3.4), "ochre", w=MW, second=0)
    kid(a, 164, gy, facing=1, look=0.7, top_col="ochre", bottom="trousers", bottom_col="slate", hair="ponytail",
        shoes="clay", expr="smile", pose=dict(WALK_R, arms=((116, 102), ("ik", (204, 196), -1))), tone="light")


@scene("val_say_thanks")
def val_say_thanks(a):
    """Berterima kasih: an aunt hands a boy a small wrapped gift; he takes it with both hands, bows his head a little
    and smiles with closed eyes."""
    backdrop(a, "ochre", 0.12)
    floor(a)

    def gift(F):
        g = rect(176, 170, 40, 32)
        a.block(g, "ochre", w=MW * 1.4, second=0)
        a.lines([((196, 170), (196, 202)), ((176, 186), (216, 186))], 3.2, "clay", amp=0.2)
        a.curve([(196, 170), (186, 160), (196, 164), (206, 158), (198, 170)], MW * 1.1, "clay", jit=0.2)

    kid(a, 142, facing=1, look=0.4, top_col="clay", bottom="shorts", bottom_col="slate", shoes="ochre", expr="thanks",
        mid=gift, pose={"lean": 8, "head": 10, "arms": (("ik", (178, 194), 1), ("ik", (190, 202), -1))}, tone="deep")
    adult(a, 262, facing=-1, look=-0.5, top="blouse", top_col="sage", sleeve="long", bottom="skirt", bottom_col="clay",
          hair="bun", shoes="slate", expr="happy", pose={"arms": ((96, 86), ("ik", (214, 188), 1))}, tone="mid")


def cup_tipped(a, c):
    puddle = [polar(add(c, (-26, 6)), 26 + a.j(3), t, 6) for t in range(0, 360, 30)]
    a.fill_smooth(puddle, "slate", 0.45)
    a.outline(puddle, FW * 1.3, second=0, jit=0.3)
    T = Tf(c, 1, -78)
    cup = T.pts([(-11, -14), (11, -14), (9, 14), (-9, 14)])
    a.block(cup, "ochre", w=MW * 1.4, second=0)
    a.ell(T((0, -14)), 11, 3.5, rot=-78, w=MW, second=0)


@scene("val_say_sorry")
def val_say_sorry(a):
    """Meminta maaf: a boy has knocked over his friend's cup (a small puddle on the floor). He scratches the back of
    his head, a little shy, and holds out his hand; she smiles and reaches to shake it."""
    backdrop(a, "slate", 0.1)
    floor(a)
    cup_tipped(a, (204, GY - 8))
    kid(a, 128, facing=1, look=0.5, top_col="ochre", bottom="shorts", bottom_col="sage", shoes="clay", expr="shy",
        pose={"head": -6, "arms": (("ik", add(head_of(128, True, {"head": -6}, 1), (-24, -2)), 1),
                                   ("ik", (196, 192), -1))}, tone="mid")
    kid(a, 270, facing=-1, look=-0.5, top="dress", top_col="clay", bottom="none", hair="bob", shoes="slate",
        expr="smile", pose={"arms": (("ik", (206, 190), 1), (82, 90))}, tone="deep")
    drop(a, (110, 98), 6, "slate", -20)


def lunchbox(a, c, rot=0.0):
    T = Tf(c, 1, rot)
    box = T.pts(rect(-22, -6, 44, 22))
    a.block(box, "sage", w=MW * 1.4, second=0)
    lid = T.pts(rect(-22, -14, 44, 8))
    a.block(lid, "sage", 0.7, w=MW * 1.2, second=0)
    for dx in (-12, 0, 12):
        a.ell(T((dx, -1)), 5, 3.5, "ochre", w=FW * 1.3, second=0)


@scene("val_share_food")
def val_share_food(a):
    """Berbagi: at recess a girl holds her open lunchbox and offers her friend a piece of kue; he reaches for it,
    smiling."""
    backdrop(a, "sage", 0.13)
    floor(a)

    def box(F):
        lunchbox(a, add(F.hd[0], (6, -4)), -4)

    F = kid(a, 132, facing=1, look=0.5, top="dress", top_col="ochre", bottom="none", hair="kerudung", ker_col="sage",
            shoes="clay", expr="happy", mid=box,
            pose={"arms": (("ik", (150, 196), 1), ("ik", (196, 176), -1))}, tone="mid")
    a.ell(add(F.hd[1], (8, -4)), 8, 6, "ochre", w=MW * 1.2, second=0)
    kid(a, 270, facing=-1, look=-0.5, top_col="slate", bottom="shorts", bottom_col="clay", shoes="ochre", expr="grin",
        pose={"arms": (("ik", (216, 178), 1), (80, 88))}, tone="light")


@scene("val_return_wallet")
def val_return_wallet(a):
    """Mengembalikan dompet: on the pavement a boy holds out a wallet he found to the man who dropped it; the man,
    carrying a market bag, turns back, glad and surprised."""
    backdrop(a, "ochre", 0.12)
    floor(a)

    def wallet(F):
        w = Tf(F.hd[1], 1, -10)
        a.block(w.pts(rect(-4, -14, 30, 20)), "slate", w=MW * 1.4, second=0)
        a.line(w((-4, -6)), w((26, -6)), FW * 1.3, "paper", 0.8)

    kid(a, 130, facing=1, look=0.6, top_col="sage", bottom="shorts", bottom_col="slate", shoes="clay", expr="smile",
        mid=wallet, pose={"arms": ((104, 96), ("ik", (178, 178), -1))}, extras={"stripe": "clay"}, tone="deep")

    def bag(F):
        h = F.hd[1]
        b = [add(h, (-20, 4)), add(h, (20, 4)), add(h, (24, 52)), add(h, (-24, 52))]
        a.block(b, "ochre", w=MW * 1.4, second=0)
        a.hatch(b, 0, 6, alpha=0.3)
        a.curve([add(h, (-12, 4)), add(h, (0, -6)), add(h, (12, 4))], MW * 1.2)
        a.blob([add(h, p) for p in ((-6, 4), (0, -14), (8, -10), (4, 4))], "sage", w=MW, second=0)

    adult(a, 268, facing=-1, look=-0.6, top="shirt", top_col="clay", bottom="trousers", bottom_col="slate",
          shoes="ochre", expr="happy", mid=bag, extras={"collar": "clay", "placket": True},
          pose={"lean": -3, "arms": (("ik", (196, 170), 1), ((80, 92)))}, hands=("open", "round"), tone="mid")


def warung_counter(a, x0, x1, y):
    front = [(x0, y), (x1, y - 2), (x1, GY), (x0, GY)]
    a.fill_poly(front, "ochre", 0.9)
    a.hatch(front, 0, 10, alpha=0.3)
    a.outline_poly(front, LW, second=0.3)
    top = [(x0 - 6, y - 8), (x1 + 6, y - 10), (x1 + 6, y), (x0 - 6, y + 2)]
    a.block(top, "clay", w=MW * 1.4, second=0)
    for i, jx in enumerate((x0 + 30, x0 + 66)):
        jar = [(jx - 13, y - 10), (jx - 14, y - 40), (jx - 8, y - 46), (jx + 8, y - 46), (jx + 14, y - 40),
               (jx + 13, y - 10)]
        a.fill_smooth(jar, "paper", 0.6, off=(0, 0))
        for k in range(3):
            a.ell((jx - 5 + k * 5, y - 18 - (k % 2) * 6), 4, 3, ("clay", "ochre", "sage")[k], w=FW, second=0)
        a.outline(jar, MW * 1.3, second=0)
        a.block(rect(jx - 9, y - 52, 18, 7), "slate", w=MW, second=0)


@scene("val_return_change")
def val_return_change(a):
    """Mengembalikan kelebihan kembalian: at a warung counter a woman gives back the extra note the seller handed her by
    mistake; the seller, behind the counter, is pleasantly surprised."""
    backdrop(a, "sage", 0.13)
    floor(a, x0=14, x1=210, marks=4)
    adult(a, 300, facing=-1, look=-0.5, top="shirt", top_col="slate", bottom="trousers", bottom_col="clay",
          hair="peci", shoes="clay", expr="happy", cut=200, extras={"collar": "slate"},
          pose={"arms": ((84, 96), ("ik", (236, 168), 1))}, hands=("round", "open"), tone="deep")
    warung_counter(a, 190, 392, 196)

    def money(F):
        note(a, add(F.hd[1], (10, -6)), -12, "sage")

    adult(a, 112, facing=1, look=0.5, top="blouse", top_col="ochre", sleeve="long", bottom="skirt", bottom_col="sage",
          hair="kerudung", ker_col="clay", shoes="slate", expr="smile", mid=money,
          pose={"arms": ((100, 92), ("ik", (196, 172), -1))}, tone="light")


def flower_pot_broken(a, c):
    for p, rot in (((-26, 2), -30), ((4, 8), 20), ((26, 0), 70)):
        sh = Tf(add(c, p), 1, rot).pts([(-14, -6), (12, -8), (14, 4), (-12, 8)])
        a.block(sh, "clay", w=MW * 1.4, second=0)
    soil = [polar(add(c, (-2, -6)), 22, t, 8) for t in range(180, 361, 30)]
    a.fill_smooth(soil + [add(c, (20, -4)), add(c, (-24, -4))], "ink", 0.55)
    a.stipple(soil, 6, 2, alpha=0.7)
    st = add(c, (0, -10))
    a.curve([st, add(st, (6, -14)), add(st, (18, -20))], MW * 1.2)
    lp = leaf_pts(add(st, (10, -16)), add(st, (34, -26)), 6)
    a.fill_smooth(lp, "sage")
    a.outline(lp, MW, second=0, jit=0.2)


@scene("val_tell_truth")
def val_tell_truth(a):
    """Berkata jujur: a flower pot lies broken on the floor; the child points to it and tells his mother what happened,
    a hand on his chest; she bends a little to listen, calm."""
    backdrop(a, "ochre", 0.12)
    floor(a)
    flower_pot_broken(a, (82, GY - 6))
    kid(a, 168, facing=1, look=0.5, top_col="slate", bottom="shorts", bottom_col="ochre", shoes="clay", expr="down",
        pose={"head": 4, "arms": (("ik", (104, 214), 1), ("ik", (180, 178), 1)), "behind": ("arm0",)},
        hands=("point", "round"), tone="mid")
    adult(a, 282, facing=-1, look=-0.6, top="blouse", top_col="clay", sleeve="long", bottom="skirt", bottom_col="sage",
          hair="kerudung", ker_col="ochre", shoes="slate", expr="smile",
          pose={"lean": -10, "head": -6, "arms": ((96, 84), ("ik", (218, 186), 1))}, hands=("round", "open"),
          tone="deep")


def school_desk(a, x0, x1, y, col="ochre"):
    top = [(x0, y), (x1, y - 2), (x1 + 8, y + 12), (x0 - 8, y + 14)]
    a.block(top, col, w=LW, second=0.3)
    a.fill_poly([(x0, y + 14), (x1, y + 12), (x1, y + 60), (x0, y + 62)], col, 0.5)
    a.lines([((x0 + 4, y + 14), (x0 + 4, GY)), ((x1 - 4, y + 12), (x1 - 4, GY))], LW, amp=0.3)


@scene("val_copy_answer")
def val_copy_answer(a):
    """Menyontek (gently): two pupils in uniform at one desk during a test; the boy leans over, eyes on his neighbour's
    paper; she keeps writing."""
    backdrop(a, "slate", 0.1)
    board = [(110, 34), (300, 32), (302, 78), (112, 80)]
    a.fill_poly(board, "sage", 0.6)
    a.outline_poly(board, MW * 1.4, second=0)
    floor(a, marks=6)
    kid(a, r=26, head=(126, 120), cut=226, top="shirt", top_col="paper", sleeve="short", expr="smile", look=0.9,
        pose={"lean": 14, "head": 10, "arms": (("ik", (146, 210), 1), ("ik", (196, 212), -1))},
        extras={"collar": "paper"}, tone="light")
    kid(a, r=26, head=(272, 122), cut=226, top="shirt", top_col="paper", sleeve="short", hair="ponytail", expr="smile",
        look=-0.3, pose={"head": 6, "arms": (("ik", (240, 214), 1), ("ik", (288, 212), -1))},
        extras={"collar": "paper"},
        tone="mid")
    school_desk(a, 40, 360, 212)
    for c, rot in (((170, 206), -4), ((262, 206), 3)):
        T = Tf(c, 1, rot)
        sh = T.pts(rect(-30, -8, 60, 14))
        a.fill_poly(sh, "paper", off=(0, 0))
        a.outline_poly(sh, MW * 1.2, second=0)
        a.lines([(T((-24, -4 + k * 4)), T((18 - k * 6, -4 + k * 4))) for k in range(3)], FW, alpha=0.5, amp=0.2)
    a.blob(capsule((282, 212), (300, 192), 2.6), "clay", w=MW, second=0)
    dashes(a, [(150, 122), (200, 150), (248, 196)], MW, "ink", 0.55, on=5, off=5)


@scene("val_clean_up")
def val_clean_up(a):
    """Membersihkan kelas: after school a girl sweeps the floor with a broom into a small pile of dust; a boy puts
    books back on the shelf."""
    backdrop(a, "ochre", 0.12)
    floor(a)
    shelf_x = 286
    for y in (120, 170, 220):
        a.block(rect(shelf_x, y, 96, 8), "ochre", w=MW * 1.3, second=0)
    a.lines([((shelf_x + 2, 112), (shelf_x + 2, GY)), ((shelf_x + 94, 112), (shelf_x + 94, GY))], LW, amp=0.3)
    for i, (x, h, col) in enumerate(((300, 34, "clay"), (312, 30, "sage"), (322, 36, "slate"), (336, 28, "ochre"))):
        a.block(rect(x, 170 - h, 10, h), col, w=MW, second=0)
    for i, (x, h, col) in enumerate(((298, 32, "sage"), (310, 34, "clay"), (352, 30, "slate"))):
        a.block(rect(x, 220 - h, 11, h), col, w=MW, second=0)

    def books(F):
        book_closed(a, add(F.hd[1], (6, -4)), -80, "clay", 26, 34)

    kid(a, 248, facing=1, look=0.6, top="shirt", top_col="paper", bottom="shorts", bottom_col="clay", shoes="slate",
        mid=books, pose={"arms": ((104, 96), ("ik", (318, 104), -1))}, extras={"collar": "paper"}, tone="deep")

    def broom(F):
        top_, bot = (140, 150), (60, GY - 6)
        a.blob(capsule(top_, bot, 3.2), "ochre", w=MW, second=0)
        fan = [add(bot, (-4, -6)), add(bot, (8, -6)), add(bot, (2, 12)), add(bot, (-26, 12))]
        a.fill_poly(fan, "ochre", 0.9)
        a.lines([(add(bot, (0, -4)), add(bot, (dx, 12))) for dx in (-22, -14, -6, 2)], FW * 1.3, alpha=0.8)
        a.outline_poly(fan, MW * 1.2, second=0)

    kid(a, 124, facing=-1, look=-0.5, top="dress", top_col="sage", bottom="none", hair="kerudung", ker_col="ochre",
        shoes="clay", mid=broom, pose={"lean": -6, "arms": (("ik", (108, 196), 1), ("ik", (126, 170), -1))},
        tone="mid")
    a.stipple([(18, GY - 4), (44, GY - 10), (48, GY), (16, GY + 2)], 10, 2.4, alpha=0.7)


# --------------------------------------------------------------------------------------------- scenes 13-24


def head_of(cx, kid_, pose, facing=0, r=None, gy=GY):
    """Where figure() will put the head centre for this pose (to aim a hand at the head before drawing)."""
    r = r or (KR if kid_ else AR)
    return Fig(cx, gy, r, kid_, dict(STAND, **(pose or {})), facing).hc


@scene("val_throw_trash")
def val_throw_trash(a):
    """Membuang sampah pada tempatnya: a girl drops a snack wrapper into a bin at the school yard; a second bin stands
    beside it."""
    backdrop(a, "sage")
    floor(a)
    trash_bin(a, 262, GY, "sage")
    trash_bin(a, 330, GY, "ochre")
    kid(a, 176, facing=1, look=0.6, top="dress", top_col="clay", bottom="none", hair="ponytail", shoes="slate",
        expr="smile", pose={"arms": ((104, 96), ("ik", (246, 168), -1))}, hands=("round", "open"), tone="deep")
    wrapper_bit(a, (258, 176), 20)
    a.lines([((250, 186), (252, 196)), ((262, 188), (262, 198))], FW * 1.3, alpha=0.7)


@scene("val_litter")
def val_litter(a):
    """Membuang sampah sembarangan (gently): a boy walks on eating a snack and lets the wrapper fall to the ground
    behind him, though a bin stands close by."""
    backdrop(a, "ochre", 0.12)
    floor(a)
    trash_bin(a, 330, GY, "sage")
    kid(a, 214, facing=1, look=0.6, top_col="sage", bottom="shorts", bottom_col="slate", shoes="clay", expr="eat",
        pose=dict(WALK_R, arms=((128, 140), ("ik", (236, 150), -1))), extras={"stripe": "ochre"}, tone="mid")
    a.block(Tf((240, 146), 1, -20).pts(rect(-6, -10, 12, 20)), "clay", w=MW * 1.2, second=0)
    wrapper_bit(a, (124, 226), -30)
    wrapper_bit(a, (96, GY - 4), 10)
    a.curve([(134, 214), (128, 220), (122, 216)], FW * 1.3, alpha=0.7)
    dashes(a, [(140, 200), (126, 212), (112, 236), (100, 258)], FW * 1.3, "ink", 0.6, on=4, off=4)


@scene("val_listen")
def val_listen(a):
    """Mendengarkan: a girl tells her friend something, a speech bubble of squiggles; he faces her, still and attentive,
    with a small nod."""
    backdrop(a, "sage", 0.12, cy=176)
    kid(a, r=33, head=(116, 132), cut=300, top="dress", top_col="ochre", hair="bob", expr="eat", look=0.5,
        pose={"arms": ((100, 94), ("ik", (176, 220), -1))}, hands=("round", "open"), tone="light")
    kid(a, r=33, head=(292, 136), cut=300, top_col="slate", hair="short", expr="smile", look=-0.6,
        pose={"head": 6, "arms": ((100, 94), (80, 86))}, extras={"stripe": "clay"}, tone="deep")
    bubble(a, (196, 58), 104, 56, (152, 104))
    for k, ln in enumerate((70, 54)):
        squiggle(a, 160, 50 + k * 14, ln, k)
    motion_arcs(a, (254, 130), 14, 150, 210, w=FW * 1.4, alpha=0.7)


@scene("val_interrupt")
def val_interrupt(a):
    """Memotong pembicaraan (gently): two friends are talking when a third pushes in between them, hand up and mouth
    wide, his big spiky bubble covering theirs; the other two stop, surprised."""
    backdrop(a, "ochre", 0.12, cy=176)
    kid(a, r=30, head=(84, 140), cut=300, top="dress", top_col="sage", hair="kerudung", ker_col="clay", expr="hungry",
        look=0.5, tone="mid")
    kid(a, r=30, head=(318, 142), cut=300, top_col="ochre", hair="short", expr="hungry", look=-0.5, tone="light")
    bubble(a, (110, 66), 70, 40, (96, 104))
    squiggle(a, 86, 64, 46)
    kid(a, r=32, head=(204, 150), cut=300, top_col="clay", hair="short", expr="hot", look=0.1,
        pose={"head": -4, "arms": ((100, 94), (-70, -96))}, hands=("round", "open"), tone="deep")
    bubble(a, (228, 60), 112, 64, (214, 112), jag=True)
    a.zig([(190, 56), (204, 66), (218, 52), (232, 66), (246, 52), (262, 64)], MW * 1.4, jit=0.3)


def swing(a, x, top=78):
    a.blob(capsule((x - 74, top - 6), (x + 74, top - 6), 5), "ochre", w=MW * 1.3, second=0)
    for px, dx in ((x - 70, -18), (x + 70, 18)):
        a.blob(capsule((px, top - 6), (px + dx, GY), 4.5), "ochre", w=MW * 1.2, second=0)


@scene("val_wait_turn")
def val_wait_turn(a):
    """Menunggu giliran: at the playground one girl is on the swing; a boy waits beside it, hands behind his back,
    smiling, for his turn."""
    backdrop(a, "sage")
    floor(a)
    swing(a, 147, top=52)
    seat_y = 192
    for x in (122, 172):
        a.line((x, 46), (x + 1, seat_y), MW * 1.1, amp=0.4)
    a.block([(108, seat_y), (186, seat_y - 2), (186, seat_y + 8), (108, seat_y + 10)], "clay", w=MW * 1.3, second=0)
    pose = {"arms": (("ik", (122, 176), 1), ("ik", (172, 176), -1)), "legs": ((84, 100), (96, 80))}
    F = Fig(147, GY, KR, True, dict(STAND, **pose), 0)
    dy = (seat_y - 2) - F.hip[1]
    kid(a, r=KR, hip=(147, F.hip[1] + dy), look=0.3, top="dress", top_col="ochre", bottom="none", hair="ponytail",
        shoes="slate", expr="happy", pose=pose, tone="mid")
    kid(a, 316, facing=-1, look=-0.6, top_col="slate", bottom="shorts", bottom_col="sage", shoes="clay", expr="smile",
        pose={"arms": ((118, 60), (62, 120)), "behind": ("arm0", "arm1")}, tone="deep")


@scene("val_help_friend")
def val_help_friend(a):
    """Menolong teman: a girl is carrying a tall, wobbling stack of books; her friend takes the top half off her
    hands."""
    backdrop(a, "ochre", 0.12)
    floor(a)

    def stack(F):
        for k, col in enumerate(("clay", "sage", "slate", "ochre")):
            book_closed(a, (166 + (k % 2) * 4 - k * 2, 184 - k * 14), 90 + (k % 2) * 6 - 3, col, 13, 52)

    kid(a, 122, facing=1, look=0.6, top="dress", top_col="sage", bottom="none", hair="kerudung", ker_col="ochre",
        shoes="clay", expr="smile", mid=stack, pose={"arms": (("ik", (146, 196), 1), ("ik", (188, 194), -1))},
        tone="light")
    for k, col in enumerate(("clay", "ochre")):
        book_closed(a, (214 - k * 3, 132 - k * 14), 90 + k * 4, col, 13, 52)
    kid(a, 296, facing=-1, look=-0.6, top_col="ochre", bottom="shorts", bottom_col="slate", shoes="slate", expr="grin",
        pose={"arms": (("ik", (186, 130), 1), ("ik", (242, 128), 1))}, extras={"stripe": "paper"}, tone="mid")
    motion_arcs(a, (150, 112), 18, 200, 250, w=FW * 1.4, alpha=0.7)


def ball(a, c, r=14, col="clay"):
    round_ball(a, c, r, col, w=MW * 1.3)
    a.curve([polar(c, r * 0.6, t) for t in (200, 225, 250)], 2.4, "paper", 0.9, jit=0.1)


@scene("val_include_friend")
def val_include_friend(a):
    """Mengajak teman bermain: two children are playing ball; one turns and waves the new child over with an open hand,
    and she smiles and comes closer."""
    backdrop(a, "sage")
    floor(a)
    kid(a, 64, facing=1, look=0.6, top_col="clay", bottom="shorts", bottom_col="slate", shoes="ochre", expr="grin",
        pose={"arms": ((116, 100), (60, 40))}, tone="light")
    ball(a, (122, GY - 14))
    kid(a, 196, facing=1, look=0.7, top_col="ochre", bottom="shorts", bottom_col="sage", shoes="clay", expr="happy",
        pose={"arms": ((112, 100), (-40, -70))}, hands=("round", "open"), tone="deep")
    motion_arcs(a, (252, 112), 18, -60, 0, w=FW * 1.4, alpha=0.8)
    kid(a, 330, facing=-1, look=-0.6, top="dress", top_col="sage", bottom="none", hair="kerudung", ker_col="clay",
        shoes="slate", expr="smile", pose=dict(WALK_L, lean=-3), tone="mid")


@scene("val_left_out")
def val_left_out(a):
    """Dikucilkan (gently): two children play ball together, turned to each other; a third sits alone on a bench at
    the side, watching them, quiet and a little sad. No tears, no one is unkind on purpose."""
    backdrop(a, "slate", 0.1)
    floor(a)
    bench(a, 20, 120, 210, "ochre", back=False)
    pose = {"arms": ((80, 30), (76, 24)), "legs": ((-4, 90), (2, 92)), "behind": ("arm0", "leg0")}
    F = Fig(56, GY, KR, True, dict(STAND, **pose), 1)
    dy = 208 - (F.hip[1] + KR * 0.32)
    kid(a, r=KR, hip=(56, F.hip[1] + dy), facing=1, look=0.7, top_col="slate", bottom="trousers", bottom_col="sage",
        shoes="clay", expr="down", pose=dict(pose, head=8), tone="deep")
    kid(a, 236, facing=1, look=0.6, top_col="ochre", bottom="shorts", bottom_col="slate", shoes="clay", expr="grin",
        pose={"arms": ((60, 20), (120, 160))}, tone="mid")
    ball(a, (292, 170))
    kid(a, 350, facing=-1, look=-0.6, top="dress", top_col="clay", bottom="none", hair="ponytail", shoes="slate",
        expr="happy", pose={"arms": ((-60, -80), (100, 90)), "behind": ("arm1",)}, hands=("open", "round"),
        tone="light")


@scene("val_keep_promise")
def val_keep_promise(a):
    """Janji (menepati janji): two friends, close up, hook their little fingers together, a pinky promise, both
    smiling."""
    backdrop(a, "ochre", 0.13, cy=180)
    kid(a, r=36, head=(104, 124), cut=300, top_col="sage", hair="short", expr="happy", look=0.6,
        pose={"arms": ((100, 94), ("ik", (186, 200), -1))}, hands=("round", "none"), extras={"stripe": "ochre"},
        tone="deep")
    kid(a, r=36, head=(300, 128), cut=300, top="dress", top_col="clay", hair="kerudung", ker_col="ochre", expr="happy",
        look=-0.6, pose={"arms": (("ik", (214, 200), 1), (80, 86))}, hands=("none", "round"), tone="light")
    for sx, cx in ((-1, 184), (1, 216)):
        a.tone = "deep" if sx < 0 else "light"
        fist = ellipse((cx, 204), 15, 14, n=10)
        skin_parts(a, [fist])
        a.outline(fist, MW * 1.4, second=0, jit=0.2)
        a.curve([(cx - sx * 8, 196), (cx - sx * 2, 204), (cx - sx * 8, 212)], FW * 1.4, alpha=0.8)
    a.tone = "mid"
    for tone, pts in (("deep", [(190, 196), (192, 182), (200, 176), (208, 180)]),
                      ("light", [(210, 196), (208, 184), (200, 186), (194, 182)])):
        a.tone = tone
        fing = ribbon(pts, 8, 7)
        skin_parts(a, [fing])
        a.outline(fing, MW * 1.2, second=0, jit=0.15)
    a.tone = "mid"
    for r in (12, 18):
        a.arc((200, 186), r, -150, -30, FW * 1.4, alpha=0.7)


@scene("val_on_time")
def val_on_time(a):
    """Tepat waktu: a boy in school uniform walks in through the open school gate early; the clock on the pillar shows
    a quarter to seven, and the teacher at the gate waves good morning."""
    backdrop(a, "sage")
    floor(a)
    school_gate(a, 92, clock=(6, 45))
    kid(a, 180, facing=1, look=0.6, top="shirt", top_col="paper", bottom="shorts", bottom_col="clay", shoes="slate",
        expr="smile", extras={"collar": "paper"},
        pose=dict(WALK_R, arms=(("ik", (166, 186), 1), (58, 40))), tone="mid")
    a.block([(146, 134), (170, 130), (172, 176), (146, 180)], "ochre", w=MW * 1.4, second=0)
    adult(a, 318, facing=-1, look=-0.6, top="blouse", top_col="sage", sleeve="long", bottom="skirt", bottom_col="slate",
          hair="kerudung", ker_col="clay", shoes="clay", expr="happy",
          pose={"arms": ((-50, -100), (84, 88))}, hands=("open", "round"), tone="light")


@scene("val_late")
def val_late(a):
    """Terlambat (gently): the clock on the school gate is already past seven and the gate is closing; a girl runs for
    it, bag bouncing, a sweat drop flying."""
    backdrop(a, "ochre", 0.12)
    floor(a)
    school_gate(a, 236, open_=False, clock=(7, 20))
    kid(a, 140, GY - 6, r=26, facing=1, look=0.7, top="shirt", top_col="paper", bottom="shorts", bottom_col="clay",
        shoes="slate", expr="hot", extras={"collar": "paper"},
        pose={"lean": 15, "arms": ((44, -36), (136, 76)), "legs": ((126, 168), (26, 98)), "behind": ("arm0", "leg0")},
        tone="deep")
    a.block([(96, 128), (118, 122), (122, 162), (98, 168)], "ochre", w=MW * 1.4, second=0)
    a.lines([((28, 150), (60, 150)), ((20, 172), (56, 172)), ((32, 194), (60, 194))], MW * 1.3, alpha=0.7)
    drop(a, (178, 84), 6.5, "slate", 30)


@scene("val_borrow_return")
def val_borrow_return(a):
    """Mengembalikan barang pinjaman: a girl gives back the umbrella she borrowed, neatly rolled, with both hands; her
    friend takes it and smiles."""
    backdrop(a, "slate", 0.1)
    floor(a)

    def umbrella(F):
        T = Tf((146, 184), 1.3, -6)
        a.line(T((0, 0)), T((96, 0)), MW * 1.3, amp=0.2)
        canopy = T.pts([(30, 0), (44, -7), (70, -6), (92, -2), (100, 0), (92, 2), (70, 6), (44, 7)])
        a.fill_smooth(canopy, "slate", 0.95)
        a.lines([(T((46, -4)), T((90, -1))), (T((46, 3)), T((88, 1)))], FW, "paper", 0.6)
        a.outline(canopy, MW * 1.4, second=0, jit=0.2)
        a.block(T.pts(rect(58, -8, 6, 16)), "clay", w=FW * 1.3, second=0)
        a.curve(T.pts([(0, 0), (-8, 2), (-10, 12), (-4, 18)]), 5.0, "ochre", jit=0.2)
        a.curve(T.pts([(0, 0), (-8, 2), (-10, 12), (-4, 18)]), FW * 1.2, jit=0.2)

    kid(a, 112, facing=1, look=0.6, top="dress", top_col="ochre", bottom="none", hair="bob", shoes="clay", expr="smile",
        mid=umbrella, pose={"lean": 4, "arms": (("ik", (160, 186), 1), ("ik", (196, 180), -1))}, tone="mid")
    kid(a, 296, facing=-1, look=-0.6, top_col="clay", bottom="shorts", bottom_col="slate", shoes="ochre", expr="happy",
        pose={"arms": (("ik", (244, 176), 1), (80, 88))}, hands=("open", "round"), tone="light")


# --------------------------------------------------------------------------------------------- scenes 25-36


@scene("val_gotong_royong")
def val_gotong_royong(a):
    """Gotong royong: kerja bakti in the kampung. Two neighbours carry a long bamboo pole together on their shoulders;
    a boy walks alongside with a bucket to help."""
    backdrop(a, "sage")
    floor(a)
    roof = [(250, 44), (330, 18), (404, 44), (404, 52), (250, 52)]
    a.fill_poly(roof, "clay", 0.8)
    a.hatch(roof, 0, 6, alpha=0.35)
    a.outline_poly(roof, MW * 1.4, closed=False, second=0)
    a.fill_poly([(262, 52), (404, 52), (404, 120), (262, 120)], "ochre", 0.3)
    pole = [(20, 136), (210, 131), (388, 126)]
    adult(a, 84, facing=1, look=0.5, top="shirt", top_col="sage", bottom="trousers", bottom_col="slate", hair="short",
          shoes="clay", expr="smile", pose=dict(WALK_R, arms=(("ik", (104, 128), -1), (60, 46))), tone="deep")
    a.blob(ribbon(pole, 13, 11), "ochre", w=MW * 1.4, second=0)
    a.lines([((150, 127), (150, 141)), ((250, 123), (250, 137)), ((370, 120), (370, 133))], MW, amp=0.2)
    adult(a, 326, facing=1, look=0.5, top="tshirt", top_col="clay", bottom="trousers", bottom_col="ochre", hair="peci",
          shoes="slate", expr="happy", pose=dict(WALK_R, arms=(("ik", (352, 126), -1), (58, 42))), tone="light")

    def bucket(F):
        h = F.hd[1]
        b = [add(h, (-14, 12)), add(h, (14, 12)), add(h, (11, 40)), add(h, (-11, 40))]
        a.block(b, "slate", w=MW * 1.4, second=0)
        a.arc(add(h, (0, 12)), 14, 180, 360, MW * 1.2, ry=12)

    kid(a, 206, facing=1, look=0.6, top_col="ochre", bottom="shorts", bottom_col="sage", shoes="clay", expr="grin",
        r=24, mid=bucket, pose=dict(WALK_R, arms=((116, 102), (80, 88))), extras={"stripe": "paper"}, tone="mid")


@scene("val_respect_elder")
def val_respect_elder(a):
    """Menghormati yang lebih tua (salim): a girl bows and brings her grandfather's hand to her forehead; he smiles,
    in peci and sarung."""
    backdrop(a, "ochre", 0.13)
    floor(a)
    base = {"lean": 30, "head": 16}
    hc = head_of(166, True, base, 1)
    hand = add(hc, (KR * 1.05, KR * 0.35))
    pose = dict(base, arms=(("ik", add(hand, (-6, 14)), 1), ("ik", add(hand, (6, 16)), -1)))
    kid(a, 166, facing=1, look=0.6, top="dress", top_col="clay", bottom="none", hair="kerudung", ker_col="sage",
        shoes="slate", expr="thanks", pose=pose, tone="mid")
    adult(a, 286, facing=-1, look=-0.5, top="shirt", top_col="ochre", bottom="sarung", bottom_col="slate", hair="peci",
          shoes="clay", expr="happy", old=True, extras={"moustache": True},
          pose={"arms": ((90, 84), ("ik", add(hand, (4, 2)), 1))}, tone="deep")

def bed_side(a, x0, x1, y):
    frame = [(x0, y), (x1, y - 2), (x1, y + 24), (x0, y + 26)]
    a.block(frame, "ochre", w=LW, second=0.3)
    for x in (x0 + 8, x1 - 8):
        a.blob(capsule((x, y + 24), (x, GY), 4.5), "ochre", w=MW * 1.2, second=0)
    head = [(x0 - 4, y - 60), (x0 + 10, y - 62), (x0 + 10, y + 24), (x0 - 4, y + 26)]
    a.block(head, "ochre", w=MW * 1.4, second=0)


@scene("val_visit_sick")
def val_visit_sick(a):
    """Menjenguk teman yang sakit: a friend rests in bed under a blanket; a girl visits with a small basket of fruit
    and sits by the bed, smiling."""
    backdrop(a, "slate", 0.1)
    floor(a)
    bed_side(a, 24, 236, 196)
    pillow = [(36, 160), (104, 154), (108, 192), (38, 196)]
    a.blob(pillow, "paper", w=MW * 1.4, second=0)
    a.tone = "light"
    draw_head(a, (80, 164), 30, "short", "tired", 0.3, -14, lite=True)
    blanket = [(98, 198), (106, 168), (150, 156), (204, 160), (232, 176), (236, 198)]
    a.fill_smooth(blanket, "sage", 0.95)
    a.hatch(blanket, 80, 9, w=MW, color="paper", alpha=0.35)
    a.outline(blanket, LW, second=0.3)
    hand = ellipse((150, 166), 9, 8, n=8)
    skin_parts(a, [hand])
    a.outline(hand, MW * 1.2, second=0, jit=0.2)

    def basket(F):
        h = F.hd[1]
        b = [add(h, (-20, -4)), add(h, (22, -4)), add(h, (16, 22)), add(h, (-14, 22))]
        for k, col in enumerate(("ochre", "clay", "ochre")):
            a.ell(add(h, (-10 + k * 10, -10 - (k % 2) * 4)), 8, 8, col, w=MW, second=0)
        a.block(b, "ochre", 0.8, w=MW * 1.4, second=0)
        a.hatch(b, 30, 5, alpha=0.4)
        a.hatch(b, -30, 5, alpha=0.4)

    kid(a, 318, facing=-1, look=-0.6, top="dress", top_col="clay", bottom="none", hair="kerudung", ker_col="ochre",
        shoes="slate", expr="smile", mid=basket, pose={"arms": (("ik", (262, 184), 1), (84, 92))}, tone="deep")


def fence(a, y=176, x0=0, x1=400):
    xs = list(range(int(x0) + 10, int(x1), 26))
    for x in xs:
        a.block([(x, y + 2), (x + 6, y - 6), (x + 12, y + 2), (x + 12, GY), (x, GY)], "ochre", 0.85, w=MW, second=0)
    a.lines([((x0, y + 18), (x1, y + 16)), ((x0, y + 56), (x1, y + 54))], 5, "ochre", amp=0.4)
    a.lines([((x0, y + 15), (x1, y + 13)), ((x0, y + 53), (x1, y + 51))], FW * 1.2, amp=0.4)


@scene("val_greet_neighbor")
def val_greet_neighbor(a):
    """Menyapa tetangga: behind her garden fence a neighbour waters her plants and waves; a boy passing on the lane
    waves back."""
    backdrop(a, "sage")

    def can(F):
        h = F.hd[1]
        body = [add(h, (-4, 4)), add(h, (24, 4)), add(h, (24, 30)), add(h, (-4, 30))]
        a.block(body, "slate", w=MW * 1.4, second=0)
        a.blob(ribbon([add(h, (24, 12)), add(h, (40, 2)), add(h, (52, -8))], 6, 4), "slate", w=MW, second=0)
        a.lines([(add(h, (54, -4 + k * 4)), add(h, (60 + k * 2, 8 + k * 6))) for k in range(3)], FW * 1.3, "slate", 0.9)

    adult(a, 104, 250, facing=1, look=0.4, top="blouse", top_col="ochre", sleeve="long", bottom="skirt",
          bottom_col="clay", hair="kerudung", ker_col="sage", shoes="slate", expr="happy", mid=can,
          pose={"arms": ((-120, -90), ("ik", (150, 180), -1))}, hands=("open", "round"), tone="deep")
    for x in (40, 176, 214):
        for ang in (-130, -90, -50):
            lp = leaf_pts((x, 236), polar((x, 236), 30, ang), 8)
            a.fill_smooth(lp, "sage")
            a.outline(lp, MW, second=0, jit=0.2)
    fence(a, 180, 0, 248)
    floor(a, x0=14, x1=386)
    kid(a, 318, facing=-1, look=-0.6, top_col="slate", bottom="shorts", bottom_col="ochre", shoes="clay", expr="grin",
        pose=dict(WALK_L, arms=((80, 86), (-56, -92)), behind=("leg1",)), hands=("round", "open"), tone="light")


def wheelchair(a, cx, gy=GY):
    big = (cx - 4, gy - 34)
    a.stroke(a.ell_path(big, 34, 34, wob=0.012), 5.5, "ink", 0.9)
    a.ell_outline(big, 28, 28, w=FW * 1.3, second=0, wob=0.015)
    a.lines([(polar(big, 4, t), polar(big, 26, t)) for t in range(0, 360, 45)], FW, alpha=0.6, amp=0.2)
    a.ell((cx + 34, gy - 8), 8, 8, "slate", w=MW * 1.2, second=0)
    frame = [(cx - 30, gy - 70), (cx - 26, gy - 120), (cx - 20, gy - 120), (cx - 22, gy - 70), (cx + 30, gy - 68),
             (cx + 34, gy - 16)]
    a.curve(frame, 4.4, "slate", jit=0.2)
    a.curve(frame, FW * 1.2, jit=0.2)


@scene("val_friends_diverse")
def val_friends_diverse(a):
    """Bersahabat dalam perbedaan: three friends side by side and smiling: a girl in a kerudung, a boy in a wheelchair
    with glasses, and a girl with long hair, arm in arm."""
    backdrop(a, "ochre", 0.13)
    floor(a)
    kid(a, 84, facing=1, look=0.3, top="dress", top_col="sage", bottom="none", hair="kerudung", ker_col="clay",
        shoes="slate", expr="happy", pose={"arms": ((100, 94), ("ik", (150, 168), -1))}, tone="deep")
    wheelchair(a, 208)
    pose = {"arms": (("ik", (176, 214), 1), ("ik", (236, 212), -1)), "legs": ((-2, 90), (4, 92))}
    F = Fig(196, GY, KR, True, dict(STAND, **pose), 0)
    dy = (GY - 70) - (F.hip[1] + KR * 0.2)
    kid(a, r=KR, hip=(196, F.hip[1] + dy), look=0.0, top_col="ochre", bottom="trousers", bottom_col="slate",
        shoes="clay", expr="grin", pose=pose, extras={"glasses": True}, tone="light")
    kid(a, 320, facing=-1, look=-0.3, top="dress", top_col="clay", bottom="none", hair="long", shoes="ochre",
        expr="happy", pose={"arms": (("ik", (250, 170), 1), (80, 86))}, tone="mid")


def tap_sink(a, x, y):
    a.blob(capsule((x, 40), (x, y - 40), 6), "slate", 0.9, w=MW * 1.3, second=0)
    spout = ribbon([(x, y - 40), (x + 24, y - 44), (x + 38, y - 34)], 11, 9)
    a.blob(spout, "slate", w=MW * 1.4, second=0)
    a.ell((x + 6, y - 54), 10, 5, "clay", w=MW * 1.3, second=0)
    basin = [(x - 26, y), (x + 80, y - 4), (x + 70, y + 26), (x - 18, y + 28)]
    a.fill_poly(basin, "paper", off=(0, 0))
    a.fill_poly(basin, "slate", 0.3)
    a.outline_poly(basin, LW, second=0.3)
    a.blob(capsule((x + 26, y + 26), (x + 26, GY), 7), "slate", 0.6, w=MW, second=0)


@scene("val_save_water")
def val_save_water(a):
    """Hemat air: after brushing her teeth a girl turns the tap off, a cup in her other hand; the last drop falls."""
    backdrop(a, "sage", 0.12)
    floor(a)
    a.fill_poly([(224, 40), (400, 38), (400, GY), (224, GY)], "slate", 0.12, off=(0, 0))
    a.hatch([(224, 40), (400, 38), (400, 140), (224, 140)], 0, 20, color="slate", alpha=0.2)
    tap_sink(a, 268, 188)

    def cup(F):
        h = F.hd[0]
        c = [add(h, (-10, -22)), add(h, (10, -22)), add(h, (8, 4)), add(h, (-8, 4))]
        a.block(c, "ochre", w=MW * 1.4, second=0)
        a.blob(capsule(add(h, (2, -24)), add(h, (10, -48)), 2.4), "sage", w=MW, second=0)

    kid(a, 176, facing=1, look=0.6, top="dress", top_col="clay", bottom="none", hair="bob", shoes="slate",
        expr="smile", mid=cup, pose={"arms": (("ik", (148, 182), 1), ("ik", (272, 136), -1))}, tone="light")
    drop(a, (306, 166), 6, "slate")
    motion_arcs(a, (274, 134), 16, -120, -60, w=FW * 1.4, alpha=0.8)


@scene("val_kind_animal")
def val_kind_animal(a):
    """Menyayangi hewan: a boy crouches and sets down a bowl of water for a thirsty cat, which comes to drink."""
    backdrop(a, "ochre", 0.12)
    floor(a)
    pose = {"lean": 16, "head": 14, "arms": (("ik", (226, 252), 1), ("ik", (262, 252), -1)),
            "legs": ((-24, 104), (-10, 112)), "behind": ("leg0", "arm0")}
    kid(a, 170, facing=1, look=0.6, top_col="sage", bottom="shorts", bottom_col="clay", shoes="ochre", expr="happy",
        pose=pose, extras={"stripe": "ochre"}, tone="deep")
    bc = (246, GY - 6)
    a.blob(ellipse(bc, 26, 12, n=12, a0=0, sweep=180) + [add(bc, (26, -2)), add(bc, (-26, -2))], "clay", w=MW * 1.3,
           second=0)
    a.fill_smooth(ellipse(add(bc, (0, -2)), 21, 4.5, n=10), "slate", 0.8)
    a.ell_outline(add(bc, (0, -2)), 24, 5.5, w=MW, second=0)
    draw_cat_sit(a, (322, GY - 2), 1.05, flip=True)
    motion_arcs(a, (290, 214), 12, 180, 240, w=FW * 1.3, alpha=0.7)


def phone_in_hand(a, c, rot=0.0, screen=None, scale=1.0):
    T = Tf(c, scale, rot)
    body = T.pts(rect(-11, -19, 22, 38))
    a.block(body, "slate", w=MW * 1.3, second=0)
    scr = T.pts(rect(-8, -15, 16, 28))
    a.fill_poly(scr, "paper", 0.9, off=(0, 0))
    if screen:
        screen(T)


@scene("val_phone_kind")
def val_phone_kind(a):
    """Bijak bermedia (baik): a boy sends a kind message; a speech bubble carrying a small flower floats from his phone
    to his friend, who reads it on her phone and smiles."""
    backdrop(a, "sage", 0.12, cy=180)

    def ph(F):
        phone_in_hand(a, add(F.nb, (8, 74)), -8, scale=1.6)

    kid(a, r=31, head=(96, 132), cut=300, top_col="ochre", hair="short", expr="happy", look=0.5, mid=ph,
        pose={"head": 12, "arms": (("ik", (88, 222), 1), ("ik", (120, 220), -1))}, tone="mid")

    def ph2(F):
        phone_in_hand(a, add(F.nb, (-8, 74)), 8, scale=1.6)

    kid(a, r=31, head=(304, 136), cut=300, top="dress", top_col="sage", hair="kerudung", ker_col="clay", expr="happy",
        look=-0.5, mid=ph2, pose={"head": -12, "arms": (("ik", (284, 226), 1), ("ik", (314, 228), -1))},
        tone="deep")
    bubble(a, (206, 74), 84, 60, (134, 178))
    small_flower(a, (206, 74), 1.4, "clay")
    a.dots([(236, 108), (250, 122)], 4.0, "ochre", 0.8)


@scene("val_phone_unkind")
def val_phone_unkind(a):
    """Bijak bermedia (kurang baik, gently): a boy types a harsh message, a frown on his face; the bubble from his phone
    is a spiky scribble, and his friend reading it looks down, hurt. No tears."""
    backdrop(a, "slate", 0.1, cy=180)

    def ph(F):
        phone_in_hand(a, add(F.nb, (8, 74)), -8, scale=1.6)

    F = kid(a, r=31, head=(96, 132), cut=300, top_col="clay", hair="short", expr="down", look=0.5, mid=ph,
            pose={"head": 12, "arms": (("ik", (88, 222), 1), ("ik", (120, 220), -1))}, tone="light")
    brows(a, F, "angry")

    def ph2(F):
        phone_in_hand(a, add(F.nb, (-8, 74)), 8, scale=1.6)

    kid(a, r=31, head=(304, 140), cut=300, top="dress", top_col="ochre", hair="ponytail", expr="down", look=-0.5,
        mid=ph2, pose={"head": 14, "arms": (("ik", (284, 230), 1), ("ik", (314, 232), -1))}, tone="mid")
    bubble(a, (206, 74), 92, 62, (134, 178), jag=True)
    a.zig([(180, 70), (190, 60), (198, 80), (208, 62), (216, 82), (226, 64), (234, 76)], MW * 1.4, jit=0.4)


@scene("val_calm_breath")
def val_calm_breath(a):
    """Menenangkan diri: a girl sits cross-legged on a mat, eyes closed, one hand on her belly and one on her knee,
    breathing out slowly; soft curls show the breath."""
    backdrop(a, "sage", 0.13)
    mat = [(80, 254), (320, 250), (330, 270), (70, 274)]
    a.block(mat, "ochre", 0.8, second=0.3)
    a.hatch(mat, 0, 6, alpha=0.3)
    cx, base = 200, 258
    hip_y = base - 26
    r = 30
    hy = hip_y - r * (1.18 + 1.55)
    kid(a, r=r, head=(cx + a.j(2), hy), cut=hip_y + 4, top="tshirt", top_col="clay", hair="bun", expr="sleep",
        pose={"arms": (("ik", (cx - 4, hip_y - 26), 1), ("ik", (cx + 52, hip_y + 6), -1))}, tone="light")
    lap = [(cx - 70, base), (cx - 64, base - 24), (cx - 26, base - 34), (cx + 26, base - 34), (cx + 64, base - 24),
           (cx + 70, base)]
    a.fill_smooth(lap, "slate")
    a.hatch(clip_half(lap, (cx + 24, 0), (1, 0)), 70, 5.0, alpha=0.35)
    a.outline(lap, LW, second=0.3)
    a.curve([(cx - 58, base - 6), (cx - 10, base - 14), (cx + 34, base - 22)], MW * 1.2, jit=0.3)
    a.curve([(cx + 58, base - 6), (cx + 12, base - 12)], MW * 1.2, jit=0.3)
    a.tone = "light"
    feet = [ellipse((cx + 40, base - 20), 11, 6, -20, n=8), ellipse((cx - 30, base - 8), 11, 6, 15, n=8)]
    skin_parts(a, feet)
    for f in feet:
        a.outline(f, MW * 1.2, second=0, jit=0.2)
    for k, (x, y) in enumerate(((226, 162), (240, 146), (256, 132))):
        a.curve([(x, y), (x + 10, y - 8), (x + 22, y - 4), (x + 30, y - 12)], MW * (1.2 - 0.15 * k), "slate", 0.85)


@scene("val_angry_face")
def val_angry_face(a):
    """Marah (recognising anger, gently): a boy with arms crossed, brows pulled down, cheeks flushed, a small scribble
    cloud over his head. No shouting, nothing broken."""
    backdrop(a, "clay", 0.1, cy=176)
    F = kid(a, r=40, head=(200, 132), cut=300, top_col="slate", hair="short", expr="down", look=0.1,
            pose={"head": -4, "arms": (("ik", (226, 236), 1), ("ik", (174, 230), -1))}, extras={"stripe": "ochre"},
            tone="mid")
    brows(a, F, "angry")
    for sx in (-1, 1):
        a.fill_smooth(ellipse(add(F.hc, (sx * 24, 12)), 9, 5, n=8), "clay", 0.55)
    cloud = [polar((206, 52), 30 + (6 if k % 2 else 0), k * 30, 18 + (4 if k % 2 else 0)) for k in range(12)]
    a.fill_smooth(cloud, "slate", 0.25)
    a.outline(cloud, MW * 1.3, second=0, jit=0.3)
    a.zig([(186, 52), (194, 44), (200, 58), (208, 44), (216, 58), (224, 46)], MW * 1.2, jit=0.3)


def sapling(a, base, h=62):
    top = (base[0] + 2, base[1] - h)
    a.curve([base, (base[0] - 3, base[1] - h * 0.5), top], LW)
    for t, ln, wd in ((0.45, 22, 8), (0.75, 20, 7), (1.0, 16, 6)):
        b = lerp(base, top, t)
        for sx in (-1, 1):
            lp = leaf_pts(b, (b[0] + sx * ln, b[1] - 8), wd, asym=0.75)
            a.fill_smooth(lp, "sage")
            a.outline(lp, MW, second=0, jit=0.2)


@scene("val_teamwork")
def val_teamwork(a):
    """Bekerja sama: two children plant a young tree together: one holds it straight while the other shovels soil
    around it; the watering can waits for the next step."""
    backdrop(a, "sage")
    floor(a)
    mound = [(160, GY + 2), (176, GY - 12), (210, GY - 16), (238, GY - 10), (250, GY + 2)]
    a.fill_smooth(mound, "clay", 0.6)
    a.stipple(mound, 8, 2.4, alpha=0.6)
    a.curve(mound, LW)
    sapling(a, (204, GY - 14), 90)
    can = [(42, GY - 2), (42, GY - 34), (76, GY - 34), (76, GY - 2)]
    a.block(can, "sage", w=MW * 1.4, second=0)
    a.blob(ribbon([(76, GY - 26), (94, GY - 40), (106, GY - 52)], 7, 4), "sage", w=MW, second=0)
    a.arc((59, GY - 34), 14, 180, 360, MW * 1.2, ry=14)
    kid(a, 140, facing=1, look=0.6, top="dress", top_col="clay", bottom="none", hair="kerudung", ker_col="ochre",
        shoes="slate", expr="happy", pose={"lean": 8, "arms": (("ik", (196, 214), 1), ("ik", (202, 196), -1))},
        tone="mid")

    def shovel(F):
        h = F.hd[0]
        a.blob(capsule(add(h, (6, -30)), (238, GY - 12), 3), "ochre", w=MW, second=0)
        blade = [(226, GY - 16), (246, GY - 10), (242, GY + 2), (224, GY - 4)]
        a.block(blade, "slate", w=MW * 1.3, second=0)

    kid(a, 300, facing=-1, look=-0.6, top_col="ochre", bottom="shorts", bottom_col="slate", shoes="clay", expr="grin",
        mid=shovel, pose={"lean": -10, "arms": (("ik", (262, 210), 1), ("ik", (280, 186), 1))},
        extras={"stripe": "paper"}, tone="deep")


SHEETS.append(("13d_fu12_values", lambda k: k.startswith("val_"), 6, 180))
