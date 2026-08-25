const path = require('path');

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
      SYNC_GUI_BASH: path.join(__dirname, 'vendor', 'win-tools', 'usr', 'bin', 'bash.exe'),
      SYNC_GUI_SSH: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
      SYNC_GUI_DRIVE_PREFIX: '/cygdrive'
    }
  }]
};
