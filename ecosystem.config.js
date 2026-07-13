module.exports = {
  apps: [
    {
      name: 'axsoft-contable',
      script: 'server.js',
      instances: 1,           // SQLite = 1 instancia (no usar cluster con better-sqlite3)
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      max_memory_restart: '300M',
      time: true
    }
  ]
};
