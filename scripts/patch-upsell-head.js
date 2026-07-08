const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const headInject = [
  '  <script src="../../../config/site-base.js"></script>',
  '  <script src="../../../js/credpix-utm.js"></script>',
  '  <script src="../../../js/credpix-boot.js"></script>',
].join('\n');

for (let n = 1; n <= 20; n++) {
  const f = path.join(root, 'up/upsell/up' + n + '.html');
  let h = fs.readFileSync(f, 'utf8');

  if (!h.includes('credpix-boot.js')) {
    if (/<script>window\.CREDPIX_BASE_PATH[^<]+<\/script>/.test(h)) {
      h = h.replace(/<script>window\.CREDPIX_BASE_PATH[^<]+<\/script>\s*\n?/g, '');
    }
    if (!h.includes('site-base.js')) {
      h = h.replace('<head>', '<head>\n' + headInject);
    }
  }

  fs.writeFileSync(f, h);
  const ok = fs.readFileSync(f, 'utf8').includes('credpix-boot.js');
  console.log('up' + n + (ok ? ' OK' : ' MISSING credpix-boot'));
}
