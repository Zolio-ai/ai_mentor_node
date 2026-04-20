module.exports = {
  apps: [
    {
      name: "ai-mentor-api",
      script: "server.mjs",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_restarts: 20,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "ai-mentor-worker",
      script: "worker/main.mjs",
      args: "start",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_restarts: 20,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
