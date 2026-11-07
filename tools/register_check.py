#!/usr/bin/env python3
"""
register_check.py — objective alignment between the redrawn mark and the artwork.

    python3 tools/register_check.py

Rasterises the geometry tools/make_logo.py emits at the artwork's own scale and
compares it band by band with the ink actually present in the photo, then
reports the IoU at zero offset and the IoU at the best small shift found by
search.  Numbers rather than impressions:

  IoU at (0,0) ~ 0.7+ and best-shift ~ 0 px   the redraw sits on the artwork's
  geometry; a large best-shift means a SPEC value was measured against a wrong
  centre; a low IoU at any shift means the shape itself is wrong, not placed
  wrong.

Reference: the ring's outer boundary, circle-fit over the 197deg arc where only
the ring exists (190 rays, residual median 2.0 px), gives centre (748.4, 481.2)
px, outer radius 426.9 px, stroke 47.0 px on the 1536x1024 photo -> 0.13119
artboard units per px, so ring centreline r = 52.92 and stroke 6.17.
"""
import io, math, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cairosvg
from make_logo import art, AB, SPEC as S

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'uploads', 'IMG-20260504-WA0035.jpg')
CX, CY, ROUT, RAB = 748.4, 481.2, 426.9, 56.0      # photo px, artboard units
SCALE = ROUT / RAB                                   # photo px per artboard unit
K = RAB / ROUT                                       # artboard units per photo px

im = Image.open(SRC).convert('RGB')
W, H = im.size
a = np.asarray(im).astype(int)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
white = (R > 230) & (G > 230) & (B > 230)
redm = (R > 100) & (G < 110) & (B < 115) & ((R - np.maximum(G, B)) > 40)
navy = (~white) & (~redm)
yy, xx = np.mgrid[0:H, 0:W]
RAD = np.hypot(xx - CX, yy - CY) * K
ANG = np.degrees(np.arctan2(yy - CY, xx - CX)) % 360.0

# Each band is compared inside its own frame: a window in (radius, angle) around
# the element, so a mark that overlaps its own ink scores well and one that does
# not, does not.  The reference is any ink in that frame.
ink_any = ~white
F = lambda r0, r1, a0, a1: ((RAD > r0) & (RAD < r1) &
                            (((ANG >= a0) & (ANG <= a1)) if a0 <= a1
                             else ((ANG >= a0) | (ANG <= a1))))
BANDS = {
    'ring      ': (F(46, 60, 86, 289), ink_any),
    'stars     ': (F(43, 67, 289, 12), ink_any),
    'crescent  ': (F(3, 42, 40, 200), ink_any),
    'monogram  ': (F(0, 46, 200, 350), ink_any),
    'wordmark  ': (F(44, 64, 13, 88), ink_any),
}

def render(shift=(0, 0), scale=1.0):
    sc = SCALE * scale
    ox, oy = CX - (AB / 2) * sc + shift[0], CY - (AB / 2) * sc + shift[1]
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
           '<rect width="%d" height="%d" fill="#000"/>'
           '<g fill="#fff" stroke="#fff"><g transform="translate(%.3f,%.3f) scale(%.5f)">%s'
           '</g></g></svg>' % (W, H, W, H, W, H, ox, oy, sc, art('#fff', '#fff')))
    m = np.asarray(Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode())))
                   .convert('L').resize((W, H))) > 110
    return m

def iou(v, r):
    u = (v | r).sum()
    return (v & r).sum() / u if u else 0.0

def per_band(mask, frame, ref):
    return iou(mask & frame, ref & frame)

full = render()
print('photo %dx%d   artboard->photo %.4f px/unit   centre (%.1f, %.1f) px\n'
      % (W, H, SCALE, CX, CY))
print('band        IoU@0,0  best shift (px)  IoU@best   ink px')
for lab, (frame, ref) in BANDS.items():
    best = max(((per_band(render((dx, dy)), frame, ref), dx, dy)
                for dx in range(-24, 25, 6) for dy in range(-24, 25, 6)))
    print('%s    %5.3f     %+4d, %+4d      %5.3f    %d'
          % (lab, per_band(full, frame, ref), best[1], best[2], best[0], (ref & frame).sum()))

# ── a picture to go with the numbers: the vector in green over the artwork ──
base = np.asarray(Image.open(SRC).convert('RGB')).copy()
green = np.array([0, 200, 90], dtype=np.uint8)
out = base.astype(np.int16)
out[full] = (out[full] * 0.42 + green * 0.58).astype(np.int16)
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save('/tmp/azt_overlay.png')
print('\nwrote /tmp/azt_overlay.png (the rendered mark over the artwork)')

# scale sensitivity: which radius does the artwork want?
print('\nscale sweep (whole mark vs all ink inside r<63):')
ink = (~white) & (RAD < 63.0)
for f in (0.94, 0.97, 1.00, 1.03, 1.06):
    print('   x%.2f  IoU %.3f' % (f, iou(render(scale=f), ink)))
