#!/usr/bin/env bash
# Everything that has to be true before a commit: generated files are in sync,
# and all four suites pass. CI runs the same checks (see .github/workflows/pages.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "· app/ matches src/"
python3 tools/build_app.py --check
echo "· site/ matches the sources"
python3 tools/build_site.py --check

if [ ! -d node_modules/jsdom ]; then
  echo "· installing jsdom (dev-only, nothing in app/ needs it)"
  npm install --silent --no-audit --no-fund
fi

echo "· app logic (jsdom)"
node test.js
echo "· app UI (jsdom)"
node test-ui.js
echo "· the Pages site (jsdom)"
node test-site.js
echo "· hygiene: no network, no innerHTML, no alert"
node lint.js
if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "· release contract: every file a deploy needs is tracked"
  python3 tools/zip_release.py --list > /dev/null
else
  # an extracted archive has no .git — check the same contract against the disk
  echo "· release contract: files on disk (no git repo here)"
  python3 tools/zip_release.py --check-files
fi

echo
echo "all green · app/index.html $(wc -c < app/index.html) bytes · site/index.html $(wc -c < site/index.html) bytes"
