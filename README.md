# ChatGPT Web Local API

Turn the logged-in ChatGPT web app into a local HTTP API service.

This project opens the real `chatgpt.com` page in Electron, keeps that browser window visible, preserves your local login session, and exposes `http://127.0.0.1:3123` so scripts on your machine can send prompts, read replies, open chats, and work with Projects.

It is deliberately boring: no hidden browser engine, no login bypass, no CAPTCHA tricks, no private ChatGPT endpoints. If the page asks for human action, you handle it in the window.

## Install

```bat
npm.cmd install
```

## Run

```bat
npm.cmd start
```

On first launch, sign in to ChatGPT in the Electron window. Cookies and session data stay in Electron's local app data, not in this repo.

## Windows curl note

In Windows `cmd`, do not use the Unix `\` line continuation style.

Wrong:

```bash
curl -X POST http://127.0.0.1:3123/open-chat \ -H "Content-Type: application/json" \ -d "{\"url\":\"...\"}"
```

Use one line:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-chat -H "Content-Type: application/json" -d "{\"url\":\"https://chatgpt.com/c/your-chat-id\"}"
```

Or use `^`:

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

## API

The server listens only on:

```text
http://127.0.0.1:3123
```

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/status` | Current URL, load state, login guess, and parsed IDs |
| `GET` | `/ids` | Current `chatId`, `projectId`, and `projectChatId` |
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

## Daily use

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

Refresh a stuck page:

```bat
curl.exe -X POST http://127.0.0.1:3123/refresh
```

Start a new normal chat:

```bat
curl.exe -X POST http://127.0.0.1:3123/new-chat
```

## IDs

Several endpoints return parsed IDs:

```json
{
  "pageType": "project-chat",
  "chatId": "68faa820-8f40-8322-b5c2-14a704892d13",
  "projectId": "g-p-69192d2e28e88191afb123fe7d3c16fb-stat",
  "projectChatId": "68faa820-8f40-8322-b5c2-14a704892d13"
}
```

A Project home page has a `projectId` but no `chatId`. That is expected. A Project chat is still a ChatGPT chat, usually under a URL like:

```text
https://chatgpt.com/g/g-p-your-project/c/your-chat-id
```

Do not use `projectId` as a chat ID. It will 404.

## Chats

List visible chats:

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

Open a Project chat by URL:

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

Open by visible card index:

```bat
curl.exe -X POST http://127.0.0.1:3123/open-project-chat ^
  -H "Content-Type: application/json" ^
  -d "{\"index\":0}"
```

If `/project-chats` looks off, inspect candidates without clicking anything:

```bat
curl.exe http://127.0.0.1:3123/debug/project-chat-candidates
```

## From another program

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

## Practical notes

- URLs are more reliable than titles. Save URLs when you can.
- New chats often do not get a real `chatId` until after the first message.
- Project chats are still chats. Once you have a `/c/{chatId}` URL, opening that URL is the reliable path.
- This drives a real web page. If ChatGPT changes the DOM, selectors may need adjustment.
- The local API binds to `127.0.0.1` only.

## Security

The remote ChatGPT page runs with:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- default web security still enabled

Login data lives in your local Electron app data. It is not committed to GitHub.
