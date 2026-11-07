#!/usr/bin/env python3
"""
build_site.py — assemble the GitHub Pages site in site/ from the project's sources.

    python3 tools/build_site.py           # write site/ (+ workflow, .nojekyll)
    python3 tools/build_site.py --check   # fail if site/ is stale or wrong

Why it is generated rather than hand-written: this page advertises the app, so
every number on it is read out of the app and the brand at build time — the file
size, the view count, the role list, the colour catalogue, the string count, the
version, the palette and the artwork. A hand-copied landing page is how the
brand and the marketing copy drifted apart once already.

Inputs                       Outputs
  web/index.src.html  ────────  site/index.html      (the landing page)
  /tmp/azt_sprite.svg           site/app/index.html  (byte-identical copy)
  /tmp/azt_favicon.txt          site/app/README.md
  app/index.html                site/404.html        (Pages has no rewrites)
  tools/make_logo.py            site/logo.svg, site/.nojekyll, .nojekyll
                                .github/workflows/pages.yml

Order matters for a release:  python3 tools/build_app.py && python3 tools/build_site.py
Both --check modes are wired into the workflow, so a commit that forgets to
regenerate fails CI instead of shipping a stale site.
"""
import io, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import make_logo

rd = lambda p: io.open(os.path.join(ROOT, p), encoding='utf-8').read()
TMP = lambda n: os.path.join('/tmp', n)


def balanced(text, opener_re, open_ch='{', close_ch='}'):
    """Return the contents of the { } or [ ] block that opener_re points at."""
    m = re.search(opener_re, text)
    if not m:
        raise LookupError(opener_re)
    i = text.index(open_ch, m.end() - 1)
    depth, j = 0, i
    while j < len(text):
        c = text[j]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return text[i + 1:j]
        j += 1
    raise LookupError('unbalanced: ' + opener_re)


def raw_of(app):
    return balanced(app, r'var\s+I18N_RAW\s*=')


def strip_comments(text):
    return re.sub(r'/\*.*?\*/', '', text, flags=re.S)


def top_blocks(text):
    """[(name, inner)] for the top-level `Name: { ... }` entries of an object body."""
    out, i = [], 0
    while i < len(text):
        m = re.compile(r'(\w+)\s*:\s*\{').search(text, i)
        if not m:
            break
        start = text.index('{', m.end() - 1)
        depth, j = 0, start
        while j < len(text):
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append((m.group(1), text[start + 1:j]))
        i = j + 1
    return out


# The tick matrix is generated, never typed: a hand-written permissions table is
# exactly the kind of claim that quietly outlives the code it describes. Cell text
# is English for no-JS readers and is replaced by applyLang() from the page's own
# dictionary, which test-site.js cross-checks against these words.
CELL = {'yes': ('y', 'acc.yes', 'yes'), 'no': ('n', 'acc.no', 'no'),
        'ro': ('n', 'acc.ro', 'read only'), 'own': ('s', 'acc.own', 'own sheds only'),
        'all': ('y', 'acc.all', 'all sites')}


def perm_rows(app, view_count):
    perms = top_blocks(strip_comments(balanced(app, r'(?:var\s+)?PERMS\s*=')))
    scoped_actions = set(re.findall(r'^\s{2}(\w+)\s*:',
                                    strip_comments(balanced(app, r'var\s+SCOPED_ACTIONS\s*=')), re.M))
    views_src = strip_comments(balanced(app, r'var\s+VIEWS_FOR_ROLE\s*='))
    views_for = dict((m.group(1), re.findall(r"'([\w.]+)'", m.group(2)))
                     for m in re.finditer(r'(\w+)\s*:\s*\[([^\]]*)\]', views_src))
    # which roles the app itself treats as warehouse-scoped — read from the guards,
    # not from a guess: they all spell it out as  user.role === 'X'  /  !== 'X'
    scoped_roles = set(re.findall(r"user\.role\s*[!=]==\s*'(\w+)'", app))
    if any(a in scoped_actions for _name, body in perms for a in re.findall(r'(\w+)\s*:', body)) \
            and not scoped_roles:
        raise SystemExit('build_site: SCOPED_ACTIONS exist but no scoped role was detected '
                         'in user.role checks — the permissions table would be wrong')

    def cell(kind):
        cls, key, text = CELL[kind]
        return '<td class="%s" data-i18n="%s">%s</td>' % (cls, key, text)

    def has(flags, *a):
        return all(x in flags for x in a)

    rows = []
    for role, body in perms:
        flags = set(re.findall(r'(\w+)\s*:', strip_comments(body)))
        scoped = role in scoped_roles
        see = ('all' if not scoped else 'own') if 'viewAll' in flags else 'no'
        own = 'no'
        if has(flags, 'editInventory', 'editMovements'):
            own = 'own' if scoped else 'yes'
        mp = 'no'
        if 'editMapping' in flags:
            mp = 'own' if scoped else 'yes'
        cat = 'yes' if has(flags, 'editFabric', 'editColor') else ('ro' if 'viewAll' in flags else 'no')
        exp = 'yes' if 'exportData' in flags else 'no'
        st = 'yes' if has(flags, 'manageUsers', 'editSettings') else 'no'
        n_screens = len(views_for.get(role, []))
        tds = ''.join(cell(k) for k in (see, own, mp, cat, exp, st))
        if role not in views_for:
            raise SystemExit('build_site: role %s has PERMS but no VIEWS_FOR_ROLE entry — '
                             'the Screens column would lie' % role)
        rows.append('<tr><td><b>%s</b></td><td><b>%d</b> / %d</td>%s</tr>'
                    % (role, len(views_for[role]), view_count, tds))
    if len(rows) < 2:
        raise SystemExit('build_site: PERMS parsed to %d roles — the extractor is off' % len(rows))
    return '\n          '.join(rows)


def facts(app):
    """Everything the landing page claims, measured from the app source."""
    ver = re.search(r"version:\s*'([\d.]+)'", app)
    routes = balanced(app, r'var ROUTES\s*=')
    views = re.findall(r'^\s{2}(\w+):\s*\{\s*title:', routes, re.M)
    # Roles come from the role.* label keys the UI itself renders — that is what a
    # reader of "N roles" means. (PERMS is keyed the same way but a role may inherit
    # another's block, so it is not the authority.)
    roles = sorted(set(re.findall(r"^\s*'role\.(\w+)'\s*:", raw_of(app), re.M)))
    nav = re.findall(r"NAV_ORDER\s*=\s*\[([^\]]*)\]", app)
    if nav and len(re.findall(r"'[\w.]+'", nav[0])) != len(views):
        raise SystemExit('build_site: ROUTES (%d) and NAV_ORDER (%d) disagree — '
                         'the landing page quotes both, fix the app or the extractor'
                         % (len(views), len(re.findall(r"'[\w.]+'", nav[0]))))
    perms = balanced(app, r'(?:var\s+)?PERMS\s*=')
    # the market catalogue the Masters tab seeds, counted row by row
    catalog = balanced(app, r'var\s+COLOR_CATALOG\s*=\s*\[', '[', ']')
    colours = len(re.findall(r"^\s*\['col-", catalog, re.M))
    # I18N_RAW is the single table every UI string comes from: 'key': [en, ar].
    # I18N.en / I18N.ar are built from it at load, so the language count and the
    # string count are both read from here rather than assumed.
    raw = raw_of(app)
    strings = len(re.findall(r"^\s*'[\w.]+'\s*:\s*\[", raw, re.M))
    shim = re.search(r'var\s+I18N\s*=\s*\{([^;]*)\};', app)
    langs = len(re.findall(r'(\w+)\s*:\s*\{\}', shim.group(1))) if shim else 0
    # the shipped single file, not the source it was built from — the sprite and
    # favicon are spliced in, so the shipped page is the bigger one.
    size = os.path.getsize(os.path.join(ROOT, 'app', 'index.html'))
    for name, val in (('version', ver), ('views', views), ('roles', roles),
                      ('colours', colours), ('strings', strings)):
        if not val:
            raise SystemExit('build_site: could not read %s from the app source — '
                             'the app changed shape, fix the extractor (never the page)' % name)
    return {
        'VERSION': ver.group(1),
        'VIEWS': str(len(views)),
        'ROLES': str(len(roles)),
        'COLOURS': str(colours),
        'STRINGS': str(strings),
        'LANGS': str(langs),
        'SIZE_KB': str(round(size / 1024)),
        'NAVY': make_logo.NAVY,
        'RED': make_logo.RED,
        'ROLES_LIST': ' · '.join(roles),
        'VIEWS_LIST': ' · '.join(views),
    }


def subst(text, vals):
    for k, v in vals.items():
        text = text.replace('{{%s}}' % k, v)
    left = sorted(set(re.findall(r'\{\{([A-Z_]+)\}\}', text)))
    if left:
        raise SystemExit('build_site: no value supplied for %s' % ', '.join(left))
    return text


SITE_404 = """<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Al Azhar Tex — opening the app</title>
<!--@FAVICON-->
<style>
  :root{--navy:{{NAVY}};--red:{{RED}}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F8FC;
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,
    "Noto Sans","Noto Sans Arabic",sans-serif;color:#1B1D47}
  .card{background:#fff;border:1px solid #E3E7F1;border-radius:18px;padding:30px 32px;
    max-width:520px;width:90vw;box-shadow:0 10px 30px -18px rgba(27,29,71,.28);text-align:center}
  .card svg{width:72px;height:72px;color:var(--navy)}
  h1{font-size:20px;margin:14px 0 6px;color:var(--navy)}
  p{margin:0 0 18px;color:#5A6178;font-size:14.5px}
  code{background:#f1f3fa;padding:2px 6px;border-radius:6px;font-size:.9em}
  a{color:var(--navy);font-weight:700}
  .bar{height:4px;background:#e6ebf1;border-radius:4px;overflow:hidden;margin-top:20px}
  .bar i{display:block;height:100%;width:40%;background:var(--red);animation:go 1.2s linear infinite}
  @keyframes go{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
</style>
</head>
<body>
  <div class="card">
    <!--@MARK-->
    <h1>Al Azhar Tex · Fabric Roll Inventory</h1>
    <p>This is a single-page application: every view is a hash route (for example
       <code>#/reports</code>), and GitHub Pages has no rewrite rules. This page reads
       the address you asked for and is taking you to the right place.</p>
    <p><a id="manual" href="./">Continue to the site →</a></p>
    <div class="bar"><i></i></div>
  </div>
<script>
(function () {
  'use strict';
  /* /app/<anything> and /app → the app, with the path turned into a hash route.
     That is the case worth automating, because it is an absolute path and so
     works at any deployment depth, including /repo/app/#/reports typed by hand.
     Anything else falls back to ./ — the landing page sits at the deploy root;
     GitHub Pages offers no rewrite rules, which is why the app routes on the
     hash instead of on the path. */
  var p = location.pathname, target = './', link = document.getElementById('manual');
  var m = p.match(/^(.*\\/app)(?:\\/index\\.html)?(?:\\/(.*))?$/i);
  if (m) {
    var dir = m[1].replace(/\\/+$/, '');
    var rest = (m[2] || '').replace(/^\\/+/, '').replace(/\\/+$/, '');
    target = dir + '/index.html' + (location.hash || (rest ? '#/' + rest : ''));
  } else if (/\\/logo\\.svg$/i.test(p)) {
    target = './logo.svg';
  }
  if (link) link.setAttribute('href', target);
  setTimeout(function () { location.replace(target); }, 60);
}());
</script>
</body>
</html>
"""

WORKFLOW = """# Publishes site/ to GitHub Pages and refuses to ship a stale site.
#
# Two repository settings have to agree with this file, and both are outside the
# reach of GITHUB_TOKEN, so they are one-time clicks in the web UI:
#
#   1. Settings -> Pages -> Build and deployment -> Source = GitHub Actions
#      ("Deploy from a branch" pins the site to a single branch, serves that
#      branch *instead of* any artifact, and rejects this job with
#      "Deployments are only allowed from <branch>".)
#   2. Settings -> Environments -> github-pages -> Deployment branches and tags
#      = the branch named under `on: push:` below, usually `main`
#      (otherwise Actions is refused before the job starts with
#      "Branch \"main\" is not allowed to deploy to github-pages".)
#
# The preflight step diagnoses both and prints the exact fix, so a deployment
# failure names its cause instead of spending an afternoon on the YAML.
name: pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: '3.x'
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
      - name: Install Pillow (brand rasteriser only; the app needs nothing)
        run: python -m pip install --quiet pillow
      - name: Install jsdom (the test harnesses only; the app needs nothing)
        run: npm ci --no-audit --no-fund
      - name: app/ must equal what src/ builds
        run: |
          python3 tools/build_app.py --check || {
            echo "::error::app/ is stale — run: python3 tools/build_app.py"; exit 1; }
      - name: site/ must equal what the sources build
        run: |
          python3 tools/build_site.py --check || {
            echo "::error::site/ is stale — run: python3 tools/build_site.py"; exit 1; }
      - name: The four suites — logic, UI, site, hygiene
        run: |
          node test.js
          node test-ui.js
          node test-site.js
          node lint.js
  deploy:
    needs: verify
    environment:
      name: github-pages
      url: ${{ steps.pages.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Preflight — the Pages source must be GitHub Actions
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          cfg=$(gh api "repos/$GITHUB_REPOSITORY/pages" 2>/dev/null || true)
          if [ -z "$cfg" ]; then
            echo "::error::GitHub Pages is not enabled for this repository. Fix: Settings -> Pages -> Build and deployment -> Source = GitHub Actions."
            exit 1
          fi
          build_type=$(printf '%s' "$cfg" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("build_type",""))')
          echo "Pages build_type: $build_type"
          if [ "$build_type" != "workflow" ]; then
            src=$(printf '%s' "$cfg" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("source") or {}; print(s.get("branch","?")+s.get("path",""))')
            echo "::error::Pages serves '$build_type' from branch $src, so this artifact would be ignored. Fix: Settings -> Pages -> Build and deployment -> Source = GitHub Actions. One-time click; the site then rebuilds from site/ on every push."
            exit 1
          fi
      - uses: actions/configure-pages@v6
        with:
          # Creates the Pages site on the very first run (needs a token with
          # administration:write; GITHUB_TOKEN cannot, in which case this is a
          # no-op for a site that already exists).
          enablement: true
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site
          # .nojekyll is a dotfile; without it Pages would run Jekyll over the
          # output and refuse to publish anything Jekyll considers special.
          include-hidden-files: true
      - id: pages
        uses: actions/deploy-pages@v5
"""


def build():
    """Return ({relpath: text}, facts) for everything the site builder owns."""
    app = rd('src/app.src.html')
    f = facts(app)

    page = rd('web/index.src.html')
    rows = perm_rows(app, int(f['VIEWS']))
    assert page.count('<!--@PERMTABLE-->') == 1
    page = subst(page.replace('<!--@PERMTABLE-->', rows), f)
    sprite = io.open(TMP('azt_sprite.svg'), encoding='utf-8').read().strip()
    favicon = io.open(TMP('azt_favicon.txt'), encoding='utf-8').read().strip()
    icon_link = '<link rel="icon" type="image/svg+xml" href="%s">' % favicon
    assert page.count('<!--@SPRITE-->') == 1 and page.count('<!--@FAVICON-->') == 1
    page = (page.replace('<!--@SPRITE-->',
                         '<svg width="0" height="0" style="position:absolute" aria-hidden="true" '
                         'focusable="false">' + sprite + '</svg>')
                .replace('<!--@FAVICON-->', icon_link))

    four04 = subst(SITE_404, f).replace('<!--@FAVICON-->', icon_link)
    baked = io.open(TMP('azt_mark_baked.svg'), encoding='utf-8').read()
    body = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', baked).strip()
    vb = re.search(r'viewBox="([^"]+)"', baked).group(1)
    four04 = four04.replace('<!--@MARK-->',
                            '<svg viewBox="%s" role="img" aria-label="Al Azhar Tex">%s</svg>' % (vb, body))
    for name, txt in (('web/index.src.html', page), ('the 404 template', four04)):
        if '<!--@' in txt or '{{' in txt:
            raise SystemExit('build_site: %s still has an unspliced marker or placeholder' % name)

    out = {
        'site/index.html': page,
        'site/404.html': four04,
        'site/app/index.html': rd('app/index.html'),
        'site/app/README.md': rd('src/README.app.md'),
        'site/logo.svg': rd('app/logo.svg'),
        'site/.nojekyll': '',
        '.nojekyll': '',
        '.github/workflows/pages.yml': WORKFLOW,
    }
    return out, f


def main():
    check = '--check' in sys.argv
    if not os.path.exists(TMP('azt_sprite.svg')):
        make_logo.main()
    if not os.path.exists(os.path.join(ROOT, 'app', 'index.html')):
        raise SystemExit('build_site: app/index.html missing — run tools/build_app.py first')
    out, f = build()
    bad = []
    for rel, txt in out.items():
        p = os.path.join(ROOT, rel)
        if check:
            have = io.open(p, encoding='utf-8', newline='').read() if os.path.exists(p) else None
            if have != txt:
                bad.append(rel)
            continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        io.open(p, 'w', encoding='utf-8', newline='').write(txt)
    if check:
        if bad:
            print('DRIFT: not what the sources build: %s' % ', '.join(bad))
            print('fix:   python3 tools/build_site.py   (then commit the result)')
            return 1
        print('site/ is exactly what the sources build (%d files checked)' % len(out))
        return 0
    for rel in sorted(out):
        print('  %-32s %7d bytes' % (rel, len(out[rel].encode())))
    print('\nsite/ built · v%(VERSION)s · %(VIEWS)s views · %(ROLES)s roles · '
          '%(COLOURS)s colours · %(STRINGS)s strings × %(LANGS)s languages · '
          '%(SIZE_KB)s KB app' % f)
    print('  views: %(VIEWS_LIST)s' % f)
    print('  roles: %(ROLES_LIST)s' % f)
    return 0


if __name__ == '__main__':
    sys.exit(main())
