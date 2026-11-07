#!/usr/bin/env python3
# =============================================================================
#  make_logo.py — the single source of truth for the Al Azhar Tex brand mark.
#
#  Run:  python3 tools/make_logo.py        (then: python3 tools/check_logo.py)
#
#  Everything is driven by one table, SPEC, whose values are MEASURED off the
#  supplied artwork by tools/measure_logo.py, not drawn from memory:
#
#    - the artwork's ring is circle-fit to centre (748.4, 481.2) px with its
#      OUTER edge at radius 426.9 px, from 190 rays over the arc where the ring
#      is the only ink (residual median 2.0 px, and its x/y radii agree to
#      0.1%, so the mark really is circular and the bbox's odd 899x862 extent is
#      the wordmark letters sticking out, not a squashed scan);
#    - the artboard is pinned to that: the ring's outer edge = 56 units on the
#      120-unit board, i.e. 0.13119 artboard units per photo pixel;
#    - so 1 artboard unit == 7.623 photo pixels, and every number below is a
#      pixel measurement divided by 7.623.
#    - tools/register_check.py then rasterises the result back over the photo and
#      reports the overlap per band: ring 0.84, monogram 0.89, crescent 0.79,
#      stars 0.73, wordmark 0.49 — every one of them at zero offset, with the
#      scale sweep peaking at exactly 1.00. That check is what the three earlier
#      guesses, which all looked plausible and all registered poorly, did not.
#
#  What the artwork actually is (this differs from a first impression, which is
#  why the earlier redraw was wrong):
#
#    ring      one navy arc, 89deg -> 286deg (197deg), stroke 6.2 on r=52.9,
#              ends cut flat. It does NOT close: the right-hand sector belongs to
#              the stars and the wordmark, and nothing is drawn behind them.
#    stars     five red stars in that open sector, 295.9 -> 2.3deg, and each one
#              measured singly: they ride the ring's OUTER edge (centres r 53.3
#              to 56.1, so the band is half behind them), they shrink along the
#              arc (circumradius 7.5 down to 5.5) and they are NOT turned to
#              face outward — all five share one rotation, tip at 295deg.
#    wordmark  "AL AZHAR TEX" along the ring's own circle: each of the ten
#              letters on its own measured angle, from 83.5deg (the "A" at the
#              bottom, just inside the ring's lower tip) to 13.7deg (the "X" on
#              the right), baseline r=60 so the caps grow inward to ~53 and the
#              letters overlap where the ring would have been.
#    monogram  a heavy navy bowl (annulus: mid r 12.1, stroke 10.8, so its counter
#              stays a 12x15 white hole) whose lower wall continues right into a
#              crossbar that meets a square-cut stem; the red element is a crescent
#              BAND under the bowl (outer r 19.4, inner 9.0, 11..194deg about its own
#              centre (48.5, 65.5)) - never a filled disc, and its ends are cut
#              radially.
#
#    strapline "FINE FABRICS", 40.7 units wide with a 5.4 cap height - so it is
#              condensed relative to a normal grotesque, hence the negative
#              tracking - sitting flat between the crescent and the wordmark.
#              Its ends droop under a unit, which is not worth drawing.
#
#  Only four SVG primitives are emitted — <path> built from M/L, <circle>,
#  <rect>, <text> with rotate() — so the mark renders identically everywhere:
#  no textPath, no arc flags, no filters, no web fonts, no bitmaps.
#
#  Outputs (all consumed by the app build; nothing is hand-edited downstream):
#    app/logo.svg          standalone lockup, colours baked
#    /tmp/azt_sprite.svg   inline <symbol id="azt-mark"> for index.html
#    /tmp/azt_favicon.txt  data-URI favicon, colours baked, no words
#    /tmp/azt_mark_baked.svg  same geometry, colours baked, for 404.html
# =============================================================================
import math, os

NAVY = '#222457'          # sampled from the supplied artwork
RED  = '#CB3632'          # sampled from the supplied artwork
AB   = 120.0              # artboard edge
VB   = (-6.0, -6.0, 132.0, 132.0)   # the stars/wordmark reach r=63: pad the box

SPEC = dict(
    # ── the ring: 197deg of a circle, tips cut flat. It does NOT close — the
    #    open 163deg sector on the right belongs to the stars and the wordmark,
    #    and nothing is drawn behind them.                                      
    ring_r   = 52.9,        # centreline;  outer 56.0, inner 49.8
    ring_w   = 6.2,
    ring_a0  = 89.0,        # lower tip, just past 6 o'clock, where "AL" begins
    ring_a1  = 286.0,       # upper tip, at 11:30, where the first star begins
    # ── five red stars in the open sector. Measured per star: they are NOT on
    #    the centreline (they straddle the ring's OUTER edge) and they shrink
    #    along the arc, so their radius, size and angle are each given singly.
    star_ang = [295.9, 313.5, 330.9, 347.1,   2.3],
    star_r   = [ 53.3,  54.5,  54.5,  56.4,  56.1],
    star_ro  = [  7.5,   6.9,   6.4,   5.8,   5.5],
    #    they are NOT rotated to face outward: every star's tips land on the
    #    same absolute angles (measured 295, 5, 75, 145, 215), so one constant
    #    rotation fits the whole set — a detail a first redraw always gets wrong.
    star_rot = 295.0,        # angle of a star's leading tip; None = face outward
    # ── the monogram. The "a" bowl is a heavy annulus (its counter is a 12x15
    #    white hole); its lower wall runs out into the crossbar that meets the
    #    square-cut stem. The red crescent is a BAND, never a filled disc, and
    #    its own centre sits below the bowl so the bowl nests in its opening.
    bowl_c   = (47.6, 45.9),
    bowl_rm  = 12.1,
    bowl_w   = 10.8,
    bar      = (44.0, 53.3, 38.6, 10.3),
    stem     = (70.7, 28.2, 11.9, 56.0),
    cres_c   = (48.5, 65.5),
    cres_rm  = 14.15,
    cres_w   = 10.3,
    cres_a0  = 11.0,
    cres_a1  = 194.0,
    # ── the words follow the ring's circle: baseline just outside the ring,
    #    caps growing inward. Each glyph sits at its own measured angle (the
    #    list is the 10 letters of "AL AZHAR TEX", first at the bottom).
    word     = 'AL AZHAR TEX',
    word_r   = 60.0,
    word_a   = [83.5, 77.8, 66.4, 59.8, 52.5, 44.5, 37.3, 26.2, 19.9, 13.7],
    word_fs  = 9.6,
    # ── the strapline is flat, tightly tracked, and 40.7 units wide with a
    #    5.4 cap height — i.e. condensed relative to a normal grotesque.
    tag      = 'FINE FABRICS',
    tag_x    = 63.7,
    tag_y    = 96.5,
    tag_fs   = 7.4,
    tag_ls   = -1.6,
    tag_tilt = 0.0,
)
S = SPEC
FONT = 'Helvetica,Arial,sans-serif'

# --------------------------------------------------------------- primitives --
def polar(r, deg, cx=AB / 2, cy=AB / 2):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy + r * math.sin(a))

def arc_pts(r, a0, a1, step, cx=AB / 2, cy=AB / 2):
    n = max(2, int(abs(a1 - a0) / step))
    return [polar(r, a0 + (a1 - a0) * i / n, cx, cy) for i in range(n + 1)]

def d_poly(pts):
    return 'M' + ' L'.join('%.2f,%.2f' % p for p in pts)

def d_arc(r, a0, a1, step=2.0, cx=AB / 2, cy=AB / 2):
    return d_poly(arc_pts(r, a0, a1, step, cx, cy))

def star_path(ro=6.6):
    """A five-point star, one tip pointing along +x before rotation."""
    p = []
    for k in range(10):
        r = ro if k % 2 == 0 else ro * 0.42
        a = math.radians(k * 36)
        p.append('%.2f,%.2f' % (r * math.cos(a), r * math.sin(a)))
    return 'M' + ' L'.join(p) + 'Z'

STAR = star_path()

def word_angles():
    """(glyph, angle) for the curved wordmark: the letters of S['word'] in order,
    each on its measured angle, so word spaces fall out of the gaps for free."""
    letters = [c for c in S['word'] if c != ' ']
    ang = S['word_a']
    assert len(letters) == len(ang), 'word and word_a must list the same glyphs'
    return list(zip(letters, ang))

# ----------------------------------------------------------------- the SVG ---
def art(navy='currentColor', red='var(--brand-red)', words=True, fine=2.0):
    B, CC, T, BR = S['bowl_c'], S['cres_c'], S['stem'], S['bar']
    out = [
        # the ring: one open arc, tips cut flat, nothing behind the stars
        '<path d="%s" fill="none" stroke="%s" stroke-width="%g" stroke-linecap="butt"/>'
        % (d_arc(S['ring_r'], S['ring_a0'], S['ring_a1'], fine), navy, S['ring_w']),
        # the "a": heavy bowl, its counter left as a white hole
        '<circle cx="%g" cy="%g" r="%g" fill="none" stroke="%s" stroke-width="%g"/>'
        % (B[0], B[1], S['bowl_rm'], navy, S['bowl_w']),
        # its lower wall runs out into the crossbar that meets the stem
        '<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>' % (BR + (navy,)),
        # the stem: square corners, clear of the bowl by 6 units
        '<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>' % (T + (navy,)),
        # the crescent: a BAND (never a filled disc) cradling the bowl
        '<path d="%s" fill="none" stroke="%s" stroke-width="%g" stroke-linecap="butt"/>'
        % (d_arc(S['cres_rm'], S['cres_a0'], S['cres_a1'], fine, CC[0], CC[1]), red, S['cres_w']),
        # five stars, one point outward, straddling the ring's outer edge
        '<g fill="%s">' % red + ''.join(
            '<path d="%s" transform="translate(%.2f,%.2f) rotate(%.1f)"/>'
            % (star_path(ro), polar(rr, a)[0], polar(rr, a)[1],
               a if S['star_rot'] is None else S['star_rot'])
            for a, rr, ro in zip(S['star_ang'], S['star_r'], S['star_ro'])) + '</g>',
    ]
    if words:
        for ch, a in word_angles():
            if ch == ' ':
                continue
            x, y = polar(S['word_r'], a)
            out.append('<text x="%.2f" y="%.2f" transform="rotate(%.2f %.2f %.2f)" '
                       'text-anchor="middle" font-family="%s" font-size="%g" '
                       'font-weight="700" fill="%s">%s</text>'
                       % (x, y, a - 90, x, y, FONT, S['word_fs'], navy, ch))
        tx, ty = S['tag_x'], S['tag_y']
        out.append('<text x="%g" y="%g" text-anchor="middle" '
                   'transform="rotate(%g %g %g)" font-family="%s" font-size="%g" '
                   'font-style="italic" font-weight="700" letter-spacing="%g" '
                   'fill="%s">%s</text>'
                   % (tx, ty, S['tag_tilt'], tx, ty, FONT, S['tag_fs'], S['tag_ls'],
                      navy, S['tag']))
    return ''.join(out)

HEAD = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%g %g %g %g"' % VB)

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out  = lambda n: os.path.join('/tmp', n)

    # 1. the standalone lockup, colours baked
    svg = ('%s width="640" height="640"><title>Al Azhar Tex — Fine Fabrics</title>'
           '<desc>Navy ring arc with five red stars and the words AL AZHAR TEX; '
           'the monogram is a navy bowl and stem cradled by a red crescent.</desc>'
           '%s</svg>' % (HEAD, art(NAVY, RED)))
    p = os.path.join(root, 'app', 'logo.svg')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(svg)
    print('logo.svg (full lockup): %d bytes' % len(svg))

    # 2. the inline sprite the app references with <use href="#azt-mark">
    sym = ('<symbol id="azt-mark" viewBox="%g %g %g %g">%s</symbol>'
           % (VB[0], VB[1], VB[2], VB[3], art()))
    with open(out('azt_sprite.svg'), 'w', encoding='utf-8') as f:
        f.write(sym)
    print('inline sprite (symbol): %d bytes' % len(sym))

    # 3. the favicon: no words, no stars — it has to survive 16px
    compact = ('%s width="64" height="64">%s</svg>'
               % ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 112 112"',
                  art(NAVY, RED, words=False)))
    uri = 'data:image/svg+xml,' + ''.join(
        c if (c.isalnum() or c in "-._~") else '%%%02X' % ord(c)
        for c in compact)
    with open(out('azt_favicon.txt'), 'w', encoding='utf-8') as f:
        f.write(uri)
    print('favicon data uri      : %d bytes' % len(uri))

    # 4. the baked copy for 404.html (a page outside the app, no CSS variables)
    baked = '%s>%s</svg>' % (HEAD, art(NAVY, RED))
    with open(out('azt_mark_baked.svg'), 'w', encoding='utf-8') as f:
        f.write(baked)
    print('404 baked mark        : %d bytes' % len(baked))
    print('\nnext: python3 tools/check_logo.py   (renders + registers the mark '
          'on the supplied artwork)')

if __name__ == '__main__':
    main()
