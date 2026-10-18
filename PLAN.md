可直接将以下内容全选复制并保存为本地项目根目录下的 `PLAN.md`，然后在 Antigravity 中交给 **Gemini 3.8 Flash** 一键执行落盘。

# `PLAN.md` — `argon-bridge` 零依赖本地与云端双脑桥接系统施工蓝图

## 0. 执行指令（致本地 Antigravity / Gemini 3.8 Flash）

你正在执行首席系统架构师（Gemini 4 Argon）下发的完整工程施工图。请严格按照以下规范完成自动化构建：

1. **零删减落盘**：按本文件中的精确路径创建所有文件，**严禁修改、省略或截断任何一行代码**。

2. **目录结构**：
- `./AGENTS.md`

- `./package.json`

- `./ask_argon.js`

- `./extension/manifest.json`

- `./extension/background.js`

- `./extension/content.js`
3. **初始化与自检**：文件创建完毕后，立即在终端执行第 3 节中的 `npm install` 及连通性自检命令。

## 1. 协作宪章：`AGENTS.md`

请在项目根目录创建 `./AGENTS.md`，完整内容如下：

Markdown

```
# AGENTS.md — 本地与云端双脑协同开发宪章 (Argon-Bridge Protocol)

## 1. 角色定义与职责边界
本项目采用 **“云端架构师 + 本地执行官”** 双模型协同架构：
- **本地执行官 (Gemini 3.8 Flash @ Google Antigravity)**：负责文件读写、代码落盘、终端命令执行、常规 Bug 修复与单元测试验证。
- **首席系统架构师 (Gemini 4 Argon @ Web Browser)**：负责复杂系统架构设计、跨模块重构方案、疑难 Bug 根因诊断及核心算法推演。

## 2. 跨模型通讯工具：`ask_argon.js`
本地已部署 `argon-bridge` 桥接器，可通过 WebSocket (`ws://127.0.0.1:17420`) 直接驱动浏览器中已登录的 Gemini 4 Argon 网页端并获取纯净 Markdown 回复。

### 常用调用方式
1. **直接提问（输出到终端 `stdout`）**：
   ```bash
   node ask_argon.js "请帮我审查当前架构并给出优化方案"
```

2. **直接提问并将架构师回复保存为 `PLAN.md`**：

  Bash

```
node ask_argon.js "请针对以下需求输出完整施工蓝图..." --out PLAN.md
```

3. **读取本地长文档/代码上下文提问（推荐用于复杂上下文）**：

  Bash

```
node ask_argon.js --file context_prompt.md --out PLAN.md
```

4. **自定义超时时间（默认 300000ms 即 5 分钟）**：

  Bash

```
node ask_argon.js --file prompt.md --timeout 600000
```

## 3. 协同触发准则（何时必须请教 Argon）

当本地执行官（Gemini 3.8 Flash）遇到以下任一情况时，**必须暂停盲目试错**，主动组织上下文并运行 `node ask_argon.js` 向 Gemini 4 Argon 请教：

1. **架构级决策**：涉及新建核心模块、引入外部依赖、修改数据流或通信协议。

2. **连续报错熔断**：同一问题尝试修复 **2 次** 仍未通过测试或编译。

3. **复杂逻辑推演**：涉及并发控制、异步状态机、DOM 深度解析或安全边界设计。

## 4. 提问上下文组装规范

向 Argon 提问时，请确保包含以下三要素以获得一次性可执行方案：

- **当前目标**：一句话说明要解决的具体问题。

- **关键上下文**：附上相关的报错堆栈或核心代码片段。

- **输出要求**：明确要求 Argon 输出完整代码或可直接落盘的 `PLAN.md`。

```

---

## 2. 核心源码文件清单

### 2.1 `./package.json`

在项目根目录创建 `./package.json`：

```json
{
  "name": "argon-bridge",
  "version": "1.0.0",
  "description": "Zero-bloat WebSocket bridge connecting local Antigravity CLI (Gemini 3.8 Flash) to logged-in Web Gemini 4 Argon",
  "main": "ask_argon.js",
  "scripts": {
    "ask": "node ask_argon.js",
    "test:ping": "node ask_argon.js \"请回复：Argon Bridge 链路连通测试成功，当前模型运行正常。\""
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "MIT"
}
```

### 2.2 `./ask_argon.js`

在项目根目录创建 `./ask_argon.js`（所有运行日志输出至 `stderr`，确保 `stdout` 仅包含纯净的 Gemini 4 Argon 回复内容）：

JavaScript

```
#!/usr/bin/env node
/**
 * argon-bridge: Local CLI & Transient WebSocket Server
 * Port: 17420 (127.0.0.1)
 * Usage:
 *   node ask_argon.js "Your question here"
 *   node ask_argon.js --file prompt.md
 *   node ask_argon.js --file prompt.md --out PLAN.md
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 17420;
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes

function logInfo(msg) {
  process.stderr.write(`\x1b[36m[Argon-Bridge]\x1b[0m \${msg}\n`);
}

function logSuccess(msg) {
  process.stderr.write(`\x1b[32m[Argon-Bridge]\x1b[0m \${msg}\n`);
}

function logWarn(msg) {
  process.stderr.write(`\x1b[33m[Argon-Bridge]\x1b[0m \${msg}\n`);
}

function logError(msg) {
  process.stderr.write(`\x1b[31m[Argon-Bridge Error]\x1b[0m \${msg}\n`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    prompt: '',
    filePath: null,
    outPath: null,
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' || arg === '-f') {
      config.filePath = args[++i];
    } else if (arg === '--out' || arg === '-o') {
      config.outPath = args[++i];
    } else if (arg === '--port' || arg === '-p') {
      config.port = parseInt(args[++i], 10) || DEFAULT_PORT;
    } else if (arg === '--timeout' || arg === '-t') {
      config.timeoutMs = parseInt(args[++i], 10) || DEFAULT_TIMEOUT_MS;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      positional.push(arg);
    }
  }

  if (config.filePath) {
    const resolvedFile = path.resolve(process.cwd(), config.filePath);
    if (!fs.existsSync(resolvedFile)) {
      logError(`找不到指定的输入文件: \${resolvedFile}`);
      process.exit(1);
    }
    config.prompt = fs.readFileSync(resolvedFile, 'utf8').trim();
  } else if (positional.length > 0) {
    config.prompt = positional.join(' ').trim();
  }

  if (!config.prompt) {
    logError('提问内容不能为空。请提供提问字符串或使用 --file <path> 指定文件。');
    printHelp();
    process.exit(1);
  }

  return config;
}

function printHelp() {
  process.stderr.write(`
用法:
  node ask_argon.js "提问内容"
  node ask_argon.js --file <prompt.md> [--out <PLAN.md>] [--timeout <ms>] [--port <17420>]

参数说明:
  --file, -f     从指定文件读取提问内容
  --out, -o      将 Argon 的回复同时写入指定文件（如 PLAN.md）
  --timeout, -t  超时时间（毫秒，默认 300000）
  --port, -p     本地 WebSocket 监听端口（默认 17420）
  --help, -h     显示帮助信息
`);
}

function main() {
  const config = parseArgs(process.argv);
  const requestId = crypto.randomUUID();
  let promptDispatched = false;
  let isCompleted = false;

  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: config.port,
  });

  const timeoutHandle = setTimeout(() => {
    if (!isCompleted) {
      logError(`等待超时 (\${config.timeoutMs / 1000}s)。请确认：`);
      logError(`1. Chrome 已安装并启用 Argon Bridge 插件；`);
      logError(`2. 已打开 https://gemini.google.com 且处于已登录状态；`);
      logError(`3. 页面右上角状态球显示已连接，或点击状态球上的“立即重连”。`);
      cleanupAndExit(1);
    }
  }, config.timeoutMs);

  function cleanupAndExit(code) {
    isCompleted = true;
    clearTimeout(timeoutHandle);
    try {
      for (const client of wss.clients) {
        try {
          client.close();
        } catch (_) {}
      }
      wss.close(() => {
        process.exit(code);
      });
      setTimeout(() => process.exit(code), 300);
    } catch (_) {
      process.exit(code);
    }
  }

  wss.on('listening', () => {
    logInfo(`本地 WebSocket 服务已启动: ws://127.0.0.1:\${config.port}`);
    logInfo(`请求 ID: \${requestId} | 提问长度: \${config.prompt.length} 字符`);
    logInfo(`正在等待 Chrome 插件连接 (若未自动连接，请点击 Gemini 网页右上角状态球)...`);
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logError(`端口 \${config.port} 已被占用。请等待上一个 ask_argon.js 进程结束，或检查残留进程。`);
    } else {
      logError(`WebSocket Server 异常: \${err.message}`);
    }
    cleanupAndExit(1);
  });

  wss.on('connection', (ws) => {
    logSuccess('Chrome 插件已成功连接！');

    function sendPromptToExtension() {
      if (promptDispatched || isCompleted) return;
      promptDispatched = true;
      logInfo('正在将提问发送至浏览器端 Gemini 4 Argon...');
      ws.send(
        JSON.stringify({
          type: 'ASK_ARGON',
          requestId,
          prompt: config.prompt,
          timestamp: Date.now(),
        })
      );
    }

    // 连接建立后如果收到 HELLO 或 300ms 内未收到均主动下发任务
    const dispatchTimer = setTimeout(() => {
      sendPromptToExtension();
    }, 300);

    ws.on('message', (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString('utf8'));
      } catch (err) {
        logWarn(`收到非 JSON 消息: \${rawData}`);
        return;
      }

      if (msg.type === 'HELLO') {
        clearTimeout(dispatchTimer);
        sendPromptToExtension();
        return;
      }

      if (msg.type === 'STATUS') {
        logInfo(`[浏览器状态] \${msg.status}\${msg.detail ? ' - ' + msg.detail : ''}`);
        return;
      }

      if (msg.type === 'ERROR') {
        logError(`浏览器端执行失败: \${msg.error || '未知错误'}`);
        cleanupAndExit(1);
        return;
      }

      if (msg.type === 'RESPONSE') {
        if (isCompleted) return;
        isCompleted = true;

        const markdown = (msg.markdown || '').trim();
        const source = msg.source || 'unknown';
        logSuccess(`已收到 Gemini 4 Argon 完整回复！(提取方式: \${source}, 长度: \${markdown.length} 字符)`);

        // 发送确认帧
        try {
          ws.send(JSON.stringify({ type: 'ACK', requestId }));
        } catch (_) {}

        // 如果指定了 --out，写入目标文件
        if (config.outPath) {
          const resolvedOut = path.resolve(process.cwd(), config.outPath);
          fs.writeFileSync(resolvedOut, markdown + '\n', 'utf8');
          logSuccess(`回复已成功写入文件: \${resolvedOut}`);
        }

        // 打印纯净 Markdown 到 stdout
        process.stdout.write(markdown + '\n');
        cleanupAndExit(0);
      }
    });

    ws.on('close', () => {
      if (!isCompleted) {
        logWarn('Chrome 插件连接断开，等待重连中...');
        promptDispatched = false;
      }
    });

    ws.on('error', (err) => {
      logWarn(`连接通道异常: \${err.message}`);
    });
  });

  process.on('SIGINT', () => {
    logWarn('收到中断信号 (SIGINT)，正在关闭本地桥接服务...');
    cleanupAndExit(130);
  });

  process.on('SIGTERM', () => {
    cleanupAndExit(143);
  });
}

main();
```

### 2.3 `./extension/manifest.json`

创建 `./extension/manifest.json`（Chrome Extension Manifest V3 规范）：

JSON

```
{
  "manifest_version": 3,
  "name": "Argon Bridge (Antigravity <-> Gemini 4 Argon)",
  "version": "1.0.0",
  "description": "Bridges local CLI / Google Antigravity with logged-in Web Gemini 4 Argon via ws://127.0.0.1:17420",
  "permissions": [
    "tabs",
    "scripting",
    "storage",
    "alarms",
    "clipboardRead",
    "clipboardWrite"
  ],
  "host_permissions": [
    "https://gemini.google.com/*",
    "http://127.0.0.1:17420/*",
    "http://localhost:17420/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "https://gemini.google.com/*"
      ],
      "js": [
        "content.js"
      ],
      "run_at": "document_idle"
    }
  ]
}
```

### 2.4 `./extension/background.js`

创建 `./extension/background.js`。
**架构亮点**：通过与 `content.js` 建立长连接端口 (`argon-keepalive-port`) 结合高频重连轮询，彻底解决 Manifest V3 Service Worker 休眠导致连不上临时本地 WebSocket Server 的痛点。

JavaScript

```
/**
 * Argon Bridge - Manifest V3 Background Service Worker
 * Maintains WebSocket connection to ws://127.0.0.1:17420 and routes payloads
 * between local ask_argon.js CLI and the active Gemini tab's content.js.
 */

const WS_URL = 'ws://127.0.0.1:17420';
const RECONNECT_INTERVAL_MS = 1500;
const ALARM_NAME = 'argon-bridge-reconnect-alarm';

let ws = null;
let isConnecting = false;
let reconnectTimer = null;
const contentPorts = new Map(); // tabId -> Port

function broadcastWsState(state, detail = '') {
  for (const [tabId, port] of contentPorts.entries()) {
    try {
      port.postMessage({
        type: 'BRIDGE_STATE',
        state,
        detail,
        timestamp: Date.now(),
      });
    } catch (_) {
      contentPorts.delete(tabId);
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, RECONNECT_INTERVAL_MS);
}

function connectWebSocket(force = false) {
  if (force && ws) {
    try {
      ws.close();
    } catch (_) {}
    ws = null;
    isConnecting = false;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (isConnecting) return;

  isConnecting = true;

  try {
    const socket = new WebSocket(WS_URL);
    ws = socket;

    socket.onopen = () => {
      isConnecting = false;
      broadcastWsState('CONNECTED', '已连接本地 CLI (17420)');
      try {
        socket.send(
          JSON.stringify({
            type: 'HELLO',
            client: 'argon-bridge-mv3',
            timestamp: Date.now(),
          })
        );
      } catch (_) {}
    };

    socket.onmessage = async (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (data.type === 'ASK_ARGON') {
        broadcastWsState('WORKING', '收到本地提问，正在驱动 Argon...');
        await forwardTaskToGeminiTab(data);
      } else if (data.type === 'ACK') {
        broadcastWsState('CONNECTED', '回复已送达本地 CLI');
      }
    };

    socket.onclose = () => {
      isConnecting = false;
      ws = null;
      broadcastWsState('STANDBY', '待命：等待本地运行 ask_argon.js');
      scheduleReconnect();
    };

    socket.onerror = () => {
      isConnecting = false;
      try {
        socket.close();
      } catch (_) {}
      ws = null;
      scheduleReconnect();
    };
  } catch (err) {
    isConnecting = false;
    ws = null;
    scheduleReconnect();
  }
}

function sendToLocalCli(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (_) {
      return false;
    }
  }
  return false;
}

async function findTargetGeminiTab() {
  // 1. 优先使用已建立长连接且当前激活的 Gemini 标签页
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (!tabs || tabs.length === 0) {
    return null;
  }
  const activeTab = tabs.find((t) => t.active) || tabs[0];
  return activeTab;
}

async function forwardTaskToGeminiTab(taskPayload) {
  const tab = await findTargetGeminiTab();
  if (!tab || !tab.id) {
    sendToLocalCli({
      type: 'ERROR',
      requestId: taskPayload.requestId,
      error: '未找到已打开的 https://gemini.google.com 标签页，请在 Chrome 中打开 Gemini 网页版。',
    });
    return;
  }

  const port = contentPorts.get(tab.id);
  if (port) {
    try {
      port.postMessage(taskPayload);
      return;
    } catch (_) {
      contentPorts.delete(tab.id);
    }
  }

  // Fallback: chrome.tabs.sendMessage
  try {
    await chrome.tabs.sendMessage(tab.id, taskPayload);
  } catch (err) {
    sendToLocalCli({
      type: 'ERROR',
      requestId: taskPayload.requestId,
      error: `无法向 Gemini 页面注入指令 (\${err.message})，请刷新 https://gemini.google.com 页面后重试。`,
    });
  }
}

// 监听来自 content.js 的长连接（同时保持 Service Worker 唤醒状态）
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'argon-keepalive-port') return;

  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
  if (tabId) {
    contentPorts.set(tabId, port);
  }

  // 立即同步当前 WebSocket 状态
  const isConnected = ws && ws.readyState === WebSocket.OPEN;
  port.postMessage({
    type: 'BRIDGE_STATE',
    state: isConnected ? 'CONNECTED' : 'STANDBY',
    detail: isConnected ? '已连接本地 CLI (17420)' : '待命：等待本地运行 ask_argon.js',
    timestamp: Date.now(),
  });

  // 确保连接循环立即激活
  connectWebSocket(false);

  port.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'HEARTBEAT') {
      connectWebSocket(false);
      return;
    }

    if (msg.type === 'FORCE_RECONNECT') {
      broadcastWsState('CONNECTING', '正在手动重连 ws://127.0.0.1:17420...');
      connectWebSocket(true);
      return;
    }

    if (msg.type === 'STATUS' || msg.type === 'RESPONSE' || msg.type === 'ERROR') {
      sendToLocalCli(msg);
      if (msg.type === 'RESPONSE') {
        broadcastWsState('CONNECTED', '回复已发回本地终端');
      } else if (msg.type === 'ERROR') {
        broadcastWsState('ERROR', msg.error || '执行异常');
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId) {
      contentPorts.delete(tabId);
    }
  });
});

// 监听一次性消息作为补充通道
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'FORCE_RECONNECT') {
    connectWebSocket(true);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'STATUS' || msg.type === 'RESPONSE' || msg.type === 'ERROR') {
    sendToLocalCli(msg);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

// 定时闹钟保活兜底
chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    connectWebSocket(false);
  }
});

// 启动时立即尝试连接
connectWebSocket(false);
```

### 2.5 `./extension/content.js`

创建 `./extension/content.js`。
**核心能力**：

1. **右上角高颜值 Shadow DOM 悬浮状态窗**：支持实时显示状态、最近一次任务耗时，以及手动点击“立即连接 :17420”按钮。

2. **双引擎 Markdown 提取**：
- **主引擎（剪贴板拦截器）**：注入页面主世界 (`MAIN` world) 钩子拦截 `navigator.clipboard.writeText`，当自动点击 Gemini 原生“复制”按钮时，即使浏览器处于后台未聚焦状态，也能 100% 截获 Gemini 官方生成的原生纯净 Markdown。

- **副引擎（DOM AST 转 Markdown 解析器）**：若页面结构变化未找到复制按钮，自动遍历模型回复容器并剔除代码块页眉工具栏，还原完整代码块（含语言标识）、标题、表格、列表与加粗格式。

JavaScript

```
/**
 * Argon Bridge - Content Script for https://gemini.google.com/*
 * Responsibilities:
 * 1. Render top-right floating HUD (Shadow DOM) with manual reconnect & status display
 * 2. Keep MV3 background service worker awake via persistent port + heartbeat
 * 3. Locate Gemini rich-textarea, inject prompt, and trigger Send button
 * 4. Detect streaming completion via MutationObserver + stability debounce
 * 5. Extract clean Markdown via Clipboard Write Hook (Copy button) + DOM-to-Markdown fallback
 */

(function () {
  if (window.__ARGON_BRIDGE_INJECTED__) return;
  window.__ARGON_BRIDGE_INJECTED__ = true;

  let bgPort = null;
  let isProcessingTask = false;
  let lastCapturedClipboardText = '';
  let lastCapturedClipboardTime = 0;

  // =========================================================================
  // 1. 注入主世界剪贴板拦截器 (绕过后台标签页 navigator.clipboard.readText 权限限制)
  // =========================================================================
  function injectClipboardInterceptor() {
    try {
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          if (window.__ARGON_CLIPBOARD_HOOKED__) return;
          window.__ARGON_CLIPBOARD_HOOKED__ = true;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
            navigator.clipboard.writeText = async function(text) {
              try {
                window.dispatchEvent(new CustomEvent('__ARGON_CLIPBOARD_CAPTURED__', {
                  detail: { text: String(text || ''), timestamp: Date.now() }
                }));
              } catch (_) {}
              try {
                return await origWriteText(text);
              } catch (_) {
                // 即使后台标签页写入系统剪贴板失败，我们也已经通过 CustomEvent 拿到纯净 Markdown
                return Promise.resolve();
              }
            };
          }
          document.addEventListener('copy', function(e) {
            try {
              const pasted = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
              if (pasted) {
                window.dispatchEvent(new CustomEvent('__ARGON_CLIPBOARD_CAPTURED__', {
                  detail: { text: String(pasted), timestamp: Date.now() }
                }));
              }
            } catch (_) {}
          }, true);
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (_) {}

    window.addEventListener('__ARGON_CLIPBOARD_CAPTURED__', (event) => {
      if (event && event.detail && typeof event.detail.text === 'string') {
        lastCapturedClipboardText = event.detail.text;
        lastCapturedClipboardTime = event.detail.timestamp || Date.now();
      }
    });
  }

  injectClipboardInterceptor();

  // =========================================================================
  // 2. 右上角悬浮状态窗 (Shadow DOM)
  // =========================================================================
  const hudState = {
    host: null,
    dotEl: null,
    titleEl: null,
    detailEl: null,
    reconnectBtn: null,
  };

  function createFloatingHud() {
    if (document.getElementById('argon-bridge-hud-host')) return;

    const host = document.createElement('div');
    host.id = 'argon-bridge-hud-host';
    host.style.cssText = 'position: fixed; top: 14px; right: 18px; z-index: 2147483647; font-family: system-ui, -apple-system, sans-serif;';
    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        .hud-card {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(17, 24, 39, 0.92);
          backdrop-filter: blur(10px);
          color: #f9fafb;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
          font-size: 12px;
          line-height: 1.3;
          transition: all 0.2s ease;
          user-select: none;
        }
        .hud-card:hover {
          border-color: rgba(96, 165, 250, 0.5);
        }
        .status-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #9ca3af;
          flex-shrink: 0;
        }
        .status-dot.STANDBY {
          background: #f59e0b;
          box-shadow: 0 0 8px #f59e0b;
        }
        .status-dot.CONNECTED {
          background: #10b981;
          box-shadow: 0 0 10px #10b981;
        }
        .status-dot.WORKING, .status-dot.CONNECTING {
          background: #3b82f6;
          box-shadow: 0 0 12px #3b82f6;
          animation: pulse 1s infinite alternate;
        }
        .status-dot.ERROR {
          background: #ef4444;
          box-shadow: 0 0 10px #ef4444;
        }
        @keyframes pulse {
          from { transform: scale(0.85); opacity: 0.7; }
          to { transform: scale(1.2); opacity: 1; }
        }
        .text-col {
          display: flex;
          flex-direction: column;
          max-width: 240px;
        }
        .title {
          font-weight: 600;
          color: #ffffff;
          white-space: nowrap;
        }
        .detail {
          font-size: 11px;
          color: #9ca3af;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .btn-reconnect {
          background: rgba(59, 130, 246, 0.2);
          color: #93c5fd;
          border: 1px solid rgba(59, 130, 246, 0.4);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }
        .btn-reconnect:hover {
          background: rgba(59, 130, 246, 0.4);
          color: #ffffff;
        }
      </style>
      <div class="hud-card">
        <span class="status-dot STANDBY" id="dot"></span>
        <div class="text-col">
          <span class="title" id="title">Argon Bridge</span>
          <span class="detail" id="detail">初始化中...</span>
        </div>
        <button class="btn-reconnect" id="reconnectBtn" title="手动触发连接本地 17420 端口">立即连接</button>
      </div>
    `;

    document.documentElement.appendChild(host);

    hudState.host = host;
    hudState.dotEl = shadow.getElementById('dot');
    hudState.titleEl = shadow.getElementById('title');
    hudState.detailEl = shadow.getElementById('detail');
    hudState.reconnectBtn = shadow.getElementById('reconnectBtn');

    hudState.reconnectBtn.addEventListener('click', () => {
      updateHud('CONNECTING', 'Argon Bridge: 重连中', '正在连接 ws://127.0.0.1:17420...');
      if (bgPort) {
        try {
          bgPort.postMessage({ type: 'FORCE_RECONNECT' });
          return;
        } catch (_) {}
      }
      chrome.runtime.sendMessage({ type: 'FORCE_RECONNECT' }).catch(() => {});
    });
  }

  function updateHud(state, titleText, detailText) {
    createFloatingHud();
    if (!hudState.dotEl) return;
    hudState.dotEl.className = `status-dot \${state}`;
    if (titleText) hudState.titleEl.textContent = titleText;
    if (detailText) hudState.detailEl.textContent = detailText;
  }

  // =========================================================================
  // 3. 与 Background Service Worker 建立保活长连接
  // =========================================================================
  function connectToBackground() {
    try {
      bgPort = chrome.runtime.connect({ name: 'argon-keepalive-port' });

      bgPort.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;

        if (msg.type === 'BRIDGE_STATE') {
          if (isProcessingTask && msg.state !== 'ERROR') return;
          const labelMap = {
            STANDBY: 'Argon Bridge: 待命',
            CONNECTED: 'Argon Bridge: 已连接',
            CONNECTING: 'Argon Bridge: 连接中',
            WORKING: 'Argon Bridge: 正在向 Argon 提问...',
            ERROR: 'Argon Bridge: 异常',
          };
          updateHud(msg.state, labelMap[msg.state] || 'Argon Bridge', msg.detail || '');
          return;
        }

        if (msg.type === 'ASK_ARGON') {
          handleAskArgonRequest(msg);
        }
      });

      bgPort.onDisconnect.addListener(() => {
        bgPort = null;
        setTimeout(connectToBackground, 1500);
      });
    } catch (_) {
      setTimeout(connectToBackground, 2000);
    }
  }

  // Fallback message listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'ASK_ARGON') {
      handleAskArgonRequest(msg);
    }
  });

  // 每 10 秒发送一次心跳，确保 MV3 Service Worker 永不休眠且持续轮询本地 CLI
  setInterval(() => {
    if (bgPort) {
      try {
        bgPort.postMessage({ type: 'HEARTBEAT', timestamp: Date.now() });
      } catch (_) {
        connectToBackground();
      }
    } else {
      connectToBackground();
    }
  }, 10000);

  function sendMessageToBackground(payload) {
    if (bgPort) {
      try {
        bgPort.postMessage(payload);
        return;
      } catch (_) {}
    }
    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  function reportStatus(status, detail = '') {
    updateHud('WORKING', `Argon Bridge: \${status}`, detail);
    sendMessageToBackground({
      type: 'STATUS',
      status,
      detail,
      timestamp: Date.now(),
    });
  }

  // =========================================================================
  // 4. DOM 定位、输入注入、流式监控与 Markdown 提取
  // =========================================================================
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function findInputElement() {
    const selectors = [
      'rich-textarea div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return el;
      }
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button.send-button',
      'button[aria-label*="Send message"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]',
      'button[data-test-id="send-button"]',
      '.send-button-container button',
    ];
    for (const sel of selectors) {
      const btns = Array.from(document.querySelectorAll(sel));
      for (const btn of btns) {
        if (btn && btn.offsetParent !== null && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          return btn;
        }
      }
    }
    return null;
  }

  function isStopButtonVisible() {
    const stopSelectors = [
      'button[aria-label*="Stop response"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="停止"]',
      '.stop-icon',
    ];
    for (const sel of stopSelectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        if (el && el.offsetParent !== null) {
          return true;
        }
      }
    }
    return false;
  }

  function getModelResponseElements() {
    const selectors = [
      'model-response',
      'message-content',
      '.model-response-text',
      'div[data-message-author-role="model"]',
    ];
    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel));
      if (nodes.length > 0) {
        return nodes;
      }
    }
    // 兜底选择器
    return Array.from(document.querySelectorAll('.markdown'));
  }

  async function injectPromptAndSend(promptText) {
    const inputEl = findInputElement();
    if (!inputEl) {
      throw new Error('未找到 Gemini 网页版输入框，请确认当前页面已登录并停留在对话界面。');
    }

    inputEl.focus();
    await sleep(100);

    if (inputEl.tagName.toLowerCase() === 'textarea') {
      inputEl.value = promptText;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // 清空原有内容
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

      // 优先使用 insertText 以触发 Angular/Quill 内部状态更新
      const inserted = document.execCommand('insertText', false, promptText);
      if (!inserted || !inputEl.innerText.trim()) {
        inputEl.innerHTML = '';
        const lines = promptText.split('\n');
        for (const line of lines) {
          const p = document.createElement('p');
          p.textContent = line || '\u200B';
          inputEl.appendChild(p);
        }
      }

      inputEl.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: promptText,
        })
      );
    }

    await sleep(350);

    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
    } else {
      // 回车发送兜底
      inputEl.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
    }
  }

  async function waitForGenerationComplete(initialCount, initialLastText, timeoutMs = 280000) {
    const startTime = Date.now();
    let generationStarted = false;
    let lastMutationTime = Date.now();
    let lastObservedText = '';

    const observer = new MutationObserver(() => {
      lastMutationTime = Date.now();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    try {
      while (Date.now() - startTime < timeoutMs) {
        await sleep(500);

        const responses = getModelResponseElements();
        const currentCount = responses.length;
        const latestNode = currentCount > 0 ? responses[currentCount - 1] : null;
        const currentText = latestNode ? (latestNode.innerText || '').trim() : '';
        const stopVisible = isStopButtonVisible();

        if (!generationStarted) {
          if (
            currentCount > initialCount ||
            stopVisible ||
            (currentText && currentText !== initialLastText)
          ) {
            generationStarted = true;
            lastMutationTime = Date.now();
            reportStatus('Argon 思考与输出中...', '已检测到流式响应');
          }
          continue;
        }

        if (currentText !== lastObservedText) {
          lastObservedText = currentText;
          lastMutationTime = Date.now();
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          reportStatus('正在接收流式输出...', `已生成 \${currentText.length} 字符 (\${elapsedSec}s)`);
        }

        // 判断流式输出完成的条件：
        // 1. 停止按钮已消失 (!stopVisible)
        // 2. 最新回复非空 (currentText.length > 0)
        // 3. DOM 内容已稳定静止超过 2600ms
        const quietDuration = Date.now() - lastMutationTime;
        if (!stopVisible && currentText.length > 0 && quietDuration >= 2600) {
          // 二次确认：再等待 600ms 确保没有后续段落跳出
          await sleep(600);
          if (!isStopButtonVisible()) {
            return latestNode;
          }
        }
      }
      throw new Error('等待 Gemini 4 Argon 生成回复超时。');
    } finally {
      observer.disconnect();
    }
  }

  function findCopyButtonForResponse(responseNode) {
    if (!responseNode) return null;

    // 在当前 model-response 内部或父级容器查找“复制”按钮
    const scopes = [
      responseNode,
      responseNode.closest('model-response'),
      responseNode.parentElement,
      responseNode.parentElement ? responseNode.parentElement.parentElement : null,
    ].filter(Boolean);

    const copySelectors = [
      'button[data-test-id="copy-button"]',
      'button[aria-label*="Copy response"]',
      'button[aria-label*="Copy"]',
      'button[aria-label*="复制"]',
      'button[mattooltip*="Copy"]',
      'button[mattooltip*="复制"]',
    ];

    for (const scope of scopes) {
      for (const sel of copySelectors) {
        const btns = Array.from(scope.querySelectorAll(sel));
        // 排除代码块内部的“复制代码”按钮，确保点击的是整条回答底部的复制按钮
        const validBtns = btns.filter((b) => !b.closest('pre') && !b.closest('code-block'));
        if (validBtns.length > 0) {
          return validBtns[validBtns.length - 1];
        }
      }
    }
    return null;
  }

  /**
   * 高保真 DOM 转 Markdown 转换器（当复制按钮不可用时的强力兜底）
   */
  function convertDomNodeToMarkdown(rootNode) {
    if (!rootNode) return '';

    const container =
      rootNode.querySelector('.markdown') ||
      rootNode.querySelector('message-content') ||
      rootNode;

    const clone = container.cloneNode(true);

    // 移除代码块顶部自带的语言栏与“复制代码”按钮，防止污染代码块内容
    const noiseSelectors = [
      '.code-block-decoration',
      '.code-header',
      'button',
      'mat-icon',
      'script',
      'style',
    ];
    for (const sel of noiseSelectors) {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue || '';
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }

      const tag = node.tagName.toLowerCase();

      // 处理代码块
      if (tag === 'pre') {
        const codeEl = node.querySelector('code');
        let lang = '';
        if (codeEl && codeEl.className) {
          const match = codeEl.className.match(/language-([a-zA-Z0-9_-]+)/);
          if (match) lang = match[1];
        }
        const rawCode = (codeEl ? codeEl.textContent : node.textContent) || '';
        return `\n\`\`\`${lang}\n${rawCode.replace(/\n+\$/, '')}\n\`\`\`\n\n`;
      }

      if (tag === 'code' && (!node.parentElement || node.parentElement.tagName.toLowerCase() !== 'pre')) {
        return `\`\${node.textContent || ''}\``;
      }

      // 处理标题
      if (/^h[1-6]\$/.test(tag)) {
        const level = parseInt(tag.slice(1), 10);
        const hashes = '#'.repeat(level);
        return `\n\${hashes} \${ getChildrenText(node).trim() }\n\n`;
      }

      if (tag === 'p') {
        return `\${getChildrenText(node).trim()}\n\n`;
      }

      if (tag === 'br') {
        return '\n';
      }

      if (tag === 'hr') {
        return '\n---\n\n';
      }

      if (tag === 'strong' || tag === 'b') {
        return `**\${getChildrenText(node)}**`;
      }

      if (tag === 'em' || tag === 'i') {
        return `*\${getChildrenText(node)}*`;
      }

      if (tag === 'blockquote') {
        const lines = getChildrenText(node).trim().split('\n');
        return '\n' + lines.map((l) => `> \${l}`).join('\n') + '\n\n';
      }

      if (tag === 'ul') {
        let out = '\n';
        Array.from(node.children).forEach((li) => {
          if (li.tagName && li.tagName.toLowerCase() === 'li') {
            out += `- \${getChildrenText(li).trim()}\n`;
          }
        });
        return out + '\n';
      }

      if (tag === 'ol') {
        let out = '\n';
        let index = 1;
        Array.from(node.children).forEach((li) => {
          if (li.tagName && li.tagName.toLowerCase() === 'li') {
            out += `${index++}. ${getChildrenText(li).trim()}\n`;
          }
        });
        return out + '\n';
      }

      if (tag === 'table') {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (rows.length === 0) return '';
        const matrix = rows.map((tr) =>
          Array.from(tr.querySelectorAll('th, td')).map((cell) =>
            getChildrenText(cell).replace(/\s+/g, ' ').trim()
          )
        );
        if (matrix.length === 0 || matrix[0].length === 0) return '';
        let mdTable = '\n| ' + matrix[0].join(' | ') + ' |\n';
        mdTable += '| ' + matrix[0].map(() => '---').join(' | ') + ' |\n';
        for (let i = 1; i < matrix.length; i++) {
          mdTable += '| ' + matrix[i].join(' | ') + ' |\n';
        }
        return mdTable + '\n';
      }

      return getChildrenText(node);
    }

    function getChildrenText(el) {
      let result = '';
      for (const child of el.childNodes) {
        result += walk(child);
      }
      return result;
    }

    return walk(clone)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function extractCleanMarkdown(responseNode) {
    // 方案 A：点击整条回复的“复制”按钮，通过剪贴板拦截器捕获官方原生 Markdown
    const copyBtn = findCopyButtonForResponse(responseNode);
    if (copyBtn) {
      const beforeClickTime = Date.now();
      lastCapturedClipboardText = '';
      copyBtn.click();
      await sleep(350);

      if (lastCapturedClipboardText && lastCapturedClipboardTime >= beforeClickTime) {
        return {
          markdown: lastCapturedClipboardText.trim(),
          source: 'clipboard-interceptor',
        };
      }

      // 尝试直接读取剪贴板（当页面恰好处于激活状态时）
      try {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim().length > 0) {
          return {
            markdown: clipText.trim(),
            source: 'navigator-clipboard',
          };
        }
      } catch (_) {}
    }

    // 方案 B：使用内置高保真 DOM-to-Markdown 转换器
    const domMarkdown = convertDomNodeToMarkdown(responseNode);
    if (domMarkdown && domMarkdown.length > 0) {
      return {
        markdown: domMarkdown,
        source: 'dom-markdown-serializer',
      };
    }

    // 方案 C：纯文本兜底
    return {
      markdown: (responseNode ? responseNode.innerText : '').trim(),
      source: 'innerText-fallback',
    };
  }

  async function handleAskArgonRequest(task) {
    if (isProcessingTask) {
      sendMessageToBackground({
        type: 'ERROR',
        requestId: task.requestId,
        error: '当前已有正在执行的 Argon 提问任务，请稍候重试。',
      });
      return;
    }

    isProcessingTask = true;
    try {
      reportStatus('正在向 Argon 提问...', `Request ID: \${task.requestId.slice(0, 8)}`);

      const existingResponses = getModelResponseElements();
      const initialCount = existingResponses.length;
      const initialLastText =
        initialCount > 0 ? (existingResponses[initialCount - 1].innerText || '').trim() : '';

      await injectPromptAndSend(task.prompt);
      reportStatus('已发送提问', '等待 Gemini 4 Argon 开始生成...');

      const latestResponseNode = await waitForGenerationComplete(initialCount, initialLastText);
      reportStatus('生成完毕', '正在提取纯净 Markdown...');

      const { markdown, source } = await extractCleanMarkdown(latestResponseNode);

      if (!markdown) {
        throw new Error('提取到的回复内容为空。');
      }

      sendMessageToBackground({
        type: 'RESPONSE',
        requestId: task.requestId,
        markdown,
        source,
        timestamp: Date.now(),
      });

      updateHud('CONNECTED', 'Argon Bridge: 已完成', `已回传 \${markdown.length} 字符 (\${source})`);
    } catch (err) {
      updateHud('ERROR', 'Argon Bridge: 执行失败', err.message || '未知错误');
      sendMessageToBackground({
        type: 'ERROR',
        requestId: task.requestId,
        error: err.message || String(err),
      });
    } finally {
      isProcessingTask = false;
    }
  }

  // 初始化悬浮窗与后台连接
  createFloatingHud();
  connectToBackground();
})();
```

## 3. 本地安装依赖与连通性测试命令

当上述 6 个文件全部创建完毕后，请依次执行以下步骤完成部署与端到端链路验收：

### 第一步：安装本地 Node.js 依赖

在项目根目录终端执行：

Bash

```
npm install
```

### 第二步：在 Chrome 浏览器中加载插件（一次性操作）

1. 打开 Chrome 浏览器，在地址栏输入 `chrome://extensions/` 并回车。

2. 打开右上角的 **“开发者模式 (Developer mode)”** 开关。

3. 点击左上角的 **“加载已解压的扩展程序 (Load unpacked)”**，选择本项目下的 `extension/` 文件夹。

4. 打开或刷新 `[https://gemini.google.com/](https://gemini.google.com/)`（确保已登录并切换至 **Gemini 4 Argon** 模型），此时页面右上角会出现 **“Argon Bridge: 待命”** 悬浮状态窗。

### 第三步：终端测试双脑连通性

在本地终端（或 Antigravity 终端）运行以下命令：

Bash

```
# 方式 1：直接通过命令行发送测试提问
node ask_argon.js "请用一句话确认收到来自本地 Antigravity 的请求，并附带一段简单的 Hello World 代码块。"

# 方式 2：测试将 Argon 的完整回复直接写入本地 PLAN.md
node ask_argon.js "请输出一个包含 Markdown 标题、表格和代码块的标准测试回复。" --out PLAN.md
```

> **排障提示**：如果在运行 `node ask_argon.js` 时浏览器刚启动，你也可以直接点击 `[https://gemini.google.com/](https://gemini.google.com/)` 页面右上角悬浮球上的 **“立即连接”** 按钮，插件将在毫秒级内完成握手并自动开始提问。
