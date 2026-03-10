# api2skill - API Skill 自动生成工具

> Chrome 侧边栏插件 + 独立后端服务，一键将浏览器抓包数据转化为 AI Agent 可用的 Markdown Skill 文档。

## 架构概览

```
┌─────────────────────────┐     HTTP POST      ┌──────────────────┐     HTTP POST     ┌───────────┐
│  Chrome Extension       │ ──────────────────> │  Backend Server  │ ────────────────> │  OpenClaw │
│  (Side Panel + SW)      │   /api/v1/analyze   │  (Node+Express)  │   /api/chat       │  Gateway  │
│                         │ <────────────────── │                  │ <──────────────── │           │
│  抓包 → 去重 → 截断     │     Markdown JSON   │  校验→组装→调用   │     AI Markdown   │  127.0.0.1│
└─────────────────────────┘                     └──────────────────┘                   └───────────┘
```

## 目录结构

```
api2skill/
├── docs/
│   └── API_CONTRACT.md          # API 数据契约文档
├── server/                      # 后端服务 (Node.js + Express)
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.js             # 入口：Express 应用启动
│       ├── routes/
│       │   └── analyze.js       # POST /api/v1/analyze-request 路由
│       ├── services/
│       │   └── openclaw.js      # OpenClaw REST API 对接 + 重试
│       └── utils/
│           ├── prompt.js        # Prompt 组装逻辑
│           └── validator.js     # 请求校验
├── extension/                   # Chrome Extension (Manifest V3)
│   ├── manifest.json            # 插件清单
│   ├── background.js            # Service Worker：debugger 抓包 + 去重
│   ├── sidepanel.html           # Side Panel HTML
│   ├── sidepanel.css            # 极客深色主题样式
│   └── sidepanel.js             # UI 逻辑 + Markdown 渲染
└── README.md
```

---

## 环境准备

### 前置条件

| 组件 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 18.0.0 | 后端运行环境 |
| Chrome | >= 116 | 支持 Side Panel API |
| OpenClaw | 最新版 | 本地 AI Gateway，默认端口 18789 |

### 1. 启动 OpenClaw

确保 OpenClaw 本地 Gateway 已运行：

```bash
# 确认 OpenClaw 正在监听
curl http://127.0.0.1:18789/health
```

### 2. 启动后端服务

```bash
cd server

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 OPENCLAW_API_KEY

# 启动服务
npm start
# 或开发模式（文件变更自动重启）
npm run dev
```

服务默认运行在 `http://localhost:3000`。

**环境变量说明**：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 后端监听端口 |
| `OPENCLAW_BASE_URL` | `http://127.0.0.1:18789` | OpenClaw 地址（云部署时填 ngrok 公网地址） |
| `OPENCLAW_API_KEY` | - | OpenClaw 认证 Token（**必填**） |
| `REQUEST_TIMEOUT_MS` | `60000` | OpenClaw 请求超时时间 (ms) |
| `CORS_ORIGIN` | `*` | 允许的跨域来源 |

### 3. 安装 Chrome 插件

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/` 目录
5. 插件图标出现在工具栏

---

## 使用流程

### Step 1: 开启抓包

1. 点击工具栏的 **API Skill Generator** 图标，打开侧边栏
2. 点击 **Capture** 按钮，开始捕获当前标签页的网络请求
3. 正常浏览网页，插件会在后台自动抓取请求/响应数据

### Step 2: 查看抓取结果

- 点击 **Refresh** 刷新请求列表
- 列表按时间倒序显示，格式为 `METHOD /path`
- 相同 Method + Path 的请求会自动去重（保留最新）

### Step 3: AI 分析

1. 找到目标请求，点击 **Analyze** 按钮
2. 等待 Loading（后端调用 OpenClaw 分析，通常 10-30 秒）
3. 分析完成后，Markdown 文档直接渲染在侧边栏

### Step 4: 复制结果

- 点击 **Copy** 按钮，一键复制原始 Markdown
- 粘贴到 Claude Code、OpenClaw 等 Agent 的 Skill 定义文件中

---

## 联调测试方案

### 测试 1: 后端健康检查

```bash
curl http://localhost:3000/health
# 预期: {"status":"ok"}
```

### 测试 2: 后端接口直连测试

```bash
curl -X POST http://localhost:3000/api/v1/analyze-request \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.example.com/v1/users?page=1&size=20",
    "method": "GET",
    "request_headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer token123"
    },
    "query_params": {"page": "1", "size": "20"},
    "request_body": null,
    "response_body": "{\"code\":0,\"data\":[{\"id\":1,\"name\":\"John\"}],\"message\":\"success\"}"
  }'
```

**预期返回**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "markdown": "# 接口名称：getUserList\n\n## 功能描述\n..."
  }
}
```

### 测试 3: 参数校验测试

```bash
# 缺少必填字段
curl -X POST http://localhost:3000/api/v1/analyze-request \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
# 预期: {"code":1001, "message":"Invalid request: 'method' is required", "data":null}

# 无效 HTTP 方法
curl -X POST http://localhost:3000/api/v1/analyze-request \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","method":"INVALID","request_headers":{},"response_body":"test"}'
# 预期: {"code":1002, "message":"Invalid request: 'method' must be a valid HTTP method", "data":null}
```

### 测试 4: OpenClaw 连接异常测试

```bash
# 停止 OpenClaw 后发送请求
curl -X POST http://localhost:3000/api/v1/analyze-request \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.example.com/test",
    "method": "GET",
    "request_headers": {},
    "response_body": "{}"
  }'
# 预期: {"code":2004, "message":"Cannot connect to OpenClaw service", "data":null}
```

### 测试 5: Chrome 插件端到端测试

1. 确保后端服务已启动
2. 安装插件并打开侧边栏
3. 访问任意网站（如 `https://jsonplaceholder.typicode.com/posts`）
4. 点击 Capture → 刷新页面 → 点击 Refresh
5. 在列表中找到 `GET /posts`，点击 Analyze
6. 验证：Loading 状态 → Markdown 渲染 → Copy 按钮可用

---

## 错误码参考

| 错误码 | HTTP 状态 | 含义 |
|--------|----------|------|
| 0 | 200 | 成功 |
| 1001 | 400 | 缺少必填字段 |
| 1002 | 400 | 字段值无效 |
| 1003 | 400 | 请求体 JSON 格式错误 |
| 2001 | 502 | OpenClaw 认证失败 |
| 2002 | 502 | OpenClaw 内部错误 |
| 2003 | 504 | OpenClaw 请求超时 |
| 2004 | 502 | 无法连接 OpenClaw |
| 2005 | 502 | OpenClaw 响应解析失败 |
| 5000 | 500 | 服务端内部错误 |

---

## 云端部署 (Vercel + ngrok)

当后端部署到 Vercel 等 Serverless 平台时：

1. 本地运行 OpenClaw 并用 ngrok 暴露：
   ```bash
   ngrok http 18789
   ```
2. 在 Vercel 环境变量中设置：
   - `OPENCLAW_BASE_URL` = ngrok 公网地址（如 `https://xxxx.ngrok-free.app`）
   - `OPENCLAW_API_KEY` = 你的 API Key

---

## 常见问题

**Q: 插件侧边栏没有抓到请求？**
A: 点击 Capture 按钮激活 debugger。部分页面可能需要刷新后才能捕获。如果使用了 Chrome DevTools，debugger 可能冲突。

**Q: Analyze 报 "Failed to connect to backend"？**
A: 确认后端服务已启动在 `localhost:3000`。检查浏览器控制台是否有 CORS 错误。

**Q: 分析结果为空或格式异常？**
A: 检查 OpenClaw 是否正常运行。可通过后端日志 (`LOG_LEVEL=debug`) 查看发送给 OpenClaw 的完整 prompt。

**Q: Response Body 被截断了？**
A: 这是预期行为。超过 50KB 的响应体会被截断并追加 `...[Truncated for AI Analysis]` 标记，以确保 AI 分析效率。
