const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const productName = 'Sync GUI';
const appId = 'sync-gui';
const packageId = `Sync-GUI-${process.platform}-${process.arch}`;
const sourceDir = path.join(root, 'dist', packageId);
const appDir = path.join(root, 'dist', `${packageId}.AppDir`);
const appImagePath = path.join(root, 'dist', `${packageId}.AppImage`);

function appImageTool() {
  const tool = process.env.APPIMAGETOOL || 'appimagetool';
  return tool;
}

function writeFile(filePath, value, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
  if (mode) fs.chmodSync(filePath, mode);
}

if (process.platform !== 'linux') {
  throw new Error('The Linux AppImage can only be built on Linux.');
}

if (!fs.existsSync(path.join(sourceDir, appId))) {
  throw new Error('Portable Linux app is missing. Run npm run dist first.');
}

fs.rmSync(appDir, { recursive: true, force: true });
fs.rmSync(appImagePath, { force: true });
fs.mkdirSync(path.join(appDir, 'usr', 'lib'), { recursive: true });
fs.cpSync(sourceDir, path.join(appDir, 'usr', 'lib', appId), { recursive: true });

writeFile(path.join(appDir, 'AppRun'), `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/lib/${appId}/${appId}" "$@"
`, 0o755);

writeFile(path.join(appDir, `${appId}.desktop`), `[Desktop Entry]
Type=Application
Name=${productName}
Exec=${appId}
Icon=${appId}
Categories=Utility;
Terminal=false
`);

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#18202b"/>
  <path d="M66 92h124M66 128h124M66 164h88" stroke="#7ee7a8" stroke-width="18" stroke-linecap="round"/>
  <circle cx="64" cy="92" r="13" fill="#2c6fbb"/>
  <circle cx="64" cy="128" r="13" fill="#d38327"/>
  <circle cx="64" cy="164" r="13" fill="#2c6fbb"/>
</svg>
`;

writeFile(path.join(appDir, 'usr', 'share', 'icons', 'hicolor', 'scalable', 'apps', `${appId}.svg`), icon);
writeFile(path.join(appDir, `${appId}.svg`), icon);
writeFile(path.join(appDir, '.DirIcon'), icon);

execFileSync(appImageTool(), [appDir, appImagePath], {
  stdio: 'inherit',
  env: { ...process.env, ARCH: process.arch === 'x64' ? 'x86_64' : process.arch }
});

if (!fs.existsSync(appImagePath)) {
  throw new Error(`AppImage self-check failed: ${appImagePath}`);
}

console.log(`Packaged ${appImagePath}`);
