/**
 * run_backend_tests.js
 *
 * Automated backend acceptance test suite for api2skill.
 * Executes 5 test cases sequentially against http://localhost:3000
 */

const BASE_URL = 'http://localhost:3000/api/v1/analyze-request';

const CASES = [
  {
    name: 'Case 1: 标准 GET 请求 (Query 解析)',
    payload: {
      url: 'https://api.github.com/search/repositories',
      method: 'GET',
      request_headers: { accept: 'application/vnd.github.v3+json' },
      query_params: { q: 'agentic workflow', sort: 'stars' },
      request_body: null,
      response_body: '{"total_count": 1, "items": [{"id": 123, "name": "agent-framework"}]}'
    },
    expectSuccess: true,
  },
  {
    name: 'Case 2: 标准 POST 请求 (复杂 Body 解析)',
    payload: {
      url: 'https://api.example.com/v1/orders',
      method: 'POST',
      request_headers: { 'content-type': 'application/json' },
      query_params: {},
      request_body: { user_id: 89757, items: [{ product_id: 'p1', qty: 2 }], coupon: 'NEWYEAR' },
      response_body: '{"code": 200, "message": "success", "data": {"order_id": "ORD-999", "status": "CREATED", "total_amount": 199.5}}'
    },
    expectSuccess: true,
  },
  {
    name: 'Case 3: 极简无参数请求',
    payload: {
      url: 'https://api.example.com/health/ping',
      method: 'GET',
      request_headers: {},
      query_params: {},
      request_body: null,
      response_body: '{"status": "UP", "timestamp": 1710000000}'
    },
    expectSuccess: true,
  },
  {
    name: 'Case 4: 极值截断边界测试 (50KB 截断标识符)',
    payload: {
      url: 'https://api.example.com/v1/data-export',
      method: 'GET',
      request_headers: {},
      query_params: { type: 'full' },
      request_body: null,
      response_body: '{"status":"success","large_data":[{"id":1,"val":"a"},{"id":2,"val":"b"},{"id":...[Truncated for AI Analysis]'
    },
    expectSuccess: true,
  },
];

// Case 5 is special: tests error handling with unreachable OpenClaw
const CASE5 = {
  name: 'Case 5: 异常与超时兜底测试 (容灾验收)',
  payload: {
    url: 'https://api.example.com/test',
    method: 'GET',
    request_headers: {},
    query_params: {},
    request_body: null,
    response_body: '{"test": true}'
  },
};

// --- Utilities ---

function separator() {
  console.log('─'.repeat(72));
}

function truncateText(text, maxLen = 500) {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + `\n  ... [truncated, total ${text.length} chars]`;
}

async function runTest(testCase) {
  const { name, payload, expectSuccess } = testCase;
  separator();
  console.log(`\n▶ ${name}`);
  console.log(`  URL: ${payload.method} ${payload.url}`);

  const start = Date.now();

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const elapsed = Date.now() - start;
    const json = await res.json();

    console.log(`  ⏱ 耗时: ${elapsed}ms`);
    console.log(`  📡 HTTP Status: ${res.status}`);
    console.log(`  📦 Response code: ${json.code}`);
    console.log(`  💬 Message: ${json.message}`);

    if (json.code === 0 && json.data && json.data.markdown) {
      console.log(`  ✅ 成功 - Markdown 长度: ${json.data.markdown.length} chars`);
      console.log(`  📄 Markdown 预览:\n`);
      console.log(truncateText(json.data.markdown, 800).split('\n').map(l => `    ${l}`).join('\n'));
      return { name, status: 'PASS', elapsed, httpStatus: res.status, code: json.code };
    } else if (expectSuccess) {
      console.log(`  ❌ 预期成功但返回错误: code=${json.code} message=${json.message}`);
      return { name, status: 'FAIL', elapsed, httpStatus: res.status, code: json.code, error: json.message };
    } else {
      console.log(`  ✅ 预期错误响应，格式正确`);
      return { name, status: 'PASS', elapsed, httpStatus: res.status, code: json.code };
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`  ⏱ 耗时: ${elapsed}ms`);
    console.log(`  ❌ 请求异常: ${err.message}`);
    return { name, status: 'ERROR', elapsed, error: err.message };
  }
}

async function runCase5() {
  separator();
  console.log(`\n▶ ${CASE5.name}`);
  console.log(`  策略: 停止 OpenClaw Gateway → 发送请求 → 验证错误格式 → 重启 OpenClaw`);
  console.log('');

  // Step 1: Stop OpenClaw
  console.log('  🔧 正在停止 OpenClaw Gateway...');
  const { execSync } = require('child_process');
  try {
    execSync('openclaw gateway stop 2>&1', { timeout: 10000 });
    console.log('  ✅ OpenClaw Gateway 已停止');
  } catch (e) {
    console.log(`  ⚠️ 停止命令返回: ${e.message.split('\n')[0]}`);
  }
  // Wait for port to release
  await new Promise(r => setTimeout(r, 2000));

  const start = Date.now();
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CASE5.payload),
    });

    const elapsed = Date.now() - start;
    const json = await res.json();

    console.log(`  ⏱ 耗时: ${elapsed}ms`);
    console.log(`  📡 HTTP Status: ${res.status}`);
    console.log(`  📦 Response code: ${json.code}`);
    console.log(`  💬 Message: ${json.message}`);

    // Verify error response format
    const hasValidFormat = typeof json.code === 'number'
      && typeof json.message === 'string'
      && json.hasOwnProperty('data');
    const isErrorResponse = json.code !== 0;

    if (hasValidFormat && isErrorResponse) {
      console.log(`  ✅ 返回规范错误格式 {code: ${json.code}, message: "${json.message}", data: null}`);
      console.log(`  ✅ 服务未崩溃，HTTP ${res.status} 错误被优雅处理`);

      // Step 3: Restart OpenClaw
      console.log('\n  🔧 正在重启 OpenClaw Gateway...');
      try {
        execSync('openclaw gateway start 2>&1', { timeout: 10000 });
        await new Promise(r => setTimeout(r, 3000));
        console.log('  ✅ OpenClaw Gateway 已重启');
      } catch (e) {
        console.log(`  ⚠️ 重启命令: ${e.message.split('\n')[0]}`);
      }

      return { name: CASE5.name, status: 'PASS', elapsed, httpStatus: res.status, code: json.code };
    } else {
      console.log(`  ❌ 响应不符合预期: hasValidFormat=${hasValidFormat}, isError=${isErrorResponse}`);
      return { name: CASE5.name, status: 'FAIL', elapsed, httpStatus: res.status, error: 'Unexpected response' };
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`  ⏱ 耗时: ${elapsed}ms`);
    console.log(`  ❌ 请求异常 (后端可能崩溃): ${err.message}`);

    // Still restart OpenClaw
    console.log('\n  🔧 正在重启 OpenClaw Gateway...');
    try {
      execSync('openclaw gateway start 2>&1', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 3000));
      console.log('  ✅ OpenClaw Gateway 已重启');
    } catch (e) { /* ignore */ }

    return { name: CASE5.name, status: 'ERROR', elapsed, error: err.message };
  }
}

// --- Main ---

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║           api2skill 后端接口验收测试                                  ║');
  console.log('║           Target: http://localhost:3000                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Health check
  try {
    const healthRes = await fetch('http://localhost:3000/health');
    const health = await healthRes.json();
    console.log(`🏥 Health check: ${health.status}`);
  } catch (err) {
    console.log(`🚨 Health check FAILED: ${err.message}`);
    console.log('   请确保后端服务已启动: cd server && npm start');
    process.exit(1);
  }

  const results = [];

  // Run Cases 1-4 (all expect OpenClaw success)
  for (const tc of CASES) {
    const result = await runTest(tc);
    results.push(result);
    console.log('');
  }

  // Run Case 5 (error handling)
  const case5Result = await runCase5();
  results.push(case5Result);

  // Summary
  separator();
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║           测试结果汇总                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

  const colWidths = [42, 8, 10, 8];
  console.log(
    '  ' +
    'Test Case'.padEnd(colWidths[0]) +
    'Status'.padEnd(colWidths[1]) +
    'Time'.padEnd(colWidths[2]) +
    'HTTP'
  );
  console.log('  ' + '─'.repeat(colWidths.reduce((a, b) => a + b, 0)));

  let passCount = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    const name = r.name.length > colWidths[0] - 2 ? r.name.substring(0, colWidths[0] - 5) + '...' : r.name;
    const time = r.elapsed ? `${r.elapsed}ms` : 'N/A';
    const http = r.httpStatus || 'N/A';
    console.log(`  ${name.padEnd(colWidths[0])}${icon} ${r.status.padEnd(colWidths[1] - 2)}${time.padEnd(colWidths[2])}${http}`);
    if (r.status === 'PASS') passCount++;
  }

  console.log('');
  console.log(`  总计: ${results.length} | 通过: ${passCount} | 失败: ${results.length - passCount}`);
  separator();

  process.exit(passCount === results.length ? 0 : 1);
}

main();
