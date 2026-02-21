# Ask ChatGPT — Chrome Side Panel Extension

A custom Chrome Extension (Manifest V3) that adds a right-click **“Ask ChatGPT”** action and a persistent side panel for contextual AI assistance on any webpage.

Built with a secure architecture that prevents API key exposure by routing all requests through a local Node/Express proxy.

---

## Features

- Right-click “Ask ChatGPT” on selected text
- Persistent Chrome side panel UI
- Global conversation thread shared across tabs
- Clear chat functionality
- Image URL + base64 image analysis
- Secure server-side OpenAI API handling

---

## Architecture

Chrome Extension (MV3)  
→ Background Service Worker (thread state + messaging)  
→ Local Node/Express Proxy (localhost:8787)  
→ OpenAI Responses API  

The API key is never exposed to the browser.  
All OpenAI calls are made from the server using environment variables.

---

## Tech Stack

- JavaScript
- Chrome Extensions (Manifest V3)
- Node.js
- Express
- OpenAI Responses API
- PM2 (process management)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/eholt723/chatgpt-extension.git
cd chatgpt-extension