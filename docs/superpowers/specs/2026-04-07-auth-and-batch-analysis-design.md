# 设计文档：站点鉴权配置 + 批量自动分析

日期：2026-04-07  
状态：已批准

---

## 背景与目标

在现有 V2 能力基础上，补全两项核心能力：

1. **站点鉴权配置** — 按域名管理 Cookie / Bearer Token / 自定义 Header，在 API 测试和 Skill 生成两个环节自动注入和引导
2. **批量自动分析** — 捕获请求后自动排队，经 AI 两阶段处理（过滤判断 → 完整分析），列表实时展示队列状态

---

## 功能一：站点鉴权配置

### 数据模型

存储在 `server/data/auth-configs.json`，Server 启动时加载到内存，写入时同步落盘。

```json
[
  {
    "id": "uuid-xxx",
    "domain": "fin-risk-control.prod.fin.qima-inc.com",
    "name": "风控平台",
    "auths": [
      { "type": "cookie", "value": "session=abc123; token=xyz" },
      { "type": "bearer", "value": "eyJhbGci..." },
      { "type": "header", "key": "X-Api-Key", "value": "my-key" }
    ],
    "updatedAt": "2026-04-07T10:00:00Z"
  }
]
```

支持的鉴权类型：
- `cookie` → 注入为 `Cookie` 请求头
- `bearer` → 注入为 `Authorization: Bearer xxx`
- `header` → 任意自定义 key/value 请求头

### 后端

**新增文件 `server/src/services/authStore.js`**

```
职责：读写 auth-configs.json
导出：getAll() / getByDomain(domain) / upsert(config) / remove(id)
```

**新增路由 `server/src/routes/auth.js`**，挂载 `/api/v1/auth`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/auth/configs` | 返回所有站点配置列表 |
| POST | `/api/v1/auth/configs` | 新增或更新站点配置（按 domain 去重） |
| DELETE | `/api/v1/auth/configs/:id` | 删除指定配置 |

**`server/src/index.js`** 注册 authRouter。

### 前端：鉴权管理 UI

Side Panel 顶部工具栏新增 **"Auth"** 按钮，进入第三个视图：

```
← Back

站点鉴权配置
──────────────────────────────────────
[+ 新增站点]

▼ fin-risk-control.prod...  [编辑] [删除]
  Cookie: session=abc...（截断显示）
  Bearer: eyJ...（截断显示）

▼ api.example.com  [编辑] [删除]
  Header: X-Api-Key = ****
──────────────────────────────────────
```

编辑区 inline 展开（非弹窗）：
- 域名输入框（hostname，不含协议和路径）
- 站点别名输入框（可选，便于识别）
- 鉴权条目列表（类型下拉 + key/value 输入 + 删除按钮）
- [+ 添加鉴权条目] 按钮
- [保存] → POST `/api/v1/auth/configs`

### 鉴权注入：API 测试时

`sidepanel.js` 的 `testAPI()` 执行前：

1. GET `/api/v1/auth/configs` 取所有配置
2. 精确匹配当前 URL 的 hostname
3. 将鉴权参数合并注入请求头
4. 用户在 Headers 表格中手动填写的同名 Header **优先级更高**（覆盖鉴权配置）

### 鉴权注入：Skill 生成时

`prompt.js` 的 `buildGenerateSkillPrompt()` 接收新增的 `authConfig` 参数。

当站点有鉴权配置时，生成的 Skill 三处均包含鉴权处理：

**`skill.json`**
```json
{
  "auth_required": true,
  "auth_types": ["cookie"],
  "auth_guide": "使用前需提供 Cookie。获取方式：打开浏览器 → F12 → Network → 复制任意请求的 Cookie 请求头值"
}
```

**`index.js`** — 运行时检测
```js
if (!params.cookie && !params.authorization) {
  return {
    error: "缺少鉴权参数",
    guide: "请提供 Cookie 或 Bearer Token，获取方式：打开浏览器 → F12 → Network → 复制 Cookie"
  };
}
```

**`README.md`** — 静态说明
```markdown
## 鉴权说明
本 Skill 需要浏览器登录态。使用前请从浏览器导出 Cookie：
1. 打开目标站点并登录
2. 按 F12 → Network → 找到任意请求 → 复制 Request Headers 中的 Cookie 值
3. 将 Cookie 值作为参数传入 Agent
```

---

## 功能二：批量自动分析

### 队列模型

队列存在 `background.js` 内存中，与 `capturedRequests` Map 同生命周期：

```js
// key = "METHOD /pathname"
analysisQueue: Map<string, {
  key: string,
  status: 'pending' | 'filtering' | 'analyzing' | 'done' | 'skipped' | 'failed',
  filterReason?: string,   // AI 判断跳过的理由
  result?: object,         // 完整分析结果（structured data）
  error?: string,          // 失败原因
}>
```

状态流转：
```
pending → filtering → skipped（AI 判断为非业务请求）
                    → analyzing → done
                                → failed
```

### 触发时机

`Network.loadingFinished` 将请求写入 `capturedRequests` 后，**自动将该 key 追加到队列**，并在处理器空闲时启动处理器。队列处理器串行消费，一次只处理一条。

用户手动点击单条"Analyze"时，该条**插队到队列头部**，优先处理。

### 两阶段 AI 调用

**阶段 1 — 过滤判断**

新增 `POST /api/v1/filter-request`，输入：

```json
{ "url": "...", "method": "GET", "request_headers": {}, "response_body": "前1KB" }
```

后端使用轻量 Prompt（新增 `buildFilterPrompt()`）：

```
判断以下请求是否为业务 API（数据查询、操作、事务类），
还是非业务请求（埋点上报、日志、监控、心跳、静态资源）。
只输出 JSON：{ "is_business": true, "reason": "一句话理由" }
```

响应：

```json
{ "status": "success", "data": { "is_business": true, "reason": "..." } }
```

**阶段 2 — 完整分析**

复用现有 `POST /api/v1/analyze-request`，无需改动。

### 前端：队列状态展示

请求列表每条 item 状态区域：

```
[GET]  /api/user/info        200   ⏳ 过滤中...
[POST] /api/order/submit     200   🔄 分析中...
[GET]  /api/track/event      200   ⏭ 已跳过（埋点上报）
[POST] /api/risk/execute     200   ✅ 完成  [查看]
[GET]  /api/config/list      200   ❌ 失败  [重试]
[POST] /api/pay/confirm      200   🕐 待处理
```

- **已跳过**：hover 显示 AI `reason`
- **完成**：点击"查看"直接进入编辑器（数据来自队列缓存，不重新请求后端）
- **失败**：点击"重试"将该条重新置为 `pending` 插入队列头部

顶部新增队列进度汇总行：

```
✅ 3 完成  ⏭ 2 跳过  ❌ 1 失败  🕐 4 待处理
```

### 消息通信扩展

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `getQueueStatus` | SP→BG | 获取完整队列状态列表 |
| `retryAnalysis` | SP→BG | 指定 key 重新入队（插队头部） |
| `queueUpdated` | BG→SP | 队列任意状态变更时主动推送 |

Side Panel 监听 `queueUpdated`，收到后刷新列表，**无需轮询**。

---

## 新增/修改文件汇总

| 文件 | 类型 | 说明 |
|------|------|------|
| `server/data/auth-configs.json` | 新增（运行时生成） | 站点鉴权配置持久化存储 |
| `server/src/services/authStore.js` | 新增 | JSON 文件读写，getAll/getByDomain/upsert/remove |
| `server/src/routes/auth.js` | 新增 | 鉴权配置 CRUD 接口 |
| `server/src/routes/filter.js` | 新增 | `/filter-request` 轻量 AI 过滤判断 |
| `server/src/utils/prompt.js` | 修改 | 新增 `buildFilterPrompt()`；`buildGenerateSkillPrompt()` 增加 `authConfig` 参数 |
| `server/src/index.js` | 修改 | 注册 authRouter、filterRouter |
| `extension/background.js` | 修改 | 新增 analysisQueue Map、串行处理器、新消息类型处理 |
| `extension/sidepanel.js` | 修改 | 队列状态渲染、queueUpdated 监听、重试逻辑、Auth 视图、鉴权注入 |
| `extension/sidepanel.css` | 修改 | 队列状态 badge 样式、Auth 管理页样式 |

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 过滤请求 AI 调用失败 | 状态置为 `failed`，不阻塞队列，继续处理下一条 |
| 分析请求 AI 调用失败 | 同上，用户可手动重试 |
| auth-configs.json 不存在 | Server 启动时自动创建空文件 |
| 域名无鉴权配置 | 正常发起请求，不注入任何鉴权参数，Skill 生成时不添加鉴权引导 |
| openclaw session 冲突 | 串行队列天然避免，同一时刻只有一个 CLI 子进程 |
