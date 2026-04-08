const express = require('express');
const { buildFilterPrompt } = require('../utils/prompt');
const { analyzeWithOpenClaw, extractJSON } = require('../services/openclaw');

const router = express.Router();

router.post('/filter-request', async (req, res) => {
  const body = req.body || {};
  if (!body.url || !body.method || !body.request_headers || typeof body.response_body !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid request: url, method, request_headers, response_body are required',
      data: null,
    });
  }

  try {
    const prompt = buildFilterPrompt(body);
    const rawText = await analyzeWithOpenClaw(prompt);
    const parsed = extractJSON(rawText);
    return res.status(200).json({
      status: 'success',
      data: {
        is_business: Boolean(parsed.is_business),
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      },
    });
  } catch (err) {
    if (err.code && err.httpStatus) {
      return res.status(err.httpStatus).json({ status: 'error', message: err.message, data: null });
    }
    return res.status(500).json({ status: 'error', message: 'Internal server error', data: null });
  }
});

module.exports = router;
