module.exports = {
  apps: [
    {
      name: "crm-api",
      cwd: "/var/www/crm",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 5000
      },
      error_file: "/var/log/crm/crm-api-error.log",
      out_file: "/var/log/crm/crm-api-out.log",
      time: true
    }
  ]
};
