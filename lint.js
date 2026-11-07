/* Static guarantees for the "single file / offline / no CDN" requirements. */
const fs=require('fs');
const html=fs.readFileSync('app/index.html','utf8');
let bad=0;
const chk=(name,cond,extra)=>{console.log((cond?'  \x1b[32mPASS\x1b[0m ':'  \x1b[31mFAIL\x1b[0m ')+name+(extra!==undefined&&!cond?'  → '+JSON.stringify(extra).slice(0,220):''));if(!cond)bad++;};
chk('one <script> block, inline', (html.match(/<script/g)||[]).length===1 && !/<script[^>]+src=/i.test(html));
chk('one <style> block, inline', (html.match(/<style/g)||[]).length===1 && !/<link[^>]+stylesheet/i.test(html));
chk('no external URLs at runtime', !/(src|href)\s*=\s*["']https?:/i.test(html), (html.match(/(src|href)\s*=\s*["']https?:[^"']{0,60}/gi)||[]).slice(0,4));
chk('no fetch/XHR/WebSocket/import', !/\b(fetch\(|XMLHttpRequest|WebSocket|importScripts|@import)\b/.test(html), (html.match(/\b(fetch\(|XMLHttpRequest|WebSocket|importScripts|@import)/g)||[]));
chk('no CDN hostnames', !/unpkg|jsdelivr|cdnjs|googleapis|gstatic|bootstrapcdn|cloudflare/i.test(html));
chk('<base href="./"> present', /<base\s+href="\.\/">/i.test(html));
chk('CSP meta present with required policy', /Content-Security-Policy/.test(html) && /default-src 'self'/.test(html));
chk('no blocking dialogs (alert/confirm/prompt)', !/\b(window\.)?(alert|confirm|prompt)\s*\(/.test(html), (html.match(/\b(alert|confirm|prompt)\s*\(/g)||[]).slice(0,5));
chk('zero innerHTML assignments (XSS surface closed)', !/\.innerHTML\s*=/.test(html), (html.match(/.{0,40}\.innerHTML.{0,30}/g)||[]));
chk('user fields never touch innerHTML', !/innerHTML\s*=\s*(?!'|")[a-zA-Z_$.\[]/.test(html), (html.match(/.{0,30}innerHTML\s*=.{0,30}/g)||[]));
chk('localStorage keys namespaced', /fabric-inventory-state-v1/.test(html) && /fabric-inventory-session/.test(html));
chk('no btoa-less plaintext demo passwords', /passwordEncoded/.test(html) && !/pass:\s*'admin123',\s*.*passwordEncoded/.test(html));
chk('dir=rtl wiring', /setAttribute\('dir', code === 'ar' \? 'rtl' : 'ltr'\)/.test(html));
chk('es2020+ only (no top-level await/module)', !/\bawait\b|type="module"/.test(html));
const repo=['README.md','.nojekyll','404.html','logo.svg'];
repo.forEach(f=>chk('repo file '+f+' exists', fs.existsSync('app/'+f)));
if(fs.existsSync('app/404.html')){const f=fs.readFileSync('app/404.html','utf8');chk('404.html redirects to index.html', /index\.html/.test(f)&&/<script/.test(f));}
if(fs.existsSync('app/.nojekyll'))chk('.nojekyll is empty', fs.statSync('app/.nojekyll').size===0);
if(fs.existsSync('app/README.md')){const r=fs.readFileSync('app/README.md','utf8');['Deploy','Pages','index.html','.nojekyll','404.html'].forEach(k=>chk('README.md mentions '+k, r.includes(k)));}
/* ── brand: Al Azhar Tex mark + palette, inlined, no external assets ───────── */
{
  const idx=fs.readFileSync('app/index.html','utf8');
  /* one <symbol> definition, referenced by <use> from the login card, the sidebar,
     the README view and the print letterhead (the in-app README also *names* the
     symbol in prose, so the count is checked on the closing tags). */
  chk('brand mark defined exactly once as an inline <symbol>', (idx.match(/<\/symbol>/g)||[]).length===1);
  chk('mark referenced by login, sidebar, README view and print head', (idx.match(/azt-mark/g)||[]).length>=5, (idx.match(/azt-mark/g)||[]).length);
  chk('favicon is an inlined vector (works on file://)', /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/.test(idx));
  chk('CSP permits the data-URI favicon', /img-src 'self' data:/.test(idx));
  chk('seeded company is Al Azhar Tex', idx.includes("companyName: 'Al Azhar Tex'"));
  chk('brand navy in the design tokens', idx.includes('--navy:#222457'));
  chk('brand red in the design tokens', idx.includes('--brand-red:#CB3632'));
  chk('no leftover placeholder company', !/Nile Valley/i.test(idx));
  chk('logo.svg is the company mark', /Al Azhar Tex/.test(fs.readFileSync('app/logo.svg','utf8')));
  chk('logo.svg shares the brand palette', fs.readFileSync('app/logo.svg','utf8').includes('#222457'));
  chk('404.html is branded too', /Al Azhar Tex/.test(fs.readFileSync('app/404.html','utf8')));
}
console.log(bad?'\n\x1b[31mLINT FAILURES: '+bad+'\x1b[0m':'\n\x1b[32mLINT CLEAN\x1b[0m');
process.exit(bad?1:0);
