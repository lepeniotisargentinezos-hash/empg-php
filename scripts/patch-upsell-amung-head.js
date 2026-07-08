/**
 * Alinha <head> dos upsells ao checkout: site-base?counter_slot=upsell + credpix-view-counter.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const upsellRe =
  /<script src="((?:\.\.\/)+)config\/site-base\.php"><\/script>[\s\S]*?<script src="\1config\/amung-counter\.php\?slot=upsell"><\/script>[\s\S]*?<script src="\1js\/credpix-view-counter\.js"><\/script>/gi;

function patchFile(file) {
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  html = html.replace(upsellRe, (m, prefix) => {
    const p = prefix || '../../../';
    return (
      `<script src="${p}config/site-base.php?counter_slot=upsell"></script>\n` +
      `    <script src="${p}js/credpix-view-counter.js"></script>`
    );
  });
  if (html === before) return false;
  fs.writeFileSync(file, html);
  return true;
}

let n = 0;
const upsellDir = path.join(root, 'up', 'upsell');
for (const name of fs.readdirSync(upsellDir)) {
  if (!name.endsWith('.html')) continue;
  if (patchFile(path.join(upsellDir, name))) {
    n++;
    console.log('patched', name);
  }
}
const obrigado = path.join(root, 'up', 'obrigado.html');
if (fs.existsSync(obrigado)) {
  let html = fs.readFileSync(obrigado, 'utf8');
  const next = html
    .replace(
      /<script src="\.\.\/config\/site-base\.php"><\/script>\s*<script src="\.\.\/config\/amung-counter\.php\?slot=upsell"><\/script>\s*<script src="\.\.\/js\/credpix-view-counter\.js"><\/script>/,
      '<script src="../config/site-base.php?counter_slot=upsell"></script>\n    <script src="../js/credpix-view-counter.js"></script>'
    );
  if (next !== html) {
    fs.writeFileSync(obrigado, next);
    n++;
    console.log('patched obrigado.html');
  }
}
console.log('total', n);
