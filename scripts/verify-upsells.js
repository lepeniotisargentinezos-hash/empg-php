const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const links = fs.readFileSync(path.join(root, 'up/assets/js/links.js'), 'utf8');
const products = fs.readFileSync(path.join(root, 'config/products.php'), 'utf8');
const phpIds = [...products.matchAll(/'(prod_[^']+)'/g)]
  .map((m) => m[1])
  .filter((id) => id !== 'prod_698630abcbdde');

const keys = [...links.matchAll(/(up\d+):/g)].map((m) => m[1]);
let ok = true;
keys.forEach((k, i) => {
  const re = new RegExp(k + ':\\s*"[^"]*(prod_[^"]+)"');
  const m = links.match(re);
  const id = m && m[1];
  if (id !== phpIds[i]) {
    ok = false;
    console.log('BAD', k, id, 'expected', phpIds[i]);
  }
});
console.log('upsell keys', keys.length);
console.log(ok ? 'ALL product IDs OK' : 'PRODUCT ID ERRORS');

for (let n = 1; n <= 20; n++) {
  const f = path.join(root, 'up/upsell/up' + n + '.html');
  if (!fs.existsSync(f)) console.log('MISSING', f);
  else {
    const html = fs.readFileSync(f, 'utf8');
    const issues = [];
    if (!html.includes('credpix-boot.js')) issues.push('no credpix-boot');
    if (!html.includes('site-base.js')) issues.push('no site-base');
    if (!html.includes('links.js')) issues.push('no links.js');
    if (html.includes('href="/up/') || html.includes("href='/up/"))
      issues.push('absolute /up/ without base');
    if (html.includes('href="/pay/')) issues.push('absolute /pay/');
    if (issues.length) console.log('up' + n + '.html:', issues.join(', '));
  }
}

const backOk = fs.existsSync(path.join(root, 'up/upsell/backredirect.html'));
console.log('backredirect exists:', backOk);
if (!backOk) process.exitCode = 1;

const requiredScripts = ['site-base.js', 'credpix-boot.js', 'links.js', 'main.js'];
let scriptErrors = 0;
for (let n = 1; n <= 20; n++) {
  const html = fs.readFileSync(path.join(root, 'up/upsell/up' + n + '.html'), 'utf8');
  requiredScripts.forEach((s) => {
    if (!html.includes(s)) {
      scriptErrors++;
      console.log('up' + n + '.html missing', s);
    }
  });
}
if (scriptErrors) {
  console.log('SCRIPT ERRORS:', scriptErrors);
  process.exitCode = 1;
} else {
  console.log('ALL 20 upsell pages have required scripts');
}
