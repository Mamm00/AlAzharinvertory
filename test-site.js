/*
 * test-site.js — the GitHub Pages site, checked the way a browser sees it.
 *
 *   node test-site.js
 *
 * Division of labour, so nothing is tested twice and nothing is untested:
 *   tools/build_app.py --check   app/ is what src/ builds
 *   tools/build_site.py --check  site/ is what the sources build, numbers included
 *   lint.js                      the app bundle obeys the no-network / no-innerHTML rules
 *   THIS FILE                    the landing page and the Pages plumbing: they execute,
 *                                both languages are complete, every link lands on a file
 *                                that ships, the brand is really applied, and the 404
 *                                rescue turns a real deep URL into a working app route.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = __dirname;
const SITE = path.join(ROOT, 'site');
let n = 0;
const problems = [];
const ok = (cond, m) => { n++; if (!cond) problems.push(m); };

const readAbs = (p) => fs.readFileSync(p, 'utf8');
const read = (rel) => readAbs(path.join(ROOT, rel));
const siteRead = (rel) => readAbs(path.join(SITE, rel));

/* ---------- object-literal reader: the page keeps its strings inside an IIFE,
   so they are not reachable from outside; read the literal itself instead of
   reimplementing applyLang. ---------- */
function literal(html, decl) {
  const at = html.indexOf(decl);
  if (at < 0) throw new Error('declaration not found: ' + decl);
  let i = html.indexOf('{', at), depth = 0, q = null;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return html.slice(i, j + 1); }
  }
  throw new Error('unbalanced literal: ' + decl);
}

/* ---------- 0. the layout GitHub Pages expects ---------- */
['index.html', '404.html', 'app/index.html', 'logo.svg', '.nojekyll', 'app/README.md']
  .forEach((p) => ok(fs.existsSync(path.join(SITE, p)), 'site/' + p + ' is missing'));
ok(fs.existsSync(path.join(ROOT, '.nojekyll')),
   'repo-root .nojekyll missing — needed if the app is deployed from the root instead of site/');
ok(fs.readFileSync(path.join(SITE, '.nojekyll')).length === 0, 'site/.nojekyll should be empty');
ok(fs.existsSync(path.join(ROOT, '.github/workflows/pages.yml')), 'the Pages workflow is missing');

const html = siteRead('index.html');
const html404 = siteRead('404.html');
const wf = read('.github/workflows/pages.yml');

/* ---------- 1. the app inside the site IS the shipped app ---------- */
ok(fs.readFileSync(path.join(SITE, 'app/index.html'))
     .equals(fs.readFileSync(path.join(ROOT, 'app/index.html'))),
   'site/app/index.html differs from app/index.html — rerun tools/build_site.py');
ok(fs.readFileSync(path.join(SITE, 'logo.svg')).equals(fs.readFileSync(path.join(ROOT, 'app/logo.svg'))),
   'site/logo.svg differs from app/logo.svg');
ok(siteRead('app/README.md') === read('src/README.app.md'),
   'site/app/README.md is not the README source — rerun the builders');

/* ---------- 2. nothing may reach the network ---------- */
/* The page has to look identical on a workshop laptop with no internet, which is
   the same reason the app carries no CDN. Anchors are fine; subresources are not. */
['site/index.html', 'site/404.html'].forEach((name) => {
  const txt = name === 'site/index.html' ? html : html404;
  ok(!/src\s*=\s*["'](?!data:)(?:https?:)?\/\//i.test(txt), name + ' loads a script/image from a URL');
  ok(!/<link[^>]+href\s*=\s*["'](?!data:)(?:https?:)?\/\//i.test(txt), name + ' links an external stylesheet/icon');
  ok(!/\burl\(\s*["']?(?:https?:)?\/\//i.test(txt), name + ' has a CSS url() pointing off-box');
  ok(!/@import/i.test(txt), name + ' uses @import');
  ok(!/\{\{[A-Z_]+\}\}/.test(txt), name + ' still holds an unsubstituted {{placeholder}}');
  ok(txt.indexOf('<!--@') === -1, name + ' still holds an unspliced builder marker');
});

/* ---------- 3. the coding rules the app obeys apply to the site too ---------- */
const scripts = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).join('\n');
ok(!/\.innerHTML\s*=/.test(html), 'the landing page writes .innerHTML');
ok(!/\.outerHTML\s*=/.test(html), 'the landing page writes .outerHTML');
ok(!/\balert\s*\(/.test(scripts), 'the landing page calls alert()');
ok(!/\bconfirm\s*\(/.test(scripts), 'the landing page calls confirm()');
ok(!/\bwindow\.prompt\s*\(|[^.\w]prompt\s*\(/.test(scripts), 'the landing page calls prompt()');
ok(!/document\.write/.test(scripts), 'the landing page uses document.write');
ok(/localStorage/.test(scripts), 'the language choice should persist via localStorage');

/* ---------- 4. execute it ---------- */
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => { if (!/Not implemented: navigation/.test(String(e.message || e))) errors.push(String(e.message || e)); });
const page = new JSDOM(html, { url: 'http://localhost/al-azhar-tex/index.html',
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const d = page.window.document;
ok(errors.length === 0, 'the landing page threw while loading: ' + errors.join(' | '));

/* ---------- 5. i18n: parity, coverage, and no swapped pairs ---------- */
const dict = eval('(' + literal(html, 'var I18N = {') + ')');
ok(dict.en && dict.ar, 'the page dictionary lost a language');
const langs = Object.keys(dict).length;
ok(langs === 2, 'expected 2 languages in the page dictionary, found ' + langs);

const used = Array.from(d.querySelectorAll('[data-i18n]')).map((e) => e.getAttribute('data-i18n'));
ok(used.length > 60, 'only ' + used.length + ' translatable elements — the markup lost its data-i18n hooks');
const scriptKeys = scripts;
used.forEach((k) => {
  ok(dict.en[k] !== undefined, 'rendered element has key "' + k + '" but no English string');
  ok(dict.ar[k] !== undefined, 'rendered element has key "' + k + '" but no Arabic string');
});
const enKeys = Object.keys(dict.en);
enKeys.forEach((k) => {
  ok(dict.ar[k] !== undefined, '"' + k + '" exists in English but not in Arabic');
  /* a key may be used by the script instead of by a data-i18n element (the
     clipboard toast says "copied" from here), so both count as used. */
  ok(used.indexOf(k) !== -1 || scriptKeys.indexOf("'" + k + "'") !== -1,
     '"' + k + '" is translated but never used — dead string');
});
const arabic = /[؀-ۿ]/;
/* the language toggle labels the other language in its own script, on purpose */
const SCRIPT_OK = ['lang.other'];
ok(enKeys.filter((k) => arabic.test(dict.en[k]) && SCRIPT_OK.indexOf(k) === -1).length === 0,
   'an English value contains Arabic — a pair is swapped');
ok(enKeys.filter((k) => !arabic.test(dict.ar[k]) && /[A-Za-z]{4}/.test(dict.ar[k])).length <= 10,
   'too many Arabic values are pure Latin — pairs are swapped');


/* the toggle is tested by pressing it, not by matching its name */
const lede = d.querySelector('.lede');
const beforeEN = lede.textContent;
const accCell = d.querySelector('#access tbody td[data-i18n]');
const beforeCell = accCell.textContent;
const press = () => d.getElementById('langBtn').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
press();
ok(d.documentElement.lang === 'ar', 'clicking the language button did not set <html lang=ar>');
ok(d.documentElement.dir === 'rtl', 'clicking the language button did not set dir=rtl — the Arabic layout would not mirror');
ok(arabic.test(lede.textContent), 'the hero copy did not change language');
ok(lede.textContent !== beforeEN, 'the hero text did not change at all');
ok(arabic.test(accCell.textContent) && accCell.textContent !== beforeCell,
   'the generated permission cells did not translate');
ok(/الأزهر|AZHAR/i.test(d.title), 'the tab title did not follow the language');
let unfilled = Array.from(d.querySelectorAll('[data-i18n]')).filter((e) => !String(e.textContent).trim()).length;
ok(unfilled === 0, unfilled + ' translated element(s) render empty in Arabic');
/* every key in the dictionary must survive the flip, in both languages */
enKeys.forEach((k) => ok(used.indexOf(k) === -1 || String(dict.ar[k]).trim().length > 0,
   'empty Arabic string for ' + k));
press();
ok(d.documentElement.dir === 'ltr' && lede.textContent === beforeEN,
   'the language button does not toggle back to English');
ok(/localStorage/.test(scripts), 'the language choice should persist across reloads');
/* an unclosed tag is silent in a browser until the whole page goes italic: count
   the structural elements in the source and in the parsed DOM, they must agree. */
['section', 'details', 'table', 'article'].forEach((tag) => {
  const inSource = (html.match(new RegExp('<' + tag + '\\b', 'g')) || []).length;
  const inDom = d.querySelectorAll(tag).length;
  ok(inSource === inDom, tag + ': ' + inSource + ' opened in the source but ' + inDom +
     ' survived parsing — something is unclosed and swallowed its siblings');
});
/* and a translated wrapper would delete everything it contains on first paint */
const offenders = Array.from(d.querySelectorAll('[data-i18n]')).filter((e) => e.querySelector('[data-i18n]'));
ok(offenders.length === 0, 'a [data-i18n] element contains other translated elements, which applyLang() wipes: ' +
   offenders.map((e) => e.getAttribute('data-i18n')).join(', '));

/* nothing translated may keep inner markup: applyLang writes textContent */
ok(!/data-i18n="[\w.]+"[^>]*>[^<]*<(?:code|b|strong|em)\b/.test(html),
   'a translated element contains markup that applyLang() would erase on first paint');
/* every string the toggle can show must be non-empty */
enKeys.forEach((k) => ok(String(dict.en[k]).trim().length > 0, 'empty English string for ' + k));

/* the English text inlined in the markup is the no-JS fallback: it must not drift
   from the dictionary, or the page shows one thing before load and another after. */
const fb = /data-i18n="([\w.]+)"[^>]*>([^<>\n]+)</g;
let fbSeen = 0, fbBad = [];
for (let m = fb.exec(html); m; m = fb.exec(html)) {
  fbSeen++;
  const want = dict.en[m[1]];
  const got = m[2].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (String(want).replace(/\s+/g, ' ').trim() !== got) fbBad.push(m[1]);
}
ok(fbSeen > 50, 'only ' + fbSeen + ' fallback texts were readable — the check lost its grip');
ok(fbBad.length === 0, fbBad.length + ' element(s) carry fallback text that differs from the dictionary: ' + fbBad.slice(0, 6).join(', '));

/* ---------- 6. links resolve to files that ship ---------- */
Array.from(d.querySelectorAll('a[href]')).forEach((a) => {
  const href = a.getAttribute('href');
  if (href.charAt(0) === '#') {
    ok(d.getElementById(href.slice(1)) !== null, 'in-page link #' + href.slice(1) + ' has no target');
    return;
  }
  ok(/^(?:https?:|mailto:)/.test(href) === false, 'the landing page links out to ' + href);
  const target = href.split('#')[0];
  if (target && !/^[a-z]+:/.test(target)) {
    ok(fs.existsSync(path.join(SITE, decodeURIComponent(target))), 'link to ' + href + ' but site/' + target + ' is not there');
  }
});
const sym = d.getElementById('azt-mark');
ok(sym, 'the sprite is missing #azt-mark — the logo would render blank');
const uses = Array.from(d.querySelectorAll('use'));
ok(uses.length >= 3, 'the mark should be reused, not redrawn: found ' + uses.length + ' <use> elements');
uses.forEach((u) => ok(d.getElementById((u.getAttribute('href') || '').slice(1)),
  '<use href="' + u.getAttribute('href') + '"> points at a missing id'));
ok(/viewBox="0 0 1040 460"/.test(html), 'the app schematic is gone');
ok(/viewBox="0 0 1040 300"/.test(html), 'the data-model diagram is gone');

/* ---------- 7. the brand is applied, and the numbers are the app's ---------- */
const navy = /--navy:\s*(#[0-9A-Fa-f]{6})/.exec(html);
const red = /--red:\s*(#[0-9A-Fa-f]{6})/.exec(html);
ok(navy && navy[1].toUpperCase() === '#222457', 'brand navy is ' + (navy && navy[1]) + ', expected #222457');
ok(red && red[1].toUpperCase() === '#CB3632', 'brand red is ' + (red && red[1]) + ', expected #CB3632');
ok(/Al Azhar Tex/.test(d.querySelector('title').textContent), 'the <title> does not carry the company name');
ok(/rel="icon"[^>]*data:image\/svg\+xml/.test(html), 'no inline SVG favicon (the tab would show the browser default)');
ok((d.getElementById('azt-mark').outerHTML.match(/z(?=[\s"])/g) || []).length >= 5 ||
   (d.getElementById('azt-mark').outerHTML.match(/L ?[-\d.]+/g) || []).length >= 5,
   'the sprite has fewer than 5 star shapes — the mark is not the real logo');

const statFor = (label) => {
  const el = Array.from(d.querySelectorAll('.stat')).find((e) =>
    e.textContent.toLowerCase().indexOf(label) !== -1);
  return el ? el.querySelector('b').textContent.trim() : null;
};
const appSrc = read('src/app.src.html');
const colours = (appSrc.match(/^\s*\['col-[^\n]*/gm) || []).length;
const roles = new Set((appSrc.match(/^\s*'role\.(\w+)'\s*:/gm) || []).map((s) => s.match(/role\.(\w+)/)[1])).size;
const strings = (appSrc.match(/^\s*'[\w.]+'\s*:\s*\[/gm) || []).length;
const views = (literal(appSrc, 'var ROUTES = {').match(/^\s{2}\w+:\s*\{\s*title:/gm) || []).length;
ok(statFor('colours') === String(colours), 'page says ' + statFor('colours') + ' colours, the catalog holds ' + colours);
ok(statFor('roles') === String(roles), 'page says ' + statFor('roles') + ' roles, the app defines ' + roles);
ok(statFor('strings') === strings + '×' + langs, 'page says ' + statFor('strings') + ', I18N_RAW holds ' + strings + ' keys × ' + langs);
ok(statFor('views') === String(views), 'page says ' + statFor('views') + ' views, ROUTES has ' + views);
const kb = parseInt(statFor('file'), 10);
const realKb = Math.round(fs.statSync(path.join(ROOT, 'app/index.html')).size / 1024);
ok(Math.abs(kb - realKb) <= 3, 'page claims ' + kb + ' KB, app/index.html is ' + realKb + ' KB');
ok(/0/.test(statFor('dependencies')), 'the dependency stat must read 0');
/* the permissions table must agree with PERMS, not with optimism */
const permsBlock = stripCommentsForTest(literal(appSrc, 'PERMS = {'));
function stripCommentsForTest(t) { return t.replace(/\/\*[\s\S]*?\*\//g, ''); }
const heads = Array.from(d.querySelectorAll('#access thead th')).map((th) => th.textContent.trim());
ok(heads.length === 8, 'the permissions table has ' + heads.length + ' columns, expected 8 (role + screens + 6 actions)');
const rowsEl = Array.from(d.querySelectorAll('#access tbody tr'));
ok(rowsEl.length >= 3, 'the permissions table has ' + rowsEl.length + ' rows');
rowsEl.forEach((tr) => {
  const tds = Array.from(tr.querySelectorAll('td'));
  ok(tds.length === heads.length, 'a permission row has ' + tds.length + ' cells vs ' + heads.length + ' headers');
  const role = tds[0].textContent.trim();
  ok(new RegExp(role + '\\s*:').test(permsBlock),
     'row "' + role + '" is not a role PERMS defines — the table and the app disagree');
  ok(/\d+/.test(tds[1].textContent), 'row "' + role + '" has no screens count');
  const ticks = tds.slice(2).map((td) => td.className);
  ok(ticks.every((c) => /^(y|n|s)$/.test(c)), 'row "' + role + '" has a cell without a y/n/s class: ' + ticks.join('|'));
  ok(tds.slice(2).every((td) => td.getAttribute('data-i18n')),
     'a permission cell is not translatable');
  ok(tds.slice(2).some((td) => td.className === 'y' || td.className === 's'),
     'row "' + role + '" can do nothing at all — the table is decoration');
});
/* the screens column must equal VIEWS_FOR_ROLE, counted here independently */
const vfr = stripCommentsForTest(literal(appSrc, 'var VIEWS_FOR_ROLE = {'));
rowsEl.forEach((tr) => {
  const role = tr.querySelector('td b').textContent.trim();
  const line = vfr.split('\n').map((x) => x.trim()).filter((x) => x.indexOf(role + ':') === 0)[0];
  ok(line !== undefined, 'role ' + role + ' has no VIEWS_FOR_ROLE entry');
  const want = (String(line).match(/'[\w.]+'/g) || []).length;
  const shown = parseInt(tr.querySelectorAll('td')[1].textContent, 10);
  ok(shown === want, 'row "' + role + '" shows ' + shown + ' screens, VIEWS_FOR_ROLE lists ' + want);
});

/* ---------- 8. structure a reader and a crawler need ---------- */
ok(d.querySelector('h1'), 'no h1');
ok(d.querySelector('meta[name=viewport]'), 'no viewport meta');
ok(d.querySelector('meta[name=description]'), 'no meta description');
['deploy', 'access', 'model', 'faq'].forEach((id) =>
  ok(d.getElementById(id), '#' + id + ' is linked from the nav but does not exist'));
const stepCards = Array.from(d.querySelectorAll('#deploy .steps > div'));
const stepKeys = enKeys.filter((k) => /^s\d+\.h$/.test(k)).length;
ok(stepCards.length === stepKeys, 'the deploy section renders ' + stepCards.length + ' steps but the dictionary has ' + stepKeys);
ok(stepCards.length >= 3, 'the deploy section has ' + stepCards.length + ' steps — too few to be instructions');
stepCards.forEach((card, i) => {
  ok(card.querySelector('[data-i18n^="s' + (i + 1) + '.h"]'), 'step ' + (i + 1) + ' has no translated heading');
  ok(card.textContent.trim().length > 40, 'step ' + (i + 1) + ' is too thin to follow');
});
ok(/counter-reset/.test(html), 'the step numbers are CSS counters, and .steps lost its counter-reset');
ok(/file:\/\//.test(html), 'the page must state that index.html works from file://');
ok(/localStorage/.test(html) && /JSON/.test(html), 'the page must say where the data lives and how it moves');
/* the FAQ must answer the two questions the app's design is built around */
const faq = d.getElementById('faq').textContent;
ok(/Google Sheets|database/i.test(faq), 'the FAQ no longer explains why there is no database');
ok(/password/i.test(faq), 'the FAQ no longer explains the client-side passwords');
ok(/\.xlsx|Excel/i.test(faq), 'the FAQ no longer answers the CSV/Excel question');

/* ---------- 9. the 404 rescue, against real Pages URLs ---------- */
function manualHref(pathname) {
  const v2 = new VirtualConsole();
  const w = new JSDOM(html404, { url: 'http://localhost' + pathname, runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: v2 }).window;
  return w.document.getElementById('manual').getAttribute('href');
}
ok(manualHref('/al-azhar-tex-inventory/app/reports') === '/al-azhar-tex-inventory/app/index.html#/reports',
   'deep /app link did not become a hash route: ' + manualHref('/al-azhar-tex-inventory/app/reports'));
ok(manualHref('/al-azhar-tex-inventory/app/') === '/al-azhar-tex-inventory/app/index.html',
   '/app/ did not resolve to the app: ' + manualHref('/al-azhar-tex-inventory/app/'));
ok(manualHref('/al-azhar-tex-inventory/app/index.html#/inventory') === '/al-azhar-tex-inventory/app/index.html#/inventory',
   'the 404 dropped a hash route that was already correct');
ok(manualHref('/al-azhar-tex-inventory/nope') === './', 'unknown paths should fall back to the site root');
ok(/setTimeout\(/.test(html404), 'the 404 should auto-continue after showing what it is doing');
ok(/<a id="manual"/.test(html404), 'the 404 needs a no-JS link, since a redirect is JS here');

/* ---------- 10. the workflow publishes exactly this ---------- */
ok(/on:\s*\n\s*push:/ .test(wf) || /push:/.test(wf), 'the workflow never triggers on push');
ok(/actions\/upload-pages-artifact@v3/.test(wf) && /path:\s*site/.test(wf), 'the workflow does not deploy site/');
ok(/actions\/deploy-pages@v4/.test(wf), 'the workflow never deploys');
ok(/actions\/configure-pages@v5/.test(wf), 'the workflow skips configure-pages');
ok(/build_site\.py --check/.test(wf) && /build_app\.py --check/.test(wf),
   'CI must fail on a stale site/ or app/');
['test.js', 'test-ui.js', 'test-site.js', 'lint.js'].forEach((f) =>
  ok(new RegExp('node ' + f.replace('.', '\\.')).test(wf), 'CI never runs ' + f));
ok(/actions\/setup-node@v4/.test(wf) && /npm ci/.test(wf), 'CI cannot run the suites without jsdom');
ok(/pages: write/.test(wf), 'the workflow lacks the Pages write permission');

if (problems.length) {
  problems.forEach((p) => console.log('  ✗ ' + p));
  console.log('\n' + problems.length + ' of ' + n + ' site checks FAILED');
  process.exit(1);
}
console.log('all ' + n + ' site checks passed');
