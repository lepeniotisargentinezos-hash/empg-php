const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const needle = '<script src="../../../js/credpix-boot.js"></script>';
const insert =
  '<script src="../../../js/credpix-utm.js"></script>\n  ' + needle;

const files = [
  ...fs.readdirSync(path.join(root, 'up/upsell')).filter((f) => f.endsWith('.html')),
].map((f) => path.join(root, 'up/upsell', f));

files.push(path.join(root, 'up/upsell/backredirect.html'));

for (const p of files) {
  if (!fs.existsSync(p)) continue;
  let h = fs.readFileSync(p, 'utf8');
  if (h.includes('credpix-utm.js')) {
    console.log('skip (has utm):', path.basename(p));
    continue;
  }
  if (!h.includes(needle)) {
    console.log('skip (no boot):', path.basename(p));
    continue;
  }
  fs.writeFileSync(p, h.replace(needle, insert));
  console.log('patched:', path.basename(p));
}
