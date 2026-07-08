/**
 * Upsells: site-base.php (lê .env) e remove scripts Amung fixos no HTML.
 * O contador upsell vem de links.js + CREDPIX_AMUNG_UPSELL no .env.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const amungInlineRe =
  /\s*<script id="amung-upsell">var _wau=_wau\|\|\[\];_wau\.push\(\["dynamic","[^"]+","2ha","c4302bffffff","small"\]\);<\/script>\s*\n\s*<script async src="https:\/\/waust\.at\/d\.js"><\/script>\s*\n/g;

const siteBaseJsRe = /(<script src=")([^"]*config\/site-base)\.js("><\/script>)/g;

function patchFile(file) {
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  html = html.replace(amungInlineRe, '\n');
  html = html.replace(siteBaseJsRe, '$1$2.php$3');
  if (html === before) {
    return false;
  }
  fs.writeFileSync(file, html);
  return true;
}

let n = 0;
for (let i = 1; i <= 20; i++) {
  const f = path.join(root, 'up', 'upsell', 'up' + i + '.html');
  if (fs.existsSync(f) && patchFile(f)) n++;
}
const extras = ['up/upsell/backredirect.html', 'up/obrigado.html'];
for (const rel of extras) {
  const f = path.join(root, rel);
  if (fs.existsSync(f) && patchFile(f)) n++;
}
console.log('normalize-upsell:', n, 'arquivo(s)');
