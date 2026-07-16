const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const productName = 'Sync GUI';
const packageId = `Sync-GUI-${process.platform}-${process.arch}`;
const outDir = path.join(root, 'dist', packageId);
const appDir = appResourcePath();
const executablePath = appExecutablePath();

function appResourcePath() {
  if (process.platform === 'darwin') {
    return path.join(outDir, `${productName}.app`, 'Contents', 'Resources', 'app');
  }
  return path.join(outDir, 'resources', 'app');
}

function appExecutablePath() {
  if (process.platform === 'win32') return path.join(outDir, `${productName}.exe`);
  if (process.platform === 'darwin') return path.join(outDir, `${productName}.app`, 'Contents', 'MacOS', productName);
  return path.join(outDir, 'sync-gui');
}

function copyRequired(name) {
  const source = path.join(root, name);
  const target = path.join(appDir, name);
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, target, { recursive: true });
}

function psQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function runningPackagedProcesses() {
  if (process.platform !== 'win32') return [];

  try {
    const script = `
      $exePath = ${psQuote(executablePath)}
      Get-Process | Where-Object { $_.Path -eq $exePath } | ForEach-Object { "$($_.Id) $($_.ProcessName)" }
    `;
    return execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true
    }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function removeOutputDir() {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
  } catch (error) {
    if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;

    const running = runningPackagedProcesses();
    const details = running.length
      ? `Running packaged app process${running.length === 1 ? '' : 'es'}:\n${running.map((item) => `  ${item}`).join('\n')}`
      : 'The operating system is still holding a file in the package folder.';
    console.error(`Cannot replace ${outDir}.`);
    console.error('Close every packaged Sync GUI window, then run npm run dist again.');
    console.error(details);
    process.exit(1);
  }
}

function patchMacInfoPlist(appPath) {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  let plist = fs.readFileSync(plistPath, 'utf8');
  plist = plist
    .replace(/<string>Electron<\/string>/g, `<string>${productName}</string>`)
    .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleExecutable</key>\n    <string>${productName}</string>`)
    .replace(/<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleName</key>\n    <string>${productName}</string>`);
  fs.writeFileSync(plistPath, plist);
}

function packageRuntime() {
  if (process.platform === 'win32') {
    fs.cpSync(electronDist, outDir, { recursive: true });
    fs.renameSync(path.join(outDir, 'electron.exe'), executablePath);
    fs.rmSync(path.join(outDir, 'resources', 'default_app.asar'), { force: true });
    return;
  }

  if (process.platform === 'darwin') {
    const electronApp = path.join(electronDist, 'Electron.app');
    const appPath = path.join(outDir, `${productName}.app`);
    if (!fs.existsSync(electronApp)) throw new Error('Electron.app is missing. Run npm install first.');
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(electronApp, appPath, { recursive: true });
    fs.renameSync(path.join(appPath, 'Contents', 'MacOS', 'Electron'), executablePath);
    fs.rmSync(path.join(appPath, 'Contents', 'Resources', 'default_app.asar'), { force: true });
    patchMacInfoPlist(appPath);
    return;
  }

  if (process.platform === 'linux') {
    fs.cpSync(electronDist, outDir, { recursive: true });
    fs.renameSync(path.join(outDir, 'electron'), executablePath);
    fs.rmSync(path.join(outDir, 'resources', 'default_app.asar'), { force: true });
    return;
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function checkRequired() {
  if (!fs.existsSync(electronDist)) {
    installElectronRuntime();
  }

  if (!fs.existsSync(electronDist)) {
    throw new Error('Electron runtime is missing. Run npm install first.');
  }

  if (!fs.existsSync(path.join(root, '.next'))) {
    throw new Error('Next build output is missing. Run npm run build first.');
  }
}

function installElectronRuntime() {
  const installer = path.join(root, 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(installer)) {
    throw new Error('Electron package is missing. Run npm install first.');
  }

  process.env.electron_config_cache ||= path.join(root, '.electron-cache');
  console.log('Electron runtime is missing; downloading it now.');
  execFileSync(process.execPath, [installer], { stdio: 'inherit' });
}

function copyApp() {
  fs.mkdirSync(appDir, { recursive: true });

  for (const name of [
    'app',
    'electron',
    'lib',
    '.next',
    'node_modules',
    'next.config.mjs',
    'package.json',
    'package-lock.json',
    'sync-projects.json'
  ]) {
    copyRequired(name);
  }
}

function selfCheck() {
  for (const required of [
    executablePath,
    path.join(appDir, 'electron', 'main.js'),
    path.join(appDir, '.next', 'BUILD_ID'),
    path.join(appDir, 'node_modules', 'next', 'package.json')
  ]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Package self-check failed: ${required}`);
    }
  }
}

// ponytail: portable-folder packaging; use electron-builder later if you need installers, signing, or auto-update.
checkRequired();
removeOutputDir();
packageRuntime();
copyApp();
selfCheck();

console.log(`Packaged ${outDir}`);
