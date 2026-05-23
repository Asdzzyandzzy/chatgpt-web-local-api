const { app, BrowserWindow, Menu, session } = require('electron');
const http = require('node:http');

const CHATGPT_URL = 'https://chatgpt.com';
const HOST = '127.0.0.1';
const PORT = 3123;
const REQUEST_TIMEOUT_MS = 120_000;

let mainWindow;
let isPageLoaded = false;
let apiServer;

function log(message, extra = '') {
  const suffix = extra ? ` ${extra}` : '';
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
}

function createWindow() {
  const chatSession = session.fromPartition('persist:chatgpt');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'ZZY Browser - ChatGPT',
    webPreferences: {
      session: chatSession,
      preload: `${__dirname}/preload.js`,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    isPageLoaded = true;
    log('Page loaded', mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on('did-start-loading', () => {
    isPageLoaded = false;
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    log('Page failed to load', `${code} ${description} ${url}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(CHATGPT_URL);
}

function ensureWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Browser window is not available.');
  }
  return mainWindow;
}

function reloadMainWindow(ignoreCache = false) {
  const win = ensureWindow();
  isPageLoaded = false;

  if (ignoreCache) {
    win.webContents.reloadIgnoringCache();
  } else {
    win.webContents.reload();
  }

  return win.webContents.getURL();
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload ChatGPT',
          accelerator: 'CommandOrControl+R',
          click: () => {
            const url = reloadMainWindow(false);
            log('Menu reload requested', url);
          }
        },
        {
          label: 'Hard Reload ChatGPT',
          accelerator: 'CommandOrControl+Shift+R',
          click: () => {
            const url = reloadMainWindow(true);
            log('Menu hard reload requested', url);
          }
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function runInPage(source, ...args) {
  const win = ensureWindow();
  const serializedArgs = JSON.stringify(args);
  return win.webContents.executeJavaScript(`(${source})(...${serializedArgs})`, true);
}

function getAutomationScript() {
  return async function automation(action, payload) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const textOf = (el) => {
      if (!el) return '';
      return (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
    };

    const findComposer = () => {
      const candidates = [
        ...document.querySelectorAll('textarea'),
        ...document.querySelectorAll('[contenteditable="true"]'),
        ...document.querySelectorAll('.ProseMirror'),
        ...document.querySelectorAll('#prompt-textarea')
      ];

      const usable = candidates.filter((el) => {
        if (!visible(el)) return false;
        const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
        const readonly = el.readOnly || el.getAttribute('readonly') !== null;
        return !disabled && !readonly;
      });

      return usable.find((el) => {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const cls = (el.className || '').toString().toLowerCase();
        return aria.includes('message') ||
          aria.includes('prompt') ||
          placeholder.includes('message') ||
          placeholder.includes('prompt') ||
          id.includes('prompt') ||
          cls.includes('prosemirror');
      }) || usable[usable.length - 1] || null;
    };

    const getAssistantMessages = () => {
      const preferred = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      if (preferred.length) return preferred;

      const fallbacks = [
        ...document.querySelectorAll('[data-testid*="conversation-turn"]'),
        ...document.querySelectorAll('article'),
        ...document.querySelectorAll('main [class*="markdown"]')
      ];

      return fallbacks.filter((el) => {
        const text = textOf(el);
        return text.length > 0 && !/you said|user/i.test(el.getAttribute('aria-label') || '');
      });
    };

    const getLastAssistantText = () => {
      const messages = getAssistantMessages();
      const last = messages[messages.length - 1];
      return textOf(last);
    };

    const looksGenerating = () => {
      const busy = document.querySelector('[aria-busy="true"], [data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"]');
      if (busy && visible(busy)) return true;

      const mainText = textOf(document.body).toLowerCase();
      return mainText.includes('stop generating') || mainText.includes('停止生成');
    };

    const setComposerValue = (el, value) => {
      el.focus();

      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
        setter ? setter.call(el, value) : (el.value = value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    };

    const sendComposer = (el) => {
      const submitButton = [...document.querySelectorAll('button')].find((button) => {
        if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
        const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.dataset.testid || ''}`.toLowerCase();
        return label.includes('send') || label.includes('submit') || label.includes('发送');
      });

      if (submitButton) {
        submitButton.click();
        return 'button';
      }

      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      return 'enter';
    };

    const waitForComposer = async (timeoutMs) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const composer = findComposer();
        if (composer) return true;
        await sleep(250);
      }

      return false;
    };

    const clickNewChat = () => {
      const selectors = [
        'a[href="/"]',
        'a[href="/?model=auto"]',
        '[data-testid="create-new-chat-button"]',
        '[aria-label*="New chat"]',
        '[aria-label*="新聊天"]'
      ];

      for (const selector of selectors) {
        const el = [...document.querySelectorAll(selector)].find(visible);
        if (el) {
          el.click();
          return selector;
        }
      }

      const button = [...document.querySelectorAll('a, button')].find((el) => {
        if (!visible(el)) return false;
        const label = `${textOf(el)} ${el.getAttribute('aria-label') || ''} ${el.title || ''}`.toLowerCase();
        return label.includes('new chat') || label.includes('新聊天');
      });

      if (button) {
        button.click();
        return 'text-match';
      }

      return null;
    };

    const waitForStableAssistant = async (previousText, timeoutMs) => {
      const startedAt = Date.now();
      let lastText = '';
      let lastChangedAt = Date.now();
      let sawNewText = false;

      while (Date.now() - startedAt < timeoutMs) {
        const current = getLastAssistantText();
        const currentIsNew = current && current !== previousText;

        if (currentIsNew && current !== lastText) {
          lastText = current;
          lastChangedAt = Date.now();
          sawNewText = true;
        }

        const stableForMs = Date.now() - lastChangedAt;
        if (sawNewText && !looksGenerating() && stableForMs >= 2000) {
          return lastText;
        }

        if (sawNewText && stableForMs >= 4000) {
          return lastText;
        }

        await sleep(250);
      }

      throw new Error(`Timed out waiting for assistant reply after ${timeoutMs}ms.`);
    };

    const looksLoggedIn = () => {
      if (findComposer()) return true;
      const body = textOf(document.body).toLowerCase();
      if (body.includes('log in') || body.includes('sign up') || body.includes('登录')) return false;
      return location.hostname.includes('chatgpt.com') && getAssistantMessages().length > 0;
    };

    if (action === 'status') {
      return {
        url: location.href,
        loaded: document.readyState === 'complete' || document.readyState === 'interactive',
        looksLoggedIn: looksLoggedIn()
      };
    }

    if (action === 'last') {
      const text = getLastAssistantText();
      if (!text) {
        throw new Error('No assistant reply found. Expected [data-message-author-role="assistant"] or readable fallback messages.');
      }
      return { text, length: text.length };
    }

    if (action === 'chat') {
      const prompt = payload?.prompt;
      const timeoutMs = payload?.timeoutMs || 120000;

      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Request body must include a non-empty string field: prompt.');
      }

      const composer = findComposer();
      if (!composer) {
        throw new Error('Could not find ChatGPT input box. Tried textarea, contenteditable, ProseMirror, and #prompt-textarea.');
      }

      const before = getLastAssistantText();
      setComposerValue(composer, prompt);
      await sleep(100);
      const sendMethod = sendComposer(composer);
      const reply = await waitForStableAssistant(before, timeoutMs);

      return {
        text: reply,
        length: reply.length,
        sendMethod
      };
    }

    if (action === 'newChat') {
      const timeoutMs = payload?.timeoutMs || 120000;
      const clicked = clickNewChat();

      if (!clicked) {
        return {
          ok: false,
          needsNavigationFallback: true,
          message: 'Could not find New chat button. Tried href, data-testid, aria-label, and visible button text.'
        };
      }

      await sleep(500);
      const composerReady = await waitForComposer(timeoutMs);
      if (!composerReady) {
        throw new Error(`Clicked New chat (${clicked}), but composer was not ready after ${timeoutMs}ms.`);
      }

      return {
        ok: true,
        method: clicked,
        url: location.href
      };
    }

    throw new Error(`Unknown page automation action: ${action}`);
  };
}

async function getStatus() {
  const win = ensureWindow();
  const pageStatus = await runInPage(getAutomationScript().toString(), 'status', {});
  return {
    url: win.webContents.getURL(),
    loaded: isPageLoaded && pageStatus.loaded,
    looksLoggedIn: pageStatus.looksLoggedIn
  };
}

async function getLastReply() {
  return runInPage(getAutomationScript().toString(), 'last', {});
}

async function sendChat(prompt) {
  return runInPage(getAutomationScript().toString(), 'chat', {
    prompt,
    timeoutMs: REQUEST_TIMEOUT_MS
  });
}

async function createNewChat() {
  const result = await runInPage(getAutomationScript().toString(), 'newChat', {
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  if (result.needsNavigationFallback) {
    const win = ensureWindow();
    isPageLoaded = false;
    await win.loadURL(CHATGPT_URL);
    return {
      ok: true,
      method: 'loadURL',
      url: win.webContents.getURL(),
      note: result.message
    };
  }

  return result;
}

function refreshPage() {
  const url = reloadMainWindow(true);
  return {
    ok: true,
    url,
    message: 'Refresh requested.'
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function startApiServer() {
  apiServer = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    log('API call', `${req.method} ${url.pathname}`);

    try {
      if (req.method === 'GET' && url.pathname === '/status') {
        const status = await getStatus();
        sendJson(res, 200, status);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/last') {
        const result = await getLastReply();
        log('Read last reply', `length=${result.length}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/chat') {
        const body = await readJsonBody(req);
        const result = await sendChat(body.prompt);
        log('Chat sent', `method=${result.sendMethod} replyLength=${result.length}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/refresh') {
        const result = refreshPage();
        log('Refresh requested', result.url);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/new-chat') {
        const result = await createNewChat();
        log('New chat requested', `method=${result.method} url=${result.url}`);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, {
        error: 'Not found',
        endpoints: ['GET /status', 'GET /last', 'POST /chat', 'POST /refresh', 'POST /new-chat']
      });
    } catch (error) {
      log('API error', error.message);
      sendJson(res, 500, {
        error: error.message,
        elapsedMs: Date.now() - startedAt
      });
    }
  });

  apiServer.requestTimeout = REQUEST_TIMEOUT_MS + 10_000;
  apiServer.headersTimeout = REQUEST_TIMEOUT_MS + 15_000;

  apiServer.listen(PORT, HOST, () => {
    log('Local API listening', `http://${HOST}:${PORT}`);
  });
}

app.whenReady().then(() => {
  createMenu();
  createWindow();
  startApiServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (apiServer) {
    apiServer.close();
  }
});
