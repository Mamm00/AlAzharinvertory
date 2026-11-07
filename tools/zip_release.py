#!/usr/bin/env python3
"""
zip_release.py — build the one archive that is the whole project, ready to deploy.

    python3 tools/zip_release.py                 # writes ../al-azhar-tex-inventory-<version>.zip
    python3 tools/zip_release.py --outdir REL    # write it somewhere else
    python3 tools/zip_release.py --list          # print the manifest, write nothing
    python3 tools/zip_release.py --check-files   # verify an extracted archive (no git needed)

Contents = `git ls-files`, i.e. exactly what the repository holds: sources, tools,
tests, the generated app/ and site/, .nojekyll, the Pages workflow. Never
node_modules (dev-only; `npm ci` recreates it) and never .git.

Everything is namespaced under a single top folder, al-azhar-tex-inventory/, so
extracting anywhere gives you a repo root rather than 37 files loose in your home
directory.

The build is verified, not assumed: the archive is re-opened, every entry is
compared byte-for-byte with the file it came from, the deploy-critical files are
required to be present, and executable bits are checked. A `<zip>.sha256` sidecar
is written so whoever receives it can prove nothing changed in transit.
"""
import hashlib
import io
import os
import re
import stat
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PREFIX = 'al-azhar-tex-inventory'

# A deploy that is missing any of these is broken in a way you only discover
# after the URL is already shared.
REQUIRED = [
    'site/index.html',
    'site/app/index.html',
    'site/404.html',
    'site/logo.svg',
    'site/.nojekyll',
    'app/index.html',
    'app/logo.svg',
    'app/README.md',
    'app/404.html',
    'app/.nojekyll',
    '.nojekyll',
    'README.md',
    '.github/workflows/pages.yml',
    'src/app.src.html',
    'web/index.src.html',
    'tools/build_app.py',
    'tools/build_site.py',
    'tools/make_logo.py',
    'tools/check.sh',
    'tools/serve.py',
    'test.js',
    'test-ui.js',
    'test-site.js',
    'lint.js',
    'package.json',
    'package-lock.json',
]


def git_dir():
    r = subprocess.run(['git', 'rev-parse', '--git-dir'], cwd=ROOT, capture_output=True)
    return r.returncode == 0


def tracked_files():
    if not git_dir():
        raise SystemExit('zip_release: %s is not a git repository, so there is no manifest to '
                         'package. Init one (git init -b main && git add -A) — or, if this is an '
                         'unzipped release, run: python3 tools/zip_release.py --check-files' % ROOT)
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True).stdout
    files = [f.decode() for f in out.split(b'\0') if f]
    if not files:
        raise SystemExit('zip_release: git ls-files returned nothing — is this a repo?')
    missing = [f for f in files if not os.path.isfile(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit('zip_release: tracked but not on disk: %s' % ', '.join(missing))
    return sorted(files)


def version():
    src = io.open(os.path.join(ROOT, 'src', 'app.src.html'), encoding='utf-8').read()
    m = re.search(r"version:\s*'([\d.]+)'", src)
    if not m:
        raise SystemExit('zip_release: no APP version in src/app.src.html')
    return m.group(1)


def build(outdir, do_list=False):
    files = tracked_files()
    for req in REQUIRED:
        if req not in files:
            raise SystemExit('zip_release: %s is not tracked by git, and a release '
                             'without it cannot deploy' % req)
    name = '%s-%s.zip' % (PREFIX, version())
    path = os.path.join(outdir, name)
    os.makedirs(outdir, exist_ok=True)
    if do_list:
        for f in files:
            print('  %-34s %8d' % (f, os.path.getsize(os.path.join(ROOT, f))))
        print('%d files, %d bytes total' % (len(files),
              sum(os.path.getsize(os.path.join(ROOT, f)) for f in files)))
        return None

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            src = os.path.join(ROOT, f)
            info = zipfile.ZipInfo(os.path.join(PREFIX, f), date_time=RELEASE_TIME)
            mode = os.stat(src).st_mode
            # 0755 for the two files people run directly, 0644 for the rest
            exec_bit = f.endswith('.sh') or (f.endswith('.py') and f.startswith('tools/'))
            info.create_system = 3                     # unix
            info.external_attr = (0o755 if exec_bit else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(src, 'rb') as fh:
                z.writestr(info, fh.read())

    verify(path, files)
    sha = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    io.open(path + '.sha256', 'w', encoding='utf-8').write(
        '%s  %s\n' % (sha, os.path.basename(path)))
    size = os.path.getsize(path)
    print('%s' % path)
    print('  %d files · %s MB in, %s MB out (%.1f%% of the folder) · sha256 %s…'
          % (len(files),
             sum(os.path.getsize(os.path.join(ROOT, f)) for f in files) / 1e6,
             size / 1e6, 100.0 * size / sum(os.path.getsize(os.path.join(ROOT, f)) for f in files),
             sha[:16]))
    return path


RELEASE_TIME = (2026, 1, 1, 0, 0, 0)   # fixed, so two builds of one commit match


def verify(path, files):
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit('zip_release: corrupt entry in the archive: %s' % bad)
        names = set(z.namelist())
        want = set(os.path.join(PREFIX, f) for f in files)
        if names != want:
            raise SystemExit('zip_release: archive does not match git ls-files · missing: [%s] · extra: [%s]'
                             % (', '.join(sorted(want - names)), ', '.join(sorted(names - want))))
        for f in files:
            arc = os.path.join(PREFIX, f)
            inside = z.read(arc)
            on_disk = open(os.path.join(ROOT, f), 'rb').read()
            if inside != on_disk:
                raise SystemExit('zip_release: %s inside the zip is not the file on disk' % f)
            mode = (z.getinfo(arc).external_attr >> 16) & 0o777
            should_run = f.endswith('.sh') or (f.endswith('.py') and f.startswith('tools/'))
            if should_run and not mode & stat.S_IXUSR:
                raise SystemExit('zip_release: %s lost its executable bit' % f)
            if not should_run and mode & stat.S_IXUSR:
                raise SystemExit('zip_release: %s should not be executable' % f)
        for req in REQUIRED:
            if os.path.join(PREFIX, req) not in names:
                raise SystemExit('zip_release: archive is missing %s' % req)


def check_files():
    """For an extracted archive: no git, so assert the deploy set is on disk."""
    missing = [f for f in REQUIRED if not os.path.isfile(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit('zip_release: this copy is missing %d deploy-critical file(s):\n  %s'
                         % (len(missing), '\n  '.join(missing)))
    present = [(f, os.path.getsize(os.path.join(ROOT, f))) for f in REQUIRED]
    print('all %d deploy-critical files present · site/index.html %d B · app/index.html %d B'
          % (len(REQUIRED), dict(present)['site/index.html'], dict(present)['app/index.html']))
    print('  run the suites here with: bash tools/check.sh')
    return 0


def main():
    args = sys.argv[1:]
    if '--check-files' in args:
        return check_files()
    outdir = ROOT
    if '--outdir' in args:
        outdir = os.path.join(ROOT, args[args.index('--outdir') + 1])
    build(outdir, do_list='--list' in args)
    return 0


if __name__ == '__main__':
    sys.exit(main())
