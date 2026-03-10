/**
 * sidepanel.js - Side Panel logic for API Skill Generator
 *
 * Communicates with background.js to list captured requests,
 * sends them to the backend for AI analysis, and renders
 * the resulting Markdown.
 */

const BACKEND_URL = 'http://localhost:3000/api/v1/analyze-request';
const TRUNCATE_LIMIT = 50000;

// DOM refs
const requestListEl = document.getElementById('request-list');
const requestListSection = document.getElementById('request-list-section');
const resultSection = document.getElementById('result-section');
const resultTitle = document.getElementById('result-title');
const loadingEl = document.getElementById('loading');
const errorDisplay = document.getElementById('error-display');
const markdownOutput = document.getElementById('markdown-output');
const btnCapture = document.getElementById('btn-capture');
const btnRefresh = document.getElementById('btn-refresh');
const btnClear = document.getElementById('btn-clear');
const btnBack = document.getElementById('btn-back');
const btnCopy = document.getElementById('btn-copy');

// Current raw markdown for copy
let currentMarkdown = '';

// --- Event Listeners ---

btnCapture.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'startCapture' }, (res) => {
    if (res && res.success) {
      btnCapture.textContent = 'Active';
      btnCapture.classList.add('btn-copied');
      setTimeout(() => {
        btnCapture.textContent = 'Capture';
        btnCapture.classList.remove('btn-copied');
      }, 1500);
    }
  });
});

btnRefresh.addEventListener('click', loadRequestList);

btnClear.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearRequests' }, () => {
    loadRequestList();
  });
});

btnBack.addEventListener('click', showList);

btnCopy.addEventListener('click', () => {
  if (!currentMarkdown) return;
  navigator.clipboard.writeText(currentMarkdown).then(() => {
    btnCopy.textContent = 'Copied';
    btnCopy.classList.add('btn-copied');
    setTimeout(() => {
      btnCopy.textContent = 'Copy';
      btnCopy.classList.remove('btn-copied');
    }, 1500);
  });
});

// --- Views ---

function showList() {
  requestListSection.classList.remove('hidden');
  resultSection.classList.add('hidden');
  loadRequestList();
}

function showResult(title) {
  requestListSection.classList.add('hidden');
  resultSection.classList.remove('hidden');
  resultTitle.textContent = title;
  loadingEl.classList.add('hidden');
  errorDisplay.classList.add('hidden');
  markdownOutput.innerHTML = '';
  currentMarkdown = '';
}

// --- Load Requests ---

function loadRequestList() {
  chrome.runtime.sendMessage({ type: 'getRequests' }, (res) => {
    if (!res || !res.requests || res.requests.length === 0) {
      requestListEl.innerHTML = '<div class="empty-state">No requests captured yet. Click "Capture" and browse a page.</div>';
      return;
    }
    requestListEl.innerHTML = '';
    res.requests.forEach((req) => {
      const item = document.createElement('div');
      item.className = 'request-item';

      const method = document.createElement('span');
      method.className = `method-badge method-${req.method}`;
      method.textContent = req.method;

      const url = document.createElement('span');
      url.className = 'request-url';
      url.textContent = truncateUrl(req.url);
      url.title = req.url;

      const status = document.createElement('span');
      status.className = 'status-code';
      status.textContent = req.status_code || '';

      const analyzeBtn = document.createElement('button');
      analyzeBtn.className = 'btn-analyze';
      analyzeBtn.textContent = 'Analyze';
      analyzeBtn.addEventListener('click', () => analyzeRequest(req.key, req.method, req.url));

      item.appendChild(method);
      item.appendChild(url);
      item.appendChild(status);
      item.appendChild(analyzeBtn);
      requestListEl.appendChild(item);
    });
  });
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const display = u.pathname + u.search;
    return display.length > 60 ? display.substring(0, 57) + '...' : display;
  } catch {
    return url.length > 60 ? url.substring(0, 57) + '...' : url;
  }
}

// --- Analyze ---

async function analyzeRequest(key, method, url) {
  showResult(`${method} ${truncateUrl(url)}`);
  loadingEl.classList.remove('hidden');

  // Get full request detail from background
  const detail = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getRequestDetail', key }, (res) => {
      resolve(res ? res.data : null);
    });
  });

  if (!detail) {
    showError('Request data not found. It may have been cleared.');
    return;
  }

  // Apply truncation strategy to response_body
  let responseBody = detail.response_body || '';
  if (responseBody.length > TRUNCATE_LIMIT) {
    responseBody = responseBody.substring(0, TRUNCATE_LIMIT) + '...[Truncated for AI Analysis]';
  }

  const payload = {
    url: detail.url,
    method: detail.method,
    request_headers: detail.request_headers || {},
    query_params: detail.query_params || {},
    request_body: detail.request_body || null,
    response_body: responseBody
  };

  try {
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();

    loadingEl.classList.add('hidden');

    if (json.code === 0 && json.data && json.data.markdown) {
      currentMarkdown = json.data.markdown;
      markdownOutput.innerHTML = renderMarkdown(currentMarkdown);
    } else {
      showError(json.message || `Error code: ${json.code}`);
    }
  } catch (err) {
    loadingEl.classList.add('hidden');
    showError(`Failed to connect to backend: ${err.message}`);
  }
}

function showError(msg) {
  loadingEl.classList.add('hidden');
  errorDisplay.classList.remove('hidden');
  errorDisplay.textContent = msg;
}

// --- Lightweight Markdown Renderer ---

function renderMarkdown(md) {
  // 1. Extract code blocks as placeholders (before escaping)
  const codeBlocks = [];
  let html = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // 2. Extract inline code
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE${idx}\x00`;
  });

  // 3. Escape remaining HTML
  html = escapeHtml(html);

  // 4. Tables
  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n');
    if (rows.length < 2) return tableBlock;

    // Separate header, separator, and body rows
    const dataRows = rows.filter(r => !/^\|[\s\-:|]+\|$/.test(r));
    if (dataRows.length === 0) return tableBlock;

    let t = '<table><thead><tr>';
    const headerCells = dataRows[0].split('|').slice(1, -1).map(c => c.trim());
    headerCells.forEach(cell => { t += `<th>${cell}</th>`; });
    t += '</tr></thead>';

    if (dataRows.length > 1) {
      t += '<tbody>';
      for (let i = 1; i < dataRows.length; i++) {
        const cells = dataRows[i].split('|').slice(1, -1).map(c => c.trim());
        t += '<tr>';
        cells.forEach(cell => { t += `<td>${cell}</td>`; });
        t += '</tr>';
      }
      t += '</tbody>';
    }
    t += '</table>';
    return t;
  });

  // 5. Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 6. Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 7. Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // 8. Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // 9. Paragraphs (lines not already wrapped in HTML tags or placeholders)
  html = html.replace(/^(?!<[a-z/])(?!\x00)(.+)$/gm, '<p>$1</p>');

  // 10. Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  // 11. Restore code blocks and inline codes
  html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i) => codeBlocks[i]);
  html = html.replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlineCodes[i]);

  return html;
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return text.replace(/[&<>"]/g, c => map[c]);
}

// --- Init ---
loadRequestList();
