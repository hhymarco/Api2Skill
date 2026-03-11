# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**api2skill** is a Chrome extension + Node.js backend that captures browser network traffic and uses AI (via OpenClaw) to generate Markdown API skill documents. Users click "Analyze" on a captured request, and the system returns a structured Markdown doc suitable for AI Agent skill definitions.

## Architecture

```
Chrome Extension (Manifest V3)          Node.js Backend              OpenClaw CLI
  background.js (Service Worker)   →    POST /api/v1/analyze-request  →  openclaw agent --json
  - chrome.debugger captures traffic     - validates request           - parses JSON response
  - deduplicates by METHOD+path          - assembles prompt            - returns markdown
  - stores in-memory Map                 - calls openclaw CLI
  sidepanel.js (UI)               ←      returns { code, data: { markdown } }
  - lists captured requests
  - triggers analysis
  - renders markdown result
```

The backend integrates with OpenClaw via **CLI subprocess** (`execFile('openclaw', ['agent', '--message', ..., '--json'])`), **not** an HTTP REST API — despite what older docs/comments may suggest.

## Server Commands

```bash
cd server

# Install dependencies
npm install

# Start production
npm start

# Development (auto-restart on file change, Node >= 18 built-in --watch)
npm run dev
```

No test runner is configured. Manual testing via curl (see `README.md` for test cases).

## Environment Setup

```bash
cd server
cp .env.example .env
# Edit .env and set OPENCLAW_API_KEY
```

Key env vars (`server/.env`):
- `OPENCLAW_API_KEY` — **required**, Bearer token for OpenClaw CLI auth
- `OPENCLAW_BIN` — path to `openclaw` binary (default: `openclaw` in PATH)
- `REQUEST_TIMEOUT_MS` — timeout in ms (default: 120000)
- `PORT` — server port (default: 3000)

## API Contract

**POST /api/v1/analyze-request** — required fields: `url`, `method`, `request_headers`, `response_body`

Response envelope: `{ code: 0, message: "success", data: { markdown: "..." } }` on success; `{ code: <non-zero>, message: "...", data: null }` on error.

Error code ranges: `1000-1999` = client validation, `2000-2999` = OpenClaw upstream, `5000-5999` = internal server.

Full schema in `docs/API_CONTRACT.md`.

## Key Implementation Details

- **Deduplication**: `background.js` keys captured requests by `METHOD /pathname` — same endpoint overwrites previous capture (keeps latest).
- **Response body truncation**: Responses >50KB are truncated with `...[Truncated for AI Analysis]` before sending to AI.
- **OpenClaw integration**: `server/src/services/openclaw.js` calls the `openclaw agent` CLI with `--json` flag and parses `result.payloads[].text`. Error codes 2001/2005 are non-retryable; others retry once after 2s.
- **Prompt assembly**: `server/src/utils/prompt.js` formats the captured data into a Chinese-language prompt with a strict Markdown output template.
- **CORS**: Configured to allow Chrome extension requests (default `*`, configurable via `CORS_ORIGIN`).

## Chrome Extension

Load unpacked from `extension/` directory in Chrome (developer mode). Requires Chrome >= 116 for Side Panel API. Uses `chrome.debugger` API (DevTools Protocol) to intercept network traffic — conflicts with open Chrome DevTools on the same tab.

Message types between sidepanel and background: `getRequests`, `getRequestDetail`, `clearRequests`, `startCapture`.
