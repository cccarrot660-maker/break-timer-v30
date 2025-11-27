// send-tg-proxy.js - simple proxy to forward Telegram messages (avoid CORS)
const express = require('express');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));
const app = express();
app.use(bodyParser.json({limit:'100kb'}));

app.post('/send', async (req, res) => {
  try {
    const { token, chatId, text } = req.body;
    if(!token || !chatId || !text) return res.status(400).json({ error: 'missing token/chatId/text' });
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text, parse_mode:'HTML' }) });
    const j = await resp.json();
    res.status(resp.status).json(j);
  } catch(err) {
    console.error('proxy error', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Proxy listening on', PORT));