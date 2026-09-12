const path = require('path');
const fs = require('fs');

const bundledBash = path.join(__dirname, 'vendor', 'win-tools', 'usr', 'bin', 'bash.exe');
const bundledSsh = path.join(__dirname, 'vendor', 'win-tools', 'usr', 'bin', 'ssh.exe');
const systemBash = 'C:\\msys64\\usr\\bin\\bash.exe';
const systemSsh = 'C:\\msys64\\usr\\bin\\ssh.exe';
const bash = fs.existsSync(bundledBash) ? bundledBash : systemBash;
const ssh = fs.existsSync(bundledSsh) ? bundledSsh : systemSsh;

module.exports = {
  apps: [{
    name: 'sync-gui',
    script: 'node_modules/next/dist/bin/next',
    args: 'start --port 49173',
    cwd: __dirname,
    interpreter: 'node',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    autorestart: true,
    env_production: {
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      PORT: '49173',
      SYNC_GUI_BASH: bash,
      SYNC_GUI_SSH: ssh,
    }
  }]
};
