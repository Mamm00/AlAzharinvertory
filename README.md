<div align="center">

<img src="app/logo.svg" width="132" height="132" alt="Al Azhar Tex logo: a navy ring arc with five red stars, a lowercase “at” monogram over a red bowl, and the words AL AZHAR TEX">

# Al Azhar Tex · Fabric Roll Inventory

**A whole warehouse system in one HTML file — English and Arabic, right-to-left included.**
GitHub Pages publishes it; nothing else has to be installed.

[Open the site →](https://mamm00.github.io/AlAzharinvertory/)
&nbsp;·&nbsp; [Open the app →](https://mamm00.github.io/AlAzharinvertory/app/)
&nbsp;·&nbsp; [In-app guide](app/README.md)

</div>

---

## What is in the box

| | |
|---|---|
| **The app** | one file, `app/index.html`, 369 KB: markup, CSS, JS, artwork and favicon inline |
| **Runtime dependencies** | none. No CDN, no fonts, no `fetch`, no build step in the browser |
| **Works from** | `file://`, a USB stick, any static host, GitHub Pages |
| **Language** | every string in EN and AR (`370` keys × 2), one toggle, real RTL — layout mirrors, tables reorder, printed reports follow |
| **Scope** | 5 warehouses seeded, 9 screens, 3 roles, 46-colour market catalog, rolls with serial + metreage, transfers, stocktakes, audit log, print-on-letterhead |
| **Data** | `localStorage` per browser, plus JSON backup/restore and CSV export |
| **Version** | 1.1.0 · build 2026-11-07 |

The full behaviour manual — including the permission rules, the number-parsing
defences and the rollback procedure — is [`app/README.md`](app/README.md), which is
also the in-app **Guide** screen, translated.

## Deploy it

**A · GitHub Actions (recommended, and what this repository is configured for)**
— every push to `main` republishes `site/`, and the pipeline *fails* if the
committed output does not match what the sources build.

1. Create a repo and push:

   ```bash
   git remote add origin git@github.com:Mamm00/AlAzharinvertory.git
   git push -u origin main
   ```

2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   Not "Deploy from a branch" — see the trap below.

3. **Settings → Environments → `github-pages` → Deployment branches and tags →
   add `main`** (or choose *All branches*). GitHub creates this environment the
   first time Pages runs and protects it with whichever branch was selected at
   the time; if that is not `main`, every deploy is refused *before the job
   starts*.

4. Push. The URL is `https://mamm00.github.io/AlAzharinvertory/`.

The deploy job spends one step proving both settings before it uploads
anything, so a misconfigured repository fails with the exact click that fixes it
instead of a red X that says nothing:

| Message | Cause | Fix |
|---|---|---|
| `Branch "main" is not allowed to deploy to github-pages due to environment protection rules` | Step 3 missing: the environment only allows the branch that was current when Pages was first enabled | add `main` under *Settings → Environments → github-pages* |
| `Invalid deployment branch and no branch protection rules set in the environment` | a deploy job running from a branch the Pages site does not publish | same |
| `Pages serves 'legacy' from branch …/` | Step 2 missing: the site is in **Deploy from a branch** mode, which serves that branch **instead of** the artifact | switch *Pages → Source* to **GitHub Actions** |

**B · Deploy from a branch** — no Actions. The Pages dropdown only offers two
folders, `/ (root)` and `/docs`, so this mode cannot point at `site/`; pick `/`
on `main` and the app is still reachable at `/app/`, but the landing page needs
a root `index.html` (the output in `site/` is written for the site root). Mode A
is one dropdown away and needs no juggling, which is why it is the default here.

**C · Skip Pages** — `app/index.html` is the product. Mail it, drop it on a shared
drive, open it from `file://`. Everyone gets the same app; each browser keeps its
own data, which is what the JSON backup is for.

If you deploy `app/` from the repo root instead of `site/`, the root `.nojekyll` is
already there, and `404.html` in that folder keeps deep app links working.

## Repository map

| Path | What it is | Edit it? |
|---|---|---|
| `src/app.src.html` | **the app source of record** — everything but the injected logo sprite | ✏️ yes |
| `src/404.src.html`, `src/README.app.md` | sources for `app/404.html` and the in-app guide | ✏️ yes |
| `web/index.src.html` | source of the landing page | ✏️ yes |
| `tools/make_logo.py` | **the logo, as one table of measured numbers** | ✏️ yes (brand) |
| `tools/build_app.py` | splices the mark + favicon into `app/` | rarely |
| `tools/build_site.py` | builds `site/`, injecting every number the landing page quotes | rarely |
| `app/`, `site/` | generated output, committed so Pages can serve it | 🚫 never by hand |
| `test.js`, `test-ui.js`, `test-site.js`, `lint.js` | the four suites, all jsdom, no browser needed | ✏️ with the code |
| `brand/`, `uploads/` | brand renders and the original artwork photo the logo was measured from | reference |

The rule that keeps this honest: **`app/` and `site/` are generated.** Numbers,
the permissions matrix, the colour count and the artwork on the landing page are
read out of the app at build time, so marketing copy cannot drift from the code.

## Rebuild and check

```bash
python3 tools/build_app.py && python3 tools/build_site.py   # regenerate
bash tools/check.sh                                          # sync + all four suites
python3 tools/serve.py                                       # preview site/ on :8080
```

`tools/serve.py` is `python3 -m http.server` plus the one thing that matters for
testing a deploy: a missing path answers **404 with the body of `404.html`**, which
is how Pages behaves and the only way to see the deep-link rescue work locally.

`tools/check.sh` is what CI runs. Expect:

```
all 217 logic checks passed          (test.js: stock maths, permissions, CSV, dates)
all 112 UI checks passed             (test-ui.js: the real app, rendered in jsdom)
all 820 site checks passed           (test-site.js: the Pages site, both languages)
LINT CLEAN (36 checks)               (no network, no innerHTML, no alert, t() coverage)
```

Dependencies for the *tooling only* (the app needs nothing): `pip install pillow` for
the brand generator, `npm ci` for jsdom. `tools/register_check.py` additionally uses
`cairosvg` and is how the logo was aligned to the original artwork.

## Sign in

| Username | Password | Role | Sees |
|---|---|---|---|
| `admin` | `admin123` | Admin | everything, 8 of 9 screens |
| `keeper1` | `keeper123` | Warehouse Keeper | own sheds: stock, movements, mapping |
| `keeper2` | `keeper456` | Warehouse Keeper | a different set of sheds |
| `sales` | `sales123` | Sales Manager | read-only, may export and print |

Change the seed in `src/app.src.html` before the first real deploy, and treat
Settings → Danger Zone as production-relevant.

## What this is not

It is a client-side app: the sign-in gates *workflow*, not traffic, and the data
lives in the browser that typed it. Anyone with the file and that machine can read
it. Pages is distribution, not a vault — for real commercial confidentiality put
the same file on an internal host or behind SSO. There is no server to arbitrate,
so the supported pattern is one browser per workstation plus JSON backups exchanged
at the end of a shift.

---

<div align="center">

<img src="app/logo.svg" width="34" height="34" alt=""><br>
<sub>Al Azhar Tex · Fine Fabrics — navy <code>#222457</code>, red <code>#CB3632</code>,
5 stars, drawn from measured geometry, not traced.</sub>

</div>
