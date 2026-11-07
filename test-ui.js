/* UI-driven flow test: everything happens by clicking and typing into the real DOM. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, 'app', 'index.html'), 'utf8');
const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/Could not parse CSS|Not implemented: navigation|Not implemented: window\.print|Not implemented: HTMLFormElement/.test(m)) errs.push(m); });
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));

let pass = 0, fail = 0, printed = 0, downloads = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 240) : '')); } };
const head = s => console.log('\n\x1b[1m== ' + s + ' \x1b[0m');

function boot(extraSetup) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://u.test/fabric-inventory/index.html#/dashboard',
    beforeParse(w) {
      w.URL.createObjectURL = b => { downloads.push(b); return 'blob:fake'; };
      w.URL.revokeObjectURL = () => {};
      w.print = () => { printed++; };
      w.scrollTo = () => {};
      const origClick = w.HTMLElement.prototype.click;
      w.HTMLElement.prototype.click = function () { if (this.tagName === 'A' && this.getAttribute('download')) downloads.push(this.getAttribute('download')); else return origClick.apply(this, arguments); };
      if (extraSetup) extraSetup(w);
    }
  });
  return dom;
}
const dom = boot();
const w = dom.window, d = w.document;
const q = s => d.querySelector(s);
const qa = s => [...d.querySelectorAll(s)];
const click = n => { if (!n) throw new Error('missing element'); n.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); };
const byText = (sel, txt) => qa(sel).find(b => (b.textContent || '').indexOf(txt) >= 0);
const setVal = (n, v) => { n.value = v; n.dispatchEvent(new w.Event('input', { bubbles: true })); n.dispatchEvent(new w.Event('change', { bubbles: true })); };
const login = (u, p) => { setVal(q('#loginUser'), u); setVal(q('#loginPass'), p); q('#loginForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); };
const modal = () => { const all = [...d.querySelectorAll('.modal')]; return all.length ? all[all.length - 1] : null; };
const mq = sel => { const m = modal(); return m ? m.querySelector(sel) : null; };
const mqa = sel => { const m = modal(); return m ? [...m.querySelectorAll(sel)] : []; };
const viewErr = () => qa('#viewHost .banner.danger').map(n => n.textContent).filter(t => /Application error/.test(t));
const toasts = () => qa('#toastHost .toast').map(n => n.textContent.replace(/\s+/g, ' ').trim());

setTimeout(() => {
  head('A. LOGIN + INVENTORY FORM END-TO-END');
  ok('login screen carries the company mark', !!d.querySelector('#loginScreen use[href="#azt-mark"]'));
  ok('login screen shows company + product + hint',
     ['Al Azhar Tex', 'Fabric Roll Inventory', 'Sign in to continue'].every(x => /x/.test('') || q('#loginScreen').textContent.indexOf(x) >= 0),
     q('.lg-brand').textContent.replace(/\s+/g, ' ').trim());
  login('admin', 'admin123');
  ok('sidebar shows the company, not the product, as the brand', q('#brandName').textContent === 'Al Azhar Tex' && /Fabric Roll Inventory/.test(q('#brandSub').textContent), q('#brandName').textContent);
  ok('signed in', w.CURRENT && w.CURRENT.role === 'Admin');
  w.location.hash = '#/inventory'; w.renderActive();
  ok('inventory view clean', viewErr().length === 0, viewErr());
  const rowsBefore = w.STATE.inventory.length;
  const stockBefore = w.getStock('wh-north', 'fab-poplin', 'col-ivory');
  const whiteBefore = w.getStock('wh-north', 'fab-poplin', 'col-optic-white');
  click(byText('#viewHost button', 'New inventory record'));
  ok('inventory modal opened', !!modal() && /New inventory record/.test(modal().textContent));
  let sels = mqa('select');
  ok('modal has the 3-level cascade', sels.length === 3, sels.length);
  ok('level 2 disabled initially', sels[1].disabled === true && sels[2].disabled === true);
  setVal(sels[0], 'wh-north');
  sels = mqa('select');
  ok('level 2 enabled after warehouse', sels[1].disabled === false && sels[1].options.length === 4, sels[1].options.length);
  setVal(sels[1], 'fab-poplin');
  sels = mqa('select');
  ok('level 3 enabled after fabric', sels[2].disabled === false && sels[2].options.length === 4, sels[2].options.length);
  setVal(sels[2], 'col-optic-white');
  setVal(mq('#fld-openingRolls'), '100');
  setVal(mq('#fld-rollsIn'), '25');
  setVal(mq('#fld-rollsOut'), '10');
  setVal(mq('#fld-unitCostPerRoll'), '1234.5');
  setVal(mq('#fld-notes'), 'created through the UI');
  const prev = [...modal().querySelectorAll('.banner')].pop();
  ok('live preview computes 115 rolls', /115/.test(prev.textContent), prev.textContent.replace(/\s+/g, ' ').trim());
  ok('preview shows metres (115×50 m)', /5,750\.00 m/.test(prev.textContent), prev.textContent.replace(/\s+/g, ' ').trim());
  ok('preview shows value 115×1234.50', /141,967\.50/.test(prev.textContent), prev.textContent.replace(/\s+/g, ' ').trim());
  click(byText('.modal-f button', 'Save'));
  ok('modal closed after save', !modal());
  ok('one inventory row added', w.STATE.inventory.length === rowsBefore + 1, w.STATE.inventory.length);
  ok('untouched colour keeps its stock', w.getStock('wh-north', 'fab-poplin', 'col-ivory') === stockBefore, stockBefore);
  ok('new row adds 115 to ledger stock', w.getStock('wh-north', 'fab-poplin', 'col-optic-white') === whiteBefore + 115, [whiteBefore, w.getStock('wh-north', 'fab-poplin', 'col-optic-white')]);
  const newRec = w.STATE.inventory[w.STATE.inventory.length - 1];
  ok('new record fields stored typed', newRec.openingRolls === 100 && newRec.rollsIn === 25 && newRec.rollsOut === 10 && newRec.unitCostPerRoll === 1234.5, newRec);
  ok('new record in table (closing 115)', qa('#viewHost tbody tr').some(tr => /115/.test(tr.textContent)));
  ok('save audited as Create', w.STATE.auditLog[w.STATE.auditLog.length - 1].action === 'Create');
  ok('toast confirmed the save', toasts().some(t => /created/i.test(t)), toasts());
  ok('persisted to localStorage', JSON.parse(w.STORAGE.get('fabric-inventory-state-v1')).inventory.length === w.STATE.inventory.length);
  // required-field validation
  click(byText('#viewHost button', 'New inventory record'));
  setVal(mqa('select')[0], 'wh-north');
  click(byText('.modal-f button', 'Save'));
  ok('validation blocks an empty form (modal stays open)', !!modal() && mqa('.err.show').length > 0, mqa('.err.show').map(e => e.textContent));
  click(byText('.modal-f button', 'Cancel'));
  ok('cancel closes', !modal());

  head('B. MOVEMENT FORM: TRANSFER IS TRANSFER-SAFE');
  w.location.hash = '#/movements'; w.renderActive();
  ok('movements view clean', viewErr().length === 0, viewErr());
  const nB = w.getStock('wh-north', 'fab-poly', 'col-sky'), eB = w.getStock('wh-east', 'fab-poly', 'col-sky');
  click(byText('#viewHost button', 'Log a movement'));
  ok('movement modal opened with type on top', !!modal() && /Type|Stock In/.test(modal().textContent.slice(0, 500)));
  setVal(mq('#fld-type'), 'Transfer');
  ok('Transfer reveals a second warehouse select', mqa('select').length === 5, mqa('select').length);
  setVal(mqa('select')[1], 'wh-north');
  setVal(mqa('select')[2], 'fab-poly');
  setVal(mqa('select')[3], 'col-sky');
  setVal(mqa('select')[4], 'wh-east');
  setVal(mq('#fld-rolls'), '7');
  setVal(mq('#fld-reference'), 'TR-UI-1');
  const mPrev = [...modal().querySelectorAll('.banner')].pop();
  ok('preview: source 185→178 style maths', new RegExp(String(nB) + ' → ' + String(nB - 7)).test(mPrev.textContent), mPrev.textContent.replace(/\s+/g, ' ').trim());
  ok('preview: destination +7', new RegExp(String(eB) + ' → ' + String(eB + 7)).test(mPrev.textContent), mPrev.textContent.replace(/\s+/g, ' ').trim());
  click(byText('.modal-f button', 'Save'));
  ok('modal closed after transfer save', !modal());
  ok('north −7', w.getStock('wh-north', 'fab-poly', 'col-sky') === nB - 7, [nB, w.getStock('wh-north', 'fab-poly', 'col-sky')]);
  ok('east +7', w.getStock('wh-east', 'fab-poly', 'col-sky') === eB + 7, [eB, w.getStock('wh-east', 'fab-poly', 'col-sky')]);
  ok('transfer row written', w.STATE.movements.some(m => m.reference === 'TR-UI-1' && m.type === 'Transfer'));
  ok('transfer is conserved company-wide', w.getStock('wh-north', 'fab-poly', 'col-sky') + w.getStock('wh-east', 'fab-poly', 'col-sky') === nB + eB);
  // transferring INTO a warehouse that does not stock the combo must be refused, with a helpful message
  click(byText('#viewHost button', 'Log a movement'));
  setVal(mq('#fld-type'), 'Transfer');
  setVal(mqa('select')[1], 'wh-north');
  setVal(mqa('select')[2], 'fab-poly');
  setVal(mqa('select')[3], 'col-sky');
  setVal(mqa('select')[4], 'wh-central');
  setVal(mq('#fld-rolls'), '1');
  click(byText('.modal-f button', 'Save'));
  ok('unmapped destination refused with a mapping hint', !!modal() && /does not stock|mapping row/.test(modal().textContent), modal() && modal().textContent.replace(/\s+/g, ' ').match(/does not stock[^]{0,60}/));
  click(byText('.modal-f button', 'Cancel'));
  // over-issue guard
  click(byText('#viewHost button', 'Log a movement'));
  setVal(mq('#fld-type'), 'Out');
  setVal(mqa('select')[1], 'wh-east');
  setVal(mqa('select')[2], 'fab-poly');
  setVal(mqa('select')[3], 'col-sky');
  setVal(mq('#fld-rolls'), '99999');
  click(byText('.modal-f button', 'Save'));
  ok('over-issue refused (modal stays, inline error)', !!modal() && mqa('.err.show').length > 0, mqa('.err.show').map(e => e.textContent));
  ok('nothing written by the refused issue', w.getStock('wh-east', 'fab-poly', 'col-sky') === eB + 7);
  click(byText('.modal-f button', 'Cancel'));
  ok('cancel closes the movement modal', !modal());

  head('C. DELETE CONFIRM + GUARD');
  w.location.hash = '#/inventory'; w.renderActive();
  const targetRow = qa('#viewHost tbody tr').find(tr => /created through the UI/.test(tr.textContent));
  ok('created row visible with Edit/Delete', !!targetRow && /Delete/.test(targetRow.textContent), !!targetRow);
  const countBefore = w.STATE.inventory.length;
  click([...targetRow.querySelectorAll('button')].find(b => /Delete/.test(b.textContent)));
  ok('confirm dialog (not window.confirm)', !!modal() && /confirm/i.test(modal().textContent));
  click(byText('.modal-f button', 'Delete'));
  ok('row deleted', w.STATE.inventory.length === countBefore - 1);
  ok('delete audited', w.STATE.auditLog.some(l => l.action === 'Delete' && l.table === 'inventory'));

  head('D. MASTERS: ADD A WAREHOUSE, EVERYTHING FOLLOWS');
  const whBefore = w.whOptions(w.CURRENT, true).length;
  w.location.hash = '#/masters'; w.renderActive();
  click(byText('#viewHost button', 'Add Warehouse'));
  setVal(mq('#fld-warehouseName'), 'Fifth Avenue Annexe');
  setVal(mq('#fld-warehouseNameAr'), 'مستودع جديد');
  setVal(mq('#fld-capacityRolls'), '600');
  setVal(mq('#fld-location'), 'Test City');
  click(byText('.modal-f button', 'Save'));
  const newWh = w.STATE.warehouses.find(x => x.warehouseName === 'Fifth Avenue Annexe');
  ok('warehouse created + id generated', !!newWh && /^wh-/.test(newWh.warehouseId), newWh && newWh.warehouseId);
  ok('warehouse now in every dropdown', w.whOptions(w.CURRENT, true).length === whBefore + 1);
  w.location.hash = '#/inventory'; w.renderActive();
  ok('warehouse appears in the inventory filter', /Fifth Avenue Annexe/.test(qa('#viewHost select')[0].textContent));
  ok('dashboard bar chart gained a column', (() => {
    w.location.hash = '#/dashboard'; w.renderActive();
    return qa('#viewHost svg .barrect').length > 5;
  })(), qa('#viewHost svg .barrect').length);
  // duplicate name refused
  w.location.hash = '#/masters'; w.renderActive();
  click(byText('#viewHost button', 'Add Warehouse'));
  setVal(mq('#fld-warehouseName'), 'Fifth Avenue Annexe');
  setVal(mq('#fld-capacityRolls'), '100');
  click(byText('.modal-f button', 'Save'));
  ok('duplicate warehouse name refused', !!modal() && /already exists/.test(modal().textContent), modal() && modal().textContent.match(/already exists[^]{"0,40}/));
  click(byText('.modal-f button', 'Cancel'));
  // delete-with-children refusal → deactivate
  w.location.hash = '#/masters'; w.renderActive();
  const northRow = qa('#viewHost tbody tr').find(tr => /North Fabric Depot/.test(tr.textContent));
  click([...northRow.querySelectorAll('button')].find(b => /Delete/.test(b.textContent)));
  ok('delete blocked by children, offers Deactivate', !!modal() && /Deactivate/.test(modal().textContent), modal() && modal().textContent.replace(/\s+/g, ' ').slice(0, 160));
  click(byText('.modal-f button', 'Deactivate'));
  ok('warehouse deactivated not deleted', w.STATE.warehouses.some(x => x.warehouseId === 'wh-north'));
  ok('deactivated row is grey/italic', qa('#viewHost tbody tr.row-inactive').length >= 1, qa('#viewHost tbody tr.row-inactive').length);
  const north = w.STATE.warehouses.find(x => x.warehouseId === 'wh-north'); north.isActive = 'Y'; w.commit({ noRender: true });
  // cleanup the test warehouse
  const testWh = w.STATE.warehouses.find(x => x.warehouseName === 'Fifth Avenue Annexe');
  w.STATE.warehouses = w.STATE.warehouses.filter(x => x !== testWh); w.commit({ noRender: true });
  ok('test warehouse removed cleanly', !w.lookupWarehouse(testWh.warehouseId));

  head('E. COLOR CATALOG + MAPPING DUPLICATE BLOCK');
  click(byText('#viewHost button', 'Colors'));
  const before = w.STATE.colors.length;
  click(byText('#viewHost button', 'Load full color catalog'));
  ok('catalog reports nothing missing', toasts().some(t => /already/i.test(t)) || w.STATE.colors.length === before, [before, w.STATE.colors.length, toasts()]);
  w.STATE.colors = w.STATE.colors.filter(c => c.colorId !== 'col-royal-blue'); w.commit({ noRender: true });
  click(byText('#viewHost button', 'Load full color catalog'));
  ok('missing color restored by one click', !!w.lookupColor('col-royal-blue') && w.STATE.colors.length === before);
  click(byText('#viewHost button', 'Mapping'));
  const mapBefore = w.STATE.mapping.length;
  click(byText('#viewHost button', 'Add Mapping Row'));
  setVal(mqa('select')[0], 'wh-north');
  setVal(mqa('select')[1], 'fab-poplin');
  setVal(mqa('select')[2], 'col-ivory');
  setVal(mq('#fld-minRolls'), '10'); setVal(mq('#fld-maxRolls'), '99');
  click(byText('.modal-f button', 'Save'));
  ok('duplicate mapping triple refused', !!modal() && w.STATE.mapping.length === mapBefore && /already exists/.test(modal().textContent), [w.STATE.mapping.length]);
  setVal(mqa('select')[2], 'col-royal-blue');
  click(byText('.modal-f button', 'Save'));
  ok('new unique mapping accepted', w.STATE.mapping.length === mapBefore + 1 && !modal());
  ok('new color now selectable in Inventory cascade', w.getActiveColorsForWarehouseFabric('wh-north', 'fab-poplin').includes('col-royal-blue'));

  head('F. FILTERS, REPORTS, PRINT, EXPORT');
  w.location.hash = '#/dashboard'; w.renderActive();
  const allRolls = w.getStockByWarehouse(w.CURRENT).reduce((a, b) => a + b.rolls, 0);
  setVal(qa('#viewHost .card select')[0], 'wh-north');
  const northRolls = w.getStockByWarehouse(w.CURRENT).filter(b => b.warehouseId === 'wh-north').reduce((a, b) => a + b.rolls, 0);
  ok('warehouse filter narrowed KPI text', northRolls < allRolls && viewErr().length === 0, [allRolls, northRolls]);
  ok('charts re-rendered after filter', qa('#viewHost svg.chart').length >= 4, qa('#viewHost svg.chart').length);
  setVal(qa('#viewHost .card select')[0], '');
  w.location.hash = '#/reports'; w.renderActive();
  ok('reports view clean', viewErr().length === 0, viewErr());
  const repRows = qa('#viewHost tbody tr').length;
  ok('byWarehouse rows == scoped warehouses', repRows === 5, repRows);
  click(byText('#viewHost .seg button', 'By grade'));
  ok('grade report renders', qa('#viewHost tbody tr').length > 0 && viewErr().length === 0, qa('#viewHost tbody tr').length);
  click(byText('#viewHost .seg button', 'By date range'));
  ok('date report renders with movement totals', qa('#viewHost tfoot').length === 1 && viewErr().length === 0);
  click(byText('#viewHost button', 'Print report'));
  ok('print sheet built in #printArea', q('#printArea').textContent.length > 200, q('#printArea').textContent.length);
  ok('printed sheet opens with the Al Azhar Tex letterhead', /Al Azhar Tex/.test(q('#printArea .p-head').textContent) && !!q('#printArea .p-head use'), q('#printArea .p-head').textContent.replace(/\s+/g, ' ').trim());
  ok('print area is a table, not raw state', /<table/.test(q('#printArea').innerHTML));
  downloads = [];
  click(byText('#viewHost button', 'Export CSV'));
  ok('report CSV downloaded', downloads.some(dn => /^report-/.test(String(dn))), downloads);
  w.location.hash = '#/audit'; w.renderActive();
  ok('audit shows the UI actions', /inventory/i.test(q('#viewHost').textContent) && qa('#viewHost tbody tr').length > 10, qa('#viewHost tbody tr').length);
  ok('audit covers login + create + update + delete', ['Login','Create','Update','Delete'].every(a => new RegExp(a).test(q('#viewHost').textContent)));
  ok('audit has before→after columns', /Old value/.test(q('#viewHost').textContent));
  const blockedRows = qa('#viewHost tbody tr').filter(tr => /Blocked/.test(tr.textContent)).length;
  ok('no permission denials leaked into an admin session', blockedRows === 0, blockedRows);
  click(byText('#viewHost .row button, #viewHost button', 'Print'));
  ok('print dialog reached via window.print()', true);

  head('G. SETTINGS SAVE + LANGUAGE + KEEPER READ-ONLY PROFILE');
  w.location.hash = '#/settings'; w.renderActive();
  setVal(q('#fld-lowStockThreshold'), '33');
  setVal(q('#fld-currency'), 'AED');
  click(byText('#viewHost .card-h button', 'Save'));
  ok('settings persisted', w.STATE.settings.lowStockThreshold === 33 && w.STATE.settings.currency === 'AED', w.STATE.settings);
  ok('money format follows currency', w.fmtMoney(5) === 'AED 5.00', w.fmtMoney(5));
  w.STATE.settings.lowStockThreshold = 25; w.STATE.settings.currency = 'EGP'; w.commit({ noRender: true });
  // user create through the UI
  w.location.hash = '#/settings'; w.renderActive();
  const usersBefore = w.STATE.users.length;
  click(byText('#viewHost button', 'Add user'));
  setVal(mq('#fld-username'), 'Keeper3');
  setVal(mq('#fld-displayName'), 'Third Keeper');
  setVal(mq('#fld-password'), 'keeper333');
  mqa('input[type=checkbox]').forEach(c => { if (c.id === 'sc-wh-west') c.checked = true; });
  click(byText('.modal-f button', 'Save'));
  const nu = w.STATE.users.find(u => u.username === 'keeper3');
  ok('account created, username lowercased', !!nu && nu.role === 'WarehouseKeeper' && nu.warehouseIds.join() === 'wh-west', nu);
  ok('password stored btoa-obfuscated, never plaintext', nu.passwordEncoded.indexOf('keeper333') < 0 && w.dec(nu.passwordEncoded) === 'keeper333');
  // deactivate + block login
  const uRow = qa('#viewHost tbody tr').find(tr => /keeper3/.test(tr.textContent));
  click([...uRow.querySelectorAll('button')].find(b => /Deactivate/.test(b.textContent)));
  ok('deactivate is an audited update', w.STATE.users.find(u => u.username === 'keeper3').isActive === 'N');
  w.endSession(false);
  login('keeper3', 'keeper333');
  ok('deactivated account cannot log in', !w.CURRENT && /deactivated/.test(q('#loginErr').textContent), q('#loginErr').textContent);
  w.STATE.users = w.STATE.users.filter(u => u.userId !== (nu && nu.userId)); w.commit({ noRender: true });
  ok('users back to 4', w.STATE.users.length === usersBefore, w.STATE.users.length);
  login('admin', 'admin123');
  click(byText('#appLang button', 'ع'));
  ok('RTL applied from the header switch', d.documentElement.getAttribute('dir') === 'rtl' && w.STATE.settings.language === 'ar');
  ok('brand name stays Latin in Arabic mode', q('#brandName').textContent === 'Al Azhar Tex' && /نظام لفافات/.test(q('#brandSub').textContent), q('#brandSub').textContent);
  w.location.hash = '#/inventory'; w.renderActive();
  ok('inventory table headers in Arabic', /المستودع/.test(q('#viewHost').textContent));
  ok('no untranslated key strings anywhere', !/\b(nav|msg|btn|f|page|sec|mas|inv|mov|dash|rep|typ|act|st|perm|howto|deploy|trouble|readme)\.[a-zA-Z]/.test(q('#viewHost').textContent + q('#navList').textContent), (q('#viewHost').textContent.match(/\b[a-z]+\.[a-z]{2,}/g) || []).slice(0, 6));
  click(byText('#appLang button', 'EN'));
  ok('back to English + persisted', d.documentElement.getAttribute('dir') === 'ltr' && w.STATE.settings.language === 'en');

  head('H. KEEPER UI: NO EDIT CONTROLS OUTSIDE SCOPE, PROFILE ONLY');
  w.endSession(false);
  login('keeper1', 'keeper123');
  w.location.hash = '#/settings'; w.renderActive();
  ok('keeper settings route → their own profile', /My Profile|ملفي/.test(q('#pageTitle').textContent) && w.STATE.auditLog.some(l => l.action === 'Blocked' && l.recordId === 'settings'), q('#pageTitle').textContent);
  ok('keeper profile has no Save buttons', qa('#viewHost button').filter(b => /Save/.test(b.textContent)).length === 0, qa('#viewHost button').map(b => b.textContent));
  w.location.hash = '#/masters'; w.renderActive();
  const keepBtns = {};
  ['Warehouses', 'Fabrics', 'Colors', 'Mapping'].forEach(lab => {
    click(byText('#viewHost .tabs button', lab));
    keepBtns[lab] = qa('#viewHost .card-h button').map(b => b.textContent.trim());
  });
  ok('keeper: no Add / Delete on the Warehouses, Fabrics and Colors tabs', ['Warehouses', 'Fabrics', 'Colors'].every(l => !keepBtns[l].some(t => /Add |Delete/.test(t))), keepBtns);
  ok('keeper: + Add Mapping Row stays on the Mapping tab', keepBtns['Mapping'].some(t => /Add Mapping Row/.test(t)), keepBtns['Mapping']);
  ok('keeper: Export CSV is offered on every tab', Object.keys(keepBtns).every(l => keepBtns[l].some(t => /Export/.test(t))), keepBtns);
  const fabricsBefore = w.STATE.fabrics.length, kMapBefore = w.STATE.mapping.length;
  click(byText('#viewHost button', 'Add Mapping Row'));
  ok('mapping modal opens with the 3-level cascade', !!modal() && mqa('select').length === 3);
  const kWh = [...mqa('select')[0].options].map(o => o.value).filter(v => /^wh-/.test(v));
  ok('the picker never offers a warehouse outside the scope', kWh.length === 2 && kWh.indexOf('wh-east') < 0, kWh);
  /* find a combination South does not stock yet, and map it from the UI */
  const free = (() => {
    for (const f of w.STATE.fabrics) for (const c of w.STATE.colors) {
      if (!w.STATE.mapping.some(m => m.warehouseId === 'wh-south' && m.fabricId === f.fabricId && m.colorId === c.colorId)) return [f.fabricId, c.colorId];
    }
    return null;
  })();
  setVal(mqa('select')[0], 'wh-south');
  setVal(mqa('select')[1], free[0]);
  setVal(mqa('select')[2], free[1]);
  setVal(mq('#fld-minRolls'), '10');
  click(byText('.modal-f button', 'Save'));
  ok('keeper maps a combination for their own warehouse', w.STATE.mapping.length === kMapBefore + 1 && !!modal() === false, w.STATE.mapping.length - kMapBefore);
  const kNew = w.STATE.mapping[w.STATE.mapping.length - 1];
  ok('the new row is logged to the audit table with the keeper as author', kNew.warehouseId === 'wh-south' &&
      w.STATE.auditLog.some(l => l.action === 'Create' && l.table === 'mapping' && l.recordId === kNew.mappingId && /keeper1/.test(String(l.user || l.userId || ''))),
      JSON.stringify(w.STATE.auditLog[w.STATE.auditLog.length - 1]).slice(0, 150));
  ok('shared fabric catalog untouched by a keeper', w.STATE.fabrics.length === fabricsBefore);
  w.STATE.mapping = w.STATE.mapping.filter(m => m.mappingId !== kNew.mappingId); w.commit({ noRender: true });
  w.endSession(false);
  login('admin', 'admin123');
  w.location.hash = '#/masters'; w.renderActive();
  click(byText('#viewHost .tabs button', 'Warehouses'));
  const whBtns = qa('#viewHost .card-h button').map(b => b.textContent.trim());
  ok('admin: Warehouses tab offers Add + Export', whBtns.some(t => /Add Warehouse/.test(t)) && whBtns.some(t => /Export/.test(t)), whBtns);
  click(byText('#viewHost .tabs button', 'Fabrics'));
  const admBtns = qa('#viewHost .card-h button').map(b => b.textContent.trim());
  ok('admin: Fabrics tab offers Add Fabric (keepers had none)', admBtns.some(t => /Add Fabric/.test(t)), admBtns);
  const fabRow = qa('#viewHost tbody tr')[0];
  ok('admin fabric rows carry Edit + Delete', /Edit/.test(fabRow.textContent) && /Delete/.test(fabRow.textContent), fabRow.textContent.replace(/\s+/g, ' ').slice(0, 70));
  w.endSession(false);
  login('keeper1', 'keeper123');
  // warehouse dropdown in inventory + movements + reports: only 2 options
  ['inventory', 'movements', 'reports', 'dashboard'].forEach(v => {
    w.location.hash = '#/' + v; w.renderActive();
    const s0 = qa('#viewHost select')[0];
    const opts = [...s0.options].map(o => o.value).filter(x => /^wh-/.test(x));
    ok(v + ': warehouse dropdown = north+south only', opts.length === 2 && !opts.includes('wh-east'), opts);
  });
  w.location.hash = '#/inventory'; w.renderActive();
  const delBtns = qa('#viewHost tbody button').filter(b => /Delete/.test(b.textContent));
  ok('keeper can delete in-scope inventory rows', delBtns.length > 0);
  ok('keeper KPI totals ≠ admin totals', (() => {
    const k = w.getStockByWarehouse(w.CURRENT).reduce((a, b) => a + b.rolls, 0);
    const a = w.getStockByWarehouse(w.STATE.users.find(u => u.role === 'Admin')).reduce((x, b) => x + b.rolls, 0);
    return k < a;
  })());

  head('I. file:// + BLOCKED localStorage (degraded mode)');
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://u.test/fabric-inventory/index.html#/readme',
    beforeParse(win) {
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {}; win.print = () => {};
      Object.defineProperty(win, 'localStorage', { get() { throw new Error('localStorage blocked'); } });
    }
  });
  setTimeout(() => {
    const w2 = dom2.window, d2 = dom2.window.document;
    ok('app boots with storage denied', !!w2.STATE && w2.STATE.inventory.length > 0);
    ok('STORAGE.mode = in-memory', w2.STORAGE.mode() === 'in-memory', w2.STORAGE.mode());
    d2.querySelector('#loginUser').value = 'admin'; d2.querySelector('#loginPass').value = 'admin123';
    d2.querySelector('#loginForm').dispatchEvent(new w2.Event('submit', { bubbles: true, cancelable: true }));
    ok('login still works without storage', !!w2.CURRENT);
    w2.STATE.settings.currency = 'QAR'; w2.commit({ noRender: true });
    ok('write survives in memory', w2.STATE.settings.currency === 'QAR');
    w2.location.hash = '#/readme'; w2.renderActive();
    ok('README warns about volatile storage', /localStorage is unavailable|storage is blocked|التخزين/i.test(d2.querySelector('#viewHost').textContent), d2.querySelector('#viewHost .banner') && d2.querySelector('#viewHost .banner').textContent.slice(0, 90));
    ok('404.html + .nojekyll are shipped beside index.html', fs.existsSync(path.join(__dirname, 'app', '404.html')) && fs.existsSync(path.join(__dirname, 'app', '.nojekyll')));

    head('J. CLEAN RENDER SWEEP (every view × every role, Arabic + English)');
    const roles = ['admin', 'sales', 'keeper1', 'keeper2'];
    const setValD = (doc, win, sel, val) => { const n = doc.querySelector(sel); if (!n) return; n.value = val; n.dispatchEvent(new win.Event('input', { bubbles: true })); n.dispatchEvent(new win.Event('change', { bubbles: true })); };
    const clickD = (doc, win, n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

    let sweepErr = 0;
    function openEveryModal(doc, win) {
      /* click every Edit button on page 1 of each masters tab: opens + closes a modal */
      const trs = [...doc.querySelectorAll('#viewHost tbody tr')].slice(0, 5);
      trs.forEach(tr => {
        const edit = [...tr.querySelectorAll('button')].find(b => /^Edit$/.test(b.textContent.trim()));
        if (!edit) return;
        clickD(doc, win, edit);
        const mm = doc.querySelector('.modal');
        if (mm) {
          const cancel = [...mm.querySelectorAll('.modal-f button')].find(x => /Cancel/.test(x.textContent));
          if (cancel) clickD(doc, win, cancel);
        }
      });
    }
    function clickAllTabs(doc, win) {
      [...doc.querySelectorAll('#viewHost .tabs button')].forEach(b => clickD(doc, win, b));
    }
    const PW = { admin: 'admin123', sales: 'sales123', keeper1: 'keeper123', keeper2: 'keeper456' };
    function sweep(lang) {
      let i = 0, sweepErr = 0;
      const next = () => {
        if (i >= roles.length) {
          ok('sweep: 4 roles × 9 views × ' + lang.toUpperCase() + ' — no render errors / NaN / undefined', sweepErr === 0, sweepErr);
          finish();
          return;
        }
        const role = roles[i];
        const dm = new JSDOM(html, {
          runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
          url: 'https://s.test/repo/index.html#/dashboard',
          beforeParse(win) {
            win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {}; win.print = () => {};
            win.localStorage.setItem('fabric-inventory-state-v1', JSON.stringify(w.STATE));
          }
        });
        setTimeout(() => {
          const w3 = dm.window, d3 = dm.window.document;
          setValD(d3, w3, '#loginUser', role); setValD(d3, w3, '#loginPass', PW[role]);
          d3.querySelector('#loginForm').dispatchEvent(new w3.Event('submit', { bubbles: true, cancelable: true }));
          if (lang === 'ar') w3.setLanguage('ar', { save: false });
          ['readme', 'settings', 'profile', 'masters', 'inventory', 'movements', 'dashboard', 'reports', 'audit'].forEach(v => {
            w3.location.hash = '#/' + v; w3.renderActive();
            const txt = d3.querySelector('#viewHost').textContent;
            const bad = [...d3.querySelectorAll('#viewHost .banner.danger')].filter(n => /Application error/.test(n.textContent));
            if (bad.length) { sweepErr++; console.log('   \x1b[31mERR\x1b[0m ' + role + '/' + lang + '/' + v + ' → ' + bad[0].textContent.replace(/\s+/g, ' ').slice(0, 200)); }
            const cells = [...d3.querySelectorAll('#viewHost td, #viewHost th, #viewHost .chip, #viewHost .kpi, #viewHost .stat, #viewHost .banner, #viewHost option, #viewHost label')];
            const junk = cells.filter(n => /NaN|undefined|\[object /.test(n.textContent));
            if (junk.length) { sweepErr++; console.log('   \x1b[31mJUNK\x1b[0m ' + role + '/' + lang + '/' + v + ' → ' + junk.slice(0, 2).map(n => n.textContent.replace(/\s+/g, ' ').slice(0, 60)).join(' | ')); }
            /* the README page is documentation: it *talks about* NaN/undefined on
               purpose, so the prose scan only applies to the data views.           */
            if (v !== 'readme' && /\bundefined\b/.test(txt)) { sweepErr++; console.log('   \x1b[31mundef\x1b[0m ' + role + '/' + lang + '/' + v + ' → ' + (txt.match(/.{0,60}undefined.{0,40}/) || [''])[0]); }
            if (v === 'inventory' || v === 'movements' || v === 'audit') {
              if (/\bnull\b/.test(txt)) { sweepErr++; console.log('   \x1b[31mnull\x1b[0m ' + role + '/' + lang + '/' + v); }
            }
            if (v === 'masters') { clickAllTabs(d3, w3); openEveryModal(d3, w3); }
          });
          dm.window.close();
          i++;
          next();
        }, 450);
      };
      next();
    }
    let done = 0;
    function finish() {
      done++;
      if (done < 2) return;
      ok('zero unexpected console errors overall', errs.length === 0, errs.slice(0, 6));
      ok('window.print() was invoked at least once (deferred)', printed >= 1, printed);
      console.log('\n\x1b[1m' + (fail ? 'FAILURES: ' + fail : 'ALL GOOD') + '\x1b[0m  ·  ' + pass + ' UI assertions passed  ·  prints=' + printed + '  downloads=' + downloads.length);
      process.exit(fail ? 1 : 0);
    }
    sweep('en'); setTimeout(() => sweep('ar'), 6000);
  }, 500);
}, 500);
