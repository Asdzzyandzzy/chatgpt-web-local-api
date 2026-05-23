# ZZY Browser

一个最小可运行的 Electron + Node.js 本地可编程浏览器壳。它打开真实的 `https://chatgpt.com` 页面，并在本机 `127.0.0.1:3123` 暴露 HTTP API，用于把 prompt 输入到页面、发送、读取最新回复。

它不会绕过验证码、破解登录或调用非公开接口。你仍然会看到真实浏览器窗口，可以手动登录、处理验证码、切换模型和调整页面状态。

## 安装

```bash
npm install
```

## 启动

```bash
npm start
```

第一次启动后，在打开的 Electron 窗口里手动登录 ChatGPT。应用使用 Electron 的持久化 session：`persist:chatgpt`，会保留 Cookie 和登录态。

## API

本地 API 只监听：

```text
http://127.0.0.1:3123
```

### 查看状态

```bash
curl http://127.0.0.1:3123/status
```

返回示例：

```json
{
  "url": "https://chatgpt.com/",
  "loaded": true,
  "looksLoggedIn": true
}
```

### 发送消息

```bash
curl -X POST http://127.0.0.1:3123/chat \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"你好，请用一句话介绍你自己。\"}"
```

返回示例：

```json
{
  "text": "你好，我是 ChatGPT，可以帮助你写作、编程、分析问题和整理信息。",
  "length": 37,
  "sendMethod": "button"
}
```

`POST /chat` 会：

1. 查找输入框，优先尝试 `textarea`、`contenteditable`、`.ProseMirror`、`#prompt-textarea`。
2. 写入 prompt。
3. 优先点击发送按钮，找不到按钮时尝试回车发送。
4. 等待 assistant 回复完成，最多等待 120 秒。
5. 返回最新 assistant 回复文本。

### 读取最后一条回复

```bash
curl http://127.0.0.1:3123/last
```

优先读取：

```css
[data-message-author-role="assistant"]
```

如果找不到，会尝试少量可读消息区域作为 fallback。仍然找不到时会返回清晰错误。

## 安全设置

Electron 远程页面配置：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- 没有关闭 `webSecurity`

本地 HTTP API 只绑定 `127.0.0.1`，不会监听局域网地址。

## 日志

启动后终端会打印：

- 每次 API 调用
- 页面加载状态
- 是否成功发送
- 读取到的回复长度
- 错误信息

## 常见问题

### 选择器失效

ChatGPT 页面结构可能改版。如果出现类似 `Could not find ChatGPT input box` 或 `No assistant reply found`，说明输入框或回复区域选择器可能需要更新。主要逻辑在 `main.js` 的页面自动化脚本里。

### 登录过期

如果 `/status` 返回 `looksLoggedIn: false`，或者窗口显示登录页，请在 Electron 窗口里重新手动登录。

### 验证码

应用不会绕过验证码。遇到验证码时，请在可见的 Electron 窗口中手动完成。

### 页面改版或模型切换

这是本地用户可见网页自动化，不是稳定的官方 API。页面改版、模型菜单变化、发送按钮变化都可能导致自动化失败。你可以先在窗口中手动调整到目标模型或新会话，再调用本地 API。

### 回复超时

`POST /chat` 默认最多等待 120 秒。网络慢、页面卡住、登录状态异常、或 ChatGPT 正在要求人工操作时可能超时。终端日志会显示对应错误。
