const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.resolve(__dirname, '../../data');
const dataFile = path.join(dataDir, 'auth-configs.json');

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, '[]\n', 'utf8');
  }
}

function readAll() {
  ensureStore();
  const raw = fs.readFileSync(dataFile, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function writeAll(items) {
  ensureStore();
  const tmp = dataFile + '.tmp';
  fs.writeFileSync(tmp, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, dataFile);
}

function getAll() {
  return readAll();
}

function getByDomain(domain) {
  return readAll().find(item => item.domain === domain) || null;
}

function upsert(config) {
  if (!config.domain || typeof config.domain !== 'string') {
    throw new TypeError('upsert: config.domain is required');
  }
  const items = readAll();
  const now = new Date().toISOString();
  const next = {
    id: config.id || crypto.randomUUID(),
    domain: config.domain,
    name: config.name || '',
    auths: Array.isArray(config.auths) ? config.auths : [],
    updatedAt: now,
  };
  const idx = config.id
    ? items.findIndex(item => item.id === config.id)
    : items.findIndex(item => item.domain === next.domain);
  if (idx >= 0) {
    next.id = items[idx].id;
    items[idx] = next;
  } else {
    items.push(next);
  }
  writeAll(items);
  return next;
}

function remove(id) {
  const items = readAll();
  const next = items.filter(item => item.id !== id);
  writeAll(next);
  return next.length !== items.length;
}

module.exports = { getAll, getByDomain, upsert, remove };
