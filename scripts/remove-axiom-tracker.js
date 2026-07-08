const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const trackerRe =
  /\s*<script src="https:\/\/tracker\.axiomblack\.site\/t\.js[^"]*"><\/script>\s*\n?/gi;

for (let n = 1; n <= 20; n++) {
  const f = path.join(root, 'up/upsell/up' + n + '.html');
  let h = fs.readFileSync(f, 'utf8');
  h = h.replace(trackerRe, '\n');
  fs.writeFileSync(f, h);
  console.log(
    'up' + n,
    h.includes('axiomblack') ? 'FAIL' : 'ok'
  );
}
