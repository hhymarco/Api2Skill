const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';
const AUTH_BASE_URL = 'http://localhost:3000/api/v1/auth/configs';

// 测试用的真实抓包数据
const rawPayload = {
  url: "https://fin-risk-control.prod.fin.qima-inc.com/api/dispatch/invoke/risk.engine.param.execute.action",
  method: "POST",
  request_headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept": "application/json",
    "Referer": "https://fin-risk-control.prod.fin.qima-inc.com/datacenterV2/datalist"
  },
  query_params: {},
  request_body: {
    "paramName": "SHOP_IS_IN_TRIAL",
    "session[kdt_id]": "147349612",
    "testMode": "true"
  },
  response_body: "{\"code\": 0,\"msg\": \"success\",\"data\": {\"class\": \"com.youzan.pay.risk.engine.api.result.param.RuleParamExecuteResult\",\"content\": \"false\"}}"
};

// 终端颜色配置
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m"
};

async function runV2Tests() {
  console.log(`${colors.cyan}🚀 开始执行 V2 后端全链路联调测试...${colors.reset}\n`);
  let analyzedJsonSchema = null;

  console.log(`${colors.yellow}▶ [阶段 0] 校验鉴权配置 CRUD...${colors.reset}`);
  const authPayload = {
    domain: 'example.com',
    name: 'Example',
    auths: [
      { type: 'cookie', value: 'sid=abc' },
      { type: 'bearer', value: 'token-123' },
      { type: 'header', key: 'X-Api-Key', value: 'key-1' }
    ]
  };

  let createdAuthId = null;
  try {
    const createAuthRes = await fetch(AUTH_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authPayload)
    });
    const createAuthJson = await createAuthRes.json();
    if (!createAuthRes.ok || createAuthJson.status !== 'success' || !createAuthJson.data?.id) {
      throw new Error(`鉴权配置创建失败: ${JSON.stringify(createAuthJson)}`);
    }

    createdAuthId = createAuthJson.data.id;

    const listAuthRes = await fetch(AUTH_BASE_URL);
    const listAuthJson = await listAuthRes.json();
    if (!listAuthRes.ok || listAuthJson.status !== 'success' || !Array.isArray(listAuthJson.data) || listAuthJson.data.length === 0) {
      throw new Error(`鉴权配置查询失败: ${JSON.stringify(listAuthJson)}`);
    }
    if (!listAuthJson.data.some(item => item.id === createdAuthId)) {
      throw new Error(`鉴权配置查询结果未包含新建记录: ${JSON.stringify(listAuthJson)}`);
    }

    console.log(`${colors.green}✔ 鉴权配置 CRUD 通过${colors.reset}\n`);
  } finally {
    if (createdAuthId) {
      const deleteAuthRes = await fetch(`${AUTH_BASE_URL}/${createdAuthId}`, { method: 'DELETE' });
      const deleteAuthJson = await deleteAuthRes.json();
      if (!deleteAuthRes.ok || deleteAuthJson.status !== 'success') {
        throw new Error(`鉴权配置删除失败: ${JSON.stringify(deleteAuthJson)}`);
      }
    }
  }

  // --- 阶段 1: 测试接口提取分析 ---
  console.log(`${colors.yellow}▶ [阶段 1] 正在请求 /analyze-request 分析接口结构...${colors.reset}`);
  let startTime = performance.now();

  try {
    const res1 = await fetch(`${BASE_URL}/analyze-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rawPayload)
    });

    const data1 = await res1.json();
    const duration1 = ((performance.now() - startTime) / 1000).toFixed(2);

    if (res1.ok && data1.status === 'success' && data1.data) {
      console.log(`${colors.green}✔ 分析成功 (${res1.status}) - 耗时: ${duration1}s${colors.reset}`);
      analyzedJsonSchema = data1.data;
      console.log(`预览提取的 Skill 名称: ${analyzedJsonSchema.skill_name}`);
      console.log(`预览提取的 API 方法: ${analyzedJsonSchema.api_info.method}\n`);
    } else {
      throw new Error(`分析接口报错: ${JSON.stringify(data1)}`);
    }
  } catch (error) {
    console.error(`${colors.red}✖ 阶段 1 失败: ${error.message}${colors.reset}`);
    return;
  }

  // --- 阶段 2: 测试代码生成与 ZIP 下载 ---
  console.log(`${colors.yellow}▶ [阶段 2] 请求 /generate-skill 生成 ZIP...${colors.reset}`);
  startTime = performance.now();

  try {
    const res2 = await fetch(`${BASE_URL}/generate-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analyzedJsonSchema)
    });

    const duration2 = ((performance.now() - startTime) / 1000).toFixed(2);

    if (res2.ok && res2.headers.get('content-type').includes('application/zip')) {
      const arrayBuffer = await res2.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const zipPath = path.join(__dirname, 'test_output_skill.zip');
      fs.writeFileSync(zipPath, buffer);

      console.log(`${colors.green}✔ 生成并下载成功 (${res2.status}) - 耗时: ${duration2}s${colors.reset}`);
      console.log(`${colors.cyan}📁 ZIP 文件已保存至: ${zipPath}${colors.reset}\n`);
      console.log(`${colors.green}🎉 端到端联调测试全部通过！${colors.reset}`);
    } else {
      const errorText = await res2.text();
      throw new Error(`生成 ZIP 接口报错 (${res2.status}): ${errorText}`);
    }
  } catch (error) {
    console.error(`${colors.red}✖ 阶段 2 失败: ${error.message}${colors.reset}`);
  }
}

runV2Tests();
