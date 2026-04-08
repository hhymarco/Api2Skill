const express = require('express');
const { getAll, upsert, remove } = require('../services/authStore');

const router = express.Router();

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('/') || trimmed.includes(' ')) return null;
  return trimmed;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isValidAuthItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return false;
  }

  switch (item.type) {
    case 'cookie':
    case 'bearer':
      return isNonEmptyString(item.value);
    case 'header':
      return isNonEmptyString(item.key) && isNonEmptyString(item.value);
    default:
      return false;
  }
}

router.get('/auth/configs', (_req, res) => {
  res.status(200).json({ status: 'success', data: getAll() });
});

router.post('/auth/configs', (req, res) => {
  const domain = normalizeDomain(req.body?.domain);
  const { name, auths } = req.body || {};
  if (!domain) {
    return res.status(400).json({ status: 'error', message: "Missing required field: 'domain'", data: null });
  }
  if (!Array.isArray(auths)) {
    return res.status(400).json({ status: 'error', message: "Missing required field: 'auths'", data: null });
  }
  if (!auths.every(isValidAuthItem)) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid request: auths contains invalid item',
      data: null,
    });
  }
  const saved = upsert({ id: req.body.id, domain, name, auths });
  return res.status(200).json({ status: 'success', data: saved });
});

router.delete('/auth/configs/:id', (req, res) => {
  const removed = remove(req.params.id);
  if (!removed) {
    return res.status(404).json({ status: 'error', message: 'Auth config not found', data: null });
  }
  return res.status(200).json({ status: 'success', data: true });
});

module.exports = router;
