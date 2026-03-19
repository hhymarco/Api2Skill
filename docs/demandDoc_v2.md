# 需求、架构与自动化测试说明书 V2：API Skill 自动生成平台 (迭代版)

## 1. 迭代背景与项目概述

本项目是一款面向 AI Agent 开发者的 Chrome 侧边栏插件及配套后端工具。**本次开发是在已有 V1 基础版本上的 V2 迭代升级。**

- **已有功能 (V1 保留能力)**：前端已具备基于 `chrome.webRequest` 的页面请求抓包、按 Method+URL 去重、数据截取（50KB 限制）以及发送给后端的能力。后端已具备基础的调用 OpenClaw 进行请求逆向解析的能力。
- **本次 V2 迭代新增核心功能**：
  1. **接口文档可视化修改**：摒弃纯文本展示，前端将解析后的 API 结构渲染为可编辑的表单，支持用户修改描述、增删改 Query/Body/Headers 参数及添加 Cookie 鉴权信息。
  2. **插件内真实接口测试**：前端基于用户修改后的表单数据，直接发起真实 HTTP 请求进行联调，并展示 Response 结果。
  3. **Skill 描述与代码生成**：根据用户确认的 API 契约和补充的 Skill 描述，驱动大模型自动生成完整的 OpenClaw 规范 Skill 代码。
  4. **Skill 打包与下载**：后端将生成的代码在内存中打包为 ZIP 文件流，前端接收并触发浏览器本地下载。

---

## 2. 核心业务工作流

1. **抓包与初析 (沿用 V1)**：前端抓取页面请求，发送给后端 `/api/v1/analyze-request`。后端调用 OpenClaw 分析，返回 API 结构化 JSON 数据（包含自动生成的 Skill 名称和描述）。
2. **可视化编辑 (V2 新增)**：前端将 JSON 渲染为可编辑表单，用户可在 UI 上任意增删改。
3. **前端直连测试 (V2 新增)**：用户点击"测试"按钮，前端直接利用当前表单数据发起真实 Fetch 请求（无视跨域），并将 Response 展示在界面下方。无论成功失败，不阻断后续流程。
4. **生成与下载 Skill (V2 新增)**：用户点击"生成 Skill"，前端将**修改后的完整数据**发送给后端 `/api/v1/generate-skill`。后端引导 OpenClaw 生成代码并打包成 ZIP 返回，前端触发浏览器下载。

---

## 3. Agent 团队角色与协作协议

请（大模型）模拟敏捷开发团队，基于现有代码库执行以下迭代任务：

- **角色 A（前端工程师）**：负责改造 Chrome Extension 的 Side Panel UI。实现可视化表单渲染、前端直接发起联调请求的功能，以及接收二进制流并触发 ZIP 下载的逻辑。*注意保护 V1 既有的 Service Worker 抓包去重代码。*
- **角色 B（后端工程师）**：负责升级 Node.js Server。改造原 `/analyze-request` 接口使其强制输出结构化 JSON；新增 `/generate-skill` 接口，实现 Prompt 组装、调用 OpenClaw 及基于 `archiver` 等库的多文件内存 ZIP 打包。
- **角色 C（测试工程师）**：在后端代码更新后，运行自动化测试脚本，验证新增的结构解析和 ZIP 打包链路。

---

## 4. 前后端开发规范

### 4.1 前端 UI 界面与交互设计 (Chrome Extension)

- 采用暗黑极客风格 (Dark Mode)。
- **顶部区域**：增加 `Skill 名称` 和 `Skill 触发场景描述` 输入框。
- **接口编辑区（重点改造）**：将 Query、Body、Headers（包含 Cookie）渲染为**可编辑的表格**（包含：字段名、类型、必填勾选框、说明、测试值输入框）。允许用户新增或删除行。
- **测试与生成控制区**：
  - `测试接口` 按钮：组装表格参数发起真实请求，展示 Response Header 和 Body JSON。
  - `生成并下载 Skill` 按钮：提交最终 JSON 至后端。

### 4.2 后端接口 1：初始结构分析 (`POST /api/v1/analyze-request`)

**作用**：接收抓包数据，调用 OpenClaw 输出结构化 JSON Schema。

预期响应数据结构：

```json
{
  "skill_name": "riskEngineParamExecute",
  "skill_description": "风险引擎参数执行接口，用于查询指定店铺的特定风险参数值...",
  "api_info": {
    "method": "POST",
    "url": "https://...",
    "headers": [
      { "key": "Content-Type", "value": "application/x-www-form-urlencoded", "description": "" }
    ],
    "query": [],
    "body": [
      { "key": "paramName", "type": "String", "required": true, "description": "风险参数名称", "test_value": "SHOP_IS_IN_TRIAL" }
    ],
    "response_mock": "{ \"code\": 0, \"msg\": \"success\" }"
  }
}
```

### 4.3 后端接口 2：Skill 生成与打包 (`POST /api/v1/generate-skill`)

**作用**：接收完整 JSON 数据，调用 OpenClaw 生成代码，并返回 ZIP 文件流。

处理逻辑：

1. 组装 Prompt 让大模型生成代码：`"你是一个 OpenClaw Skill 开发专家。根据 API 契约生成 Skill 目录结构。以 JSON 输出，Key 是文件名，Value 是代码内容。"`
2. 提取 LLM 返回的多文件结构，使用 `archiver` 等库在内存中打包为 `.zip`。
3. 设置响应头 `Content-Type: application/zip` 及 `Content-Disposition: attachment; filename="skill.zip"` 返回前端。

---

## 5. 后端自动化验收测试指南

开发完成后，创建并运行以下 `v2_backend_tests.js` 脚本验证核心链路。测试使用真实的业务风控接口数据。

```javascript
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';

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
```

---

## 6. 全局执行指令

请理解上述迭代背景，并按照【第 3 节 Agent 团队角色与协作协议】开始工作：

1. **角色 B（后端）**：基于现有代码，改造 `/analyze-request` 接口，并新增 `/generate-skill` 接口实现 ZIP 打包功能。
2. **角色 C（测试）**：创建并运行上述的 `v2_backend_tests.js` 脚本。如有报错主动修复代码，直至成功生成 ZIP 文件。
3. **角色 A（前端）**：在保护原有 Service Worker 基建的前提下，迭代 Side Panel 的原生 JS 代码，实现表单化编辑与连通性测试。

请开始 V2 代码迭代。
