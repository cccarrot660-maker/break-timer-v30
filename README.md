# Break Timer V11 PRO — Online-ready bundle

This bundle contains a modernized UI and a simple Node.js proxy for Telegram (to avoid CORS).

Files included:
- index.html
- styles.css
- app.js
- send-tg-proxy.js (Node.js proxy)
- README (this file)

## Quick local test
1. Extract files.
2. Run a simple static server (recommended):
   python -m http.server 8000
   # then open http://localhost:8000

3. Or use any static host (GitHub Pages, Netlify, Vercel). If you deploy static-only, Telegram direct calls may be blocked by CORS — use the proxy below.

## Proxy (recommended for production or public hosting)
1. On a server (or local machine), install Node.js (v16+).
2. Put `send-tg-proxy.js` on the server and run:
   npm init -y
   npm install express body-parser node-fetch
   node send-tg-proxy.js

3. Use the proxy URL `https://your-server/send` (or `http://localhost:3000/send`) in the app `Proxy URL` field.
4. The web app will POST `{ token, chatId, text }` to the proxy which forwards to Telegram API.

## Deploy options
- GitHub Pages: static files only (no proxy). Use proxy for Telegram.
- Vercel/Netlify: deploy static site; optionally deploy `send-tg-proxy.js` as serverless function.
- VPS: host both web files and proxy on same domain to avoid CORS issues.

## Need help?
Tell me which hosting method you prefer (GitHub Pages / Vercel / VPS) and I will give step-by-step instructions and a ready-to-deploy package for that platform.
