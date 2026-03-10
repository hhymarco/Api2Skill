/**
 * Route handler for POST /api/v1/analyze-request
 */

const express = require('express');
const { validateAnalyzeRequest } = require('../utils/validator');
const { buildPrompt } = require('../utils/prompt');
const { analyzeWithOpenClaw } = require('../services/openclaw');

const router = express.Router();

router.post('/analyze-request', async (req, res) => {
  // Validate request
  const validation = validateAnalyzeRequest(req.body);
  if (!validation.valid) {
    return res.status(400).json({
      code: validation.code,
      message: validation.message,
      data: null,
    });
  }

  try {
    // Normalize method to uppercase
    const payload = {
      ...req.body,
      method: req.body.method.toUpperCase(),
      query_params: req.body.query_params || {},
      request_body: req.body.request_body || null,
    };

    // Build prompt and call OpenClaw
    const prompt = buildPrompt(payload);
    const markdown = await analyzeWithOpenClaw(prompt);

    return res.status(200).json({
      code: 0,
      message: 'success',
      data: { markdown },
    });

  } catch (err) {
    // Structured errors from openclaw service
    if (err.code && err.httpStatus) {
      return res.status(err.httpStatus).json({
        code: err.code,
        message: err.message,
        data: null,
      });
    }

    // Unexpected errors
    console.error('[analyze] Unexpected error:', err);
    return res.status(500).json({
      code: 5000,
      message: 'Internal server error',
      data: null,
    });
  }
});

module.exports = router;
