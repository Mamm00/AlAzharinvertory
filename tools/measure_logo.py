#!/usr/bin/env python3
"""
measure_logo.py — read the geometry of the supplied logo artwork off the pixels.

    python3 tools/measure_logo.py [artwork] [sector-of-ring-only]

The vector redraw in tools/make_logo.py is driven by the numbers printed here
instead of by eye. Method:

  1. classify every pixel  navy / red / white;
  2. fit a circle to the outermost ink along the arc sectors where only the ring
     exists (least squares, Kasa) -> the artwork's true centre and outer radius.
     The lockup's bounding box cannot be used: the wordmark letters stick out
     past the ring at the lower right, which would skew any bbox-derived frame;
  3. measure everything else in that frame and print it on the 120x120 artboard
     app/logo.svg uses, pinned so the ring's outer edge is 56 units.
"""
import math, sys
from collections import defaultdict

from PIL import Image

PATH = sys.argv[1] if len(sys.argv) > 1 else 'uploads/IMG-20260504-WA0035.jpg'
AB, R_OUT_AB = 120.0, 56.0
im = Image.open(PATH).convert('RGB')
W, H = im.size
px = im.load()

def kind(x, y):
    r, g, b = px[x, y]
    if r > 230 and g > 230 and b > 230:
        return '.'
    if r > 100 and g < 110 and b < 115 and (r - max(g, b)) > 40:
        return 'R'
    return 'N'

def any_ink(x, y):
    return 0 <= x < W and 0 <= y < H and kind(x, y) != '.'

def outer_edge(cx, cy, deg, rmax):
    """outermost ink pixel along a ray, or None"""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    lo, hi = 0.0, rmax
    best = None
    for _ in range(34):
        mid = (lo + hi) / 2.0
        if any_ink(int(round(cx + mid * c)), int(round(cy + mid * s))):
            best = mid; lo = mid
        else:
            hi = mid
            if hi - lo < 0.6:
                break
    return best

# ── 1. coarse centre from the bbox, then circle-fit the ring ──────────────
xs = [x for x in range(W) for y in range(0, H, 4) if kind(x, y) != '.']
ys = [y for y in range(H) for x in range(0, W, 4) if kind(x, y) != '.']
BX0, BX1, BY0, BY1 = min(xs), max(xs), min(ys), max(ys)
CX, CY = (BX0 + BX1) / 2.0, (BY0 + BY1) / 2.0
RMAX = max(BX1 - CX, CX - BX0, BY1 - CY, CY - BY0) * 1.02

ARC = list(range(150, 271))          # left + top: the ring is the only ink here

def outer_at(cx, cy, deg, rmax, step=2.0):
    """outermost ink along a ray: scan outward, keep the last hit. A binary
    search would be wrong - the ray crosses ring, then white, then monogram,
    so "ink present" is not monotone in radius."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    best, r = None, 0.30 * rmax
    while r <= rmax:
        if any_ink(int(round(cx + r * c)), int(round(cy + r * s))):
            best = r
        r += step
    return best

def score(cx, cy):
    rs = [outer_at(cx, cy, d, RMAX) for d in ARC]
    rs = [r for r in rs if r]
    if len(rs) < len(ARC) * 0.8:
        return 1e9, 0.0
    m = sum(rs) / len(rs)
    return math.sqrt(sum((r - m) ** 2 for r in rs) / len(rs)), m

best = (1e9, 0, 0, 0.0)
step = 16.0
for _ in range(4):
    cand = []
    for dyc in (-step, 0, step):
        for dxc in (-step, 0, step):
            rms, m = score(CX + dxc, CY + dyc)
            cand.append((rms, CX + dxc, CY + dyc, m))
    best = min(cand, key=lambda t: t[0])
    CX, CY, R_OUT = best[1], best[2], best[3]
    step /= 2.5
    if step < 1.0:
        break
print('ring circle fit   centre (%.1f, %.1f) px   outer radius %.1f px   rms %.2f px'
      % (CX, CY, R_OUT, best[0]))
print('   bbox x %d..%d y %d..%d   (fit uses rays %d..%d only)' % (BX0, BX1, BY0, BY1, ARC[0], ARC[-1]))
K = R_OUT_AB / R_OUT

def ab(x, y):
    return ((x - CX) * K + AB / 2.0, (y - CY) * K + AB / 2.0)

def polar(x, y):
    dx, dy = x - CX, y - CY
    return (math.degrees(math.atan2(dy, dx)) % 360.0, math.hypot(dx, dy) * K)

def any_ink2(x, y):
    return 0 <= x < W and 0 <= y < H and kind(x, y) != '.'


def ab(x, y):
    return ((x - CX) * K + AB / 2.0, (y - CY) * K + AB / 2.0)

def polar(x, y):
    dx, dy = x - CX, y - CY
    return (math.degrees(math.atan2(dy, dx)) % 360.0, math.hypot(dx, dy) * K)

def art_ray(deg, frac_lo=0.30, frac_hi=1.30, want='N'):
    """first/last radius (artboard units) along a ray with the wanted class"""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    rs = []
    r = frac_lo * R_OUT
    while r < frac_hi * R_OUT:
        x = int(round(CX + r * c)); y = int(round(CY + r * s))
        if 0 <= x < W and 0 <= y < H and kind(x, y) == want:
            rs.append(r * K)
        r += 0.75 / K * 0.75
    return rs

# ── 2. ring stroke + coverage, in the fitted frame ────────────────────────
thick, outer_r, inner_r = [], [], []
for deg in range(360):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    hits = []
    r = 0.78 * R_OUT
    while r <= 1.12 * R_OUT:
        x = int(round(CX + r * c)); y = int(round(CY + r * s))
        hits.append(any_ink(x, y))
        r += 0.5 / K
    idx = [i for i, h in enumerate(hits) if h]
    if idx:
        o = (idx[-1] + 1) * 0.5 / K * K
        i0 = (idx[0]) * 0.5 / K * K
        outer_r.append(o); inner_r.append(i0); thick.append(o - i0)
outer = R_OUT * K
stroke = sorted(thick)[len(thick) // 2]
MID = outer - stroke / 2.0
print('ring              outer %.1f  stroke %.1f (median)  centreline r %.1f  -> inner %.1f'
      % (outer, stroke, MID, outer - stroke))

def ring_present(deg):
    for f in (0.94, 0.99, 1.04):
        rho = MID * f / K
        if any_ink(int(round(CX + rho * math.cos(math.radians(deg)))), int(round(CY + rho * math.sin(math.radians(deg))))):
            return True
    return False
cov = [ring_present(d) for d in range(360)]
runs, st = [], None
for d in range(720):
    on = cov[d % 360]
    if on and st is None: st = d
    elif not on and st is not None: runs.append((st % 360, d % 360, d - st)); st = None
gaps, st = [], None
for d in range(720):
    off = not cov[d % 360]
    if off and st is None: st = d
    elif not off and st is not None: gaps.append((st % 360, d % 360, d - st)); st = None
print('ring ink present   %s' % ' '.join('%.0f..%.0f' % (a, b) for a, b, n in runs if n >= 3))
print('ring NOTCHES       %s' % ' '.join('%.0f..%.0f(%.0f)' % (a, b, (b - a) % 360) for a, b, n in gaps if n >= 3))

# ── 3. stars: red clusters at the ring line ───────────────────────────────
cls = defaultdict(list)
for y in range(int(CY - R_OUT * 1.25), int(CY + R_OUT * 1.25)):
    for x in range(int(CX - R_OUT * 1.25), int(CX + R_OUT * 1.25)):
        if 0 <= x < W and 0 <= y < H and kind(x, y) == 'R':
            a, r = polar(x, y)
            cls[int(a)].append((r, x, y))
groups, cur, prev = [], None, None
for a in sorted(cls):
    if prev is not None and a - prev > 3 and cur:
        groups.append(cur); cur = []
    if cur is None: cur = []
    cur.append(a); prev = a
if cur: groups.append(cur)
print('\nred clusters       centre  span   radial(ab)      n     mean xy')
STARS = []
for g in groups:
    rr = [p[0] for a in g for p in cls[a]]
    xsum = sum(p[1] for a in g for p in cls[a]); ysum = sum(p[2] for a in g for p in cls[a]); n = len(rr)
    a0, a1 = min(g), max(g)
    print('   %7.1f  %4d   %4.1f..%4.1f  %6d   (%.1f, %.1f)'
          % ((a0 + a1) / 2.0, a1 - a0, min(rr), max(rr), n, xsum / n * K, ysum / n * K))
    if min(rr) > MID - 12 and n > 250:
        cnt = max(1, round((a1 - a0) / 17.6)) if a1 - a0 > 24 else 1
        for i in range(cnt):
            STARS.append(a0 + (a1 - a0) * (i + 0.5) / cnt)
print('   star centres: %s' % [round(s, 1) for s in STARS])

# ── 4. monogram: everything inside the ring, split by class ───────────────
def box(pred, lo=0.0, hi=1.3):
    m = [1e9, 1e9, -1e9, -1e9]
    for y in range(int(CY - R_OUT * hi), int(CY + R_OUT * hi)):
        for x in range(int(CX - R_OUT * hi), int(CX + R_OUT * hi)):
            if 0 <= x < W and 0 <= y < H and pred(x, y):
                ax, ay = ab(x, y)
                m = [min(m[0], ax), min(m[1], ay), max(m[2], ax), max(m[3], ay)]
    return m
navy_in = lambda x, y: kind(x, y) == 'N' and polar(x, y)[1] < MID - stroke / 2.0 - 1.0
red_in = lambda x, y: kind(x, y) == 'R' and polar(x, y)[1] < MID - stroke / 2.0 - 1.0
nb, rb = box(navy_in), box(red_in)
print('\nmonogram navy box  x %.1f..%.1f (w %.1f)  y %.1f..%.1f (h %.1f)' % (nb[0], nb[2], nb[2] - nb[0], nb[1], nb[3], nb[3] - nb[1]))
print('cradle   red  box  x %.1f..%.1f (w %.1f)  y %.1f..%.1f (h %.1f)' % (rb[0], rb[2], rb[2] - rb[0], rb[1], rb[3], rb[3] - rb[1]))
# red cradle in polar terms about its own best centre
if rb[0] < rb[2]:
    ccx, ccy = (rb[0] + rb[2]) / 2.0, (rb[1] + rb[3]) / 2.0
    print('   cradle about (%%.1f, %%.1f): x %.1f  ->  angles/radii below' % (ccx, ccy, rb[0]))
def runs_at(f, row=True, lo=None, hi=None):
    out, s = [], None
    if row:
        yy = int(round(CY + (f - AB / 2.0) / K))
        rng = range(int(CX - R_OUT * 1.25), int(CX + R_OUT * 1.25))
        on = lambda t: kind(t, yy) != '.'
        at = lambda t: ab(t, yy)
    else:
        xx = int(round(CX + (f - AB / 2.0) / K))
        rng = range(int(CY - R_OUT * 1.25), int(CY + R_OUT * 1.25))
        on = lambda t: kind(xx, t) != '.'
        at = lambda t: ab(xx, t)
    for t in rng:
        if not (0 <= t < W if row else 0 <= t < H): continue
        v = on(t)
        if v and s is None: s = t
        elif not v and s is not None:
            a, b = at(s), at(t - 1)
            out.append((round(a[0] if row else a[1], 1), round(b[0] if row else b[1], 1), kind(*( (t-1, yy) if row else (xx, t-1) ))))
            s = None
    return out
print('\nrows (x runs):')
for f in (30, 40, 46, 52, 58, 64, 70, 76, 82, 88, 94):
    print('   y=%2d  %s' % (f, ['%s%.1f..%.1f' % (k, a, b) for a, b, k in runs_at(f, True)]))
print('cols (y runs):')
for f in (10, 20, 30, 40, 45, 50, 60, 70, 75, 90, 100, 110):
    print('   x=%3d %s' % (f, ['%s%.1f..%.1f' % (k, a, b) for a, b, k in runs_at(f, False)]))

# ── 5. wordmark + strapline: navy inside the ring, below the monogram ─────
wm, tagl = [], []
for y in range(int(CY - R_OUT * 1.25), int(CY + R_OUT * 1.25)):
    for x in range(int(CX - R_OUT * 1.25), int(CX + R_OUT * 1.25)):
        if not (0 <= x < W and 0 <= y < H) or kind(x, y) != 'N':
            continue
        a, r = polar(x, y)
        ax, ay = ab(x, y)
        inside_ring = r < MID - stroke / 2.0 - 1.0
        in_mono = nb[0] - 1 < ax < nb[2] + 1 and nb[1] - 1 < ay < nb[3] + 1
        if inside_ring and not in_mono and ay > rb[1] - 3:
            (tagl if ay < rb[3] + 2 and abs(ax - ccx if rb[0] < rb[2] else 0) else wm).append((a, r, ax, ay))
        elif r < MID - stroke / 2.0 - 1.0 and ay > nb[3] - 2 and in_mono:
            tagl.append((a, r, ax, ay))
for lab, P in (('wordmark', wm), ('strapline', tagl)):
    if P:
        A = [p[0] for p in P]; Rr = [p[1] for p in P]
        print('\n%-10s  angle %.0f..%.0f  radius %.1f..%.1f  bbox x %.1f..%.1f y %.1f..%.1f  n=%d'
              % (lab, min(A), max(A), min(Rr), max(Rr), min(p[2] for p in P), max(p[2] for p in P),
                 min(p[3] for p in P), max(p[3] for p in P), len(P)))
        bins = defaultdict(int)
        for p in P: bins[int(p[0] // 10) * 10] += 1
        print('             ink per 10-deg sector: %s' % ' '.join('%d:%d' % (k, v) for k, v in sorted(bins.items())))
