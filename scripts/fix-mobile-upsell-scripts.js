const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

for (let n = 1; n <= 20; n++) {
  const f = path.join(root, 'up/upsell/up' + n + '.html');
  let h = fs.readFileSync(f, 'utf8');
  h = h.replace(
    /<script src="\.\.\/assets\/js\/links\.js" defer><\/script>/g,
    '<script src="../assets/js/links.js"></script>'
  );
  h = h.replace(
    /onclick="redirect\('(up\d+|back)'\)"/g,
    'type="button" data-credpix-checkout="$1" onclick="redirect(\'$1\')"'
  );
  fs.writeFileSync(f, h);
  console.log('up' + n, 'ok');
}
