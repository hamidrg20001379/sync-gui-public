const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const productName = 'Sync GUI';
const portableId = 'Sync-GUI-win32-x64';
const distDir = path.join(root, 'dist');
const portableDir = path.join(distDir, portableId);
const installerName = 'Sync-GUI-Setup-win32-x64';
const installerPath = path.join(distDir, `${installerName}.exe`);
const issPath = path.join(distDir, 'sync-gui-installer.iss');

function findIscc() {
  if (process.env.ISCC && fs.existsSync(process.env.ISCC)) return process.env.ISCC;

  try {
    return execFileSync('where', ['ISCC.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
  } catch {
    const candidates = [
      path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
      path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe')
    ];
    const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (found) return found;
  }

  throw new Error('Inno Setup compiler is missing. Install it with: winget install JRSoftware.InnoSetup -e or choco install innosetup -y. For a custom install, set ISCC to the full ISCC.exe path.');
}

function issQuote(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '""');
}

function appVersion() {
  const ref = process.env.GITHUB_REF_NAME || '';
  const version = ref.replace(/^v/i, '');
  return /^\d+\.\d+\.\d+/.test(version) ? version : '1.0.0';
}

if (process.platform !== 'win32') {
  throw new Error('The Windows installer can only be built on Windows.');
}

if (!fs.existsSync(path.join(portableDir, `${productName}.exe`))) {
  throw new Error('Portable Windows app is missing. Run npm run dist first.');
}

const iss = `#define MyAppName "${productName}"
#define MyAppExeName "${productName}.exe"

[Setup]
AppId={{AEB30F7D-C298-4B21-A5A7-443B6894649B}
AppName={#MyAppName}
AppVersion=${appVersion()}
DefaultDirName={localappdata}\\Programs\\${productName}
DefaultGroupName={#MyAppName}
OutputDir=${issQuote(distDir)}
OutputBaseFilename=${installerName}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
DisableProgramGroupPage=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "${issQuote(path.join(portableDir, '*'))}"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"
Name: "{userdesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
`;

fs.writeFileSync(issPath, iss, 'utf8');
fs.rmSync(installerPath, { force: true });

execFileSync(findIscc(), [issPath], { stdio: 'inherit', windowsHide: true });

if (!fs.existsSync(installerPath)) {
  throw new Error(`Installer self-check failed: ${installerPath}`);
}

console.log(`Packaged ${installerPath}`);
