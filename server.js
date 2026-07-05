// Zero-dependency HTTP server: serves the static UI and exposes a streaming
// (SSE) /api/translate endpoint that drives the Claude-backed translator.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseSrt, buildSrt } = require('./srt');
const { translateCues } = require('./translate');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleTranslate(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  // The API key is embedded server-side only (never sent to the browser).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const { srt, source, target, tone, accessCode } = payload;

  if (!apiKey) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'سرور پیکربندی نشده است (ANTHROPIC_API_KEY تنظیم نشده).' }));
    return;
  }

  // Optional shared access code to keep the public URL from being abused.
  const requiredCode = process.env.ACCESS_CODE;
  if (requiredCode && (accessCode || '').trim() !== requiredCode) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'کد دسترسی نادرست است.' }));
    return;
  }

  if (!srt || !source || !target || !tone) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing required fields (srt, source, target, tone)' }));
    return;
  }

  const cues = parseSrt(srt);
  if (cues.length === 0) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'هیچ پاراگراف معتبری در فایل پیدا نشد.' }));
    return;
  }

  // Cap the number of cues per request to keep translation cost predictable.
  const maxCues = Number(process.env.MAX_CUES || 3000);
  if (cues.length > maxCues) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `فایل خیلی بزرگ است (${cues.length} پاراگراف). حداکثر مجاز ${maxCues} پاراگراف است.` }));
    return;
  }

  // Server-Sent Events stream so the UI can show live progress.
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('start', { total: cues.length });

  try {
    const translated = await translateCues({
      apiKey,
      model: process.env.TRANSLATE_MODEL || 'claude-sonnet-5',
      source,
      target,
      tone,
      cues,
      onProgress: (done, total) => send('progress', { done, total }),
    });
    const outSrt = buildSrt(translated);
    send('done', { srt: outSrt });
  } catch (err) {
    send('error', { message: String(err && err.message ? err.message : err) });
  } finally {
    res.end();
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/translate') {
    handleTranslate(req, res).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: String(err.message || err) }));
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`زیرنویس — SRT translator running at http://localhost:${PORT}`);
});
