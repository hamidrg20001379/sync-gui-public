const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const productName = 'Sync GUI';
const packageId = `Sync-GUI-${process.platform}-${process.arch}`;
const sourceDir = path.join(root, 'dist', packageId);
const dmgPath = path.join(root, 'dist', `${packageId}.dmg`);

if (process.platform !== 'darwin') {
  throw new Error('The macOS DMG can only be built on macOS.');
}

if (!fs.existsSync(path.join(sourceDir, `${productName}.app`))) {
  throw new Error('Portable macOS app is missing. Run npm run dist first.');
}

fs.rmSync(dmgPath, { force: true });
execFileSync('hdiutil', [
  'create',
  '-volname',
  productName,
  '-srcfolder',
  sourceDir,
  '-ov',
  '-format',
  'UDZO',
  dmgPath
], { stdio: 'inherit' });

if (!fs.existsSync(dmgPath)) {
  throw new Error(`DMG self-check failed: ${dmgPath}`);
}

console.log(`Packaged ${dmgPath}`);
