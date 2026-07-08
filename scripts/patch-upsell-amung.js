const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const inlineBlock =
  "  <script id=\"amung-upsell\">var _wau=_wau||[];_wau.push([\"dynamic\",\"emnads233312\",\"2ha\",\"c4302bffffff\",\"small\"]);</script>\n" +
  '  <script async src="https://waust.at/d.js"></script>\n';

const obrigadoBlock =
  "    <script id=\"amung-upsell\">var _wau=_wau||[];_wau.push([\"dynamic\",\"emnads233312\",\"2ha\",\"c4302bffffff\",\"small\"]);</script>\n" +
  '    <script async src="https://waust.at/d.js"></script>\n';

const patterns = [
  [
    /  <script>window\.CREDPIX_VIEW_COUNTER_CODE='emnads233312';<\/script>\s*\n  <script src="\.\.\/\.\.\/\.\.\/js\/credpix-view-counter\.js"><\/script>\s*\n/g,
    inlineBlock,
  ],
  [
    /  <script src="\.\.\/\.\.\/\.\.\/js\/credpix-view-counter\.js"><\/script>\s*\n/g,
    inlineBlock,
  ],
  [
    /    <script>window\.CREDPIX_VIEW_COUNTER_CODE='emnads233312';<\/script>\s*\n    <script src="\.\.\/js\/credpix-view-counter\.js"><\/script>\s*\n/g,
    obrigadoBlock,
  ],
  [
    /    <script src="\.\.\/js\/credpix-view-counter\.js"><\/script>\s*\n/g,
    obrigadoBlock,
  ],
];

function patchFile(file, isObrigado) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('emnads233312","2ha"') || html.includes("emnads233312\", \"2ha\"")) {
    console.log(path.basename(file), 'skip (inline ok)');
    return false;
  }

  let changed = false;
  for (const [re, block] of patterns) {
    if (re.test(html)) {
      html = html.replace(re, isObrigado ? obrigadoBlock : inlineBlock);
      changed = true;
      break;
    }
  }

  if (!changed) {
    console.log(path.basename(file), 'no match');
    return false;
  }

  fs.writeFileSync(file, html);
  console.log(path.basename(file), 'ok');
  return true;
}

let updated = 0;
for (let i = 1; i <= 20; i++) {
  if (patchFile(path.join(root, 'up/upsell/up' + i + '.html'))) updated++;
}
if (patchFile(path.join(root, 'up/upsell/backredirect.html'))) updated++;
if (patchFile(path.join(root, 'up/obrigado.html'), true)) updated++;

console.log('updated', updated, 'files');
