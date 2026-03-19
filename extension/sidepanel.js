/**
 * sidepanel.js - V2 Side Panel logic for API Skill Generator
 *
 * V2 features:
 * - Renders analyzed API as editable form tables
 * - Direct frontend API testing (real fetch)
 * - Generate & download Skill as ZIP
 */

const BACKEND_ANALYZE_URL = 'http://localhost:3000/api/v1/analyze-request';
const BACKEND_GENERATE_URL = 'http://localhost:3000/api/v1/generate-skill';
const TRUNCATE_LIMIT = 50000;

// DOM refs - List view
const requestListEl = document.getElementById('request-list');
const requestListSection = document.getElementById('request-list-section');
const btnCapture = document.getElementById('btn-capture');
const btnRefresh = document.getElementById('btn-refresh');
const btnClear = document.getElementById('btn-clear');

// DOM refs - Editor view
const editorSection = document.getElementById('editor-section');
const editorTitle = document.getElementById('editor-title');
const loadingEl = document.getElementById('loading');
const errorDisplay = document.getElementById('error-display');
const editorContent = document.getElementById('editor-content');
const btnBack = document.getElementById('btn-back');
const btnTest = document.getElementById('btn-test');
const btnGenerate = document.getElementById('btn-generate');

// Editor fields
const skillNameInput = document.getElementById('skill-name');
const skillDescInput = document.getElementById('skill-description');
const apiMethodSelect = document.getElementById('api-method');
const apiUrlInput = document.getElementById('api-url');
const responseMockTextarea = document.getElementById('response-mock');

// Test result
const testResult = document.getElementById('test-result');
const testStatus = document.getElementById('test-status');
const testHeadersSection = document.getElementById('test-response-headers');
const testHeadersContent = document.getElementById('test-headers-content');
const testBodyContent = document.getElementById('test-body-content');

// Generate status
const generateStatus = document.getElementById('generate-status');

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
  chrome.runtime.sendMessage({ type: 'clearRequests' }, () => loadRequestList());
});

btnBack.addEventListener('click', showList);

// Add row buttons
document.querySelectorAll('.btn-add').forEach(btn => {
  btn.addEventListener('click', () => {
    const tableId = btn.dataset.table;
    addParamRow(tableId);
  });
});

btnTest.addEventListener('click', testAPI);
btnGenerate.addEventListener('click', generateSkill);

// --- Views ---

function showList() {
  requestListSection.classList.remove('hidden');
  editorSection.classList.add('hidden');
  loadRequestList();
}

function showEditor(title) {
  requestListSection.classList.add('hidden');
  editorSection.classList.remove('hidden');
  editorTitle.textContent = title;
  loadingEl.classList.remove('hidden');
  errorDisplay.classList.add('hidden');
  editorContent.classList.add('hidden');
  testResult.classList.add('hidden');
  generateStatus.classList.add('hidden');
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
  showEditor(`${method} ${truncateUrl(url)}`);

  const detail = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getRequestDetail', key }, (res) => {
      resolve(res ? res.data : null);
    });
  });

  if (!detail) {
    showError('Request data not found. It may have been cleared.');
    return;
  }

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
    const res = await fetch(BACKEND_ANALYZE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    loadingEl.classList.add('hidden');

    if (json.status === 'success' && json.data) {
      renderEditor(json.data);
    } else {
      showError(json.message || 'Analysis failed. Please retry.');
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

// --- Render Editor ---

function renderEditor(data) {
  skillNameInput.value = data.skill_name || '';
  skillDescInput.value = data.skill_description || '';

  const info = data.api_info || {};
  apiMethodSelect.value = info.method || 'POST';
  apiUrlInput.value = info.url || '';
  responseMockTextarea.value = info.response_mock || '';

  // Render tables
  renderHeadersTable(info.headers || []);
  renderParamTable('query', info.query || []);
  renderParamTable('body', info.body || []);

  editorContent.classList.remove('hidden');
}

function renderHeadersTable(headers) {
  const tbody = document.querySelector('#table-headers tbody');
  tbody.innerHTML = '';
  headers.forEach(h => addHeaderRow(h));
}

function renderParamTable(tableId, params) {
  const tbody = document.querySelector(`#table-${tableId} tbody`);
  tbody.innerHTML = '';
  params.forEach(p => addParamRow(tableId, p));
}

function addHeaderRow(data = {}) {
  const tbody = document.querySelector('#table-headers tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="cell-input" type="text" value="${esc(data.key || '')}" placeholder="key"></td>
    <td><input class="cell-input" type="text" value="${esc(data.value || '')}" placeholder="value"></td>
    <td><input class="cell-input" type="text" value="${esc(data.description || '')}" placeholder="description"></td>
    <td><button class="btn-del" title="Delete row">×</button></td>
  `;
  tr.querySelector('.btn-del').addEventListener('click', () => tr.remove());
  tbody.appendChild(tr);
}

function addParamRow(tableId, data = {}) {
  const tbody = document.querySelector(`#table-${tableId} tbody`);
  const tr = document.createElement('tr');
  const checked = data.required ? 'checked' : '';
  tr.innerHTML = `
    <td><input class="cell-input" type="text" value="${esc(data.key || '')}" placeholder="key"></td>
    <td>
      <select class="cell-select">
        ${['String','Number','Boolean','Object','Array'].map(t =>
          `<option${data.type === t ? ' selected' : ''}>${t}</option>`
        ).join('')}
      </select>
    </td>
    <td class="col-req-cell"><input type="checkbox" class="cell-check" ${checked}></td>
    <td><input class="cell-input" type="text" value="${esc(data.description || '')}" placeholder="description"></td>
    <td><input class="cell-input" type="text" value="${esc(data.test_value || '')}" placeholder="value"></td>
    <td><button class="btn-del" title="Delete row">×</button></td>
  `;
  tr.querySelector('.btn-del').addEventListener('click', () => tr.remove());
  tbody.appendChild(tr);
}

function esc(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Read Form Data ---

function readFormData() {
  const headers = [];
  document.querySelectorAll('#table-headers tbody tr').forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const key = inputs[0].value.trim();
    if (!key) return;
    headers.push({ key, value: inputs[1].value.trim(), description: inputs[2].value.trim() });
  });

  const readParams = (tableId) => {
    const params = [];
    document.querySelectorAll(`#table-${tableId} tbody tr`).forEach(tr => {
      const key = tr.querySelector('input[type="text"]').value.trim();
      if (!key) return;
      const inputs = tr.querySelectorAll('input[type="text"]');
      const sel = tr.querySelector('select');
      const chk = tr.querySelector('input[type="checkbox"]');
      params.push({
        key,
        type: sel ? sel.value : 'String',
        required: chk ? chk.checked : false,
        description: inputs[1] ? inputs[1].value.trim() : '',
        test_value: inputs[2] ? inputs[2].value.trim() : ''
      });
    });
    return params;
  };

  return {
    skill_name: skillNameInput.value.trim(),
    skill_description: skillDescInput.value.trim(),
    api_info: {
      method: apiMethodSelect.value,
      url: apiUrlInput.value.trim(),
      headers,
      query: readParams('query'),
      body: readParams('body'),
      response_mock: responseMockTextarea.value.trim()
    }
  };
}

// --- Test API ---

async function testAPI() {
  const data = readFormData();
  const { method, url, headers: headersList, query, body } = data.api_info;

  if (!url) {
    alert('Please enter a URL first.');
    return;
  }

  testResult.classList.remove('hidden');
  testStatus.textContent = 'Testing...';
  testStatus.className = 'test-status';
  testHeadersSection.classList.add('hidden');
  testBodyContent.textContent = 'Sending request...';

  // Build fetch options
  const fetchHeaders = {};
  headersList.forEach(h => { if (h.key) fetchHeaders[h.key] = h.value; });

  // Build URL with query params
  let fetchUrl = url;
  if (query.length > 0) {
    const qp = new URLSearchParams();
    query.forEach(p => { if (p.key) qp.set(p.key, p.test_value); });
    fetchUrl += (url.includes('?') ? '&' : '?') + qp.toString();
  }

  // Build body
  let fetchBody = undefined;
  if (method !== 'GET' && method !== 'HEAD' && body.length > 0) {
    const contentType = fetchHeaders['Content-Type'] || fetchHeaders['content-type'] || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const fd = new URLSearchParams();
      body.forEach(p => { if (p.key) fd.set(p.key, p.test_value); });
      fetchBody = fd.toString();
    } else {
      const obj = {};
      body.forEach(p => { if (p.key) obj[p.key] = p.test_value; });
      fetchBody = JSON.stringify(obj);
      if (!fetchHeaders['Content-Type'] && !fetchHeaders['content-type']) {
        fetchHeaders['Content-Type'] = 'application/json';
      }
    }
  }

  try {
    const response = await fetch(fetchUrl, {
      method,
      headers: fetchHeaders,
      body: fetchBody
    });

    const statusCode = response.status;
    const ok = response.ok;
    testStatus.textContent = `${statusCode} ${response.statusText}`;
    testStatus.className = `test-status ${ok ? 'status-ok' : 'status-err'}`;

    // Show response headers
    const respHeaders = {};
    response.headers.forEach((val, key) => { respHeaders[key] = val; });
    testHeadersContent.textContent = JSON.stringify(respHeaders, null, 2);
    testHeadersSection.classList.remove('hidden');

    // Show response body
    let bodyText = '';
    try {
      const json = await response.json();
      bodyText = JSON.stringify(json, null, 2);
    } catch {
      bodyText = await response.text();
    }
    testBodyContent.textContent = bodyText || '(empty)';

  } catch (err) {
    testStatus.textContent = 'Network Error';
    testStatus.className = 'test-status status-err';
    testBodyContent.textContent = err.message;
  }
}

// --- Generate Skill ---

async function generateSkill() {
  const data = readFormData();

  if (!data.skill_name) {
    alert('Please enter a Skill Name first.');
    return;
  }

  generateStatus.classList.remove('hidden');
  btnGenerate.disabled = true;

  try {
    const res = await fetch(BACKEND_GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errJson.message || `HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/zip')) {
      const text = await res.text();
      throw new Error('Expected ZIP response but got: ' + text.substring(0, 200));
    }

    // Trigger download
    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1]
      || `${data.skill_name}.zip`;
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

  } catch (err) {
    alert(`Generate failed: ${err.message}`);
  } finally {
    generateStatus.classList.add('hidden');
    btnGenerate.disabled = false;
  }
}

// --- Init ---
loadRequestList();
