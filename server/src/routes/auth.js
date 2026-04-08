const express = require('express');
const { getAll, upsert, remove } = require('../services/authStore');

const router = express.Router();

router.get('/auth/configs', (_req, res) => {
  res.status(200).json({ status: 'success', data: getAll() });
});

router.post('/auth/configs', (req, res) => {
  const { domain, name, auths } = req.body || {};
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({ status: 'error', message: "Missing required field: 'domain'", data: null });
  }
  if (!Array.isArray(auths)) {
    return res.status(400).json({ status: 'error', message: "Missing required field: 'auths'", data: null });
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
