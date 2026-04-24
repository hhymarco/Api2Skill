const express = require('express');
const { buildFilterPrompt } = require('../utils/prompt');
const { analyzeWithOpenClaw, extractJSON } = require('../services/openclaw');

const router = express.Router();

router.post('/filter-request', async (req, res) => {
  const body = req.body || {};
  if (!body.url || !body.method ||
    typeof body.request_headers !== 'object' || Array.isArray(body.request_headers) || body.request_headers === null ||
    typeof body.response_body !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid request: url, method, request_headers, response_body are required',
      data: null,
    });
  }

  try {
    const prompt = buildFilterPrompt(body);
    let parsed;
    for (let attempt = 0; attempt <= 1; attempt++) {
      const rawText = await analyzeWithOpenClaw(prompt);
      try {
        parsed = extractJSON(rawText);
        break;
      } catch {
        if (attempt === 1) throw new Error('AI returned non-JSON response');
      }
    }
    return res.status(200).json({
      status: 'success',
      data: {
        is_business: parsed.is_business === true,
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
