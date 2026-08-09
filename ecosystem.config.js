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
      PORT: '49173'
    }
  }]
};
