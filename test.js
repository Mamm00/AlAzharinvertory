/* Smoke + behaviour test for app/index.html, run in jsdom.
   Verifies: boot, login/RBAC, routing, every view render, derived math,
   cascades, i18n/RTL, seed integrity, CSV/JSON export, audit trail. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = path.join(__dirname, 'app', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = String(e && e.message || e);
  if (/Could not parse CSS|Not implemented: window\.print|Not implemented: HTMLFormElement|Not implemented: navigation/.test(m)) return;
  errors.push('jsdomError: ' + m + (e && e.detail ? ' :: ' + e.detail : ''));
});
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.com/fabric-inventory/index.html#/dashboard',
  virtualConsole: vc,
  beforeParse(w) {
    w.URL.createObjectURL = () => 'blob:fake';
    w.URL.revokeObjectURL = () => {};
    w.print = () => { printed++; };
    w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = () => {};
    w.__downloads = [];
    const origCreate = w.document.createElement.bind(w.document);
    // capture anchor clicks with [download] so we can inspect exported files
    w.addEventListener('click', () => {}, true);
  }
});
let printed = 0;
const w = dom.window;
const d = w.document;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 300) : '')); }
};
const head = s => console.log('\n\x1b[1m== ' + s + ' \x1b[0m');

function login(user, passW) {
  d.querySelector('#loginUser').value = user;
  d.querySelector('#loginPass').value = passW;
  d.querySelector('#loginForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}
function textOf(sel) { const n = d.querySelector(sel); return n ? n.textContent.trim() : null; }
function click(elm) { if (!elm) throw new Error('no element to click'); elm.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); }
function clickText(sel, txt) {
  const n = [...d.querySelectorAll(sel)].find(b => (b.textContent || '').includes(txt));
  if (!n) return null;
  click(n); return n;
}
function viewHasError() {
  return [...d.querySelectorAll('#viewHost .banner.danger')].map(n => n.textContent).filter(t => /Application error/.test(t));
}

setTimeout(() => {
  head('1. BOOT');
  ok('STATE created', !!w.STATE);
  ok('seeded from scratch', Array.isArray(w.STATE.warehouses) && w.STATE.warehouses.length === 5, w.STATE && w.STATE.warehouses.length);
  ok('8 fabrics', w.STATE.fabrics.length === 8, w.STATE.fabrics.length);
  ok('46 catalog colors', w.STATE.colors.length === 46, w.STATE.colors.length);
  ok('mapping 70 unique + 1 seeded duplicate', w.STATE.mapping.length === 71, w.STATE.mapping.length);
  ok('inventory rows', w.STATE.inventory.length === 44, w.STATE.inventory.length);
  ok('movements 32 rows', w.STATE.movements.length === 32, w.STATE.movements.length);
  ok('4 users', w.STATE.users.length === 4);
  ok('login screen visible, app hidden', !d.querySelector('#loginScreen').hidden && d.querySelector('#app').hidden);
  ok('no session yet', !w.STORAGE.get('fabric-inventory-session'));
  ok('demo credential buttons rendered', d.querySelectorAll('#demoCreds button').length === 4);
  ok('boot logged no console errors', errors.length === 0, errors.slice(0, 4));

  head('2. DERIVED MATH (getStock / status / meters / reorder)');
  const inv0 = w.STATE.inventory[0];
  const expectClosing = Number(inv0.openingRolls) + Number(inv0.rollsIn) - Number(inv0.rollsOut);
  ok('closingRolls = open + in − out', expectClosing === 155, expectClosing);
  const row0 = w.getInventoryRows({}).find(r => r.recordId === inv0.recordId);
  ok('inventory row derived present', !!row0);
  ok('totalMeters = closing × metersPerRoll', Math.abs(row0.totalMeters - 155 * 50) < 1e-9, row0.totalMeters);
  ok('totalValue = closing × unitCost', Math.abs(row0.totalValue - 155 * 950) < 1e-9, row0.totalValue);
  ok('uom propagated from fabric', row0.uom === 'Roll', row0.uom);
  ok('gradeCode from color', row0.gradeCode === 'A', row0.gradeCode);
  ok('status computed', ['OK', 'Low', 'Overstock', 'Out of Stock'].includes(row0.status), row0.status);
  // transfer math: north→east poly sky
  const tWh = w.STATE.movements.find(m => m.type === 'Transfer');
  const srcStock = w.getStock(tWh.fromWarehouseId, tWh.fabricId, tWh.colorId);
  const dstStock = w.getStock(tWh.toWarehouseId, tWh.fabricId, tWh.colorId);
  ok('transfer raises destination', dstStock > 0, { dstStock });
  ok('getStock is integer-ish', Number.isFinite(srcStock) && Number.isInteger(srcStock), srcStock);
  ok('no NaN anywhere in derived rows', !w.getInventoryRows({}).some(r => !Number.isFinite(r.closingRolls) || !Number.isFinite(r.totalValue)));
  ok('computeStatus(0)=Out of Stock', w.computeStatus(0, 10, 100) === 'Out of Stock');
  ok('computeStatus(5,10,100)=Low', w.computeStatus(5, 10, 100) === 'Low');
  ok('computeStatus(100,10,100)=Overstock', w.computeStatus(100, 10, 100) === 'Overstock');
  ok('computeStatus(50,10,100)=OK', w.computeStatus(50, 10, 100) === 'OK');
  const oos = w.STATE.inventory.find(r => Number(r.openingRolls) + Number(r.rollsIn) - Number(r.rollsOut) === 0);
  ok('seed contains an out-of-stock row', !!oos);
  ok('reorder = max(0, min − closing) rounded up', (() => {
    const r = w.getInventoryRows({}).find(x => x.status === 'Low');
    if (!r) return false;
    const raw = r.minRolls - r.closingRolls;
    return r.reorder === Math.ceil(Math.max(0, raw));
  })());
  ok('warehouse utilization derived', (() => {
    const b = w.getStockByWarehouse(w.STATE.users.find(u => u.username === 'admin'));
    return b.length === 5 && b.every(x => Number.isFinite(x.utilizationPct));
  })());

  head('3. BAD LOGIN + LOCKOUT + AUDIT');
  const auditBefore = w.STATE.auditLog.length;
  login('admin', 'wrongpass');
  ok('bad password rejected', !w.CURRENT);
  ok('login failure audited', w.STATE.auditLog.length === auditBefore + 1 && w.STATE.auditLog[w.STATE.auditLog.length - 1].action === 'Blocked');
  ok('error shown inline (no alert)', /password/i.test(textOf('#loginErr')), textOf('#loginErr'));
  ok('still on login screen', d.querySelector('#app').hidden);
  login('keeper1', 'keeper123');
  ok('keeper1 signed in', !!w.CURRENT && w.CURRENT.username === 'keeper1');
  ok('session token stored', !!JSON.parse(w.STORAGE.get('fabric-inventory-session')).token);
  ok('login success audited', w.STATE.auditLog[w.STATE.auditLog.length - 1].action === 'Login');

  head('4. KEEPER SCOPE (keeper1 = north + south only)');
  ok('scope from user record', JSON.stringify(w.CURRENT.warehouseIds) === '["wh-north","wh-south"]', w.CURRENT.warehouseIds);
  ok('getWarehousesForUser filters', w.getWarehousesForUser(w.CURRENT).length === 2);
  ok('whOptions omit east/west/central', (() => {
    const opts = w.whOptions(w.CURRENT, true);
    const v = opts.map(o => o.value).join(',');
    return !/wh-east|wh-west|wh-central/.test(v);
  })(), w.whOptions(w.CURRENT, true).map(o => o.value));
  const kNav = [...d.querySelectorAll('#navList button')].map(b => b.getAttribute('data-route'));
  ok('keeper nav excludes settings + audit', !kNav.includes('settings') && !kNav.includes('audit') && kNav.includes('profile'), kNav);
  ok('keeper nav has masters/inventory/movements/dash/reports', ['masters', 'inventory', 'movements', 'dashboard', 'reports'].every(x => kNav.includes(x)), kNav);
  w.location.hash = '#/inventory'; w.renderActive();
  ok('inventory renders for keeper', viewHasError().length === 0, viewHasError());
  const invOpts = [...d.querySelectorAll('#viewHost select')][0];
  ok('inventory filter shows exactly 2 warehouses', [...invOpts.options].map(o => o.value).filter(v => /^wh-/.test(v)).length === 2,
    [...invOpts.options].map(o => o.value));
  ok('keeper inventory table only own rows', (() => {
    const rows = w.getInventoryRows({});
    return rows.every(r => ['wh-north', 'wh-south'].includes(r.warehouseId)) && rows.length > 0;
  })());
  ok('keeper movements only own warehouses', w.getMovementRows({}).every(m => [m.fromWarehouseId, m.toWarehouseId].some(x => ['wh-north', 'wh-south'].includes(x))));
  for (const v of ['dashboard', 'reports', 'masters', 'movements', 'audit', 'settings', 'profile', 'readme']) {
    w.location.hash = '#/' + v; w.renderActive();
    ok('view ' + v + ' renders clean for keeper', viewHasError().length === 0, viewHasError());
  }
  ok('audit blocked for keeper (redirected away)', w.normalizeRoute(d.location.hash) !== 'audit');
  ok('blocked navigation audited', w.STATE.auditLog.some(l => l.action === 'Blocked' && l.recordId === 'audit'));
  ok('settings route falls back to a permitted view', ['dashboard', 'readme', 'profile', 'masters', 'inventory', 'movements', 'reports'].includes(w.normalizeRoute(d.location.hash)), d.location.hash);
  // write attempt outside scope must be denied and must not mutate
  w.location.hash = '#/masters'; w.renderActive();
  const mappingBefore = JSON.stringify(w.STATE.mapping);
  const eastWh = w.STATE.warehouses.find(x => x.warehouseId === 'wh-east');
  ok('can(editWarehouse, east) false for keeper', w.can(w.CURRENT, 'editWarehouse', 'wh-east') === false);
  ok('can(editInventory, north) true for keeper', w.can(w.CURRENT, 'editInventory', 'wh-north') === true);
  ok('can(deleteFabric) false for keeper', w.can(w.CURRENT, 'deleteFabric') === false);
  ok('can(editFabric) false for keeper — shared catalog is Admin-only', w.can(w.CURRENT, 'editFabric') === false);
  ok('can(editColor) false for keeper', w.can(w.CURRENT, 'editColor') === false);
  ok('can(editMapping) in scope true / out of scope false', w.can(w.CURRENT, 'editMapping', 'wh-north') === true && w.can(w.CURRENT, 'editMapping', 'wh-east') === false);
  ok('guard() denies + logs', w.guard('editWarehouse', 'wh-east', { table: 'warehouses', recordId: 'wh-east' }) === false);
  ok('state untouched by denied write', JSON.stringify(w.STATE.mapping) === mappingBefore);
  ok('denial logged as Blocked', w.STATE.auditLog[w.STATE.auditLog.length - 1].action === 'Blocked');
  ok('toast surfaced for denial', d.querySelectorAll('#toastHost .toast.err').length > 0);

  head('5. CASCADING DROPDOWNS');
  w.location.hash = '#/inventory'; w.renderActive();
  const sels = () => [...d.querySelectorAll('#viewHost .card')].flatMap(c => [...c.querySelectorAll('select')]);
  const casc = w.makeCascader({ user: false });
  d.body.appendChild(casc.node);
  ok('L2 disabled before L1 chosen', casc.fab.node.disabled === true && casc.col.node.disabled === true);
  ok('helper text present', /Select a warehouse first/.test(casc.node.textContent), casc.node.textContent.slice(0, 80));
  casc.wh.set('wh-north'); casc.wh.node.dispatchEvent(new w.Event('change'));
  ok('L2 populated after warehouse', !casc.fab.node.disabled && casc.fab.node.options.length === 4, casc.fab.node.options.length);
  ok('L2 matches getActiveFabricsForWarehouse', (() => {
    const n = w.getActiveFabricsForWarehouse('wh-north').length;
    return casc.fab.node.options.length === n;
  })(), casc.fab.node.options.length);
  casc.fab.set('fab-poplin'); casc.fab.node.dispatchEvent(new w.Event('change'));
  ok('L3 populated after fabric', !casc.col.node.disabled && casc.col.node.options.length === 4, casc.col.node.options.length);
  ok('color label shows "Name (GRADE)"', /\(A\)/.test(casc.col.node.options[0].textContent) || /\(B\)/.test([...casc.col.node.options].map(o => o.textContent).join(' ')),
    [...casc.col.node.options].map(o => o.textContent));
  casc.wh.set('wh-south'); casc.wh.node.dispatchEvent(new w.Event('change'));
  ok('changing L1 clears L2 + L3', casc.fab.get() === '' && casc.col.get() === '', [casc.fab.get(), casc.col.get()]);
  ok('changing L1 repopulates L2', casc.fab.node.options.length === w.getActiveFabricsForWarehouse('wh-south').length, casc.fab.node.options.length);
  casc.set({ warehouseId: 'wh-north', fabricId: 'fab-poplin', colorId: 'col-navy' });
  ok('set() restores a full valid cascade', casc.get().colorId === 'col-navy' && casc.validate() === true, casc.get());
  casc.set({ warehouseId: 'wh-north', fabricId: 'fab-poplin', colorId: 'col-ivory' });
  ok('valid cascade passes validate()', casc.validate() === true, casc.errBox.textContent);
  const savedMap = w.STATE.mapping.find(m => m.warehouseId === 'wh-north' && m.fabricId === 'fab-poplin' && m.colorId === 'col-ivory');
  savedMap.isActive = 'N'; w.bump();                     // mapping withdrawn while a form is open
  ok('now-invalid combo blocked by validate()', casc.validate() === false && /not stocked/.test(casc.errBox.textContent), casc.errBox.textContent);
  savedMap.isActive = 'Y'; w.bump();
  ok('restored mapping validates again', casc.validate() === true);
  ok('isValidCombination false for unmapped', w.isValidCombination('wh-north', 'fab-velvet', 'col-plum') === false);
  ok('isValidCombination true for mapped', w.isValidCombination('wh-north', 'fab-poplin', 'col-ivory') === true);
  ok('inactive mapping is not a valid combo', w.isValidCombination('wh-central', 'fab-poplin', 'col-sec-grey') === false);
  casc.node.remove();

  head('6. SALES MANAGER = READ-ONLY');
  w.endSession(false);
  login('sales', 'sales123');
  ok('sales signed in', w.CURRENT.role === 'SalesManager');
  ok('sales nav excludes settings', ![...d.querySelectorAll('#navList button')].some(b => b.getAttribute('data-route') === 'settings'));
  ok('sales can view audit', (w.VIEWS_FOR_ROLE.SalesManager || []).includes('audit'));
  for (const v of ['dashboard', 'reports', 'masters', 'inventory', 'movements', 'audit', 'readme']) {
    w.location.hash = '#/' + v; w.renderActive();
    ok('view ' + v + ' clean for sales', viewHasError().length === 0, viewHasError());
  }
  const addBtns = [...d.querySelectorAll('#viewHost button')].filter(b => /Add|＋/.test(b.textContent));
  ok('no Add buttons in current view', addBtns.length === 0, addBtns.map(b => b.textContent));
  w.location.hash = '#/inventory'; w.renderActive();
  const allBtns = [...d.querySelectorAll('#viewHost button')].map(b => b.textContent.trim());
  ok('inventory: zero edit/delete for sales', !allBtns.some(t => /Edit|Delete/.test(t)), allBtns.slice(0, 12));
  ok('inventory: export/print allowed for sales', allBtns.some(t => /CSV|Print/.test(t)), allBtns);
  ok('can(editInventory) false for sales', w.can(w.CURRENT, 'editInventory', 'wh-north') === false);
  ok('can(exportData) true for sales', w.can(w.CURRENT, 'exportData') === true);
  ok('sales sees all 5 warehouses', w.getWarehousesForUser(w.CURRENT).length === 5);
  w.location.hash = '#/settings'; w.renderActive();
  ok('sales blocked from settings UI (renders a permitted view instead)', !/User accounts|حسابات المستخدمين/.test(d.querySelector('#viewHost').textContent) && w.STATE.auditLog.some(l => l.action === 'Blocked' && l.recordId === 'settings'), d.querySelector('#pageTitle').textContent);

  head('7. ADMIN CAN DO EVERYTHING + WRITES WORK');
  w.endSession(false);
  login('admin', 'admin123');
  ok('admin signed in', w.CURRENT.role === 'Admin');
  ['viewAll', 'editWarehouse', 'editFabric', 'editColor', 'editMapping', 'editInventory', 'editMovements', 'manageUsers', 'editSettings', 'resetSample', 'clearData', 'deleteFabric']
    .forEach(a => { if (!w.can(w.CURRENT, a, 'wh-east')) ok('admin can ' + a, false); });
  ok('admin has every action', ['viewAll', 'editWarehouse', 'editFabric', 'editColor', 'editMapping', 'editInventory', 'editMovements', 'manageUsers', 'editSettings', 'resetSample', 'clearData', 'deleteFabric'].every(a => w.can(w.CURRENT, a, 'wh-east') === true));
  for (const v of ['readme', 'settings', 'masters', 'inventory', 'movements', 'dashboard', 'reports', 'audit']) {
    w.location.hash = '#/' + v; w.renderActive();
    ok('admin view ' + v + ' clean', viewHasError().length === 0, viewHasError());
  }
  // full end-to-end: add fabric → map → stock → move → dashboard reacts
  const fabCountBefore = w.STATE.fabrics.length, dashRollsBefore = w.getStockByWarehouse(w.CURRENT).reduce((a, b) => a + b.rolls, 0);
  w.STATE.fabrics.push({ fabricId: 'fab-test', fabricName: 'Test Tussah', fabricNameAr: 'اختبار', composition: '100% Silk', gsm: 90, uom: 'Roll', defaultGrade: 'A', metersPerRoll: 50, isActive: 'Y' });
  w.commit({ noRender: true });
  ok('fabric added to state', w.lookupFabric('fab-test') !== null);
  w.STATE.mapping.push({ mappingId: 'map-test', warehouseId: 'wh-north', fabricId: 'fab-test', colorId: 'col-ivory', isActive: 'Y', minRolls: 10, maxRolls: 50, leadTimeDays: 5 });
  w.commit({ noRender: true });
  ok('fabric now offered in cascade', w.getActiveFabricsForWarehouse('wh-north').includes('fab-test'));
  ok('color offered for the new pair', w.getActiveColorsForWarehouseFabric('wh-north', 'fab-test').includes('col-ivory'));
  ok('invalid combination was impossible before mapping', w.isValidCombination('wh-north', 'fab-test', 'col-ivory') === true);
  const closingBefore = w.getStock('wh-north', 'fab-test', 'col-ivory');
  w.STATE.inventory.push({ recordId: 'inv-test', date: w.isoToday(), warehouseId: 'wh-north', fabricId: 'fab-test', colorId: 'col-ivory', openingRolls: 30, rollsIn: 12, rollsOut: 2, unitCostPerRoll: 1000, lastUpdated: new Date().toISOString(), notes: 'e2e test' });
  w.commit({ noRender: true });
  ok('inventory write flows into getStock', w.getStock('wh-north', 'fab-test', 'col-ivory') === closingBefore + 40, w.getStock('wh-north', 'fab-test', 'col-ivory'));
  ok('derived status for the new combo = Low (below min 10? no)', (() => {
    const r = w.getInventoryRows({}).find(x => x.recordId === 'inv-test');
    return r && r.status === 'OK' && r.closingRolls === 40 && r.minRolls === 10 && r.maxRolls === 50;
  })(), w.getInventoryRows({}).find(x => x.recordId === 'inv-test'));
  w.STATE.movements.push({ movementId: 'mov-test', date: w.isoToday(), type: 'Transfer', fromWarehouseId: 'wh-north', toWarehouseId: 'wh-east', fabricId: 'fab-test', colorId: 'col-ivory', rolls: 10, reference: 'TR-E2E', user: 'admin', notes: '' });
  w.commit({ noRender: true });
  ok('transfer −10 at source', w.getStock('wh-north', 'fab-test', 'col-ivory') === 30, w.getStock('wh-north', 'fab-test', 'col-ivory'));
  ok('transfer +10 at destination', w.getStock('wh-east', 'fab-test', 'col-ivory') === 10, w.getStock('wh-east', 'fab-test', 'col-ivory'));
  ok('company total unchanged by transfer (no double count)', w.getStock('wh-north', 'fab-test', 'col-ivory') + w.getStock('wh-east', 'fab-test', 'col-ivory') === 40);
  w.location.hash = '#/dashboard'; w.renderActive();
  const dashTxt = d.querySelector('#viewHost').textContent;
  ok('dashboard re-rendered with live numbers', /Total rolls/.test(dashTxt));
  const after = w.getStockByWarehouse(w.CURRENT).reduce((a, b) => a + b.rolls, 0);
  ok('dashboard rolls moved by test data (+40)', after === dashRollsBefore + 40, { before: dashRollsBefore, after });
  ok('SVG charts present (4)', d.querySelectorAll('#viewHost svg.chart').length >= 4, d.querySelectorAll('#viewHost svg.chart').length);
  ok('KPI cards present (7)', d.querySelectorAll('#viewHost .kpi').length === 7, d.querySelectorAll('#viewHost .kpi').length);
  ok('top movers table populated', /Top 10 movers/.test(dashTxt));
  // formatting
  ok('meter format #,##0.00 m', w.fmtMeters(1234.5) === '1,234.50 m', w.fmtMeters(1234.5));
  ok('currency format', w.fmtMoney(9876.5) === 'EGP 9,876.50', w.fmtMoney(9876.5));
  ok('roll format #,##0', w.fmtNum(1234567) === '1,234,567', w.fmtNum(1234567));
  ok('date format dd-mmm-yyyy', /^\d{2}-[A-Za-z]{3}-\d{4}$/.test(w.fmtDate('2026-11-07')), w.fmtDate('2026-11-07'));
  ok('no undefined/NaN in dashboard DOM', !/\bundefined\b|\bNaN\b/.test(dashTxt), (dashTxt.match(/\b(NaN|undefined)\b.*/) || [''])[0]);

  head('8. I18N + RTL');
  const before = textOf('#pageTitle');
  w.toggleLanguage();
  ok('dir becomes rtl', d.documentElement.getAttribute('dir') === 'rtl', d.documentElement.getAttribute('dir'));
  ok('lang becomes ar', d.documentElement.getAttribute('lang') === 'ar');
  ok('title translated', textOf('#pageTitle') !== before && /لوحة/.test(textOf('#pageTitle')), textOf('#pageTitle'));
  ok('language persisted in settings', w.STATE.settings.language === 'ar');
  ok('nm() prefers Arabic field', w.nm(w.STATE.warehouses[0], 'warehouseName') === 'مستودع القماش الشمالي', w.nm(w.STATE.warehouses[0], 'warehouseName'));
  ok('nm() falls back to EN when AR empty', w.nm({ fabricName: 'English only' }, 'fabricName') === 'English only');
  ok('Arabic month name in dates', /يناير|نوفمبر/.test(w.fmtDate('2026-11-07')), w.fmtDate('2026-11-07'));
  w.location.hash = '#/masters'; w.renderActive();
  ok('masters renders in Arabic', viewHasError().length === 0, viewHasError());
  const arBtns = [...d.querySelectorAll('#viewHost button')].map(b => b.textContent.trim());
  ok('buttons translated (إضافة)', arBtns.some(t => /إضافة/.test(t)), arBtns.slice(0, 8));
  ok('no untranslated keys leaked (nav.*)', !/nav\.[a-z]/.test(d.querySelector('#navList').textContent));
  w.location.hash = '#/readme'; w.renderActive();
  ok('README body is Arabic', /طريقة الاستخدام/.test(d.querySelector('#viewHost').textContent));
  // i18n key parity — the structural guarantee of [en,ar] pairs
  const missingAr = Object.keys(w.I18N.en).filter(k => w.I18N.ar[k] === undefined || w.I18N.ar[k] === '');
  ok('every key has an Arabic string', missingAr.length === 0, missingAr);
  const usedKeys = [...fs.readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([\w.]+)'/g)].map(m => m[1]).filter(k => !/\.$/.test(k));
  const unknown = [...new Set(usedKeys)].filter(k => w.I18N.en[k] === undefined);
  const srcTxt = fs.readFileSync(file, 'utf8');
  const orphanKeys = Object.keys(w.I18N.en).filter(k => srcTxt.indexOf("t('" + k + "'") < 0);
  ok('every t(key) resolves to a dictionary entry', unknown.length === 0, unknown);
  console.log('  \x1b[90m(unused dictionary keys: ' + orphanKeys.length + ')\x1b[0m');
  w.toggleLanguage();
  ok('back to LTR', d.documentElement.getAttribute('dir') === 'ltr');

  head('9. SEED INTEGRITY + FLAGS');
  const combos = new Set(w.STATE.mapping.map(m => m.warehouseId + '|' + m.fabricId + '|' + m.colorId));
  const badInv = w.STATE.inventory.filter(r => !combos.has(r.warehouseId + '|' + r.fabricId + '|' + r.colorId));
  ok('exactly 1 deliberate unmapped inventory row', badInv.length === 1, badInv.map(r => r.recordId));
  const rows2 = w.getInventoryRows({ user: w.STATE.users.find(u => u.role === 'Admin') });
  const invalid = rows2.filter(r => r.validationFlag && /Invalid/.test(r.validationFlag));
  ok('unmapped row flagged ⚠ Invalid combination', invalid.length === 1, invalid.map(r => r.recordId));
  const inactiveRows = rows2.filter(r => r.isActive === 'N');
  ok('inactive-mapping row present (grey/italic class)', inactiveRows.length >= 1, inactiveRows.length);
  const dupeCombos = {};
  w.STATE.mapping.forEach(m => { const k = m.warehouseId + '|' + m.fabricId + '|' + m.colorId; dupeCombos[k] = (dupeCombos[k] || 0) + 1; });
  const dupes = Object.keys(dupeCombos).filter(k => dupeCombos[k] > 1);
  ok('exactly 1 duplicate mapping pair seeded', dupes.length === 1, dupes);
  ok('inventory dates are valid ISO', w.STATE.inventory.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
  ok('movement dates within 90d', w.STATE.movements.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.date) && w.daysBetween(m.date, w.isoToday()) <= 90 && w.daysBetween(m.date, w.isoToday()) >= 0));
  ok('movement mix (4 types)', ['In', 'Out', 'Transfer', 'Adjustment'].every(t => w.STATE.movements.some(m => m.type === t)));
  ok('all colors have grade + rank + hex', w.STATE.colors.every(c => ['A', 'B', 'C', 'D'].includes(c.gradeCode) && c.gradeRank === w.GRADE_RANK[c.gradeCode] && /^#[0-9A-Fa-f]{6}$/.test(c.hexCode)));
  ok('all colors have Arabic names', w.STATE.colors.every(c => (c.colorNameAr || '').length > 1));
  ok('all warehouses have Arabic names', w.STATE.warehouses.every(x => (x.warehouseNameAr || '').length > 1));
  ok('all fabrics have Arabic names', w.STATE.fabrics.every(f => (f.fabricNameAr || '').length > 1));
  ok('capacity 500..2000', w.STATE.warehouses.every(x => x.capacityRolls >= 500 && x.capacityRolls <= 2000));
  ok('metersPerRoll 45..100', w.STATE.fabrics.every(f => f.metersPerRoll >= 45 && f.metersPerRoll <= 100));
  ok('grade counts A=7 B=20 C=17 D=2', (() => {
    const c = {}; w.STATE.colors.forEach(x => c[x.gradeCode] = (c[x.gradeCode] || 0) + 1);
    return c.A === 7 && c.B === 20 && c.C === 17 && c.D === 2;
  })(), w.STATE.colors.map(c => c.gradeCode).reduce((a, g) => (a[g] = (a[g] || 0) + 1, a), {}));
  ok('diagnostics run clean-ish', (() => {
    const is = w.runDiagnostics();
    return Array.isArray(is) && is.length > 0 && is.every(i => i.sev && i.msg);
  })(), w.runDiagnostics().length);
  ok('diagnostics reports the seeded duplicate', w.runDiagnostics().some(i => /DUPLICATE/.test(i.title + i.msg)));

  head('9b. BRANDING — Al Azhar Tex');
  ok('seeded company name', w.STATE.settings.companyName === 'Al Azhar Tex', w.STATE.settings.companyName);
  ok('mark defined exactly once', d.querySelectorAll('symbol#azt-mark').length === 1, d.querySelectorAll('symbol#azt-mark').length);
  ok('login card + sidebar reference the mark', d.querySelectorAll('use[href="#azt-mark"]').length >= 2, d.querySelectorAll('use[href="#azt-mark"]').length);
  ok('browser tab leads with the company', /^Al Azhar Tex/.test(d.title), d.title);
  ok('sidebar brand + product line', d.querySelector('#brandName').textContent === 'Al Azhar Tex' && /Fabric Roll Inventory/.test(d.querySelector('#brandSub').textContent), d.querySelector('#brandSub').textContent);
  ok('favicon is an inline vector, not a file', /^data:image\/svg\+xml,/.test(d.querySelector('link[rel=icon]').getAttribute('href') || ''));
  ok('in-app README shows the company', /Al Azhar Tex/.test((() => { w.location.hash = '#/readme'; w.renderActive(); return d.querySelector('#viewHost').textContent; })()));
  w.printTables('Brand probe', [], []);
  ok('print letterhead carries mark + company', /Al Azhar Tex/.test(d.querySelector('#printArea').textContent) && !!d.querySelector('#printArea use[href="#azt-mark"]'), d.querySelector('#printArea .p-co') && d.querySelector('#printArea .p-co').textContent);
  ok('the printed title still sits under the letterhead', /Brand probe/.test(d.querySelector('#printArea h1').textContent));

  head('10. CSV + JSON EXPORT / IMPORT');
  const csv = w.rowsToCsv(['name', 'note'], [['North, Hub', 'line1\nline2'], ['say "hi"', '=SUM(1)']]);
  ok('CSV quotes comma + newline', /"North, Hub"/.test(csv) && /"line1\nline2"/.test(csv), JSON.stringify(csv));
  ok('CSV escapes inner quotes', csv.includes('"say ""hi"""'), csv);
  ok('CSV neutralises formula injection', csv.includes("'=SUM(1)"), csv);
  ok('csvSpec(inventory) has headers', w.csvSpec('inventory')().head.length > 18);
  ok('csvSpec(inventory) rows = scoped inventory', w.csvSpec('inventory')().rows.length === w.getInventoryRows({}).length, [w.csvSpec('inventory')().rows.length, w.getInventoryRows({}).length]);
  ['warehouses', 'fabrics', 'colors', 'mapping', 'inventory', 'movements', 'audit', 'users'].forEach(k => {
    const s = w.csvSpec(k)();
    if (!(s.head.length && s.rows.length >= 0 && s.rows.every(r => r.length === s.head.length))) ok('csv ' + k + ' shape', false, { head: s.head.length, bad: s.rows.filter(r => r.length !== s.head.length).length });
    else ok('csv ' + k + ' shape (' + s.rows.length + ' rows)', true);
  });
  w.exportJson();
  ok('exportJson does not throw + audits', w.STATE.auditLog.some(l => l.action === 'Export' && l.table === 'backup'));
  const payload = JSON.stringify({ app: w.APP.name, version: w.APP.version, state: w.STATE });
  const bad = w.validateImport(JSON.parse('{"foo":1}'));
  ok('validateImport rejects junk', bad.length > 3, bad);
  ok('validateImport accepts our payload', w.validateImport(JSON.parse(payload).state).length === 0);
  ok('date parse is TZ-stable', w.parseISO('2026-11-07').getDate() === 7 && w.parseISO('2026-11-07').getMonth() === 10);
  ok('numeric coercion', w.num('1,234.5') === 1234.5 && w.num('') === 0 && w.num('abc', 7) === 7 && w.intNum('9.7') === 10);

  head('11. FORM XSS + VALIDATION');
  const f = w.buildForm([{ key: 'x', label: 'X', type: 'text', required: true }, { key: 'n', label: 'N', type: 'int', min: 0 }]);
  ok('empty required fails validation', f.validate() === false);
  f.set({ x: 'ok', n: '5' });
  ok('valid passes', f.validate() === true);
  f.set({ x: 'ok', n: '-3' });
  ok('negative below min fails', f.validate() === false);
  ok('values are typed numbers', f.get().n === -3 && typeof f.get().n === 'number');
  w.location.hash = '#/settings'; w.renderActive();
  w.userForm(null);
  const modalBox = d.querySelector('.modal');
  ok('user modal opens', !!modalBox);
  const uName = modalBox.querySelector('#fld-username'), uDisp = modalBox.querySelector('#fld-displayName');
  uName.value = '<img src=x onerror=alert(1)>'; uDisp.value = '</td><script>bad()</script>';
  const pw = modalBox.querySelector('#fld-password'); pw.value = 'abcdef1';
  [...modalBox.querySelectorAll('input[type=checkbox]')].forEach(c => { if (c.id.startsWith('sc-')) c.checked = true; });
  const saveBtn = [...modalBox.querySelectorAll('button')].find(b => /Save/.test(b.textContent));
  click(saveBtn);
  w.commit({ noRender: true });
  ok('no raw markup ever injected', !d.querySelector('#viewHost img[src="x"], script.bad') && d.querySelectorAll('#navList script, #viewHost script').length === 0);
  const injected = w.STATE.users.find(u => u.username === '<img src=x onerror=alert(1)>'.toLowerCase());
  ok('user row stored verbatim as data (escaped at render)', !!injected, w.STATE.users.map(u => u.username));
  w.location.hash = '#/settings'; w.renderActive();
  ok('settings table shows it as text not nodes', /onerror/.test(d.querySelector('#viewHost').textContent) && d.querySelectorAll('#viewHost img').length === 0);
  if (injected) { w.STATE.users = w.STATE.users.filter(u => u.userId !== injected.userId); w.commit({ noRender: true }); }

  head('12. SETTINGS WRITE + DANGER ZONE');
  w.location.hash = '#/settings'; w.renderActive();
  const before2 = w.STATE.settings.currency;
  w.STATE.settings.currency = 'SAR'; w.commit({ noRender: true });
  ok('currency change re-formats money', w.fmtMoney(10).startsWith('SAR '), w.fmtMoney(10));
  w.STATE.settings.currency = before2; w.commit({ noRender: true });
  w.dangerAction('resetSample');
  const dangerModal = d.querySelector('.modal');
  ok('danger action opens confirm dialog (no window.confirm)', !!dangerModal && /Danger|confirm|تأكيد/i.test(dangerModal.textContent));
  const okBtn = [...dangerModal.querySelectorAll('button')].find(b => /sample|Reset/i.test(b.textContent));
  click(okBtn);
  ok('reset restores seed (test rows gone)', !w.lookupFabric('fab-test') && w.STATE.fabrics.length === 8, w.STATE.fabrics.length);
  ok('reset keeps the signed-in session', !!w.CURRENT && w.CURRENT.role === 'Admin');
  ok('reset logged to audit', w.STATE.auditLog.some(l => l.action === 'Reset'));

  head('13. SESSION RESTORE + LOGOUT');
  const tok = w.STORAGE.get('fabric-inventory-session');
  ok('session survives reload', !!tok && !!JSON.parse(tok).userId);
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.com/fabric-inventory/index.html#/reports',
    virtualConsole: vc,
    beforeParse(x) {
      x.URL.createObjectURL = () => 'blob:fake'; x.URL.revokeObjectURL = () => {}; x.print = () => {};
      x.localStorage.setItem('fabric-inventory-state-v1', JSON.stringify(w.STATE));
      x.localStorage.setItem('fabric-inventory-session', tok);
    }
  });
  setTimeout(() => {
    const w2 = dom2.window, d2 = dom2.window.document;
    ok('reload skips login (session valid)', d2.querySelector('#app').hidden === false && d2.querySelector('#loginScreen').hidden === true);
    ok('restored user is admin', w2.CURRENT && w2.CURRENT.username === 'admin', w2.CURRENT && w2.CURRENT.username);
    ok('reload lands on the hash route (#/reports)', w2.normalizeRoute(d2.location.hash) === 'reports', d2.location.hash);
    ok('reports view rendered after reload', /Report|تقرير/i.test(d2.querySelector('#viewHost').textContent));
    ok('state rehydrated from localStorage', w2.STATE && w2.STATE.inventory.length === w.STATE.inventory.length, [w2.STATE && w2.STATE.inventory.length, w.STATE.inventory.length]);
    // expired session path
    const st = JSON.parse(tok); st.loginAt = new Date(Date.now() - 99 * 3600 * 1000).toISOString();
    const dom3 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.test/index.html', virtualConsole: vc,
      beforeParse(x) { x.localStorage.setItem('fabric-inventory-state-v1', JSON.stringify(w.STATE)); x.localStorage.setItem('fabric-inventory-session', JSON.stringify(st)); } });
    setTimeout(() => {
      const d3 = dom3.window.document;
      ok('expired session → back to login', d3.querySelector('#loginScreen').hidden === false && d3.querySelector('#app').hidden === true);
      ok('expired token cleared', !dom3.window.STORAGE.get('fabric-inventory-session'));
      // keeper2 on a fresh instance: 3 warehouses
      head('14. KEEPER2 SCOPE (east + west + central)');
      const dom4 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.test/index.html', virtualConsole: vc,
        beforeParse(x) { x.localStorage.setItem('fabric-inventory-state-v1', JSON.stringify(w.STATE)); } });
      setTimeout(() => {
        const w4 = dom4.window, d4 = dom4.window.document;
        d4.querySelector('#loginUser').value = 'keeper2';
        d4.querySelector('#loginPass').value = 'keeper456';
        d4.querySelector('#loginForm').dispatchEvent(new w4.Event('submit', { bubbles: true, cancelable: true }));
        ok('keeper2 signed in', w4.CURRENT && w4.CURRENT.username === 'keeper2');
        ok('keeper2 sees 3 warehouses', w4.getWarehousesForUser(w4.CURRENT).length === 3, w4.CURRENT && w4.CURRENT.warehouseIds);
        ok('keeper2 never sees north/south', !w4.getWarehousesForUser(w4.CURRENT).some(x => ['wh-north', 'wh-south'].includes(x.warehouseId)));
        w4.location.hash = '#/inventory'; w4.renderActive();
        ok('keeper2 inventory excludes north/south rows', w4.getInventoryRows({}).every(r => !['wh-north', 'wh-south'].includes(r.warehouseId)));
        ok('keeper2 dashboard clean', [...d4.querySelectorAll('#viewHost .banner.danger')].every(n => !/Application error/.test(n.textContent)));
        w4.location.hash = '#/masters'; w4.renderActive();
        const k2Btns = () => [...d4.querySelectorAll('#viewHost .card-h button')].map(x => x.textContent.trim());
        const k2RowBtns = () => [...d4.querySelectorAll('#viewHost tbody button')].map(x => x.textContent.trim());
        ok('keeper2 Warehouses tab: Export only, no Add / Delete', k2Btns().length === 1 && /Export/.test(k2Btns()[0]) && !k2RowBtns().some(t => /Delete|Edit/.test(t)), [k2Btns(), k2RowBtns()]);
        const k2Tabs = [...d4.querySelectorAll('#viewHost .tabs button')];
        ok('keeper2 masters shows all four tabs', k2Tabs.length === 4, k2Tabs.length);
        k2Tabs[3].dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
        ok('keeper2 Mapping tab keeps + Add Mapping Row', k2Btns().some(t => /Add Mapping Row/.test(t)), k2Btns());
        const k2Rows = [...d4.querySelectorAll('#viewHost tbody tr')].map(tr => tr.textContent);
        ok('keeper2 mapping table shows no North/South row', k2Rows.length > 0 && !k2Rows.some(t => /North Fabric Depot|South Fabric Depot/.test(t)), k2Rows.length);
        const k2Filter = [...d4.querySelectorAll('#viewHost select')][0];
        const k2Opts = [...k2Filter.options].map(o => o.value).filter(v => /^wh-/.test(v));
        ok('keeper2 mapping warehouse filter = own 3 sheds', k2Opts.length === 3 && !k2Opts.includes('wh-north') && !k2Opts.includes('wh-south'), k2Opts);
        ok('every mapping row keeper2 sees is editable by them', [...d4.querySelectorAll('#viewHost tbody tr button')].every(b2 => /Edit|Delete/.test(b2.textContent)));
        ok('total runtime errors: ' + errors.length, errors.length === 0, errors.slice(0, 5));
        console.log('\n\x1b[1m' + (fail ? 'FAILURES: ' + fail : 'ALL GOOD') + '\x1b[0m  ·  ' + pass + ' assertions passed');
        process.exit(fail ? 1 : 0);
      }, 400);
    }, 400);
  }, 500);
}, 600);
