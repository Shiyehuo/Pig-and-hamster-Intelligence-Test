const fs = require('fs');
const path = require('path');

/**
 * 排名持久化：原子写入 + 自动备份（默认最多保留 20 份，最快每 60 秒一份）。
 */
function createRankingStore(root, options = {}) {
  const rankingPath = path.join(root, 'ranking.json');
  const backupsDir = path.join(root, 'backups');
  const maxBackups = options.maxBackups || 20;
  const minIntervalMs = options.minIntervalMs || 60 * 1000;
  let lastBackupAt = 0;

  function load() {
    if (!fs.existsSync(rankingPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(rankingPath, 'utf8'));
    } catch (err) {
      console.warn('ranking.json 读取失败：', err.message);
      return [];
    }
  }

  function rotateBackup(content) {
    const now = Date.now();
    if (now - lastBackupAt < minIntervalMs) return;
    lastBackupAt = now;
    try {
      fs.mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(backupsDir, 'ranking-' + stamp + '.json'), content, 'utf8');
      const files = fs.readdirSync(backupsDir)
        .filter(f => /^ranking-.*\.json$/.test(f))
        .sort();
      while (files.length > maxBackups) {
        try { fs.unlinkSync(path.join(backupsDir, files.shift())); } catch {}
      }
    } catch (err) {
      console.warn('自动备份失败：', err.message);
    }
  }

  function save(data) {
    const json = JSON.stringify(data, null, 2) + '\n';
    let prev = null;
    try { prev = fs.readFileSync(rankingPath, 'utf8'); } catch {}
    if (prev !== null && prev.trim() !== json.trim() && prev.trim() !== '[]') {
      rotateBackup(prev);
    }
    const tmpPath = rankingPath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf8');
    fs.renameSync(tmpPath, rankingPath);
  }

  return { load, save, rankingPath, backupsDir };
}

module.exports = { createRankingStore };
