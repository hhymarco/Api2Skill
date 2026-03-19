# Bug Fix: Failed to parse OpenClaw response

**日期**: 2026-03-19
**影响版本**: OpenClaw 2026.3.13+
**文件**: `server/src/services/openclaw.js`

---

## 现象

在 Chrome 插件中点击 **Analyze** 按钮后，侧边栏显示红色错误提示：

```
Failed to parse OpenClaw response
```

---

## 排查过程

### 1. 定位错误来源

错误信息 `"Failed to parse OpenClaw response"` 在代码中只有一处触发点，即 `openclaw.js` 第 88–91 行：

```js
try {
  data = JSON.parse(stdout);
} catch {
  return reject({ code: 2005, httpStatus: 502, message: 'Failed to parse OpenClaw response' });
}
```

说明 `JSON.parse(stdout)` 抛出了异常，即 `stdout` 不是合法 JSON。

### 2. 验证 openclaw CLI 实际输出

运行以下命令，将 stderr 丢弃，只保留 stdout：

```bash
openclaw agent --message "hello" --json --session-id "test-debug" 2>/dev/null
```

输出如下（节选）：

```
[35m[plugins][39m [36mmemory-lancedb-pro: smart extraction enabled ...[39m
[35m[plugins][39m [36mmemory-lancedb-pro@1.1.0-beta.9: plugin registered ...[39m
[35m[plugins][39m [36mfeishu_chat: Registered feishu_chat, feishu_chat_members[39m
... （多行插件初始化日志）
{
  "runId": "eb5d655a-...",
  "status": "ok",
  "result": { "payloads": [{ "text": "hi!" }] }
}
```

**关键发现**：插件初始化日志（带 ANSI 颜色转义码）**输出到 stdout 而非 stderr**，导致 stdout 是"日志文本 + JSON"的混合内容，直接 `JSON.parse` 必然失败。

---

## 根本原因

OpenClaw 插件系统（`memory-lancedb-pro`、`feishu_*` 等）在初始化时将诊断日志写入 **stdout**，而不是 stderr。

这与常见 CLI 惯例（日志走 stderr，数据走 stdout）相悖。即使传入了 `--json` 标志，这些日志行依然出现在 stdout 的 JSON 内容**之前**，破坏了 JSON 的可解析性。

---

## 改动点

**文件**: `server/src/services/openclaw.js`

```diff
-      // Parse JSON output
+      // Parse JSON output — strip any plugin log lines printed to stdout before the JSON object
       let data;
       try {
-        data = JSON.parse(stdout);
+        const jsonStart = stdout.indexOf('{');
+        if (jsonStart === -1) throw new Error('no JSON object found');
+        data = JSON.parse(stdout.slice(jsonStart));
       } catch {
         return reject({ code: 2005, httpStatus: 502, message: 'Failed to parse OpenClaw response' });
       }
```

**思路**：用 `stdout.indexOf('{')` 找到第一个 `{`，从该位置开始解析，跳过前面所有插件日志行。

---

## 验证

改动后执行以下脚本确认修复生效：

```bash
node -e "
const { execFile } = require('child_process');
execFile('openclaw', ['agent', '--message', 'hi', '--json', '--session-id', 'test-fix'], {
  timeout: 30000, maxBuffer: 10 * 1024 * 1024, env: process.env
}, (err, stdout, stderr) => {
  const jsonStart = stdout.indexOf('{');
  const data = JSON.parse(stdout.slice(jsonStart));
  console.log('status:', data.status);           // ok
  console.log('text:', data.result?.payloads?.[0]?.text);
});
"
```

输出：

```
status: ok
text: Hi! 👋 有什么我可以帮你的吗？
```

---

## 影响范围

- 仅影响 `server/src/services/openclaw.js` 中的 JSON 解析逻辑
- 不影响重试机制、错误码映射、请求验证等其他逻辑
- 对 openclaw 未安装插件的环境（stdout 直接是纯 JSON）同样兼容，因为 `indexOf('{')` 返回 0，`slice(0)` 等同于原始字符串
