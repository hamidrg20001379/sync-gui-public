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
const webInstaller = process.env.SYNC_GUI_WEB_INSTALLER === '1';

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

function copyFiltered(source, target, skip) {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (item) => !skip(path.relative(source, item).replace(/\\/g, '/'))
  });
}

function skipBundledWindowsTool(relative) {
  if (!relative) return false;
  if (
    relative === 'home' ||
    relative.startsWith('home/') ||
    relative === 'tmp' ||
    relative.startsWith('tmp/') ||
    relative === 'var' ||
    relative.startsWith('var/')
  ) return true;

  if (relative.startsWith('usr/bin/')) {
    const name = path.posix.basename(relative);
    // MSYS2 shell startup uses core utilities such as cygpath, uname, id,
    // which, locale, tzset, ln, and env in addition to the sync commands.
    // Keep every executable and runtime DLL so the bundled shell behaves as
    // a real portable MSYS2 environment without shipping package caches.
    return !name.endsWith('.dll') && !name.endsWith('.exe');
  }

  if (relative.startsWith('usr/lib/')) {
    return (
      relative === 'usr/lib/perl5' ||
      relative.startsWith('usr/lib/perl5/') ||
      relative === 'usr/lib/terminfo' ||
      relative.startsWith('usr/lib/terminfo/') ||
      relative === 'usr/lib/gnupg' ||
      relative.startsWith('usr/lib/gnupg/') ||
      relative === 'usr/lib/pkgconfig' ||
      relative.startsWith('usr/lib/pkgconfig/')
    );
  }

  if (relative.startsWith('usr/share/')) {
    return !(
      relative === 'usr/share/pki' ||
      relative.startsWith('usr/share/pki/') ||
      relative === 'usr/share/licenses' ||
      relative.startsWith('usr/share/licenses/') ||
      relative === 'usr/share/locale' ||
      relative.startsWith('usr/share/locale/') ||
      relative === 'usr/share/zoneinfo' ||
      relative.startsWith('usr/share/zoneinfo/')
    );
  }

  return (
    relative !== 'etc' &&
    !relative.startsWith('etc/') &&
    relative !== 'usr' &&
    !relative.startsWith('usr/')
  );
}

function winToolsRoot() {
  const binCandidates = [
    process.env.SYNC_GUI_WIN_TOOLS_BIN,
    path.join(root, 'vendor', 'win-tools', 'usr', 'bin'),
    'C:\\msys64\\usr\\bin'
  ].filter(Boolean);
  const rootCandidates = [
    process.env.SYNC_GUI_WIN_TOOLS_ROOT,
    path.join(root, 'vendor', 'win-tools'),
    ...binCandidates.map((candidate) => path.dirname(path.dirname(candidate)))
  ].filter(Boolean);

  return rootCandidates.find((candidate) => (
    fs.existsSync(path.join(candidate, 'usr', 'bin', 'bash.exe')) &&
    fs.existsSync(path.join(candidate, 'usr', 'bin', 'rsync.exe')) &&
    fs.existsSync(path.join(candidate, 'usr', 'bin', 'ssh.exe')) &&
    fs.existsSync(path.join(candidate, 'usr', 'bin', 'sshpass.exe'))
  ));
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
    'next.config.mjs',
    'package.json',
    'package-lock.json',
    'sync-projects.json'
  ]) {
    copyRequired(name);
  }

  if (process.platform === 'win32' && webInstaller) {
    copyRequired('scripts/install-win-tools.ps1');
  }

  // ponytail: exclude duplicated/dev-only payload; switch to Next standalone if the app needs a much smaller runtime.
  copyFiltered(path.join(root, '.next'), path.join(appDir, '.next'), (relative) => (
    relative === 'cache' ||
    relative.startsWith('cache/') ||
    relative === 'dev' ||
    relative.startsWith('dev/')
  ));

  copyFiltered(path.join(root, 'node_modules'), path.join(appDir, 'node_modules'), (relative) => (
    relative === 'electron' ||
    relative.startsWith('electron/')
  ));

  if (process.platform === 'win32') {
    if (webInstaller) return;
    const toolsSource = winToolsRoot();
    const toolsTarget = path.join(appDir, 'vendor', 'win-tools');
    if (!toolsSource) {
      throw new Error('Bundled Windows tools are missing. Add vendor/win-tools, set SYNC_GUI_WIN_TOOLS_ROOT, or install MSYS2 to C:\\msys64.');
    }

    // Copy only the portable runtime needed by Sync GUI. Never copy a
    // builder's home directory: it may contain private SSH keys.
    copyFiltered(toolsSource, toolsTarget, skipBundledWindowsTool);
    fs.mkdirSync(path.join(appDir, 'vendor', 'win-tools', 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(appDir, 'vendor', 'win-tools', 'home', 'sync-gui', '.ssh'), { recursive: true });
  }
}

function selfCheck() {
  const requiredFiles = [
    executablePath,
    path.join(appDir, 'electron', 'main.js'),
    path.join(appDir, '.next', 'BUILD_ID'),
    path.join(appDir, 'node_modules', 'next', 'package.json')
  ];
  if (process.platform === 'win32' && !webInstaller) {
    for (const tool of ['bash.exe', 'rsync.exe', 'ssh.exe', 'sshpass.exe']) {
      requiredFiles.push(path.join(appDir, 'vendor', 'win-tools', 'usr', 'bin', tool));
    }
    requiredFiles.push(path.join(appDir, 'vendor', 'win-tools', 'usr', 'bin', 'msys-2.0.dll'));
    requiredFiles.push(path.join(appDir, 'vendor', 'win-tools', 'usr', 'ssl', 'certs', 'ca-bundle.crt'));
  }
  for (const required of requiredFiles) {
    if (!fs.existsSync(required)) {
      throw new Error(`Package self-check failed: ${required}`);
    }
  }
}

// Portable-folder packaging; Inno Setup wraps this folder into the end-user
// installer. Set SYNC_GUI_WEB_INSTALLER=1 to download MSYS2 during install.
checkRequired();
removeOutputDir();
packageRuntime();
copyApp();
selfCheck();

console.log(`Packaged ${outDir}`);
