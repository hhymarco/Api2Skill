/**
 * Prompt assembly for OpenClaw API.
 * Converts captured HTTP data into a structured Markdown prompt.
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
 * Extract Content-Type from headers (case-insensitive).
 */
function extractContentType(headers) {
  if (!headers) return 'N/A';
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
  return key ? headers[key] : 'N/A';
}

/**
 * Build the full prompt message for OpenClaw.
 */
function buildPrompt({ url, method, request_headers, query_params, request_body, response_body }) {
  const contentType = extractContentType(request_headers);

  return `请根据以下抓包数据，按照指定模板输出 Markdown 格式的 API 接口说明文档。

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

## 输出模板

请严格按照以下模板格式输出：

# 接口名称：[根据 URL 和功能推断的英文驼峰命名]

## 功能描述
[根据请求和响应推断接口功能的简要描述]

## 基本信息
| 项目 | 值 |
|------|-----|
| Method | ${method} |
| URL | ${url} |
| Content-Type | ${contentType} |

## 请求参数说明 (Request)

### Query 参数
| 参数名 | 类型 | 必填 | 说明 | 示例值 |
|--------|------|------|------|--------|
（如无 Query 参数则注明"无"）

### Body 参数
| 参数名 | 类型 | 必填 | 说明 | 示例值 |
|--------|------|------|------|--------|
（如无 Body 参数则注明"无"）

## 返回字段说明 (Response)
| 字段名 | 类型 | 说明 | 示例值 |
|--------|------|------|--------|

## 完整调用示例 (Example)
（提供 curl 示例）`;
}

module.exports = { buildPrompt };
