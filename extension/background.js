/**
 * Argon Bridge v2.0 - Background Service Worker & Stateful Session Router
 * Handles:
 * 1. Persistent WebSocket link to ws://127.0.0.1:17420
 * 2. 1:1 Project-to-Chat Tab Routing (multi-tab matching or single-tab URL switching)
 * 3. Pending task buffering across full-page navigations
 */

const WS_URL = 'ws://127.0.0.1:17420';
const RECONNECT_INTERVAL_MS = 1500;
const ALARM_NAME = 'argon-bridge-reconnect-alarm';

let ws = null;
let isConnecting = false;
let reconnectTimer = null;
const contentPorts = new Map(); // tabId -> Port

// 当触发页面 URL 跳转切流时，暂存待执行的提问任务，等待目标页面 content.js 就绪后立刻投递
let pendingNavigationTask = null; // { tabId, taskPayload, createdAt }

function extractChatIdFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  const match = urlStr.match(/gemini\.google\.com\/(?:u\/\d+\/)?app\/([a-zA-Z0-9_-]+)/);
  return match && match[1] ? match[1] : null;
}

function isCleanNewChatUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return /gemini\.google\.com\/(?:u\/\d+\/)?app\/?(?:\?.*)?$/.test(urlStr);
}

function broadcastWsState(state, detail = '', projectInfo = null) {
  for (const [tabId, port] of contentPorts.entries()) {
    try {
      port.postMessage({
        type: 'BRIDGE_STATE',
        state,
        detail,
        projectInfo,
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
            client: 'argon-bridge-mv3-v2',
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
        await routeAndExecuteTask(data);
      } else if (data.type === 'ACK') {
        broadcastWsState('CONNECTED', `已完成 [${data.projectName || '项目'}] 回复同步`);
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
  } catch (_) {
    isConnecting = false;
    ws = null;
    scheduleReconnect();
  }
}

/**
 * 核心 1:1 会话路由器：
 * 根据 taskPayload 中的 chatId / forceNewChat 决定直接投递还是切流跳转
 */
async function routeAndExecuteTask(taskPayload) {
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (!tabs || tabs.length === 0) {
    sendToLocalCli({
      type: 'ERROR',
      requestId: taskPayload.requestId,
      error: '未找到已打开的 https://gemini.google.com 标签页，请在 Chrome 中打开 Gemini 网页版。',
    });
    return;
  }

  const targetChatId = taskPayload.forceNewChat ? null : taskPayload.chatId;
  const projectLabel = taskPayload.projectName || '未命名项目';

  // 情况 1：该项目已绑定专属 chatId
  if (targetChatId) {
    // 1a. 检查是否已经有打开的标签页正好停留在该 chatId
    const matchedTab = tabs.find((t) => extractChatIdFromUrl(t.url) === targetChatId);
    if (matchedTab && matchedTab.id) {
      sendToLocalCli({
        type: 'STATUS',
        status: `已命中项目 [${projectLabel}] 的专属会话标签页`,
        detail: `chatId: ${targetChatId}`,
      });
      await dispatchTaskToTab(matchedTab.id, taskPayload);
      return;
    }

    // 1b. 没有现成匹配的标签页 -> 选择当前激活（或第一个）Gemini 标签页，自动切流跳转到目标专属会话 URL
    const tabToSwitch = tabs.find((t) => t.active) || tabs[0];
    const targetUrl = `https://gemini.google.com/app/${targetChatId}`;

    sendToLocalCli({
      type: 'STATUS',
      status: `正在为项目 [${projectLabel}] 自动切流至专属会话...`,
      detail: targetUrl,
    });

    pendingNavigationTask = {
      tabId: tabToSwitch.id,
      taskPayload,
      createdAt: Date.now(),
    };

    await chrome.tabs.update(tabToSwitch.id, { url: targetUrl });
    return;
  }

  // 情况 2：新项目首次提问 或 显式指定 --new-chat
  const activeTab = tabs.find((t) => t.active) || tabs[0];

  // 如果当前标签页已经是干净的 /app 新会话页且没有强制刷新需求，先交由 content.js 判断或直接新建
  if (isCleanNewChatUrl(activeTab.url) && !taskPayload.forceNewChat) {
    sendToLocalCli({
      type: 'STATUS',
      status: `正在为项目 [${projectLabel}] 初始化专属新会话...`,
      detail: 'https://gemini.google.com/app',
    });
    await dispatchTaskToTab(activeTab.id, taskPayload);
    return;
  }

  // 否则驱动标签页跳转到干净的 https://gemini.google.com/app 开启全新会话
  sendToLocalCli({
    type: 'STATUS',
    status: `正在为项目 [${projectLabel}] 切换至全新 Gemini 会话窗口...`,
    detail: 'https://gemini.google.com/app',
  });

  pendingNavigationTask = {
    tabId: activeTab.id,
    taskPayload,
    createdAt: Date.now(),
  };

  await chrome.tabs.update(activeTab.id, { url: 'https://gemini.google.com/app' });
}

async function dispatchTaskToTab(tabId, taskPayload) {
  const port = contentPorts.get(tabId);
  if (port) {
    try {
      port.postMessage(taskPayload);
      return;
    } catch (_) {
      contentPorts.delete(tabId);
    }
  }

  try {
    await chrome.tabs.sendMessage(tabId, taskPayload);
  } catch (err) {
    sendToLocalCli({
      type: 'ERROR',
      requestId: taskPayload.requestId,
      error: `无法向目标 Gemini 标签页投递任务 (${err.message})，请确认页面已加载完成。`,
    });
  }
}

// 监听来自 content.js 的长连接
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'argon-keepalive-port') return;

  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
  if (tabId) {
    contentPorts.set(tabId, port);
  }

  const isConnected = ws && ws.readyState === WebSocket.OPEN;
  port.postMessage({
    type: 'BRIDGE_STATE',
    state: isConnected ? 'CONNECTED' : 'STANDBY',
    detail: isConnected ? '已连接本地 CLI (17420)' : '待命：等待本地运行 ask_argon.js',
    timestamp: Date.now(),
  });

  connectWebSocket(false);

  // 检查该 tabId 是否有因切流跳转而挂起的提问任务
  if (tabId && pendingNavigationTask && pendingNavigationTask.tabId === tabId) {
    const taskToRun = pendingNavigationTask.taskPayload;
    pendingNavigationTask = null;
    setTimeout(() => {
      dispatchTaskToTab(tabId, taskToRun);
    }, 600);
  }

  port.onMessage.addListener(async (msg) => {
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

    if (msg.type === 'STATUS' || msg.type === 'ERROR') {
      sendToLocalCli(msg);
      return;
    }

    if (msg.type === 'RESPONSE') {
      // 将项目与会话映射同步备份至 chrome.storage.local
      if (msg.projectKey && msg.chatId) {
        try {
          const store = await chrome.storage.local.get(['argonSessions']);
          const sessions = store.argonSessions || {};
          sessions[msg.projectKey] = {
            projectName: msg.projectName,
            chatId: msg.chatId,
            chatUrl: msg.chatUrl,
            updatedAt: Date.now(),
          };
          await chrome.storage.local.set({ argonSessions: sessions });
        } catch (_) {}
      }
      sendToLocalCli(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId) {
      contentPorts.delete(tabId);
    }
  });
});

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

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    connectWebSocket(false);
  }
});

connectWebSocket(false);
