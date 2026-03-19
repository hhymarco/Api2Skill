# V2 迭代说明文档

## 迭代背景

本次 V2 迭代在 V1 基础版本上新增四项核心能力：

1. **接口文档可视化编辑** — 将 AI 分析结果渲染为可编辑表单，支持增删改参数
2. **插件内真实接口测试** — 直接从 Side Panel 发起真实 HTTP 请求验证接口
3. **Skill 代码生成** — 基于确认后的 API 契约，驱动大模型生成完整 Skill 代码
4. **Skill ZIP 打包下载** — 将生成的多文件 Skill 代码打包为 ZIP 并触发本地下载

---

## 架构变更

### 整体流程（V2）

```
抓包 (V1 保留)
  └─ background.js 捕获请求，存入内存 Map

分析 (改造)
  └─ POST /api/v1/analyze-request
      ├─ 输入: { url, method, request_headers, query_params, request_body, response_body }
      └─ 输出: { status: 'success', data: { skill_name, skill_description, api_info } }

可视化编辑 (新增)
  └─ Side Panel 渲染可编辑表格 (Headers / Query / Body)

接口测试 (新增)
  └─ 前端直接 fetch，展示 Response Headers + Body

生成 Skill (新增)
  └─ POST /api/v1/generate-skill
      ├─ 输入: { skill_name, skill_description, api_info }
      └─ 输出: application/zip 二进制流 → 浏览器下载
```

---

## 后端变更详情

### 1. `POST /api/v1/analyze-request` — 响应格式变更

**V1 响应（已废弃）**
```json
{
  "code": 0,
  "message": "success",
  "data": { "markdown": "# 接口名称：..." }
}
```

**V2 响应**
```json
{
  "status": "success",
  "data": {
    "skill_name": "riskEngineParamExecute",
    "skill_description": "风险引擎参数执行接口，用于查询指定店铺的特定风险参数值",
    "api_info": {
      "method": "POST",
      "url": "https://example.com/api/invoke/action",
      "headers": [
        { "key": "Content-Type", "value": "application/x-www-form-urlencoded", "description": "请求体编码格式" }
      ],
      "query": [],
      "body": [
        { "key": "paramName", "type": "String", "required": true, "description": "风险参数名称", "test_value": "SHOP_IS_IN_TRIAL" }
      ],
      "response_mock": "{\"code\": 0, \"msg\": \"success\"}"
    }
  }
}
```

**错误响应格式（统一）**
```json
{ "status": "error", "message": "错误描述", "data": null }
```

---

### 2. `POST /api/v1/generate-skill` — 新增接口

**请求体**（与 `/analyze-request` 响应的 `data` 字段结构相同）
```json
{
  "skill_name": "riskEngineParamExecute",
  "skill_description": "...",
  "api_info": { ... }
}
```

**响应**
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="<skill_name>.zip"`
- 响应体为二进制 ZIP 文件流

**ZIP 内容结构**
```
<skill_name>/
  ├── skill.json      # Skill 元信息配置
  ├── index.js        # 主逻辑，实现 HTTP 调用
  └── README.md       # 使用说明文档
```

---

### 3. 新增 / 修改的服务端文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/utils/prompt.js` | 修改 | 新增 `buildGenerateSkillPrompt()`；`buildPrompt()` 改为要求 JSON 输出 |
| `src/services/openclaw.js` | 修改 | 新增 `extractJSON()` — 从 LLM 文本中提取 JSON，兼容 markdown 代码块 |
| `src/routes/analyze.js` | 修改 | 响应格式由 Markdown 改为结构化 JSON |
| `src/routes/generate.js` | 新增 | `/generate-skill` 路由：调用 OpenClaw + archiver 打包 |
| `src/index.js` | 修改 | 注册 `generateRouter`；CORS 增加 `Content-Disposition` 暴露 |
| `package.json` | 修改 | 新增依赖 `archiver` |

---

### 4. `extractJSON()` 工具函数

位于 `src/services/openclaw.js`，用于从 LLM 原始文本中提取 JSON。

兼容三种格式：
1. 纯 JSON 字符串
2. Markdown 代码块包裹（`` ```json ... ``` ``）
3. JSON 前后有多余文字（取第一个 `{` 到最后一个 `}` 之间的内容）

---

## 前端变更详情

### UI 结构（V2）

```
Header（固定）
  Capture | Refresh | Clear

View 1: 请求列表
  [GET]  /path/to/api  200  [Analyze]
  [POST] /path/to/api  200  [Analyze]

View 2: API 编辑器（点击 Analyze 后进入）
  ← Back  |  METHOD /path

  Skill Name       [输入框]
  Skill Description[文本域]

  Method [下拉]  URL [输入框]

  Headers 表格
    Key | Value | Description | [×]
    [+ Add]

  Query Parameters 表格
    Key | Type | Req | Description | Test Value | [×]
    [+ Add]

  Body Parameters 表格
    Key | Type | Req | Description | Test Value | [×]
    [+ Add]

  Response Mock [代码文本域]

  [Test API]  [Generate & Download Skill]

  测试结果区（点击 Test API 后出现）
    状态码 | Response Headers | Response Body
```

### 保持不变的文件

- `extension/background.js` — V1 抓包 Service Worker 完整保留，未做任何修改

### 修改的文件

| 文件 | 说明 |
|------|------|
| `extension/sidepanel.html` | 全新表单布局，增加编辑器视图 |
| `extension/sidepanel.js` | 完整重写：表单渲染、行增删、真实 fetch 测试、ZIP 下载 |
| `extension/sidepanel.css` | 扩展样式：表格单元格输入、测试结果、状态颜色 |

---

## 测试验收

### 自动化测试脚本

```bash
cd server
npm start                    # 启动服务（需已配置 OPENCLAW_API_KEY）
node v2_backend_tests.js     # 运行两阶段 E2E 测试
```

**阶段 1** — 验证 `/analyze-request` 返回正确的结构化 JSON
**阶段 2** — 验证 `/generate-skill` 返回有效的 ZIP 文件，并保存至 `test_output_skill.zip`

### 手动测试清单

- [ ] 加载插件，点击 Capture，浏览页面，确认请求列表更新
- [ ] 点击 Analyze，等待分析完成，确认表单正确渲染参数
- [ ] 修改表格中的描述或 test_value
- [ ] 点击 `+ Add` 新增一行，点击 `×` 删除行
- [ ] 点击 Test API，确认真实请求发出并显示响应
- [ ] 点击 Generate & Download Skill，确认 ZIP 文件触发下载

---

## 依赖变更

```diff
 dependencies:
   cors: ^2.8.5
   dotenv: ^16.4.7
   express: ^4.21.2
+  archiver: ^7.x
```

安装命令：
```bash
cd server && npm install
```
