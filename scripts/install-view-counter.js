const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tag = '  <script src="../../../js/credpix-view-counter.js"></script>\n';

for (let n = 1; n <= 20; n++) {
  const f = path.join(root, 'up/upsell/up' + n + '.html');
  let h = fs.readFileSync(f, 'utf8');
  if (h.includes('credpix-view-counter.js')) {
    console.log('up' + n, 'skip');
    continue;
  }
  if (h.includes('credpix-boot.js')) {
    h = h.replace(
      /(<script src="\.\.\/\.\.\/\.\.\/js\/credpix-boot\.js"><\/script>\s*\n)/,
      '$1' + tag
    );
  } else {
    h = h.replace('</head>', tag + '</head>');
  }
  fs.writeFileSync(f, h);
  console.log('up' + n, 'ok');
}

const back = path.join(root, 'up/upsell/backredirect.html');
let bh = fs.readFileSync(back, 'utf8');
if (!bh.includes('credpix-view-counter.js')) {
  bh = bh.replace(
    /(<script src="\.\.\/\.\.\/\.\.\/js\/credpix-boot\.js"><\/script>\s*\n)/,
    '$1' + tag
  );
  fs.writeFileSync(back, bh);
  console.log('backredirect ok');
}
