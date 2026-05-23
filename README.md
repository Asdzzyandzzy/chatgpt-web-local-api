# ZZY Browser

一个最小可运行的 Electron + Node.js 本地可编程浏览器壳。它打开真实的 `https://chatgpt.com` 页面，并在本机 `127.0.0.1:3123` 暴露 HTTP API，用于控制当前可见网页。

它不会绕过验证码、破解登录或调用非公开接口。你仍然会看到真实浏览器窗口，可以手动登录、处理验证码、切换模型、打开历史对话和进入 Project。

## 安装

```bat
npm.cmd install
```

## 启动

```bat
npm.cmd start
```

第一次启动后，在打开的 Electron 窗口里手动登录 ChatGPT。应用使用 Electron 的持久化 session：`persist:chatgpt`，会保留 Cookie 和登录态。

## Windows curl 注意事项

Windows `cmd` 里不要使用 Linux/macOS 的 `\` 续行。下面这种写法是错的：

```bash
curl -X POST http://127.0.0.1:3123/open-chat \ -H "Content-Type: application/json" \ -d "{\"url\":\"...\"}"
```

在 Windows `cmd` 里，请用一整行：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat -H "Content-Type: application/json" -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

或者用 `^` 续行：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

PowerShell 里可以用反引号续行：

```powershell
curl.exe -X POST http://127.0.0.1:3123/open-chat `
  -H "Content-Type: application/json" `
  -d '{"url":"https://chatgpt.com/c/your-chat-id"}'
```

## API 总览

本地 API 只监听：

```text
http://127.0.0.1:3123
```

| Method | Path | 功能 |
| --- | --- | --- |
| `GET` | `/status` | 查看当前 URL、加载状态、登录状态和当前 ID |
| `GET` | `/ids` | 只返回当前 `chatId`、`projectId`、`projectChatId` |
| `POST` | `/chat` | 向当前页面发送 prompt，并返回最新 assistant 回复 |
| `GET` | `/last` | 读取当前页面最后一条 assistant 回复 |
| `POST` | `/refresh` | 强制刷新当前 ChatGPT 页面 |
| `POST` | `/new-chat` | 新开普通会话 |
| `GET` | `/chats` | 读取当前侧边栏可见的历史 chat |
| `POST` | `/open-chat` | 按 URL 或可见标题打开历史 chat |
| `POST` | `/open-url` | 打开 `https://chatgpt.com/...` URL |
| `GET` | `/projects` | 读取当前页面可见的 Project |
| `POST` | `/open-project` | 按 URL 或可见标题打开 Project |
| `GET` | `/project-chats` | 读取当前 Project 页面里可见的历史 chat |
| `POST` | `/project-chats` | 先打开 Project，再读取其中可见历史 chat |
| `POST` | `/open-project-chat` | 打开 Project 中可见的某条 chat，并从 URL 读取 ID |
| `GET` | `/debug/project-chat-candidates` | 只读诊断 Project chat 卡片 DOM 候选 |
| `POST` | `/new-project` | 尝试通过网页 UI 新建 Project |
| `POST` | `/new-project-chat` | 在当前或指定 Project 里新开 chat |

## 基础调用

查看状态：

```bat
curl.exe http://127.0.0.1:3123/status
```

返回里会包含当前页面 ID 信息：

```json
{
  "url": "https://chatgpt.com/c/your-chat-id",
  "loaded": true,
  "looksLoggedIn": true,
  "ids": {
    "pageType": "chat",
    "chatId": "your-chat-id",
    "projectId": null,
    "projectChatId": null
  }
}
```

只读取当前 ID：

```bat
curl.exe http://127.0.0.1:3123/ids
```

`pageType` 可能是：

- `home`
- `chat`
- `project`
- `project-chat`
- `chatgpt`
- `unknown`

发送消息：

```bat
curl.exe -X POST http://127.0.0.1:3123/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"你好，请用一句话介绍你自己。\"}"
```

`/chat` 的返回也会带当前 URL 和 `ids`。如果你刚 `/new-chat`，ChatGPT 通常会在第一条消息发送后才生成真正的 `chatId`，所以要在 `/chat` 返回里读取新会话 ID。

读取最后一条回复：

```bat
curl.exe http://127.0.0.1:3123/last
```

刷新页面：

```bat
curl.exe -X POST http://127.0.0.1:3123/refresh
```

新开普通会话：

```bat
curl.exe -X POST http://127.0.0.1:3123/new-chat
```

## 历史 Chat

列出当前侧边栏可见的历史 chat：

```bat
curl.exe http://127.0.0.1:3123/chats
```

推荐保存 `/status` 返回的 `url`，以后直接打开。按 URL 打开最稳定：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

也可以按当前可见标题打开：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"Electron browser shell\"}"
```

直接打开任意 ChatGPT URL：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-url ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

为了安全，`/open-url` 只允许打开 `https://chatgpt.com/...`。

`/open-url`、`/open-chat`、`/new-chat` 的返回也会带 `ids`，例如：

```json
{
  "ok": true,
  "method": "loadURL",
  "url": "https://chatgpt.com/c/your-chat-id",
  "ids": {
    "pageType": "chat",
    "chatId": "your-chat-id",
    "projectId": null,
    "projectChatId": null
  }
}
```

## Projects

Projects 相关功能是网页 UI 自动化，比普通 chat 更容易受 ChatGPT 页面改版影响。最稳的方式仍然是保存 Project URL，然后按 URL 打开。

列出当前页面可见的 Project：

```bat
curl.exe http://127.0.0.1:3123/projects
```

按 URL 打开 Project：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/project/your-project-id\"}"
```

按当前可见标题打开 Project：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"My Project\"}"
```

读取当前 Project 页面里可见的历史 chat：

```bat
curl.exe http://127.0.0.1:3123/project-chats
```

这个接口只读取 Project 页面主内容区里的 chat，会排除侧边栏/导航里的全局历史 chat。如果当前页面不是 Project，会返回错误。

先打开指定 Project，再读取其中可见历史 chat：

```bat
curl.exe -X POST http://127.0.0.1:3123/project-chats ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/project/your-project-id\"}"
```

`POST /project-chats` 会先打开 Project，并等待最多 10 秒让 Project 内 chat 列表渲染出来。

如果 Project 页面里的 chat 是卡片而不是普通链接，返回项可能是：

```json
{
  "title": "项目阶段协作",
  "preview": "太简洁了",
  "url": null,
  "chatId": null,
  "projectId": "g-p-...",
  "projectChatId": null,
  "source": "card",
  "needsOpenForId": true,
  "index": 0
}
```

这时要先打开这张卡片，URL 才会暴露 chat id：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"index\":0}"
```

或者按标题打开：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"项目阶段协作\"}"
```

如果你已经知道 chat id，不需要 Project id，直接打开 `/c/{chatId}` 即可：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"chatId\":\"your-chat-id\"}"
```

或直接传完整 URL：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

如果要先打开指定 Project 再打开其中某条 chat：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"projectUrl\":\"https://chatgpt.com/g/g-p-your-project/project\",\"index\":0}"
```

在当前 Project 中新开 chat：

```bat
curl.exe -X POST http://127.0.0.1:3123/new-project-chat
```

这个接口会避免点击全局 New chat。它只会在当前 Project 上下文里使用 Project 专用入口；如果找不到 Project 专用的新聊天入口，会返回错误，而不是退回到普通 chat。

先打开指定 Project，再新开 chat：

```bat
curl.exe -X POST http://127.0.0.1:3123/new-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/project/your-project-id\"}"
```

尝试新建 Project：

```bat
curl.exe -X POST http://127.0.0.1:3123/new-project ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"My New Project\"}"
```

`/new-project` 会尝试点击页面里的 New project/Create project，填写名称，然后点击 Create/Done。这个接口最容易受 UI 改版影响；如果失败，请在可见窗口里手动创建 Project，再用 `/status` 保存 URL。

Project 相关接口也会尽量返回 `ids`。在 Project 内部 chat 页面上，通常会看到：

```json
{
  "pageType": "project-chat",
  "chatId": "chat-id",
  "projectId": "project-id",
  "projectChatId": "chat-id"
}
```

不同 ChatGPT 页面版本的 Project URL 格式可能不同，所以 `projectId` 是从当前 URL 中 best-effort 解析出来的。最稳的记录方式仍然是保存完整 `url`。

当你停在 Project 首页时，`chatId` 和 `projectChatId` 为 `null` 是正常的，因为当前没有打开具体 chat。`projectId` 只能用来打开 Project，不能当成 chat id 使用；直接拿 `projectId` 去打开 chat 会 404。打开 Project 里的某条 chat 后，`/ids` 才会返回对应的 `projectChatId`。

如果你调用 `/new-project-chat` 后还没有发送任何消息，返回里可能还没有 `chatId`。发出第一条 `/chat` 后，再从 `/chat` 返回或 `/ids` 读取新的 Project chat id。

如果 `/project-chats` 识别不准，可以运行只读诊断命令，把返回发给开发者调整选择器。它不会点击、导航或发消息：

```bat
curl.exe http://127.0.0.1:3123/debug/project-chat-candidates
```

## 让其他项目调用

Node.js 示例：

```js
const res = await fetch('http://127.0.0.1:3123/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '请只返回 JSON：{"ok":true,"message":"hello"}' })
});

const data = await res.json();
console.log(data.text);
```

Python 示例：

```python
import requests

res = requests.post(
    "http://127.0.0.1:3123/chat",
    json={"prompt": "请只返回 JSON，不要 Markdown：{\"ok\": true}"}
)

data = res.json()
print(data["text"])
```

## 安全设置

Electron 远程页面配置：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- 没有关闭 `webSecurity`

本地 HTTP API 只绑定 `127.0.0.1`，不会监听局域网地址。

ChatGPT Cookie/session 保存在你本机 Electron 用户数据目录里，不在 Git 仓库里，不会 push 到 GitHub。

## 常见问题

### 选择器失效

ChatGPT 页面结构可能改版。如果出现类似 `Could not find ChatGPT input box`、`No assistant reply found`、`Could not find a visible project`，说明页面选择器可能需要更新。主要逻辑在 `main.js` 的页面自动化脚本里。

### 登录过期

如果 `/status` 返回 `looksLoggedIn: false`，或者窗口显示登录页，请在 Electron 窗口里重新手动登录。

### 验证码

应用不会绕过验证码。遇到验证码时，请在可见的 Electron 窗口中手动完成。

### 历史会话或 Project 找不到

`/chats`、`/projects`、按标题 `/open-chat`、按标题 `/open-project` 只能操作当前页面可见、已经渲染出来的链接。目标不在当前可见范围内时，请手动滚动/展开侧边栏，或者保存 URL 后用 URL 打开。

### 回复超时

`POST /chat` 默认最多等待 120 秒。网络慢、页面卡住、登录状态异常、或 ChatGPT 正在要求人工操作时可能超时。终端日志会显示对应错误。
