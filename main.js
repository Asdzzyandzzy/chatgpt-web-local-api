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

    const normalizeChatUrl = (href) => {
      try {
        const url = new URL(href, location.origin);
        if (url.hostname !== 'chatgpt.com') return null;
        if (!url.pathname.startsWith('/c/')) return null;
        return url.href;
      } catch (_error) {
        return null;
      }
    };

    const chatIdFromUrl = (href) => {
      const url = normalizeChatUrl(href);
      if (!url) return null;
      return new URL(url).pathname.split('/').filter(Boolean)[1] || null;
    };

    const getVisibleChats = () => {
      const seen = new Set();
      const chats = [];

      for (const link of document.querySelectorAll('a[href]')) {
        const url = normalizeChatUrl(link.getAttribute('href'));
        if (!url || seen.has(url) || !visible(link)) continue;

        const title = textOf(link);
        if (!title) continue;

        seen.add(url);
        chats.push({ title, url, chatId: chatIdFromUrl(url) });
      }

      return chats;
    };

    const openChatByTitle = (title) => {
      const needle = String(title || '').trim().toLowerCase();
      if (!needle) return null;

      const chats = getVisibleChats();
      const exact = chats.find((chat) => chat.title.toLowerCase() === needle);
      const partial = chats.find((chat) => chat.title.toLowerCase().includes(needle));
      const match = exact || partial;
      if (!match) return null;

      const link = [...document.querySelectorAll('a[href]')].find((el) => {
        const url = normalizeChatUrl(el.getAttribute('href'));
        return url === match.url && visible(el);
      });

      if (!link) return null;
      link.click();
      return match;
    };

    const normalizeProjectUrl = (href) => {
      try {
        const url = new URL(href, location.origin);
        if (url.hostname !== 'chatgpt.com') return null;

        const path = url.pathname.toLowerCase();
        const raw = `${url.pathname}${url.search}`.toLowerCase();
        const looksProject =
          path.startsWith('/project') ||
          path.includes('/project/') ||
          path.startsWith('/g/g-p-') ||
          raw.includes('project');

        if (!looksProject) return null;
        return url.href;
      } catch (_error) {
        return null;
      }
    };

    const projectIdFromUrl = (href) => {
      const url = normalizeProjectUrl(href);
      if (!url) return null;

      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const gProject = parts.find((part) => part.startsWith('g-p-'));
      if (gProject) return gProject;

      const projectIndex = parts.findIndex((part) => part.toLowerCase().startsWith('project'));
      if (projectIndex >= 0 && parts[projectIndex + 1]) return parts[projectIndex + 1];

      const projectParam = parsed.searchParams.get('project') || parsed.searchParams.get('projectId');
      return projectParam || null;
    };

    const getVisibleProjects = () => {
      const seen = new Set();
      const projects = [];

      for (const link of document.querySelectorAll('a[href]')) {
        const url = normalizeProjectUrl(link.getAttribute('href'));
        if (!url || seen.has(url) || !visible(link)) continue;

        const title = textOf(link);
        if (!title) continue;

        seen.add(url);
        projects.push({ title, url, projectId: projectIdFromUrl(url) });
      }

      return projects;
    };

    const openProjectByTitle = (title) => {
      const needle = String(title || '').trim().toLowerCase();
      if (!needle) return null;

      const projects = getVisibleProjects();
      const exact = projects.find((project) => project.title.toLowerCase() === needle);
      const partial = projects.find((project) => project.title.toLowerCase().includes(needle));
      const match = exact || partial;
      if (!match) return null;

      const link = [...document.querySelectorAll('a[href]')].find((el) => {
        const url = normalizeProjectUrl(el.getAttribute('href'));
        return url === match.url && visible(el);
      });

      if (!link) return null;
      link.click();
      return match;
    };

    const getCurrentProject = () => {
      const currentUrl = normalizeProjectUrl(location.href);
      if (!currentUrl) return null;

      const matchingProject = getVisibleProjects().find((project) => project.url === currentUrl);
      return {
        title: matchingProject?.title || document.title || '',
        url: currentUrl,
        projectId: projectIdFromUrl(currentUrl)
      };
    };

    const getProjectScopedChats = () => {
      const project = getCurrentProject();
      if (!project?.projectId) {
        return {
          project,
          chats: [],
          error: 'Current page does not look like a Project. Open a Project first or pass { url } / { title }.'
        };
      }

      const roots = [
        document.querySelector('main'),
        document.querySelector('[role="main"]')
      ].filter(Boolean);
      const scanRoots = roots.length ? roots : [document.body];
      const seen = new Set();
      const scoped = [];
      const fallback = [];

      for (const root of scanRoots) {
        for (const link of root.querySelectorAll('a[href]')) {
          const url = normalizeChatUrl(link.getAttribute('href'));
          if (!url || seen.has(url) || !visible(link)) continue;
          if (link.closest('nav') || link.closest('aside')) continue;

          const title = textOf(link);
          if (!title) continue;

          const lowerUrl = url.toLowerCase();
          const chat = {
            title,
            url,
            chatId: chatIdFromUrl(url),
            projectId: project.projectId,
            projectChatId: chatIdFromUrl(url)
          };

          seen.add(url);

          if (lowerUrl.includes(project.projectId.toLowerCase()) || lowerUrl.includes('project')) {
            scoped.push(chat);
          } else {
            fallback.push(chat);
          }
        }
      }

      return {
        project,
        chats: scoped.length ? scoped : fallback
      };
    };

    const clickNewProjectChat = () => {
      const project = getCurrentProject();
      if (!project?.projectId) {
        return {
          ok: false,
          notInProject: true,
          message: 'Current page does not look like a Project. Open a Project first or pass { url } / { title }.'
        };
      }

      const currentChatId = chatIdFromUrl(location.href);
      if (!currentChatId && findComposer()) {
        return {
          ok: true,
          method: 'project-composer-already-ready',
          url: location.href,
          project
        };
      }

      const roots = [
        document.querySelector('main'),
        document.querySelector('[role="main"]'),
        document.body
      ].filter(Boolean);

      for (const root of roots) {
        const rootIsMain = root.tagName === 'MAIN' || root.getAttribute('role') === 'main';
        const candidates = [...root.querySelectorAll('a[href], button')].filter((el) => {
          if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

          const href = el.getAttribute('href') || '';
          let normalizedHref = '';
          try {
            normalizedHref = href ? new URL(href, location.origin).href : '';
          } catch (_error) {
            normalizedHref = '';
          }
          const label = `${textOf(el)} ${el.getAttribute('aria-label') || ''} ${el.title || ''} ${el.dataset.testid || ''}`.toLowerCase();

          if (href === '/' || href === '/?model=auto') return false;
          if (el.closest('nav') || el.closest('aside')) return false;

          const mentionsChat = label.includes('new chat') ||
            label.includes('start chat') ||
            label.includes('new conversation') ||
            label.includes('chat') ||
            label.includes('新聊天');
          const mentionsProject = label.includes('project') ||
            label.includes('项目') ||
            rootIsMain ||
            normalizedHref.toLowerCase().includes(project.projectId.toLowerCase()) ||
            normalizedHref.toLowerCase().includes('project');

          return mentionsChat && mentionsProject;
        });

        if (candidates.length) {
          candidates[0].click();
          return {
            ok: true,
            method: 'project-scoped-button',
            url: location.href,
            project
          };
        }
      }

      return {
        ok: false,
        notFound: true,
        message: 'Could not find a Project-scoped New chat button. I avoided the global New chat because it leaves the Project.'
      };
    };

    const clickNewProject = () => {
      const selectors = [
        '[data-testid*="new-project"]',
        '[data-testid*="create-project"]',
        '[aria-label*="New project"]',
        '[aria-label*="Create project"]',
        '[aria-label*="新项目"]',
        '[aria-label*="创建项目"]'
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
        return label.includes('new project') ||
          label.includes('create project') ||
          label.includes('新项目') ||
          label.includes('创建项目');
      });

      if (button) {
        button.click();
        return 'text-match';
      }

      return null;
    };

    const findDialogTextInput = () => {
      const dialog = document.querySelector('[role="dialog"]') || document.body;
      const candidates = [
        ...dialog.querySelectorAll('input[type="text"]'),
        ...dialog.querySelectorAll('textarea'),
        ...dialog.querySelectorAll('[contenteditable="true"]')
      ];

      return candidates.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') || null;
    };

    const clickCreateProjectSubmit = () => {
      const dialog = document.querySelector('[role="dialog"]') || document.body;
      const button = [...dialog.querySelectorAll('button')].find((el) => {
        if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const label = `${textOf(el)} ${el.getAttribute('aria-label') || ''} ${el.title || ''}`.toLowerCase();
        return label.includes('create') || label.includes('done') || label.includes('创建') || label.includes('完成');
      });

      if (!button) return false;
      button.click();
      return true;
    };

    const createProject = async (name, timeoutMs) => {
      const clicked = clickNewProject();
      if (!clicked) {
        return {
          ok: false,
          notFound: true,
          message: 'Could not find New project/Create project button. Try opening or expanding the Projects area manually.'
        };
      }

      await sleep(500);
      const input = findDialogTextInput();
      if (!input) {
        throw new Error(`Clicked New project (${clicked}), but could not find a visible project name input.`);
      }

      setComposerValue(input, name);
      await sleep(200);

      if (!clickCreateProjectSubmit()) {
        throw new Error('Could not find enabled Create/Done button in the project dialog.');
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const project = getCurrentProject();
        if (project) {
          return {
            ok: true,
            method: clicked,
            project
          };
        }
        await sleep(500);
      }

      throw new Error(`Project was submitted, but no project page was detected after ${timeoutMs}ms.`);
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

    if (action === 'listChats') {
      return {
        chats: getVisibleChats()
      };
    }

    if (action === 'openChat') {
      const title = payload?.title;
      const timeoutMs = payload?.timeoutMs || 120000;
      const match = openChatByTitle(title);

      if (!match) {
        return {
          ok: false,
          notFound: true,
          message: 'Could not find a visible chat with that title. Try /chats first, or use /open-url with a saved chat URL.'
        };
      }

      await sleep(500);
      const composerReady = await waitForComposer(timeoutMs);
      if (!composerReady) {
        throw new Error(`Opened chat "${match.title}", but composer was not ready after ${timeoutMs}ms.`);
      }

      return {
        ok: true,
        method: 'title',
        title: match.title,
        url: match.url
      };
    }

    if (action === 'listProjects') {
      return {
        projects: getVisibleProjects()
      };
    }

    if (action === 'openProject') {
      const title = payload?.title;
      const timeoutMs = payload?.timeoutMs || 120000;
      const match = openProjectByTitle(title);

      if (!match) {
        return {
          ok: false,
          notFound: true,
          message: 'Could not find a visible project with that title. Try /projects first, expand the Projects area, or use /open-url with a saved project URL.'
        };
      }

      await sleep(500);
      const composerReady = await waitForComposer(timeoutMs);

      return {
        ok: true,
        method: 'title',
        title: match.title,
        url: match.url,
        composerReady
      };
    }

    if (action === 'listProjectChats') {
      const timeoutMs = payload?.timeoutMs ?? 0;
      const startedAt = Date.now();
      let result = getProjectScopedChats();

      while (!result.error && result.chats.length === 0 && Date.now() - startedAt < timeoutMs) {
        await sleep(500);
        result = getProjectScopedChats();
      }

      return result;
    }

    if (action === 'newProjectChat') {
      const timeoutMs = payload?.timeoutMs || 120000;
      const result = clickNewProjectChat();

      if (!result.ok) return result;

      await sleep(500);
      const composerReady = await waitForComposer(timeoutMs);
      if (!composerReady) {
        throw new Error(`Project new chat action (${result.method}) did not produce a ready composer after ${timeoutMs}ms.`);
      }

      return {
        ...result,
        url: location.href,
        project: getCurrentProject() || result.project
      };
    }

    if (action === 'newProject') {
      const name = payload?.name;
      const timeoutMs = payload?.timeoutMs || 120000;

      if (!name || typeof name !== 'string') {
        throw new Error('Request body must include a non-empty string field: name.');
      }

      return createProject(name, timeoutMs);
    }

    throw new Error(`Unknown page automation action: ${action}`);
  };
}

async function getStatus() {
  const win = ensureWindow();
  const pageStatus = await runInPage(getAutomationScript().toString(), 'status', {});
  const url = win.webContents.getURL();
  return {
    url,
    loaded: isPageLoaded && pageStatus.loaded,
    looksLoggedIn: pageStatus.looksLoggedIn,
    ids: parseChatGptLocation(url)
  };
}

function getCurrentIds() {
  return parseChatGptLocation(ensureWindow().webContents.getURL());
}

async function getLastReply() {
  const result = await runInPage(getAutomationScript().toString(), 'last', {});
  const url = ensureWindow().webContents.getURL();
  return {
    ...result,
    url,
    ids: parseChatGptLocation(url)
  };
}

async function sendChat(prompt) {
  const result = await runInPage(getAutomationScript().toString(), 'chat', {
    prompt,
    timeoutMs: REQUEST_TIMEOUT_MS
  });
  const url = ensureWindow().webContents.getURL();
  return {
    ...result,
    url,
    ids: parseChatGptLocation(url)
  };
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
      ...withIds({
        ok: true,
        method: 'loadURL',
        url: win.webContents.getURL(),
        note: result.message
      })
    };
  }

  return withIds(result);
}

function validateChatGptUrl(rawUrl) {
  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    throw new Error('url must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'chatgpt.com') {
    throw new Error('url must start with https://chatgpt.com/.');
  }

  return parsed.href;
}

function parseChatGptLocation(rawUrl) {
  const empty = {
    pageType: 'unknown',
    chatId: null,
    projectId: null,
    projectChatId: null
  };

  if (!rawUrl) return empty;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    return empty;
  }

  if (parsed.hostname !== 'chatgpt.com') return empty;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const lowerParts = parts.map((part) => part.toLowerCase());
  const chatIndex = lowerParts.indexOf('c');
  const chatId = chatIndex >= 0 ? parts[chatIndex + 1] || null : null;

  const gProjectId = parts.find((part) => part.startsWith('g-p-')) || null;
  const projectIndex = lowerParts.findIndex((part) => part === 'project' || part === 'projects');
  const pathProjectId = projectIndex >= 0 ? parts[projectIndex + 1] || null : null;
  const projectId = gProjectId ||
    pathProjectId ||
    parsed.searchParams.get('project') ||
    parsed.searchParams.get('projectId') ||
    null;

  const pageType = projectId && chatId ? 'project-chat' :
    projectId ? 'project' :
      chatId ? 'chat' :
        parsed.pathname === '/' ? 'home' : 'chatgpt';

  return {
    pageType,
    chatId,
    projectId,
    projectChatId: projectId && chatId ? chatId : null
  };
}

function withIds(payload, rawUrl = payload?.url) {
  return {
    ...payload,
    ids: parseChatGptLocation(rawUrl)
  };
}

async function openUrl(rawUrl) {
  const url = validateChatGptUrl(rawUrl);
  const win = ensureWindow();
  isPageLoaded = false;
  await win.loadURL(url);

  return {
    ok: true,
    method: 'loadURL',
    url: win.webContents.getURL(),
    ids: parseChatGptLocation(win.webContents.getURL())
  };
}

async function listChats() {
  return runInPage(getAutomationScript().toString(), 'listChats', {});
}

async function openChat(body) {
  if (body.url) {
    return openUrl(body.url);
  }

  if (!body.title) {
    throw new Error('Request body must include either url or title.');
  }

  const result = await runInPage(getAutomationScript().toString(), 'openChat', {
    title: body.title,
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  if (result.notFound) {
    throw new Error(result.message);
  }

  return withIds(result);
}

async function listProjects() {
  return runInPage(getAutomationScript().toString(), 'listProjects', {});
}

async function openProject(body) {
  if (body.url) {
    return openUrl(body.url);
  }

  if (!body.title) {
    throw new Error('Request body must include either url or title.');
  }

  const result = await runInPage(getAutomationScript().toString(), 'openProject', {
    title: body.title,
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  if (result.notFound) {
    throw new Error(result.message);
  }

  return withIds(result);
}

async function listProjectChats(body = {}) {
  const shouldWait = Boolean(body.url || body.title);
  if (body.url || body.title) {
    await openProject(body);
  }

  const result = await runInPage(getAutomationScript().toString(), 'listProjectChats', {
    timeoutMs: shouldWait ? 10000 : 0
  });
  if (result.error) {
    throw new Error(result.error);
  }

  return {
    ...result,
    ids: parseChatGptLocation(result.project?.url || ensureWindow().webContents.getURL())
  };
}

async function createNewProject(body) {
  const result = await runInPage(getAutomationScript().toString(), 'newProject', {
    name: body.name,
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  if (result.notFound) {
    throw new Error(result.message);
  }

  return {
    ...result,
    ids: parseChatGptLocation(result.project?.url)
  };
}

async function createNewProjectChat(body = {}) {
  let project = null;

  if (body.url || body.title) {
    project = await openProject(body);
  }

  const chat = await runInPage(getAutomationScript().toString(), 'newProjectChat', {
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  if (chat.notInProject || chat.notFound) {
    throw new Error(chat.message);
  }

  const chatWithIds = withIds(chat);

  return {
    ok: true,
    project,
    chat: chatWithIds,
    ids: {
      projectId: project?.ids?.projectId || chatWithIds.ids.projectId || chatWithIds.project?.projectId || null,
      chatId: chatWithIds.ids.chatId || null,
      projectChatId: chatWithIds.ids.projectChatId || null,
      pageType: chatWithIds.ids.pageType || 'unknown'
    }
  };
}

function refreshPage() {
  const url = reloadMainWindow(true);
  return {
    ok: true,
    url,
    ids: parseChatGptLocation(url),
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

      if (req.method === 'GET' && url.pathname === '/ids') {
        const ids = getCurrentIds();
        sendJson(res, 200, ids);
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

      if (req.method === 'POST' && url.pathname === '/open-url') {
        const body = await readJsonBody(req);
        const result = await openUrl(body.url);
        log('Open URL requested', result.url);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/chats') {
        const result = await listChats();
        log('Listed visible chats', `count=${result.chats.length}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/open-chat') {
        const body = await readJsonBody(req);
        const result = await openChat(body);
        log('Open chat requested', `method=${result.method} url=${result.url}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/projects') {
        const result = await listProjects();
        log('Listed visible projects', `count=${result.projects.length}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/open-project') {
        const body = await readJsonBody(req);
        const result = await openProject(body);
        log('Open project requested', `method=${result.method} url=${result.url}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/project-chats') {
        const result = await listProjectChats();
        log('Listed visible project chats', `count=${result.chats.length}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/project-chats') {
        const body = await readJsonBody(req);
        const result = await listProjectChats(body);
        log('Listed visible project chats', `count=${result.chats.length}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/new-project') {
        const body = await readJsonBody(req);
        const result = await createNewProject(body);
        log('New project requested', `name=${body.name}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/new-project-chat') {
        const body = await readJsonBody(req);
        const result = await createNewProjectChat(body);
        log('New project chat requested', `project=${body.url || body.title || 'current'}`);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, {
        error: 'Not found',
        endpoints: [
          'GET /status',
          'GET /ids',
          'GET /last',
          'GET /chats',
          'GET /projects',
          'GET /project-chats',
          'POST /chat',
          'POST /refresh',
          'POST /new-chat',
          'POST /open-url',
          'POST /open-chat',
          'POST /open-project',
          'POST /project-chats',
          'POST /new-project',
          'POST /new-project-chat'
        ]
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
