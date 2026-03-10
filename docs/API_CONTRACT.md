# API Data Contract - api2skill

> Version: 1.0.0 | Date: 2026-03-11

---

## 1. Frontend -> Backend API Contract

### 1.1 POST /api/v1/analyze-request

Accepts a captured HTTP request/response pair and returns a Markdown-formatted API skill document.

#### 1.1.1 Request

**Content-Type**: `application/json`

**JSON Schema**:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["url", "method", "request_headers", "response_body"],
  "properties": {
    "url": {
      "type": "string",
      "format": "uri",
      "description": "Full request URL including protocol, host, path, and query string",
      "example": "https://api.example.com/v1/users?page=1&size=20"
    },
    "method": {
      "type": "string",
      "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
      "description": "HTTP method",
      "example": "POST"
    },
    "request_headers": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Request headers as key-value pairs",
      "example": {
        "Content-Type": "application/json",
        "Authorization": "Bearer token123"
      }
    },
    "query_params": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [
          { "type": "string" },
          { "type": "array", "items": { "type": "string" } }
        ]
      },
      "default": {},
      "description": "Query parameters parsed from URL. Optional; backend will also parse from url if omitted.",
      "example": { "page": "1", "size": "20" }
    },
    "request_body": {
      "oneOf": [
        { "type": "object" },
        { "type": "null" }
      ],
      "default": null,
      "description": "Request body (JSON-parsed). null for GET/DELETE requests without body.",
      "example": { "username": "john", "email": "john@example.com" }
    },
    "response_body": {
      "type": "string",
      "description": "Raw response body as string (will be forwarded to OpenClaw for analysis)",
      "example": "{\"code\":0,\"data\":{\"id\":1,\"username\":\"john\"},\"message\":\"success\"}"
    }
  },
  "additionalProperties": false
}
```

**Field Summary**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string (uri) | Yes | - | Full request URL |
| `method` | string (enum) | Yes | - | HTTP method (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) |
| `request_headers` | object | Yes | - | Request headers key-value map |
| `query_params` | object | No | `{}` | Parsed query parameters |
| `request_body` | object \| null | No | `null` | JSON request body, null if none |
| `response_body` | string | Yes | - | Raw response body string |

**Example Request**:

```http
POST /api/v1/analyze-request HTTP/1.1
Content-Type: application/json

{
  "url": "https://api.example.com/v1/users?page=1&size=20",
  "method": "POST",
  "request_headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer token123"
  },
  "query_params": {
    "page": "1",
    "size": "20"
  },
  "request_body": {
    "username": "john",
    "email": "john@example.com"
  },
  "response_body": "{\"code\":0,\"data\":{\"id\":1,\"username\":\"john\"},\"message\":\"success\"}"
}
```

#### 1.1.2 Success Response

**HTTP Status**: `200 OK`

**JSON Schema**:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["code", "data"],
  "properties": {
    "code": {
      "type": "integer",
      "const": 0,
      "description": "Business status code. 0 indicates success."
    },
    "message": {
      "type": "string",
      "default": "success",
      "description": "Human-readable status message"
    },
    "data": {
      "type": "object",
      "required": ["markdown"],
      "properties": {
        "markdown": {
          "type": "string",
          "description": "Generated Markdown API skill document"
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

**Example Success Response**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "markdown": "# 接口名称：createUser\n\n## 功能描述\n创建新用户...\n"
  }
}
```

#### 1.1.3 Error Response

**JSON Schema**:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["code", "message"],
  "properties": {
    "code": {
      "type": "integer",
      "description": "Business error code (non-zero)"
    },
    "message": {
      "type": "string",
      "description": "Human-readable error message"
    },
    "data": {
      "type": "null",
      "default": null,
      "description": "Always null on error"
    }
  },
  "additionalProperties": false
}
```

**Example Error Response**:

```json
{
  "code": 1001,
  "message": "Invalid request: 'url' is required",
  "data": null
}
```

---

## 2. Backend -> OpenClaw Internal API Contract

### 2.1 POST {OPENCLAW_BASE_URL}/api/chat

Backend constructs a prompt from the captured request data and sends it to OpenClaw for AI-powered analysis.

#### 2.1.1 Request

**Content-Type**: `application/json`
**Authorization**: `Bearer {OPENCLAW_API_KEY}`

**JSON Schema**:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["message", "session_id", "stream"],
  "properties": {
    "message": {
      "type": "string",
      "description": "Assembled prompt containing captured HTTP request/response data and Markdown template instructions"
    },
    "session_id": {
      "type": "string",
      "default": "api-analyzer-session",
      "description": "Session identifier for conversation context"
    },
    "stream": {
      "type": "boolean",
      "const": false,
      "description": "Disable streaming; wait for full response"
    }
  },
  "additionalProperties": false
}
```

**Prompt Assembly Template** (value of `message` field):

```
请根据以下抓包数据，按照指定模板输出 Markdown 格式的 API 接口说明文档。

## 抓包数据

- URL: {url}
- Method: {method}
- Request Headers:
{formatted_headers}
- Query Parameters:
{formatted_query_params}
- Request Body:
{formatted_request_body}
- Response Body:
{response_body}

## 输出模板

请严格按照以下模板格式输出：

# 接口名称：[根据 URL 和功能推断的英文驼峰命名]

## 功能描述
[根据请求和响应推断接口功能的简要描述]

## 基本信息
| 项目 | 值 |
|------|-----|
| Method | {method} |
| URL | {url} |
| Content-Type | {content_type} |

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
（提供 curl 示例）
```

**Example Request**:

```http
POST /api/chat HTTP/1.1
Content-Type: application/json
Authorization: Bearer sk-openclaw-xxxx

{
  "message": "请根据以下抓包数据，按照指定模板输出 Markdown 格式的 API 接口说明文档。\n\n## 抓包数据\n- URL: https://api.example.com/v1/users...",
  "session_id": "api-analyzer-session",
  "stream": false
}
```

#### 2.1.2 Success Response

```json
{
  "response": "# 接口名称：createUser\n\n## 功能描述\n...",
  "session_id": "api-analyzer-session"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `response` | string | OpenClaw generated Markdown content |
| `session_id` | string | Echo of the session ID |

#### 2.1.3 Error Response

OpenClaw may return errors in the following scenarios:

| HTTP Status | Scenario | Handling |
|-------------|----------|----------|
| 401 | Invalid or missing API key | Return error code 2001 to frontend |
| 500 | OpenClaw internal error | Return error code 2002 to frontend |
| Timeout | Request exceeds timeout (60s) | Return error code 2003 to frontend |
| Network Error | Cannot reach OpenClaw | Return error code 2004 to frontend |

---

## 3. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Backend server listening port |
| `OPENCLAW_BASE_URL` | No | `http://127.0.0.1:18789` | OpenClaw service base URL |
| `OPENCLAW_API_KEY` | Yes | - | Bearer token for OpenClaw authentication |
| `REQUEST_TIMEOUT_MS` | No | `60000` | Timeout for OpenClaw requests in milliseconds |
| `LOG_LEVEL` | No | `info` | Logging level (debug/info/warn/error) |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origins for Chrome extension |

---

## 4. HTTP Status Code and Error Code Mapping

### HTTP Status Codes

| HTTP Status | Usage |
|-------------|-------|
| 200 | Successful analysis |
| 400 | Client request validation failed |
| 401 | Authentication error (reserved for future use) |
| 500 | Internal server error |
| 502 | OpenClaw upstream error |
| 504 | OpenClaw request timeout |

### Business Error Codes

| Error Code | HTTP Status | Description | Message Example |
|------------|-------------|-------------|-----------------|
| 0 | 200 | Success | `"success"` |
| 1001 | 400 | Missing required field | `"Invalid request: 'url' is required"` |
| 1002 | 400 | Invalid field value | `"Invalid request: 'method' must be a valid HTTP method"` |
| 1003 | 400 | Malformed request body | `"Invalid request: request body is not valid JSON"` |
| 2001 | 502 | OpenClaw authentication failed | `"OpenClaw service authentication failed"` |
| 2002 | 502 | OpenClaw internal error | `"OpenClaw service returned an error"` |
| 2003 | 504 | OpenClaw request timeout | `"OpenClaw service request timed out"` |
| 2004 | 502 | OpenClaw unreachable | `"Cannot connect to OpenClaw service"` |
| 2005 | 502 | OpenClaw response parse error | `"Failed to parse OpenClaw response"` |
| 5000 | 500 | Unexpected server error | `"Internal server error"` |

### Error Code Ranges

| Range | Category |
|-------|----------|
| 0 | Success |
| 1000-1999 | Client request validation errors |
| 2000-2999 | OpenClaw upstream errors |
| 5000-5999 | Internal server errors |

---

## 5. Markdown Output Template

The final Markdown document returned in `data.markdown` follows this structure:

```markdown
# 接口名称：{camelCaseName}

## 功能描述
{description}

## 基本信息
| 项目 | 值 |
|------|-----|
| Method | {method} |
| URL | {url} |
| Content-Type | {content_type} |

## 请求参数说明 (Request)

### Query 参数
| 参数名 | 类型 | 必填 | 说明 | 示例值 |
|--------|------|------|------|--------|

### Body 参数
| 参数名 | 类型 | 必填 | 说明 | 示例值 |
|--------|------|------|------|--------|

## 返回字段说明 (Response)
| 字段名 | 类型 | 说明 | 示例值 |
|--------|------|------|--------|

## 完整调用示例 (Example)
```

---

## 6. CORS Configuration

The backend must support CORS for Chrome extension requests:

```
Access-Control-Allow-Origin: * (or specific extension origin)
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400
```

---

## 7. Rate Limiting (Recommended)

| Parameter | Value | Description |
|-----------|-------|-------------|
| Window | 60s | Sliding window duration |
| Max Requests | 10 | Max requests per window per IP |
| Retry-After | Header | Seconds until rate limit resets |
