/**
 * Route handler for POST /api/v1/analyze-request
 * V2: Returns structured JSON instead of Markdown.
 */

const express = require('express');
const { validateAnalyzeRequest } = require('../utils/validator');
const { buildPrompt } = require('../utils/prompt');
const { analyzeWithOpenClaw, extractJSON } = require('../services/openclaw');

const router = express.Router();

router.post('/analyze-request', async (req, res) => {
  // Validate request
  const validation = validateAnalyzeRequest(req.body);
  if (!validation.valid) {
    return res.status(400).json({
      status: 'error',
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

    // Build V2 prompt and call OpenClaw, retry once on non-JSON response
    const prompt = buildPrompt(payload);
    let structured;
    for (let attempt = 0; attempt <= 1; attempt++) {
      const rawText = await analyzeWithOpenClaw(prompt);
      try {
        structured = extractJSON(rawText);
        break;
      } catch (parseErr) {
        console.error(`[analyze] attempt ${attempt + 1}: Failed to extract JSON:`, parseErr.message);
        console.error('[analyze] Raw response:', rawText.substring(0, 500));
        try { require('fs').writeFileSync('/tmp/a2s_last_raw.txt', rawText); } catch {}
        if (attempt === 1) {
          return res.status(502).json({
            status: 'error',
            message: 'AI returned non-JSON response. Please retry.',
            data: null,
          });
        }
      }
    }

    // Validate the structured output has required fields
    if (!structured.skill_name || !structured.api_info) {
      return res.status(502).json({
        status: 'error',
        message: 'AI response missing required fields (skill_name, api_info).',
        data: null,
      });
    }

    // Ensure arrays exist with defaults
    const apiInfo = structured.api_info;
    apiInfo.headers = Array.isArray(apiInfo.headers) ? apiInfo.headers : [];
    apiInfo.query = Array.isArray(apiInfo.query) ? apiInfo.query : [];
    apiInfo.body = Array.isArray(apiInfo.body) ? apiInfo.body : [];
    apiInfo.response_mock = apiInfo.response_mock || payload.response_body || '';

    return res.status(200).json({
      status: 'success',
      data: {
        skill_name: structured.skill_name,
        skill_description: structured.skill_description || '',
        api_info: apiInfo,
      },
    });

  } catch (err) {
    // Structured errors from openclaw service
    if (err.code && err.httpStatus) {
      return res.status(err.httpStatus).json({
        status: 'error',
        message: err.message,
        data: null,
      });
    }

    // Unexpected errors
    console.error('[analyze] Unexpected error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
    });
  }
});

module.exports = router;
