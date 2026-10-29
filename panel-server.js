const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const { buildHtml, syncRanking, dedupeRanking } = require('./panel-template.js');

const root = __dirname;
const rankingPath = path.join(root, 'ranking.json');
const port = process.env.PORT || 3456;
let clients = [];
let lastPayload = null;

function encodePathSegment(seg) {
  return encodeURIComponent(seg).replace(/%2F/g, '/');
}

function scanSvgs() {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const cards = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let files;
    try {
      files = fs.readdirSync(path.join(root, entry.name), { withFileTypes: true });
    } catch { continue; }
    for (const file of files) {
      if (file.isFile() && file.name.toLowerCase().endsWith('.svg')) {
        cards.push({
          model: entry.name,
          src: `${encodePathSegment(entry.name)}/${encodePathSegment(file.name)}`,
        });
      }
    }
  }
  cards.sort((a, b) => a.model.localeCompare(b.model, 'zh-CN'));
  return cards;
}

function loadRanking() {
  if (!fs.existsSync(rankingPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(rankingPath, 'utf8'));
  } catch (err) {
    console.warn('ranking.json 读取失败：', err.message);
    return [];
  }
}

function saveRanking(data) {
  fs.writeFileSync(rankingPath, JSON.stringify(dedupeRanking(data), null, 2) + '\n', 'utf8');
}

function payloadEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function broadcast(cards) {
  const data = JSON.stringify(cards);
  clients = clients.filter((res) => {
    if (res.writableEnded || res.destroyed) return false;
    try {
      res.write(`event: update\ndata: ${data}\n\n`);
      return true;
    } catch { return false; }
  });
}

let debounceTimer = null;
function scheduleBroadcast() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const cards = scanSvgs();
    const ranking = loadRanking();
    const { ranking: syncedRanking, changed } = syncRanking(cards, ranking);
    if (changed) saveRanking(syncedRanking);
    if (!payloadEqual(cards, lastPayload)) {
      lastPayload = cards;
      broadcast(cards);
    }
  }, 200);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function serveHtml(res) {
  const cards = scanSvgs();
  const ranking = loadRanking();
  const { ranking: syncedRanking, changed } = syncRanking(cards, ranking);
  if (changed) {
    saveRanking(syncedRanking);
    console.log('已自动补齐排名：' + syncedRanking.filter(r => !ranking.some(x => x.model === r.model)).map(r => r.model).join('、'));
  }
  lastPayload = cards;
  const html = buildHtml({
    cards,
    ranking: syncedRanking,
    isLive: true,
    dirName: path.basename(root),
    title: 'SVG 模型实时面板'
  });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const mimeTypes = {
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function serveStatic(reqPath, res) {
  const decoded = decodeURIComponent(reqPath);
  const target = path.resolve(root, decoded.slice(1));
  if (!target.startsWith(path.resolve(root) + path.sep) && target !== path.resolve(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(target, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const type = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    serveHtml(res);
    return;
  }

  if (pathname === '/api/svgs') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(scanSvgs()));
    return;
  }

  if (pathname === '/api/ranking' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(loadRanking()));
    return;
  }

  if (pathname === '/api/ranking' && req.method === 'POST') {
    readBody(req).then(body => {
      const data = JSON.parse(body);
      if (!Array.isArray(data)) throw new Error('invalid');
      saveRanking(data);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    }).catch(err => {
      res.writeHead(400);
      res.end('Bad request: ' + err.message);
    });
    return;
  }

  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`event: update\ndata: ${JSON.stringify(scanSvgs())}\n\n`);
    clients.push(res);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
    return;
  }

  serveStatic(pathname, res);
});

server.listen(port, () => {
  console.log(`实时面板已启动：http://localhost:${port}`);
  console.log('按 Ctrl+C 停止服务');
});

try {
  fs.watch(root, { recursive: true }, (eventType, filename) => {
    if (typeof filename === 'string' && filename.toLowerCase().endsWith('.svg')) {
      scheduleBroadcast();
    }
  });
} catch (err) {
  console.warn('无法启用文件监听，请手动刷新页面：', err.message);
}
