module.exports = {
  apps: [
    {
      name: 'hedera-relay',
      script: './packages/server/dist/index.js',
      cwd: '/Users/user/development/hashgraph/hedera-json-rpc-relay',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env_file: '.env',
      autorestart: true,
    },
  ],
};
