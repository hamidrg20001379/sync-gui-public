const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const next = require('next');

const dev = !app.isPackaged;
const appRoot = path.join(__dirname, '..');
const exeDir = app.isPackaged ? path.dirname(app.getPath('exe')) : null;

function logError(error) {
  if (!exeDir) return;
  const message = error?.stack || error?.message || String(error);
  fs.appendFileSync(path.join(exeDir, 'sync-gui-error.log'), `${new Date().toISOString()} ${message}\n`);
}

process.on('uncaughtException', (error) => {
  logError(error);
  app.quit();
});

process.on('unhandledRejection', (error) => {
  logError(error);
  app.quit();
});

if (app.isPackaged) {
  const workspaceConfigPath = path.resolve(exeDir, '..', '..', 'sync-projects.json');
  const configPath = fs.existsSync(workspaceConfigPath)
    ? workspaceConfigPath
    : path.join(exeDir, 'sync-projects.json');
  const bundledConfigPath = path.join(appRoot, 'sync-projects.json');

  process.chdir(exeDir);
  process.env.SYNC_GUI_CONFIG ||= configPath;
  process.env.SYNC_GUI_ENV ||= path.join(path.dirname(configPath), '.env');

  if (!fs.existsSync(configPath) && fs.existsSync(bundledConfigPath)) {
    fs.copyFileSync(bundledConfigPath, configPath);
  }
}

const nextApp = next({ dev, dir: appRoot, ...(dev ? { webpack: true } : {}) });
const handle = nextApp.getRequestHandler();

let mainWindow;

nextApp.prepare().then(() => {
  const server = require('http').createServer(handle);
  server.listen(3000, '0.0.0.0', () => {
    const port = 3000;
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      webPreferences: { nodeIntegration: false }
    });
    mainWindow.loadURL(`http://localhost:${port}`);
    mainWindow.on('closed', () => { mainWindow = null; });
  });
});

app.on('window-all-closed', () => app.quit());
