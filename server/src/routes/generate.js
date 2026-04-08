/**
 * Route handler for POST /api/v1/generate-skill
 * Receives API schema, generates Skill code via OpenClaw, returns ZIP.
 */

const express = require('express');
const archiver = require('archiver');
const { buildGenerateSkillPrompt } = require('../utils/prompt');
const { analyzeWithOpenClaw, extractJSON } = require('../services/openclaw');
const { getByDomain } = require('../services/authStore');

const router = express.Router();

router.post('/generate-skill', async (req, res) => {
  const { skill_name, skill_description, api_info } = req.body;

  // Validate required fields
  if (!skill_name) {
    return res.status(400).json({
      status: 'error',
      message: "Missing required field: 'skill_name'",
      data: null,
    });
  }
  if (!api_info || !api_info.method || !api_info.url) {
    return res.status(400).json({
      status: 'error',
      message: "Missing required field: 'api_info' with method and url",
      data: null,
    });
  }

  try {
    // Build prompt for code generation
    let authConfig = null;
    try {
      const hostname = new URL(api_info.url).hostname;
      authConfig = getByDomain(hostname);
    } catch {
      authConfig = null;
    }

    const prompt = buildGenerateSkillPrompt({
      skill_name,
      skill_description: skill_description || '',
      api_info,
      authConfig,
    });

    // Call OpenClaw
    const rawText = await analyzeWithOpenClaw(prompt);

    // Extract file map JSON from LLM response
    let fileMap;
    try {
      fileMap = extractJSON(rawText);
    } catch (parseErr) {
      console.error('[generate] Failed to extract JSON from LLM response:', parseErr.message);
      console.error('[generate] Raw response:', rawText.substring(0, 500));
      return res.status(502).json({
        status: 'error',
        message: 'AI returned non-JSON response for code generation. Please retry.',
        data: null,
      });
    }

    // Validate we got at least one file
    const fileEntries = Object.entries(fileMap).filter(
      ([key, val]) => typeof key === 'string' && typeof val === 'string'
    );
    if (fileEntries.length === 0) {
      return res.status(502).json({
        status: 'error',
        message: 'AI generated no valid files. Please retry.',
        data: null,
      });
    }

    // Create ZIP in memory and stream to response
    const safeName = skill_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${safeName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('[generate] Archiver error:', err);
      // If headers not yet sent, send error response
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: 'Failed to create ZIP archive',
          data: null,
        });
      }
    });

    archive.pipe(res);

    // Add each file to the archive under a skill_name directory
    for (const [filename, content] of fileEntries) {
      archive.append(content, { name: `${safeName}/${filename}` });
    }

    await archive.finalize();

  } catch (err) {
    // Structured errors from openclaw service
    if (err.code && err.httpStatus) {
      // Only send JSON if headers not yet sent (ZIP streaming might have started)
      if (!res.headersSent) {
        return res.status(err.httpStatus).json({
          status: 'error',
          message: err.message,
          data: null,
        });
      }
      return;
    }

    // Unexpected errors
    console.error('[generate] Unexpected error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        data: null,
      });
    }
  }
});

module.exports = router;
