const fs = require('fs');
const path = require('path');
const { buildHtml, syncRanking } = require('./panel-template.js');

const root = __dirname;
const rankingPath = path.join(root, 'ranking.json');

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
        const src = `${encodeURIComponent(entry.name)}/${encodeURIComponent(file.name)}`;
        cards.push({ model: entry.name, src });
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

const cards = scanSvgs();
const ranking = loadRanking();
const { ranking: syncedRanking, changed } = syncRanking(cards, ranking);
if (changed) {
  fs.writeFileSync(rankingPath, JSON.stringify(syncedRanking, null, 2) + '\n', 'utf8');
  console.log(`已自动补齐排名：${syncedRanking.filter(r => !ranking.some(x => x.model === r.model)).map(r => r.model).join('、')}`);
}
const html = buildHtml({
  cards,
  ranking: syncedRanking,
  isLive: false,
  dirName: path.basename(root),
  title: 'SVG 模型对比面板'
});

const outPath = path.join(root, 'panel.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`已生成面板：${outPath}（包含 ${cards.length} 张 SVG，${ranking.length} 个排名）`);
