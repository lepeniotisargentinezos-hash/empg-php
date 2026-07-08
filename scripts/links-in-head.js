const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

for (let n = 2; n <= 20; n++) {
  const f = path.join(root, 'up/upsell/up' + n + '.html');
  let h = fs.readFileSync(f, 'utf8');
  if (h.indexOf('credpix-view-counter') !== -1 && h.indexOf('head') !== -1) {
    const headChunk = h.split('</head>')[0];
    if (headChunk.indexOf('links.js') === -1) {
      h = h.replace(
        '<script src="../../../js/credpix-view-counter.js"></script>\n',
        '<script src="../../../js/credpix-view-counter.js"></script>\n  <script src="../assets/js/links.js"></script>\n'
      );
    }
  }
  h = h.replace(
    /<script src="\.\.\/assets\/js\/main\.js" defer><\/script>\s*\n\s*<script src="\.\.\/assets\/js\/links\.js"><\/script>\s*\n/g,
    '<script src="../assets/js/main.js" defer></script>\n'
  );
  fs.writeFileSync(f, h);
  console.log('up' + n, 'ok');
}
