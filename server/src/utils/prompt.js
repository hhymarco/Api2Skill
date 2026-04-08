/**
 * Prompt assembly for OpenClaw API.
 * V2: Outputs structured JSON prompts for analyze and generate-skill.
 */

/**
 * Format headers object into readable lines.
 */
function formatHeaders(headers) {
  if (!headers || Object.keys(headers).length === 0) return '  (none)';
  return Object.entries(headers)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
}

/**
 * Format query params object into readable lines.
 */
function formatQueryParams(params) {
  if (!params || Object.keys(params).length === 0) return '  (none)';
  return Object.entries(params)
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
}

/**
 * Format request body into a JSON string or "(none)".
 */
function formatRequestBody(body) {
  if (body === null || body === undefined) return '(none)';
  return JSON.stringify(body, null, 2);
}

/**
 * Build the V2 analyze prompt — instructs OpenClaw to return structured JSON.
 */
function buildPrompt({ url, method, request_headers, query_params, request_body, response_body }) {
  return `请根据以下抓包数据，分析该 API 接口的完整信息。

## 抓包数据

- URL: ${url}
- Method: ${method}
- Request Headers:
${formatHeaders(request_headers)}
- Query Parameters:
${formatQueryParams(query_params)}
- Request Body:
${formatRequestBody(request_body)}
- Response Body:
${response_body}

## 输出要求

请以**纯 JSON 格式**输出分析结果（不要用 markdown 代码块包裹，直接输出 JSON）。JSON 结构如下：

{
  "skill_name": "根据 URL 和功能推断的英文驼峰命名（如 riskEngineParamExecute）",
  "skill_description": "该接口功能的简要中文描述，包含用途和关键参数说明",
  "api_info": {
    "method": "HTTP 方法（GET/POST/PUT/DELETE 等）",
    "url": "完整的请求 URL",
    "headers": [
      { "key": "请求头名称", "value": "请求头值", "description": "该请求头的用途说明" }
    ],
    "query": [
      { "key": "参数名", "type": "参数类型如 String/Number/Boolean", "required": true, "description": "参数说明", "test_value": "从抓包数据提取的示例值" }
    ],
    "body": [
      { "key": "参数名", "type": "参数类型如 String/Number/Boolean/Object", "required": true, "description": "参数说明", "test_value": "从抓包数据提取的示例值" }
    ],
    "response_mock": "响应体的 JSON 字符串（直接取自抓包数据）"
  }
}

注意事项：
1. skill_name 使用英文驼峰命名，从 URL 路径推断
2. headers 数组中只包含业务相关的请求头（如 Content-Type, Accept, Referer 等），忽略浏览器自动添加的标准头
3. query 数组从 URL 的 query string 解析，如果没有则为空数组
4. body 数组从 Request Body 解析每个字段，如果没有则为空数组
5. required 字段根据业务逻辑推断，有值的参数默认为 true
6. test_value 直接从抓包数据中提取实际值
7. response_mock 直接使用抓包的响应体字符串
8. 请直接输出 JSON，不要添加任何其他文字说明`;
}

/**
 * Build the prompt for Skill code generation.
 * Takes the confirmed API schema and generates OpenClaw Skill code.
 */
function buildGenerateSkillPrompt({ skill_name, skill_description, api_info, authConfig }) {
  const apiContract = JSON.stringify({ skill_name, skill_description, api_info }, null, 2);
  const authGuide = authConfig ? `

## 鉴权要求
该接口所在站点存在鉴权配置，请在生成结果中体现：
- skill.json 中加入 auth_required: true
- skill.json 中加入 auth_types: ${JSON.stringify((authConfig.auths || []).map(item => item.type))}
- skill.json 中加入 auth_guide，指导用户从浏览器导出 Cookie / Bearer Token / 自定义 Header
- README.md 中加入"鉴权说明"章节，指导用户在浏览器登录后从 DevTools Network 复制对应请求头
- index.js 在缺少鉴权参数时返回清晰提示，引导用户提供 Cookie、Bearer Token 或自定义 Header
` : '';

  return `你是一个 OpenClaw Skill 开发专家。请根据以下 API 契约信息，生成一个完整的 OpenClaw Skill 项目代码。

## API 契约

${apiContract}${authGuide}

## 输出要求

请以**纯 JSON 格式**输出（不要用 markdown 代码块包裹，直接输出 JSON）。JSON 的 Key 是文件路径/名称，Value 是该文件的完整代码内容。

示例结构：
{
  "skill.json": "{ ... skill 配置 JSON ... }",
  "index.js": "// skill 入口代码...",
  "README.md": "# Skill 说明文档..."
}

生成规范：
1. skill.json：包含 skill 的名称、描述、版本、触发条件等元信息
2. index.js：主逻辑文件，实现 HTTP 请求调用，包含参数验证、错误处理、响应解析
3. README.md：说明文档，包含 Skill 用途、参数说明、使用示例
4. 代码中使用 fetch 或 axios 发起 HTTP 请求
5. 正确处理请求头、查询参数、请求体
6. 包含完善的错误处理和日志输出
7. 请直接输出 JSON，不要添加任何其他文字说明`;
}

function buildFilterPrompt({ url, method, request_headers, response_body }) {
  return `请判断以下请求是否属于业务 API，而不是埋点、监控、日志、心跳或静态资源请求。

## 请求数据
- URL: ${url}
- Method: ${method}
- Request Headers:
${formatHeaders(request_headers)}
- Response Body:
${response_body || '(none)'}

请只输出纯 JSON：
{
  "is_business": true,
  "reason": "一句话说明判断依据"
}`;
}

module.exports = { buildPrompt, buildGenerateSkillPrompt, buildFilterPrompt };
