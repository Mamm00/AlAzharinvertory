<p align="center"><img src="logo.svg" alt="Al Azhar Tex — Fine Fabrics" width="88" height="88"></p>

# Al Azhar Tex · Fabric Roll Inventory

**Multi-warehouse fabric roll stock control for Al Azhar Tex (FINE FABRICS) — one `index.html`,
no build step, no server, no CDN, bilingual EN/AR.**

Track fabrics and their colour grades across warehouses. Every quantity is counted in **rolls**
(optional metres-per-roll → total metres is calculated), everything else is derived.
Warehouses, fabrics, colours, the mapping grid, thresholds and user accounts are all editable
**from the UI** — you never have to touch the code.

| | |
|---|---|
| Files | `index.html` (the whole app) · `README.md` · `.nojekyll` · `404.html` · `logo.svg` |
| Brand | Al Azhar Tex · navy `#222457`, brand red `#CB3632` — sampled from the supplied artwork |
| Logo | `logo.svg` **and** an inline `<symbol id="azt-mark">` in `index.html`; one geometry, no bitmaps, no web fonts. Every number in it is measured off the supplied artwork, not drawn from memory |
| Stack | Vanilla HTML5 + CSS3 + JavaScript (ES2020+). No framework, no runtime dependency. |
| Data | `window.localStorage`, auto-saved on every change + JSON backup / CSV export |
| Charts | Hand-drawn inline **SVG** (no chart library) |
| Languages | **English** (default) and **Arabic** with full **RTL** — `EN / ع` switch in the header |
| Access | Client-side login + 4 roles (RBAC) — demo grade, see [Security](#security-read-before-real-use) |
| Runs | double-clicked from `file://`, or served from `https://<user>.github.io/<repo>/` |

---

## 1. Deploy to GitHub Pages (5 steps)

1. **Create a repository** (public or private), e.g. `fabric-inventory`.
2. **Commit these files to the root of branch `main`:**
   `index.html`, `.nojekyll`, `404.html`, `README.md` (and optionally `logo.svg`).
   ```bash
   git init && git add index.html .nojekyll 404.html README.md logo.svg
   git commit -m "Fabric Roll Inventory"
   git branch -M main
   git remote add origin https://github.com/<user>/fabric-inventory.git
   git push -u origin main
   ```
3. Repo → **Settings** → **Pages** → *Build and deployment* → **Source: Deploy from a branch**.
4. **Branch:** `main` · **Folder:** `/ (root)` → **Save**. Wait ~1 minute.
5. Open **`https://<user>.github.io/<repo>/`** and sign in as `admin / admin123`.

> `.nojekyll` is an **empty** file that makes Pages skip Jekyll processing.
> `404.html` is a redirect fallback so a hard reload on any hash route (`#/reports`) still lands
> inside the app instead of on GitHub's 404 page.
> Every URL in the app is relative and `index.html` sets `<base href="./">`, so the `/repo/`
> subpath works without configuration.

### Run it locally instead

* **Simplest:** double-click `index.html`. Everything works, **except** that some browsers block
  `localStorage` on `file://` (Safari, private windows, hardened Firefox). The app detects this,
  shows a banner and keeps working in memory for that tab — export JSON before closing.
* **With persistence:** serve the folder over HTTP:
  ```bash
  cd the-folder && python3 -m http.server 8080   # → http://localhost:8080
  ```

---

## 2. Demo accounts (one per role, plus a second keeper)

| Username | Password | Role | Warehouse scope |
|---|---|---|---|
| `admin` | `admin123` | Admin | all 5 warehouses — full read/write, users, settings, danger zone |
| `sales` | `sales123` | Sales Manager | all warehouses, **read-only**, no Settings, may export/print |
| `keeper1` | `keeper123` | Warehouse Keeper | `wh-north`, `wh-south` only |
| `keeper2` | `keeper456` | Warehouse Keeper | `wh-east`, `wh-west`, `wh-central` only |

Keepers **add / edit / delete their own** inventory records, movements and **Mapping rows** (the
fabric–colour combinations their sheds stock, inside their `warehouseIds` only). The shared
catalogue — warehouses, fabrics, colours — is **read-only** for them: one keeper renaming
*Poly Cotton* would silently rewrite every other warehouse's price sheet, so that job stays with
the Admin. Keepers never see Settings — `#/settings` sends them to a read-only *My Profile* and the
attempt is logged. A transfer may be **shipped to any warehouse in the company** (the destination
list is deliberately unscoped: the receiving team books the inward leg), but the *From* warehouse
of every form is built from `getWarehousesForUser(user)`, so a foreign shed is not even selectable.

Every login attempt (pass or fail) and every blocked permission attempt is written to the audit log.
A wrong password and an unknown username answer with the **same** words — the screen never confirms
that an account exists; only a correct password on a disabled account reveals *"This account is
deactivated."*

---

## 3. What's inside — view → function → state

| Sidebar view | Render function | Reads (state) | Writes via |
|---|---|---|---|
| README | `renderReadme()` | `APP`, `CHANGELOG`, `STATE.settings`, `STORAGE` | — |
| Settings (Admin only) | `renderSettings()` → `settingsParamsCard` · `settingsUsersCard` · `settingsBackupCard` · `settingsDangerCard` | `settings`, `users`, `auditLog` | `editSettings`, `manageUsers`, `resetSample`, `clearData` |
| My Profile (keepers) | `renderProfile()` | `users[i]`, `mapping`, derived stock | — (read-only) |
| Masters → Warehouses | `masterWarehouses`/`mastersWarehouses()` + `warehouseForm()` | `warehouses[]` | `editWarehouse`, `deleteWarehouse` |
| Masters → Fabrics | `masterFabrics()` + `fabricForm()` | `fabrics[]` | `editFabric`, `deleteFabric` |
| Masters → Colors | `masterColors()` + `colorForm()` + `loadColorCatalog()` | `colors[]`, `COLOR_CATALOG` | `editColor`, `deleteColor` |
| Masters → Mapping | `masterMapping()` + `mappingForm()` / `deleteMappingRow()` | `mapping[]` | `editMapping`, `deleteMapping` |
| Inventory | `renderInventory()` + `inventoryForm()` / `deleteInventoryRow()` | `inventory[]` (+ derived) | `editInventory`, `deleteInventory` |
| Movements | `renderMovements()` + `movementForm()` / `deleteMovement()` | `movements[]` | `editMovements`, `deleteMovement` |
| Dashboard | `renderDashboard()` + `barChart` `stackedChart` `donutChart` `lineChart` `trendChart()` | everything, derived | — |
| Reports | `renderReports()` + `buildReport(kind)` | derived rows | — |
| Audit Log | `renderAudit()` | `auditLog[]` | — |
| *(hidden) Lists_Calc* | `SECTION 8` of the script — `getStock`, `getWarehousesForUser`, `getActiveFabricsForWarehouse`, `getActiveColorsForWarehouseFabric`, `getMappingRow`, `isValidCombination`, `computeStatus`, `computeReorderSuggestion`, `getStockByWarehouse`, `getTopMovers`, `lookup*` | `STATE` | never writes |

Cross-cutting machinery:

| Function | Responsibility |
|---|---|
| `can(user, action, warehouseId)` / `guard()` | the only authorisation gate; denial ⇒ toast + `Blocked` audit row + abort |
| `commit()` | bump revision → persist to localStorage → re-render active view |
| `ensureIdx()` / `buildStockIndex()` | rebuild the cached stock index whenever `STATE` changes |
| `t(key)` + `I18N_RAW` | every string, EN + AR, in one table (`[en, ar]` pairs, so a missing translation is impossible) |
| `nm(obj, field)` | Arabic field first (`fabricNameAr`), English fallback |
| `makeCascader()` | the 3-level Warehouse → Fabric → Color control, reused everywhere |
| `makeTable()` / `buildForm()` | the only table + form renderers (safe DOM, no `innerHTML`) |
| `csvSpec(kind)` / `exportCsv` / `exportJson` / `importJsonFile` | backup + Excel output |
| `runDiagnostics()` | orphan rows, duplicates, invalid combos, negative stock, missing translations |

---

## 4. Calculations (all of them, spelled out)

```text
closingRolls   = openingRolls + rollsIn − rollsOut
totalMeters    = closingRolls × fabrics.metersPerRoll          → "#,##0.00 m"
totalValue     = closingRolls × unitCostPerRoll                → settings.currency + "#,##0.00"
status         = closing = 0            → "Out of Stock"
                 closing ≤ minRolls     → "Low"
                 closing ≥ maxRolls     → "Overstock"   (max must be > min)
                 otherwise              → "OK"
reorder        = MAX(0, minRolls − closingRolls), CEILING to a whole roll when settings.enableRounding; blank when 0
utilization %  = Σ closingRolls(warehouse) ÷ warehouses.capacityRolls × 100   → <50 green · 50–85 amber · >85 red
duplicate      = COUNT(same warehouseId+fabricId+colorId in mapping) > 1 → "DUPLICATE" (blocked on save)
invalid        = inventory/movement row whose triple has no ACTIVE mapping row → "⚠ Invalid combination"

getStock(w, f, c)  ← implemented ONCE, used by Inventory, Movements, Dashboard, Reports,
                     reorder lists, KPIs and every export:

   Σ inventory.openingRolls (w,f,c)          ← toggle: CONFIG.INCLUDE_OPENING_IN_STOCK
 + Σ inventory.rollsIn      (w,f,c)
 − Σ inventory.rollsOut     (w,f,c)
 + Σ movements In          where toWarehouse   = w
 − Σ movements Out         where fromWarehouse = w
 + Σ movements Transfer    where toWarehouse   = w
 − Σ movements Transfer    where fromWarehouse = w
 ± Σ movements Adjustment  (signed quantity) where fromWarehouse = w
```

> The brief's `getStock()` formula omits `openingRolls`. Since this app seeds opening balances,
> `getStock()` adds them by default — set `CONFIG.INCLUDE_OPENING_IN_STOCK = false` for the literal
> formula. A −3 *Adjustment* reduces stock, and one *Transfer* touches two warehouses
> (+destination, −source), so a transfer can never double-count.

---

## 5. 5-minute test checklist

Open `index.html` (or the Pages URL) and work down the list.

1. **Log in as `admin`** → sidebar shows README, Settings, Masters, Inventory, Movements, Dashboard, Reports, Audit Log. Every table has **Edit / Delete** and each view has **＋ Add**.
2. **Log out → `sales`** → Settings is **gone** from the sidebar, **Audit Log is present**, and there is **not one** Add/Edit/Delete button anywhere (only CSV / Print). Try `#/settings` in the address bar → it bounces to Dashboard and logs a `Blocked` row.
3. **Log out → `keeper1`** → sidebar shows *My Profile* instead of Settings. Open Inventory → the Warehouse dropdown contains **exactly two** options (North, South). Open Masters → Mapping → no row belongs to East / West / Central. Dashboard KPIs count North + South only. Try editing a Central row (via DevTools you could) → the server-side equivalent, `guard()`, refuses and writes `Blocked`.
4. **Log out → `keeper2`** → three warehouses (East, West, Central) and **never** North/South. Compare the Dashboard totals with keeper1's — they must differ, and `keeper1 + keeper2` rolls = the `admin` total.
5. **Admin: add a fabric** → Masters → Fabrics → ＋ Add Fabric: `Test Tussah`, 50 m/roll → it appears instantly in the Fabrics list.
6. **Map it** → Masters → Mapping → ＋ Add Mapping Row → Warehouse = North → the Fabric dropdown now contains *Test Tussah* → Color = Ivory → min 10 / max 50 → Save. Add the **same triple again** → the save is refused as a duplicate.
7. **Record stock** → Inventory → ＋ New record → North → Test Tussah → Ivory → opening 30, in 12, out 2. Closing shows **40 rolls**, **2 000.00 m** and the value from the unit cost, computed live in the form preview before you even save.
8. **Move stock** → Movements → type **Transfer**, source North → destination East, 10 rolls. Inventory (North) drops to **30**, East gains **10**, and the company total stays 40 — the transfer-safety check.
9. **Dashboard** → *Total rolls* grew by 40 vs before step 7, the *Rolls by warehouse* bar for North moved, *Grade distribution* donut includes the new colour, *Top 10 movers* lists it after the transfer. Press **Reorder now** check: any row below min shows a whole-roll suggestion.
10. **Bilingual** → click **ع**: sidebar, tables, KPI labels, README, toasts and dates (Arabic month names) all flip to RTL; layout mirrors; refresh → language persists.
11. **Backup** → Settings → Export JSON → re-import it in a fresh browser profile → identical data. Export any CSV → opens in Excel with Arabic intact.
12. **Audit Log** → steps 5–8 are all there, with `before → after` per field.

---

## 6. Editing data model / behaviour — and the brand — without touching the UI code

> **Re-brand in one field.** `Settings → Company name` (`settings.companyName`) is the only source of
> the name everywhere it appears: the sidebar, the browser tab, the profile card, the in-app README and
> the **printed letterhead** on every report. The seed is `Al Azhar Tex`. The mark itself is a single
> inline `<symbol id="azt-mark">` referenced by the login card, the sidebar, the README view and the
> print header; `logo.svg` in this repo is the same drawing (with the curved wordmark) for README
> badges and the favicon, which is inlined as a `data:image/svg+xml` URI so it works on `file://`
> and offline. All four come from **one** generator: `tools/make_logo.py` holds a single `SPEC` table of
> artboard numbers, and `python3 tools/build_app.py` regenerates them, splices the sprite and the favicon
> into `build/p01.html`, re-bakes `404.html` and rebuilds `index.html` (never edited by hand). The numbers
> are measured, not eyeballed: `tools/measure_logo.py` circle-fits the ring in the supplied artwork and reads
> off the stroke weights, the star positions, the letter sweep and where the ring is actually broken, and
> `tools/register_check.py` rasterises the SVG back over the artwork and reports the overlap per band (ring
> 0.84, monogram 0.89, crescent 0.78 IoU, all at zero offset — the check that caught the first two attempts).
> The palette is `--navy` / `--brand-red` in the design tokens; the mark inherits them via `currentColor`
> and `var(--brand-red)`, so one `:root` edit re-tints every copy at once.

* **Add a warehouse** = 5 fields in a form → appears in every dropdown, KPI, chart, report and export.
* **Add a fabric / colour** = one form each (or `★ Load full color catalog` for all 46 market colours with Arabic names, hex and grades A–D).
* **Add a mapping row** = dependent dropdowns + min/max/lead time; duplicates refused.
* **Thresholds, currency, rounding, date format, language** = Settings → Application parameters.
* **Role rules** = one `PERMS` map at the top of the script; the README view renders the live matrix.
* **Seed data** = `SECTION 1` of the script (compact tables expanded by `expandSeed()`); it only runs when no stored state exists — *Reset to sample data* re-runs it.

---

## 7. Security — read before real use

> **Client-side RBAC is NOT tamper-proof.** A determined user can bypass role restrictions via
> DevTools. This design is intended for a small trusted team. For production, move to a real backend
> or a serverless identity provider. Passwords in this demo are obfuscated with `btoa` only — real
> deployments **MUST** hash passwords on a server (bcrypt / argon2).

What *is* done properly on the client:

* No `innerHTML` is ever assigned — user text goes through `textContent`, so stored names/notes can't execute.
* A `Content-Security-Policy` meta tag blocks every external origin (`'unsafe-inline'` is unavoidable in a single-file app and is commented as such).
* CSV export quotes/escapes commas, quotes and newlines, adds a UTF-8 BOM for Excel, and prefixes `= + - @` to defuse formula injection.
* Login attempts are logged, and 5 failures trigger a 60-second soft lockout; session tokens expire after 12 h.
* Destructive actions always confirm and always download a JSON backup first.

---

## 8. Troubleshooting — top 10 pitfalls (also in the in-app README, with detail)

1. **localStorage blocked on `file://`** → banner appears, app runs in memory. Serve over `http://` or use Pages.
2. **Stale state after editing the file** → saved state wins; use *Reset to sample data* or clear key `fabric-inventory-state-v1`, then hard-reload.
3. **Duplicate IDs** → ids are generated (`uniqueId()`), never typed; duplicate mapping triples are blocked + flagged `DUPLICATE`.
4. **Date parsing / timezone drift** → dates stored as `yyyy-mm-dd`; `parseISO()` builds local dates from parts.
5. **Numeric strings from inputs** → every read passes `num()`/`intNum()`, so `NaN` can never render.
6. **Transfer double-counting** → log a movement in Inventory **or** Movements, not both; a Transfer is one row touching two warehouses.
7. **Orphaned rows after a delete** → deletes are refused while children exist; *Deactivate* is offered; `Run diagnostics` lists stragglers.
8. **CSV broken in Excel (Arabic/commas)** → handled by `rowsToCsv()` (BOM + quoting + escaping).
9. **Currency rounding oddities** → one formatter per concept (`fmtNum`, `fmtNum2`, `fmtMeters`, `fmtMoney`), reorder always rounds **up**.
10. **Chart not re-rendering after filter** → charts are produced inside the view's render function, which the filters re-run; nothing to sync.

---

## 9. Browser support & flagged APIs

Current Chrome, Edge, Firefox and Safari (desktop + tablet), `file://` and `https://`.
Modern APIs are used **with fallbacks**: `crypto.getRandomValues` → `Math.random`;
`Intl.NumberFormat` → manual thousands grouping; `URL.createObjectURL` download → copy-to-clipboard
dialog; `<dialog>` deliberately not used (custom modal with focus trap + `Esc`); `String.replaceAll`
not used (regex with `/g` instead). No service worker is included — the app is already offline-capable
because it is one file with no external requests.

---

*Sample data is fictional and generated on first run only. MIT-style: use it, fork it, ship it.*
