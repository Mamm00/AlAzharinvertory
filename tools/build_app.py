#!/usr/bin/env python3
"""
build_app.py — regenerate the brand artwork and build everything under app/.

    python3 tools/build_app.py            # write app/
    python3 tools/build_app.py --check    # fail if app/ is not what this builds

app/ is a BUILD DIRECTORY in spirit: every file in it is produced here, so no
file in app/ is ever hand-edited and `--check` can prove a shipped file matches
its source. Sources live in src/ — deliberately not in a directory called
"build", which the sandbox (and plenty of CI tooling) treats as disposable.

  src/app.src.html    the single-file app, with two markers where the brand
                      artwork belongs:  <!--@SPRITE-->  <!--@FAVICON-->
  src/404.src.html    the GitHub Pages fallback page, with <!--@MARK-->
  src/README.app.md   the readme that ships inside app/

Output:  app/index.html  app/404.html  app/logo.svg  app/README.md  app/.nojekyll

Afterwards:  node test.js && node test-ui.js && node lint.js
"""
import io, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import make_logo

rd = lambda p: io.open(os.path.join(ROOT, p), encoding='utf-8').read()
TMP = lambda n: os.path.join('/tmp', n)


def build(dest_dir):
    """Write the five shipped files under dest_dir; return {name: text}."""
    make_logo.main()                                   # also writes app/logo.svg
    sprite  = io.open(TMP('azt_sprite.svg'),  encoding='utf-8').read().strip()
    favicon = io.open(TMP('azt_favicon.txt'), encoding='utf-8').read().strip()
    baked   = io.open(TMP('azt_mark_baked.svg'), encoding='utf-8').read()
    body    = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', baked).strip()
    vb      = re.search(r'viewBox="([^"]+)"', baked).group(1)

    app = rd('src/app.src.html')
    assert app.count('<!--@SPRITE-->') == 1 and app.count('<!--@FAVICON-->') == 1
    app = (app.replace('<!--@SPRITE-->',
                       '<svg width="0" height="0" style="position:absolute" aria-hidden="true" '
                       'focusable="false">' + sprite + '</svg>')
              .replace('<!--@FAVICON-->',
                       '<link rel="icon" type="image/svg+xml" href="%s">' % favicon))
    assert 'alert(' not in app and 'confirm(' not in app.replace('confirmPassword', '')

    page = rd('src/404.src.html')
    assert page.count('<!--@MARK-->') == 1
    page = page.replace('<!--@MARK-->',
                        '<svg width="72" height="72" viewBox="%s" role="img" '
                        'aria-label="Al Azhar Tex">%s</svg>' % (vb, body))

    out = {'index.html': app, '404.html': page,
           'README.md': rd('src/README.app.md'), '.nojekyll': '',
           'logo.svg': rd('app/logo.svg')}
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)
        for name, txt in out.items():
            io.open(os.path.join(dest_dir, name), 'w', encoding='utf-8', newline='').write(txt)
    return out


def main():
    check = '--check' in sys.argv
    out = build(None if check else os.path.join(ROOT, 'app'))
    if not check:
        # logo.svg is written by make_logo into app/ already; report the rest
        for n in ('index.html', '404.html', 'README.md', 'logo.svg'):
            print('  app/%-11s %7d bytes' % (n, os.path.getsize(os.path.join(ROOT, 'app', n))))
        print('app/ built from src/ + tools/make_logo.py')
        return 0
    bad = []
    for name, txt in out.items():
        p = os.path.join(ROOT, 'app', name)
        have = io.open(p, encoding='utf-8', newline='').read() if os.path.exists(p) else None
        if have != txt:
            bad.append(name)
    if bad:
        print('DRIFT: these files are not what the sources build: %s' % ', '.join(bad))
        print('fix:   python3 tools/build_app.py   (then commit the result)')
        return 1
    print('app/ is exactly what src/ + tools/make_logo.py build (%d files checked)' % len(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
