# ZZY Browser

ZZY Browser is a tiny Electron shell around the real ChatGPT website. It keeps the browser window visible, stores your local login session, and exposes a small `127.0.0.1` HTTP API so other local programs can ask the page to do things.

This is not an unofficial ChatGPT backend client. It does not bypass login, CAPTCHA, rate limits, or any security flow. If ChatGPT asks you to log in, solve a CAPTCHA, pick a model, or confirm something, you do that in the visible window like normal.

<details>
<summary><strong>中文说明 / Click to show Chinese</strong></summary>

ZZY Browser 是一个很小的 Electron 壳，里面打开的是真实的 ChatGPT 网页。它保留可见浏览器窗口、保存你本机登录态，并在 `127.0.0.1` 暴露一个本地 HTTP API，方便其他本地程序驱动这个页面。

它不是非官方 ChatGPT 后端客户端，也不会绕过登录、验证码、限制或任何安全流程。如果 ChatGPT 要你登录、处理验证码、切模型或确认弹窗，你还是在可见窗口里手动完成。

</details>

## Install

```bat
npm.cmd install
```

## Run

```bat
npm.cmd start
```

The first time it opens, log in to ChatGPT manually in the Electron window. The app uses Electron's persistent session partition, so cookies and login state stay on your own machine.

<details>
<summary><strong>中文：安装和启动</strong></summary>

安装：

```bat
npm.cmd install
```

启动：

```bat
npm.cmd start
```

第一次启动后，在 Electron 窗口里手动登录 ChatGPT。登录态会保存在你本机的 Electron 持久化 session 里，不会提交到 GitHub。

</details>

## Windows curl tip

In Windows `cmd`, do not use the Linux/macOS `\` line continuation style. This is wrong:

```bash
curl -X POST http://127.0.0.1:3123/open-chat \ -H "Content-Type: application/json" \ -d "{\"url\":\"...\"}"
```

Use one line:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat -H "Content-Type: application/json" -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

Or use `^` in Windows `cmd`:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

PowerShell uses backticks:

```powershell
curl.exe -X POST http://127.0.0.1:3123/open-chat `
  -H "Content-Type: application/json" `
  -d '{"url":"https://chatgpt.com/c/your-chat-id"}'
```

<details>
<summary><strong>中文：Windows curl 别踩坑</strong></summary>

Windows `cmd` 里不要用 Linux/macOS 的 `\` 续行。要么写成一整行，要么用 `^` 续行。PowerShell 里用反引号。

</details>

## API

The server listens only on:

```text
http://127.0.0.1:3123
```

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/status` | Current URL, load state, login guess, and parsed IDs |
| `GET` | `/ids` | Only the current `chatId`, `projectId`, and `projectChatId` |
| `POST` | `/chat` | Send a prompt to the current page and return the latest answer |
| `GET` | `/last` | Read the last assistant message on the page |
| `POST` | `/refresh` | Hard reload the current ChatGPT page |
| `POST` | `/new-chat` | Start a normal new chat |
| `GET` | `/chats` | Read visible chat history links |
| `POST` | `/open-chat` | Open a visible chat by title, or open a saved chat URL |
| `POST` | `/open-url` | Open a `https://chatgpt.com/...` URL |
| `GET` | `/projects` | Read visible Projects |
| `POST` | `/open-project` | Open a Project by URL or visible title |
| `GET` | `/project-chats` | Read visible chats inside the current Project page |
| `POST` | `/project-chats` | Open a Project first, then read visible chats inside it |
| `POST` | `/open-project-chat` | Open a Project chat by URL, chat ID, title, or index |
| `GET` | `/debug/project-chat-candidates` | Read-only DOM diagnostics for Project chat cards |
| `POST` | `/new-project` | Best-effort Project creation through the web UI |
| `POST` | `/new-project-chat` | Best-effort new chat inside the current or given Project |

<details>
<summary><strong>中文：API 总览</strong></summary>

本地服务只监听：

```text
http://127.0.0.1:3123
```

常用接口：

- `GET /status`：当前 URL、加载状态、登录状态和解析出来的 ID
- `GET /ids`：只返回当前 `chatId`、`projectId`、`projectChatId`
- `POST /chat`：向当前页面发送 prompt，并返回最新回复
- `GET /last`：读取最后一条 assistant 回复
- `POST /refresh`：强制刷新页面
- `POST /new-chat`：新建普通 chat
- `GET /chats`：读取可见历史 chat
- `POST /open-chat`：打开历史 chat
- `GET /projects`：读取可见 Project
- `POST /open-project`：打开 Project
- `GET /project-chats`：读取当前 Project 里的可见 chat
- `POST /open-project-chat`：打开 Project 里的某条 chat

</details>

## Everyday commands

Check where the page is:

```bat
curl.exe http://127.0.0.1:3123/status
```

Send a message:

```bat
curl.exe -X POST http://127.0.0.1:3123/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"Say hello in one sentence.\"}"
```

Read the last answer:

```bat
curl.exe http://127.0.0.1:3123/last
```

Refresh when the page feels stuck:

```bat
curl.exe -X POST http://127.0.0.1:3123/refresh
```

Start a clean normal chat:

```bat
curl.exe -X POST http://127.0.0.1:3123/new-chat
```

## IDs

`/status`, `/ids`, `/chat`, `/open-url`, `/open-chat`, and the Project helpers try to return parsed IDs:

```json
{
  "pageType": "project-chat",
  "chatId": "68faa820-8f40-8322-b5c2-14a704892d13",
  "projectId": "g-p-69192d2e28e88191afb123fe7d3c16fb-stat",
  "projectChatId": "68faa820-8f40-8322-b5c2-14a704892d13"
}
```

A Project page itself has a `projectId` but no `chatId`. That is normal. A Project chat still opens as a ChatGPT chat URL, usually something like:

```text
https://chatgpt.com/g/g-p-your-project/c/your-chat-id
```

Do not use `projectId` as a chat ID. It will 404.

## Chats

List visible normal chats:

```bat
curl.exe http://127.0.0.1:3123/chats
```

Open by URL:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

Open by visible title:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"Some chat title\"}"
```

## Projects

List visible Projects:

```bat
curl.exe http://127.0.0.1:3123/projects
```

Open a Project:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"stat\"}"
```

Read visible chats inside the current Project:

```bat
curl.exe http://127.0.0.1:3123/project-chats
```

Project chat links can be nested under the Project path, for example:

```text
https://chatgpt.com/g/g-p-.../c/68faa820-8f40-8322-b5c2-14a704892d13
```

Open a Project chat by the URL returned from `/project-chats`:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/g/g-p-your-project/c/your-chat-id\"}"
```

Open by `chatId` if you already know it:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"chatId\":\"your-chat-id\"}"
```

Open by visible card index or title:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"index\":0}"
```

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"项目阶段1协作\"}"
```

If `/project-chats` looks wrong, run the read-only diagnostic endpoint. It does not click, navigate, or send messages:

```bat
curl.exe http://127.0.0.1:3123/debug/project-chat-candidates
```

<details>
<summary><strong>中文：Project 使用方式</strong></summary>

Project 首页只有 `projectId`，没有 `chatId`。只有打开 Project 里的具体 chat 后，才会有 `projectChatId`。

读取当前 Project 里的可见 chat：

```bat
curl.exe http://127.0.0.1:3123/project-chats
```

打开返回的 Project chat URL：

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://chatgpt.com/g/g-p-your-project/c/your-chat-id\"}"
```

如果你已经知道 `chatId`，也可以直接传 `chatId`。不要拿 `projectId` 当 chat id 用。

</details>

## Calling it from another project

Node.js:

```js
const res = await fetch('http://127.0.0.1:3123/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Return only JSON: {"ok":true}' })
});

const data = await res.json();
console.log(data.text);
```

Python:

```python
import requests

res = requests.post(
    "http://127.0.0.1:3123/chat",
    json={"prompt": "Return only JSON: {\"ok\": true}"}
)

print(res.json()["text"])
```

## Notes from the trenches

- This project drives a real web page. If ChatGPT changes the DOM, a selector may break.
- URLs are more reliable than titles. Save URLs when you can.
- New chats often do not get a real `chatId` until after the first message is sent.
- Project chats are still chats. Once you have the `/c/{chatId}` URL, opening that URL is the reliable path.
- Cookies and login state live in your local Electron app data, not in this repository.
- The local API binds to `127.0.0.1` only.

## Security posture

The remote ChatGPT page runs with:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- default web security still enabled

The app does local, user-visible page automation. It does not try to bypass auth, CAPTCHA, or ChatGPT product limits.
