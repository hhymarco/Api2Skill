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
 * Send prompt to OpenClaw via CLI and return the text response.
 * Retries once on transient failures.
 *
 * @param {string} prompt - The assembled prompt message
 * @returns {Promise<string>} - The raw text response
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
 * Extract a JSON object from LLM text output.
 * Handles: pure JSON, JSON in markdown code blocks, JSON with surrounding text.
 *
 * @param {string} text - Raw text from LLM
 * @returns {object} - Parsed JSON object
 * @throws {Error} - If no valid JSON found
 */
function extractJSON(text) {
  // 1. Try stripping markdown code fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* fall through */ }
  }

  // 2. Try parsing the whole text as JSON
  try {
    return JSON.parse(text.trim());
  } catch { /* fall through */ }

  // 3. Find the first '{' and last '}' — try to extract the outermost JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch { /* fall through */ }
  }

  // 4. Repair unbalanced braces/brackets — LLMs occasionally drop trailing closers.
  if (firstBrace !== -1) {
    let s = text.slice(firstBrace).trim();
    // Strip trailing commas before closers
    s = s.replace(/,(\s*[}\]])/g, '$1');
    // Count unbalanced braces outside of strings
    let inStr = false, esc = false, openCurly = 0, openSquare = 0;
    for (const ch of s) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') openCurly++;
      else if (ch === '}') openCurly--;
      else if (ch === '[') openSquare++;
      else if (ch === ']') openSquare--;
    }
    if (inStr) s += '"';
    while (openSquare-- > 0) s += ']';
    while (openCurly-- > 0) s += '}';
    try { return JSON.parse(s); } catch { /* fall through */ }
  }

  throw new Error('No valid JSON found in LLM response');
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
      maxBuffer: 10 * 1024 * 1024, // 10MB for large responses
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

      // Parse JSON output — openclaw emits a JSON object (on stdout or stderr depending on version).
      // Strip ANSI color codes, then find the JSON object that contains "payloads".
      const combined = (stdout || '') + '\n' + (stderr || '');
      const clean = combined.replace(/\x1b\[[0-9;]*m/g, '');
      let data = null;
      // Try known markers in priority order: new shape `{"payloads"`, old shape `{"status"`.
      const markers = [/\n\{\s*"payloads"/g, /\n\{\s*"status"/g, /\{"payloads"/g, /\{"status"/g];
      for (const re of markers) {
        const hits = [...clean.matchAll(re)];
        for (let i = hits.length - 1; i >= 0 && !data; i--) {
          const start = clean.indexOf('{', hits[i].index);
          try { data = JSON.parse(clean.slice(start)); } catch { /* try next */ }
        }
        if (data) break;
      }
      if (!data) {
        const jsonStart = clean.indexOf('{');
        if (jsonStart !== -1) { try { data = JSON.parse(clean.slice(jsonStart)); } catch { /* fallthrough */ } }
      }
      if (!data) {
        return reject({ code: 2005, httpStatus: 502, message: 'Failed to parse OpenClaw response' });
      }

      // Status check is only applied if the response includes it (old shape).
      if (data.status && data.status !== 'ok') {
        return reject({
          code: 2002,
          httpStatus: 502,
          message: `OpenClaw returned status: ${data.status} - ${data.summary || 'unknown error'}`,
        });
      }

      // Extract payloads — new shape: top-level `payloads`; old shape: `result.payloads`.
      const payloads = (data.payloads) || (data.result && data.result.payloads);
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

module.exports = { analyzeWithOpenClaw, extractJSON };
