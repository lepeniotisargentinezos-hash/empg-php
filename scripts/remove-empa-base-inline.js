const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const re = /<script>window\.CREDPIX_BASE_PATH\s*=\s*window\.CREDPIX_BASE_PATH\s*\|\|\s*['"]\/empa['"]\s*;?\s*<\/script>\s*\n?/g;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '_probe') continue;
      walk(p, out);
    } else if (/\.html$/i.test(name)) out.push(p);
  }
  return out;
}

let n = 0;
for (const file of walk(root)) {
  let h = fs.readFileSync(file, 'utf8');
  if (!re.test(h)) continue;
  h = h.replace(re, '');
  fs.writeFileSync(file, h);
  console.log('cleaned:', path.relative(root, file));
  n++;
}
console.log('total:', n);
