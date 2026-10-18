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
      error: `无法向 Gemini 页面注入指令 (${err.message})，请刷新 https://gemini.google.com 页面后重试。`,
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
