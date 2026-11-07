#!/usr/bin/env python3
"""
check_logo.py — render the brand mark with a real SVG renderer.

    python3 tools/check_logo.py      ->  /tmp/azt_render.png

cairosvg is used because the sandbox ImageMagick has no SVG backend worth
trusting: it drops every fill="none" stroke and ignores text entirely, so an
IMAGe "proof" of these files proves nothing. Registration against the supplied
artwork is measured (not eyeballed) by tools/register_check.py, which also
writes the overlay image.
"""
import io, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cairosvg
from make_logo import art, VB

NAVY, RED = '#222457', '#CB3632'
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" '
       'viewBox="%g %g %g %g"><rect width="132" height="132" x="%g" y="%g" fill="#fff"/>%s</svg>'
       % (VB[0], VB[1], VB[2], VB[3], VB[0], VB[1], art(NAVY, RED)))
cairosvg.svg2png(bytestring=svg.encode(), write_to='/tmp/azt_render.png',
                 output_width=640, output_height=640)
print('rendered /tmp/azt_render.png (%d byte svg)' % len(svg.encode()))
print('for registration against the artwork: python3 tools/register_check.py')
