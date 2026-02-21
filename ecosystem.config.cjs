module.exports = {
  apps: [
    {
      name: "chatgpt-proxy",
      script: "server.js",
      cwd: "/mnt/c/Users/eholt/Documents/chatgpt-extension",
      env: {
        PORT: "8787",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY
      }
    }
  ]
};