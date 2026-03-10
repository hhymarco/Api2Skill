/**
 * OpenClaw service integration.
 *
 * Real OpenClaw uses WebSocket RPC, not a REST /api/chat endpoint.
 * We bridge via the `openclaw agent` CLI command which handles WS
 * connection, auth, and session management internally.
 */

const { execFile } = require('child_process');

const TIMEOUT_S = Math.floor((parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 120000) / 1000);
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const SESSION_ID = 'api-analyzer-session';
const MAX_RETRIES = 1;

/**
 * Send prompt to OpenClaw via CLI and return the markdown response.
 * Retries once on transient failures.
 *
 * @param {string} prompt - The assembled prompt message
 * @returns {Promise<string>} - The generated markdown content
 * @throws {Object} - { code, httpStatus, message } on failure
 */
async function analyzeWithOpenClaw(prompt) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 2000));
    }

    try {
      const result = await runOpenClawAgent(prompt);
      return result;
    } catch (err) {
      // Non-retryable errors
      if (err.code === 2001 || err.code === 2005) {
        throw err;
      }
      lastError = err;
    }
  }

  throw lastError || { code: 5000, httpStatus: 500, message: 'Internal server error' };
}

/**
 * Execute `openclaw agent` CLI and parse JSON output.
 */
function runOpenClawAgent(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      'agent',
      '--message', prompt,
      '--json',
      '--session-id', SESSION_ID,
      '--timeout', String(TIMEOUT_S),
    ];

    const child = execFile(OPENCLAW_BIN, args, {
      timeout: (TIMEOUT_S + 10) * 1000, // extra buffer beyond openclaw's own timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB for large markdown responses
      env: { ...process.env },
    }, (err, stdout, stderr) => {
      if (err) {
        // Timeout
        if (err.killed || err.signal === 'SIGTERM') {
          return reject({ code: 2003, httpStatus: 504, message: 'OpenClaw service request timed out' });
        }
        // Command not found / connection refused
        if (err.code === 'ENOENT') {
          return reject({ code: 2004, httpStatus: 502, message: 'OpenClaw CLI not found. Ensure openclaw is installed and in PATH.' });
        }
        // Check stderr for connection issues
        const errMsg = (stderr || err.message || '').toLowerCase();
        if (errMsg.includes('econnrefused') || errMsg.includes('connect') || errMsg.includes('not running')) {
          return reject({ code: 2004, httpStatus: 502, message: 'Cannot connect to OpenClaw service' });
        }
        if (errMsg.includes('unauthorized') || errMsg.includes('auth')) {
          return reject({ code: 2001, httpStatus: 502, message: 'OpenClaw service authentication failed' });
        }
        return reject({ code: 2002, httpStatus: 502, message: 'OpenClaw service returned an error' });
      }

      // Parse JSON output
      let data;
      try {
        data = JSON.parse(stdout);
      } catch {
        return reject({ code: 2005, httpStatus: 502, message: 'Failed to parse OpenClaw response' });
      }

      if (data.status !== 'ok') {
        return reject({
          code: 2002,
          httpStatus: 502,
          message: `OpenClaw returned status: ${data.status} - ${data.summary || 'unknown error'}`
        });
      }

      // Extract text from payloads
      const payloads = data.result && data.result.payloads;
      if (!payloads || !Array.isArray(payloads) || payloads.length === 0) {
        return reject({ code: 2005, httpStatus: 502, message: 'Failed to parse OpenClaw response: no payloads' });
      }

      const text = payloads.map(p => p.text).filter(Boolean).join('\n\n');
      if (!text) {
        return reject({ code: 2005, httpStatus: 502, message: 'Failed to parse OpenClaw response: empty text' });
      }

      resolve(text);
    });
  });
}

module.exports = { analyzeWithOpenClaw };
