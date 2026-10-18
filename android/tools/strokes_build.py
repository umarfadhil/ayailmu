#!/usr/bin/env python3
"""Builds android/content/src/main/assets/strokes/index.json (stroke data for `trace` items).

Format and keys: docs/content/INTERACTIONS_AUDIO.md §4. Review notes: art/strokes/README.md.

- Hiragana (46) and hanzi (25): derived from KanjiVG (https://kanjivg.tagaini.net, (c) Ulrich Apel,
  CC BY-SA 3.0). One SVG per character, `kanji/<5-hex code point>.svg` (base file, not -Kaisho), pinned to
  commit KANJIVG_COMMIT. KanjiVG paths are in drawing order and drawing direction on a 109x109 canvas; this
  script parses the path data (M/m L/l H/h V/v C/c S/s Q/q T/t Z/z, implicit repeats), samples it, divides by 109
  and simplifies each stroke to a 6-24 point polyline.
- Hangul jamo (24): hand-authored in art/strokes/hangul.py (0..100 grid), simplified the same way.

Pure Python standard library. Downloads only into the cache dir and never runs anything from it.

Usage (from the repo root):
  python3 -I android/tools/strokes_build.py --cache DIR            # fetch missing SVGs into DIR, then build
  python3 -I android/tools/strokes_build.py --cache DIR --offline  # use DIR only (fail if a file is missing)
Options: --out FILE (default: the asset path above), --hangul FILE (default: art/strokes/hangul.py).
"""
import argparse
import bisect
import heapq
import importlib.util
import json
import math
import os
import re
import sys
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DEFAULT_OUT = os.path.join(REPO, "android", "content", "src", "main", "assets", "strokes", "index.json")
DEFAULT_HANGUL = os.path.join(REPO, "art", "strokes", "hangul.py")

KANJIVG_COMMIT = "70a0b7ae0c18ceb5cb358274b029cce0234a43bc"  # KanjiVG master, fetched 2026-10-18
KANJIVG_URL = "https://raw.githubusercontent.com/KanjiVG/kanjivg/{rev}/kanji/{cp}.svg"
VIEWBOX = 109.0

HIRAGANA = [
    ("hira_a", "あ"), ("hira_i", "い"), ("hira_u", "う"), ("hira_e", "え"), ("hira_o", "お"),
    ("hira_ka", "か"), ("hira_ki", "き"), ("hira_ku", "く"), ("hira_ke", "け"), ("hira_ko", "こ"),
    ("hira_sa", "さ"), ("hira_shi", "し"), ("hira_su", "す"), ("hira_se", "せ"), ("hira_so", "そ"),
    ("hira_ta", "た"), ("hira_chi", "ち"), ("hira_tsu", "つ"), ("hira_te", "て"), ("hira_to", "と"),
    ("hira_na", "な"), ("hira_ni", "に"), ("hira_nu", "ぬ"), ("hira_ne", "ね"), ("hira_no", "の"),
    ("hira_ha", "は"), ("hira_hi", "ひ"), ("hira_fu", "ふ"), ("hira_he", "へ"), ("hira_ho", "ほ"),
    ("hira_ma", "ま"), ("hira_mi", "み"), ("hira_mu", "む"), ("hira_me", "め"), ("hira_mo", "も"),
    ("hira_ya", "や"), ("hira_yu", "ゆ"), ("hira_yo", "よ"),
    ("hira_ra", "ら"), ("hira_ri", "り"), ("hira_ru", "る"), ("hira_re", "れ"), ("hira_ro", "ろ"),
    ("hira_wa", "わ"), ("hira_wo", "を"), ("hira_n", "ん"),
]

HANGUL_KEYS = [
    "hangul_g", "hangul_n", "hangul_d", "hangul_r", "hangul_m", "hangul_b", "hangul_s", "hangul_ng",
    "hangul_j", "hangul_ch", "hangul_k", "hangul_t", "hangul_p", "hangul_h",
    "hangul_a", "hangul_ya", "hangul_eo", "hangul_yeo", "hangul_o", "hangul_yo", "hangul_u", "hangul_yu",
    "hangul_eu", "hangul_i",
]

HANZI = [
    ("hanzi_yi", "一"), ("hanzi_er", "二"), ("hanzi_san", "三"), ("hanzi_si", "四"), ("hanzi_wu", "五"),
    ("hanzi_liu", "六"), ("hanzi_qi", "七"), ("hanzi_ba", "八"), ("hanzi_jiu", "九"), ("hanzi_shi", "十"),
    ("hanzi_ren", "人"), ("hanzi_kou", "口"), ("hanzi_da", "大"), ("hanzi_xiao", "小"), ("hanzi_shan", "山"),
    ("hanzi_shui", "水"), ("hanzi_huo", "火"), ("hanzi_mu", "木"), ("hanzi_ri", "日"), ("hanzi_yue", "月"),
    ("hanzi_zhong", "中"), ("hanzi_shang", "上"), ("hanzi_xia", "下"), ("hanzi_wo", "我"), ("hanzi_hao", "好"),
]

# Mainland (GB / 现代汉语通用字笔顺规范) order where it differs from KanjiVG's Japanese order:
# key -> list of (KanjiVG stroke number, reversed?) in Mainland order. All 25 hanzi were checked stroke by stroke
# (上 丨一一, 下 一丨丶, 九 丿乙, 火 丶丿丿㇏, 小 亅丶丶, 山 丨𠃊丨, 我 丿一亅㇀㇂丿丶, 好 ㇛丿㇀ ㇇亅一, ...)
# and KanjiVG already follows the Mainland order, so this table is empty. Add an entry here if a reviewer
# finds a difference; the builder applies it after parsing.
MAINLAND_ORDER: dict[str, list[tuple[int, bool]]] = {}

MIN_POINTS = 6
MAX_POINTS = 24
EPSILON = 0.002  # shape tolerance, in cell units (0..1)
MAX_SEGMENT = 0.07  # target max gap between consecutive points along a stroke (cell units), budget permitting


# --------------------------------------------------------------------------------------------------------------
# KanjiVG SVG -> dense polylines
# --------------------------------------------------------------------------------------------------------------

PATH_RE = re.compile(r'<path\b[^>]*?\bid="kvg:([0-9a-f]{5})-s(\d+)"[^>]*?\bd="([^"]+)"', re.S)
PATH_RE_ALT = re.compile(r'<path\b[^>]*?\bd="([^"]+)"[^>]*?\bid="kvg:([0-9a-f]{5})-s(\d+)"', re.S)
TOKEN_RE = re.compile(r"[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def svg_strokes(svg_text: str, cp: str) -> list[str]:
    """The `d` attributes of the stroke paths kvg:<cp>-s1, -s2, ... in stroke-number order."""
    found = {}
    for m in PATH_RE.finditer(svg_text):
        if m.group(1) == cp:
            found[int(m.group(2))] = m.group(3)
    for m in PATH_RE_ALT.finditer(svg_text):
        if m.group(2) == cp:
            found.setdefault(int(m.group(3)), m.group(1))
    if not found:
        raise ValueError(f"no stroke paths for {cp}")
    numbers = sorted(found)
    if numbers != list(range(1, len(numbers) + 1)):
        raise ValueError(f"{cp}: stroke numbers not contiguous: {numbers}")
    return [found[n] for n in numbers]


def _cubic(p0, c1, c2, p1, n):
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p1[0],
            u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p1[1],
        ))
    return out


def _quad(p0, c, p1, n):
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append((u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]))
    return out


def path_points(d: str, steps: int = 32) -> list[tuple[float, float]]:
    """Dense polyline of an SVG path (all subpaths concatenated, in order)."""
    tokens = TOKEN_RE.findall(d)
    pts: list[tuple[float, float]] = []
    i = 0
    cmd = None
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    last_ctrl = None  # (kind, point): reflected by S/s ('C') and T/t ('Q')

    def num():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        if tokens[i].isalpha():
            cmd = tokens[i]
            i += 1
            if cmd in "Zz":
                if pts and pts[-1] != start:
                    pts.append(start)
                cur = start
                last_ctrl = None
                continue
        elif cmd is None:
            raise ValueError(f"path data starts with a number: {d[:40]}")
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = cur if rel else (0.0, 0.0)
        if c == "M":
            cur = (ox + num(), oy + num())
            start = cur
            pts.append(cur)
            last_ctrl = None
            cmd = "l" if rel else "L"  # implicit repeats of a moveto are linetos
        elif c == "L":
            cur = (ox + num(), oy + num())
            pts.append(cur)
            last_ctrl = None
        elif c == "H":
            cur = ((cur[0] if rel else 0.0) + num(), cur[1])
            pts.append(cur)
            last_ctrl = None
        elif c == "V":
            cur = (cur[0], (cur[1] if rel else 0.0) + num())
            pts.append(cur)
            last_ctrl = None
        elif c == "C":
            c1 = (ox + num(), oy + num())
            c2 = (ox + num(), oy + num())
            p1 = (ox + num(), oy + num())
            pts.extend(_cubic(cur, c1, c2, p1, steps))
            cur, last_ctrl = p1, ("C", c2)
        elif c == "S":
            c1 = (2 * cur[0] - last_ctrl[1][0], 2 * cur[1] - last_ctrl[1][1]) if last_ctrl and last_ctrl[0] == "C" else cur
            c2 = (ox + num(), oy + num())
            p1 = (ox + num(), oy + num())
            pts.extend(_cubic(cur, c1, c2, p1, steps))
            cur, last_ctrl = p1, ("C", c2)
        elif c == "Q":
            q = (ox + num(), oy + num())
            p1 = (ox + num(), oy + num())
            pts.extend(_quad(cur, q, p1, steps))
            cur, last_ctrl = p1, ("Q", q)
        elif c == "T":
            q = (2 * cur[0] - last_ctrl[1][0], 2 * cur[1] - last_ctrl[1][1]) if last_ctrl and last_ctrl[0] == "Q" else cur
            p1 = (ox + num(), oy + num())
            pts.extend(_quad(cur, q, p1, steps))
            cur, last_ctrl = p1, ("Q", q)
        else:
            raise ValueError(f"unsupported path command {cmd!r}")
    return pts


# --------------------------------------------------------------------------------------------------------------
# Dense polyline -> compact polyline (6..24 points, corners kept, curves followed)
# --------------------------------------------------------------------------------------------------------------

def _dedupe(pts):
    out = []
    for p in pts:
        if not out or math.dist(out[-1], p) > 1e-9:
            out.append(p)
    return out


def _seg_dist(p, a, b):
    """Distance from point p to the segment a-b."""
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 < 1e-18 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _shape_points(pts, eps, budget):
    """Indices of the shape-defining points: greedy Ramer-Douglas-Peucker that always splits the worst span
    first, until every dense point is within eps of the polyline or the budget is used up."""
    def worst(a, b):
        best, best_i = -1.0, -1
        for k in range(a + 1, b):
            dist = _seg_dist(pts[k], pts[a], pts[b])
            if dist > best:
                best, best_i = dist, k
        return best, best_i

    keep = {0, len(pts) - 1}
    heap = []
    d, i = worst(0, len(pts) - 1)
    if i >= 0:
        heapq.heappush(heap, (-d, 0, len(pts) - 1, i))
    while heap and len(keep) < budget:
        nd, a, b, i = heapq.heappop(heap)
        if -nd <= eps:
            break
        keep.add(i)
        for lo, hi in ((a, i), (i, b)):
            d, j = worst(lo, hi)
            if j >= 0:
                heapq.heappush(heap, (-d, lo, hi, j))
    return sorted(keep)


def simplify(dense, eps=EPSILON, max_seg=MAX_SEGMENT):
    """Dense polyline (0..1 units) -> MIN_POINTS..MAX_POINTS points, rounded to 3 decimals.
    1) shape points: corners and curves, within eps (greedy RDP, at most MAX_POINTS);
    2) spare budget: extra points spaced evenly between them so no gap along the stroke exceeds max_seg
       (where the budget allows), and at least MIN_POINTS in total."""
    pts = _dedupe([(min(1.0, max(0.0, x)), min(1.0, max(0.0, y))) for x, y in dense])
    if len(pts) < 2:
        raise ValueError("stroke has fewer than two distinct points")
    cum = [0.0]
    for p, q in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.dist(p, q))

    def at(s):
        k = min(max(bisect.bisect_right(cum, s) - 1, 0), len(pts) - 2)
        span = cum[k + 1] - cum[k]
        t = 0.0 if span <= 0 else min(1.0, max(0.0, (s - cum[k]) / span))
        return (pts[k][0] + t * (pts[k + 1][0] - pts[k][0]), pts[k][1] + t * (pts[k + 1][1] - pts[k][1]))

    marks = [cum[k] for k in _shape_points(pts, eps, MAX_POINTS)]
    gaps = [s1 - s0 for s0, s1 in zip(marks, marks[1:])]
    pieces = [max(1, math.ceil(g / max_seg - 1e-9)) for g in gaps]
    while sum(pieces) + 1 > MAX_POINTS:  # over budget: take a piece from the gap that misses it least
        j = min((k for k in range(len(gaps)) if pieces[k] > 1), key=lambda k: gaps[k] / (pieces[k] - 1))
        pieces[j] -= 1
    while sum(pieces) + 1 < MIN_POINTS:  # too few points: split the longest pieces
        j = max(range(len(gaps)), key=lambda k: gaps[k] / pieces[k])
        pieces[j] += 1
    stations = [marks[0]]
    for s0, g, n in zip(marks, gaps, pieces):
        stations.extend(s0 + g * j / n for j in range(1, n + 1))
    out = []
    for s in stations:
        x, y = at(s)
        p = [round(x, 3), round(y, 3)]
        if not out or out[-1] != p:
            out.append(p)
    if len(out) < 2:
        raise ValueError("stroke collapsed to a single point")
    return out


# --------------------------------------------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------------------------------------------

def kanjivg_svg(cache: str, ch: str, offline: bool) -> tuple[str, str]:
    cp = f"{ord(ch):05x}"
    path = os.path.join(cache, f"{cp}.svg")
    if not os.path.isfile(path):
        if offline:
            raise FileNotFoundError(f"{path} missing (KanjiVG {ch}) and --offline given")
        url = KANJIVG_URL.format(rev=KANJIVG_COMMIT, cp=cp)
        print(f"fetch {url}", file=sys.stderr)
        with urllib.request.urlopen(url, timeout=30) as r:
            data = r.read()
        with open(path + ".part", "wb") as f:
            f.write(data)
        os.replace(path + ".part", path)
    with open(path, encoding="utf-8") as f:
        return cp, f.read()


def kanjivg_glyph(cache, key, ch, offline):
    cp, text = kanjivg_svg(cache, ch, offline)
    strokes = [simplify([(x / VIEWBOX, y / VIEWBOX) for x, y in path_points(d)]) for d in svg_strokes(text, cp)]
    if key in MAINLAND_ORDER:
        reordered = []
        for n, rev in MAINLAND_ORDER[key]:
            s = strokes[n - 1]
            reordered.append(list(reversed(s)) if rev else s)
        if len(reordered) != len(strokes):
            raise ValueError(f"{key}: MAINLAND_ORDER must list every stroke once")
        strokes = reordered
    return strokes


def load_hangul(path):
    sys.dont_write_bytecode = True  # no __pycache__ next to the art source
    spec = importlib.util.spec_from_file_location("ayailmu_hangul_strokes", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.jamo()


def build(cache, hangul_path, offline):
    os.makedirs(cache, exist_ok=True)
    keys = {}
    for key, ch in HIRAGANA:
        keys[key] = {"glyph": ch, "script": "hiragana", "strokes": kanjivg_glyph(cache, key, ch, offline)}
    jamo = load_hangul(hangul_path)
    missing = [k for k in HANGUL_KEYS if k not in jamo]
    extra = [k for k in jamo if k not in HANGUL_KEYS]
    if missing or extra:
        raise ValueError(f"hangul.py keys: missing {missing}, unexpected {extra}")
    for key in HANGUL_KEYS:
        glyph, strokes = jamo[key]
        keys[key] = {"glyph": glyph, "script": "hangul", "strokes": [simplify(s) for s in strokes]}
    for key, ch in HANZI:
        keys[key] = {"glyph": ch, "script": "hanzi", "strokes": kanjivg_glyph(cache, key, ch, offline)}
    return keys


def write(keys, out):
    # One glyph per line: compact, but still diffable and greppable.
    lines = [json.dumps(k, ensure_ascii=False) + ":" + json.dumps(v, ensure_ascii=False, separators=(",", ":"))
             for k, v in keys.items()]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out + ".tmp", "w", encoding="utf-8") as f:
        f.write('{"keys":{\n' + ",\n".join(lines) + "\n}}\n")
    os.replace(out + ".tmp", out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True, help="KanjiVG SVG cache dir (<code point>.svg files)")
    ap.add_argument("--offline", action="store_true", help="do not download; fail if an SVG is missing")
    ap.add_argument("--hangul", default=DEFAULT_HANGUL)
    ap.add_argument("--out", default=DEFAULT_OUT)
    a = ap.parse_args()
    keys = build(a.cache, a.hangul, a.offline)
    write(keys, a.out)
    by_script = {}
    for v in keys.values():
        by_script[v["script"]] = by_script.get(v["script"], 0) + 1
    points = sum(len(s) for v in keys.values() for s in v["strokes"])
    strokes = sum(len(v["strokes"]) for v in keys.values())
    print(f"wrote {a.out}: {len(keys)} glyphs {by_script}, {strokes} strokes, {points} points, "
          f"{os.path.getsize(a.out)} bytes")


if __name__ == "__main__":
    main()
