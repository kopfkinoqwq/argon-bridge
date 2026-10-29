/**
 * Argon Bridge v2.3.6 - Content Script for https://gemini.google.com/*
 * Features:
 * 1. Top-right HUD displaying connection state + active [Project <-> Chat ID] badge
 * 2. Automatic waiting for rich-textarea readiness after session switching
 * 3. In-page "New Chat" trigger if needed + URL Chat ID harvesting (/app/<chatId>)
 * 4. Dual-engine clean Markdown extraction (Clipboard hook + DOM serializer)
 */

(function () {
  if (window.__ARGON_BRIDGE_INJECTED__) return;
  window.__ARGON_BRIDGE_INJECTED__ = true;

  let bgPort = null;
  let isProcessingTask = false;
  let lastCapturedClipboardText = '';
  let lastCapturedClipboardTime = 0;

  function getCurrentChatIdFromUrl() {
    const match = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/);
    return match && match[1] ? match[1] : null;
  }

  // =========================================================================
  // 1. 注入主世界剪贴板拦截器
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
  // 2. 右上角悬浮状态窗 (含当前绑定项目与 Chat ID 显示)
  // =========================================================================
  const hudState = {
    host: null,
    dotEl: null,
    titleEl: null,
    badgeEl: null,
    detailEl: null,
    newChatBtn: null,
    reconnectBtn: null,
  };

  function createFloatingHud() {
    if (document.getElementById('argon-bridge-hud-host')) return;

    const host = document.createElement('div');
    host.id = 'argon-bridge-hud-host';
    host.style.cssText =
      'position: fixed; top: 14px; right: 18px; z-index: 2147483647; font-family: system-ui, -apple-system, sans-serif;';
    const shadow = host.attachShadow({ mode: 'open' });

    const initialChatId = getCurrentChatIdFromUrl();

    shadow.innerHTML = `
      <style>
        .hud-card {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(17, 24, 39, 0.94);
          backdrop-filter: blur(10px);
          color: #f9fafb;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
          font-size: 12px;
          line-height: 1.3;
          user-select: none;
        }
        .status-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #9ca3af;
          flex-shrink: 0;
        }
        .status-dot.STANDBY { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
        .status-dot.CONNECTED { background: #10b981; box-shadow: 0 0 10px #10b981; }
        .status-dot.WORKING, .status-dot.CONNECTING {
          background: #3b82f6;
          box-shadow: 0 0 12px #3b82f6;
          animation: pulse 1s infinite alternate;
        }
        .status-dot.ERROR { background: #ef4444; box-shadow: 0 0 10px #ef4444; }
        @keyframes pulse {
          from { transform: scale(0.85); opacity: 0.7; }
          to { transform: scale(1.2); opacity: 1; }
        }
        .text-col {
          display: flex;
          flex-direction: column;
          max-width: 280px;
        }
        .title-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .title {
          font-weight: 600;
          color: #ffffff;
          white-space: nowrap;
        }
        .project-badge {
          background: rgba(16, 185, 129, 0.2);
          color: #6ee7b7;
          border: 1px solid rgba(16, 185, 129, 0.35);
          padding: 1px 6px;
          border-radius: 6px;
          font-size: 10px;
          font-family: monospace;
          white-space: nowrap;
        }
        .detail {
          font-size: 11px;
          color: #9ca3af;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .version-badge {
          background: rgba(59, 130, 246, 0.25);
          color: #93c5fd;
          border: 1px solid rgba(59, 130, 246, 0.45);
          padding: 1px 6px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 700;
          font-family: monospace;
          white-space: nowrap;
        }
        .btn-newchat {
          background: rgba(16, 185, 129, 0.2);
          color: #6ee7b7;
          border: 1px solid rgba(16, 185, 129, 0.4);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s;
        }
        .btn-newchat:hover {
          background: rgba(16, 185, 129, 0.45);
          color: #ffffff;
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
          white-space: nowrap;
        }
        .btn-reconnect:hover {
          background: rgba(59, 130, 246, 0.45);
          color: #ffffff;
        }
      </style>
      <div class="hud-card">
        <span class="status-dot STANDBY" id="dot"></span>
        <div class="text-col">
          <div class="title-row">
            <span class="title" id="title">Argon Bridge</span>
            <span class="version-badge">v2.3.6</span>
            <span class="project-badge" id="badge">${initialChatId ? '#' + initialChatId.slice(0, 8) : 'New Chat'}</span>
          </div>
          <span class="detail" id="detail">初始化中...</span>
        </div>
        <button class="btn-newchat" id="newChatBtn" title="开启全新会话，释放膨胀的 DOM 节点与网页卡顿">🔄 新开会话</button>
        <button class="btn-reconnect" id="reconnectBtn" title="手动触发连接本地 17420 端口">立即连接</button>
      </div>
    `;

    document.documentElement.appendChild(host);

    hudState.host = host;
    hudState.dotEl = shadow.getElementById('dot');
    hudState.titleEl = shadow.getElementById('title');
    hudState.badgeEl = shadow.getElementById('badge');
    hudState.detailEl = shadow.getElementById('detail');
    hudState.newChatBtn = shadow.getElementById('newChatBtn');
    hudState.reconnectBtn = shadow.getElementById('reconnectBtn');

    if (hudState.newChatBtn) {
      hudState.newChatBtn.addEventListener('click', async () => {
        updateHud('WORKING', 'Argon Bridge: 正在重置', '正在开启全新干净会话释放 DOM 内存...');
        await ensureCleanNewChatIfRequired(true);
      });
    }

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

  function updateHud(state, titleText, detailText, badgeText = null) {
    createFloatingHud();
    if (!hudState.dotEl) return;
    hudState.dotEl.className = `status-dot ${state}`;
    if (titleText) hudState.titleEl.textContent = titleText;
    if (detailText) hudState.detailEl.textContent = detailText;
    if (badgeText && hudState.badgeEl) {
      hudState.badgeEl.textContent = badgeText;
    } else if (hudState.badgeEl && !badgeText) {
      const cid = getCurrentChatIdFromUrl();
      if (cid && hudState.badgeEl.textContent === 'New Chat') {
        hudState.badgeEl.textContent = `#${cid.slice(0, 8)}`;
      }
    }
  }

  // =========================================================================
  // 3. 与 Background Service Worker 建立长连接
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
            WORKING: 'Argon Bridge: 运行中',
            ERROR: 'Argon Bridge: 异常',
          };
          updateHud(msg.state, labelMap[msg.state] || 'Argon Bridge v2', msg.detail || '');
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

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'ASK_ARGON') {
      handleAskArgonRequest(msg);
    }
  });

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

  function reportStatus(status, detail = '', badgeText = null) {
    updateHud('WORKING', status, detail, badgeText);
    sendMessageToBackground({
      type: 'STATUS',
      status,
      detail,
      timestamp: Date.now(),
    });
  }

  // =========================================================================
  // 4. DOM 定位、跨会话等待、提问注入与 ChatID 提取
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

  /**
   * 当页面因切换项目会话刚完成跳转时，等待富文本输入框渲染就绪（最长 20 秒）
   */
  async function waitForInputReady(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = findInputElement();
      if (el) return el;
      await sleep(300);
    }
    throw new Error('等待 Gemini 页面输入框加载超时，请确认已登录 https://gemini.google.com');
  }

  function findSendButton() {
    const candidateSelectors = [
      'button.send-button',
      'button[aria-label*="Send message"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]',
      'button[aria-label*="提交"]',
      'button[data-test-id="send-button"]',
      'button[data-test-id*="send"]',
      '.send-button-container button',
      'rich-textarea ~ * button',
      '.input-area button',
    ];

    for (const sel of candidateSelectors) {
      try {
        const btns = Array.from(document.querySelectorAll(sel));
        for (const btn of btns) {
          if (isVisible(btn)) {
            const ariaDisabled = btn.getAttribute('aria-disabled') === 'true';
            const disabled = btn.disabled;
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            
            // 排除清空、语音、附件等无关按钮
            if (
              ariaLabel.includes('mic') ||
              ariaLabel.includes('语音') ||
              ariaLabel.includes('upload') ||
              ariaLabel.includes('上传') ||
              ariaLabel.includes('file')
            ) {
              continue;
            }

            if (!disabled && !ariaDisabled) {
              return btn;
            }
          }
        }
      } catch (_) {}
    }

    // 启发式搜索：查找包含向上箭头或 send 图标的按钮
    const icons = Array.from(document.querySelectorAll('mat-icon, svg, .material-symbols-outlined'));
    for (const icon of icons) {
      const iconText = (icon.textContent || '').trim().toLowerCase();
      const fontIcon = (icon.getAttribute('fonticon') || icon.getAttribute('data-mat-icon-name') || '').toLowerCase();
      if (
        iconText === 'send' ||
        iconText === 'arrow_upward' ||
        iconText === 'north' ||
        fontIcon === 'send' ||
        fontIcon === 'arrow_upward'
      ) {
        const btn = icon.closest('button, [role="button"]');
        if (btn && isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          return btn;
        }
      }
    }

    return null;
  }

  function findStopButton() {
    const stopSelectors = [
      'button[aria-label*="Stop response"]',
      'button[aria-label*="Stop generating"]',
      'button[aria-label*="Stop streaming"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="停止生成"]',
      'button[aria-label*="停止响应"]',
      'button[aria-label*="停止"]',
      'button[aria-label*="中断"]',
      'button.stop-button',
      '.stop-icon',
      'mat-icon[fonticon="stop"]',
      'mat-icon[data-mat-icon-name="stop"]',
      'button[data-test-id*="stop"]',
      'button svg rect',
      'button mat-icon rect',
    ];
    for (const sel of stopSelectors) {
      try {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          if (isVisible(el)) {
            return el.closest('button') || el;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  function isStopButtonVisible() {
    const stopSelectors = [
      'button[aria-label*="Stop response"]',
      'button[aria-label*="Stop generating"]',
      'button[aria-label*="Stop streaming"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="停止生成"]',
      'button[aria-label*="停止响应"]',
      'button[aria-label*="停止"]',
      'button[aria-label*="中断"]',
      'button.stop-button',
      '.stop-icon',
      'mat-icon[fonticon="stop"]',
      'mat-icon[data-mat-icon-name="stop"]',
      'button[data-test-id*="stop"]',
      'button svg rect',
      '.sparkle-generating',
      '[data-is-generating="true"]',
    ];
    for (const sel of stopSelectors) {
      try {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          if (el && el.offsetParent !== null) {
            return true;
          }
        }
      } catch (_) {}
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
    return Array.from(document.querySelectorAll('.markdown'));
  }

  function getUserQueryElements() {
    const selectors = [
      'user-query',
      'div[data-message-author-role="user"]',
      '.user-query-container',
      '.user-query',
    ];
    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel));
      if (nodes.length > 0) return nodes;
    }
    return [];
  }

  async function waitForHistorySettled(timeoutMs = 2500) {
    const start = Date.now();
    let lastCount = getModelResponseElements().length;
    let stableTime = Date.now();

    while (Date.now() - start < timeoutMs) {
      await sleep(250);
      const curCount = getModelResponseElements().length;
      if (curCount !== lastCount) {
        lastCount = curCount;
        stableTime = Date.now();
      } else if (Date.now() - stableTime >= 600) {
        break;
      }
    }
  }

  // =========================================================================
  // 4. 智能模型与思考深度双重锁定引擎 (Model = Argon & Thinking Effort = High)
  // =========================================================================
  const DEFAULT_TARGET_MODEL_KEYWORDS = [
    'argon',
    '4 argon',
    'gemini 4',
    'pro',
    'advanced',
    'deep think',
    '高级',
    '思考',
    '2.5 pro',
    '1.5 pro',
    'ultra',
  ];

  const THINKING_LEVEL_SYNONYMS = {
    high: ['high', '高', '深度思考', '深度推理', '深度', '最高', '最大', 'deep', 'maximum', 'extra thorough'],
    medium: ['medium', 'med', '中', '中等', '标准', '均衡', 'balanced'],
    low: ['low', 'minimal', '低', '轻量', '快速', '浅度', 'fast', 'quick'],
  };

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function simulateRealClick(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function simulateHover(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
    el.dispatchEvent(new PointerEvent('pointerenter', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
  }

  function getCleanElementText(el) {
    if (!el) return '';
    try {
      const clone = el.cloneNode(true);
      clone
        .querySelectorAll('mat-icon, svg, .material-symbols-outlined, .google-symbols, mat-spinner')
        .forEach((n) => n.remove());
      return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (_) {
      return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }
  }

  function getElementDescriptor(el) {
    if (!el) return '';
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const aria = el.getAttribute('aria-label') || '';
    const tooltip = el.getAttribute('mattooltip') || el.getAttribute('title') || '';
    const testId = el.getAttribute('data-test-id') || el.getAttribute('data-value') || '';
    return `${text} ${aria} ${tooltip} ${testId}`.replace(/\s+/g, ' ').trim();
  }

  function isElementSelected(el) {
    if (!el) return false;
    if (
      el.getAttribute('aria-checked') === 'true' ||
      el.getAttribute('aria-selected') === 'true' ||
      el.getAttribute('aria-pressed') === 'true' ||
      el.classList.contains('mat-button-toggle-checked') ||
      el.classList.contains('mat-mdc-chip-selected') ||
      el.classList.contains('selected') ||
      el.classList.contains('active')
    ) {
      return true;
    }
    const parentToggle = el.closest('mat-button-toggle');
    if (parentToggle && parentToggle.classList.contains('mat-button-toggle-checked')) {
      return true;
    }
    const icons = Array.from(el.querySelectorAll('mat-icon, .material-symbols-outlined, svg'));
    for (const icon of icons) {
      const iconText = (icon.textContent || '').trim().toLowerCase();
      if (iconText === 'check' || iconText === 'done' || iconText === 'radio_button_checked') {
        return true;
      }
    }
    return false;
  }

  async function closeActiveOverlays() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(120);
    const backdrops = Array.from(document.querySelectorAll('.cdk-overlay-backdrop'));
    for (const bd of backdrops) {
      try {
        bd.remove();
      } catch (_) {}
    }
    const panes = Array.from(document.querySelectorAll('.cdk-overlay-pane'));
    for (const p of panes) {
      if (p.querySelector('button[role="menuitem"], mat-button-toggle, mat-option, .bard-mode-list-button')) {
        try {
          p.remove();
        } catch (_) {}
      }
    }
    await sleep(80);
  }

  function findSafetyBlockElement() {
    const errorSelectors = [
      '.error-message',
      '.response-error',
      '[data-test-id*="safety"]',
      '.safety-block-container',
      '.safety-block',
      'mat-icon[fonticon="error"]',
      'mat-icon[fonticon="warning"]',
      '.response-warning',
    ];
    for (const sel of errorSelectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function findModelSwitcherButton() {
    const explicitSelectors = [
      'bard-mode-switcher button',
      '[data-test-id="bard-mode-menu-button"]',
      '[data-test-id*="model-selector"]',
      'input-area-v2 button[aria-haspopup="menu"]',
      'rich-textarea ~ * button[aria-haspopup="menu"]',
      'button[aria-label*="model" i]',
      'button[aria-label*="模型"]',
      'button[aria-label*="模式"]',
      '.input-area button[aria-haspopup="true"]',
      '.input-area button[aria-expanded]',
    ];

    for (const sel of explicitSelectors) {
      const btns = Array.from(document.querySelectorAll(sel));
      for (const btn of btns) {
        if (!isVisible(btn)) continue;
        const desc = getElementDescriptor(btn);
        if (/flash|argon|pro|advanced|gemini|\d\.\d/i.test(desc)) {
          return btn;
        }
      }
    }

    const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const btn of allButtons) {
      if (!isVisible(btn)) continue;
      if (btn.closest('mat-sidenav') || btn.closest('pre') || btn.closest('model-response')) continue;
      const text = (btn.innerText || '').replace(/\s+/g, ' ').trim();
      if (
        text.length > 0 &&
        text.length <= 32 &&
        /\b(flash|argon|pro|advanced|deep\s*think)\b/i.test(text)
      ) {
        return btn;
      }
    }
    return null;
  }

  function findStandaloneThinkingButton(modelBtn = null) {
    const inputArea =
      document.querySelector('input-area-v2') ||
      document.querySelector('.input-area-container') ||
      document.querySelector('.input-area') ||
      (document.querySelector('rich-textarea')
        ? document.querySelector('rich-textarea').closest('form, .input-area, main')
        : null) ||
      document.body;

    const inlineToggles = Array.from(
      inputArea.querySelectorAll('mat-button-toggle button, [role="radio"], [role="tab"]')
    ).filter(isVisible);
    if (inlineToggles.length >= 2) {
      const hasHigh = inlineToggles.some((el) => matchesThinkingTier(el, 'high'));
      const hasLow = inlineToggles.some((el) => matchesThinkingTier(el, 'low'));
      if (hasHigh && hasLow) {
        return { type: 'inline-group', elements: inlineToggles };
      }
    }

    const candidates = Array.from(
      inputArea.querySelectorAll('button, [role="button"], mat-chip-option, [role="combobox"]')
    ).filter((el) => {
      if (!isVisible(el)) return false;
      if (modelBtn && (el === modelBtn || modelBtn.contains(el) || el.contains(modelBtn))) return false;
      if (el.closest('mat-sidenav') || el.closest('model-response') || el.closest('pre')) return false;
      return true;
    });

    for (const btn of candidates) {
      const desc = getElementDescriptor(btn).toLowerCase();
      const shortText = (btn.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();

      if (
        /\b(thinking|reasoning|effort|budget|思考|推理|深度)\b/i.test(desc) ||
        /^(low|medium|high|minimal|低|中|高|深度思考|轻量推理)$/i.test(shortText) ||
        /\b(thinking|思考|推理)\s*[:：-]?\s*(low|medium|high|低|中|高)\b/i.test(desc)
      ) {
        return { type: 'dropdown-button', element: btn };
      }
    }

    return null;
  }

  function matchesThinkingTier(el, tierKey = 'high') {
    if (!el) return false;
    const cleanText = getCleanElementText(el).toLowerCase();
    const rawText = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const ariaText = (
      (el.getAttribute('aria-label') || '') +
      ' ' +
      (el.getAttribute('data-test-id') || '') +
      ' ' +
      (el.getAttribute('data-value') || '')
    )
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    // 过滤掉整个模型名长文本（防止误伤含有该词汇的模型选项本身）
    if (/\b(flash-lite|3\.8\s*flash|3\.5\s*flash|gemini\s*4\s*argon|gemini\s*3)\b/i.test(cleanText) && cleanText.length > 25) {
      return false;
    }

    if (tierKey === 'high') {
      if (/^(low|medium|minimal|off|低|中|关闭)\b/i.test(cleanText)) return false;
      if (
        cleanText === '高' ||
        cleanText === 'high' ||
        cleanText === '深度思考' ||
        cleanText === '深度推理' ||
        cleanText === '高思考' ||
        cleanText === '高推理' ||
        cleanText === 'maximum' ||
        /^(高|深度|深度思考|深度推理|最大|最高)(\s|$|（|\()/i.test(cleanText) ||
        /\b(high|maximum|extra\s*thorough)\b/i.test(cleanText) ||
        /\b(high)\b/i.test(ariaText) ||
        /(思考|推理|thinking|effort|level).*?(high|高|深度|最大)/i.test(`${cleanText} ${ariaText}`) ||
        /(high|高|深度|最大).*?(思考|推理|thinking|effort|level)/i.test(`${cleanText} ${ariaText}`) ||
        (/高/.test(cleanText) && cleanText.length <= 10 && !/[低中]/.test(cleanText))
      ) {
        return true;
      }
    } else if (tierKey === 'low') {
      if (
        cleanText === '低' ||
        cleanText === 'low' ||
        cleanText === '轻量' ||
        cleanText === '快速' ||
        cleanText === 'minimal' ||
        /^(低|轻量|快速|浅度)(\s|$|（|\()/i.test(cleanText) ||
        /\b(low|minimal|fast|quick)\b/i.test(cleanText) ||
        /\b(low|minimal)\b/i.test(ariaText) ||
        (/低/.test(cleanText) && cleanText.length <= 10 && !/[高中]/.test(cleanText))
      ) {
        return true;
      }
    } else if (tierKey === 'medium') {
      if (
        cleanText === '中' ||
        cleanText === 'medium' ||
        cleanText === '中等' ||
        cleanText === '标准' ||
        cleanText === '均衡' ||
        /^(中|中等|标准|均衡)(\s|$|（|\()/i.test(cleanText) ||
        /\b(medium|balanced|standard)\b/i.test(cleanText) ||
        /\b(medium)\b/i.test(ariaText) ||
        (/中/.test(cleanText) && cleanText.length <= 10 && !/[高低]/.test(cleanText))
      ) {
        return true;
      }
    }

    return false;
  }

  function isDescriptorAlreadyAtTier(descText, targetTier = 'high') {
    if (!descText) return false;
    const norm = descText.replace(/\s+/g, ' ').trim().toLowerCase();

    if (targetTier === 'high') {
      // 若包含 low / 低 / 中，绝不是 High
      if (/(\b(low|medium|minimal|off)\b|[:：\s](低|中|轻量|标准|关闭)(?:$|\s|\)))/i.test(norm)) {
        return false;
      }
      if (
        /\b(high|maximum|deep)\b/i.test(norm) ||
        /(高|深度思考|深度推理|深度|最高|最大)/.test(norm)
      ) {
        return true;
      }
      return false;
    } else if (targetTier === 'low') {
      if (/(\b(high|medium)\b|[:：\s](高|中)(?:$|\s|\)))/i.test(norm)) {
        return false;
      }
      return /\b(low|minimal|fast)\b/i.test(norm) || /(低|轻量|快速|浅度)/.test(norm);
    }
    return false;
  }

  // =========================================================================
  // 3.5 官方高阶额度耗尽与退火冷却管理器 (Argon Quota & Backoff Manager)
  // =========================================================================
  let isArgonQuotaExhausted = false;
  let quotaExhaustedDetectedAt = 0;
  const QUOTA_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 冷却期 2 小时

  function checkArgonQuotaExhausted() {
    if (isArgonQuotaExhausted) {
      if (Date.now() - quotaExhaustedDetectedAt > QUOTA_COOLDOWN_MS) {
        isArgonQuotaExhausted = false;
        return false;
      }
      return true;
    }
    return false;
  }

  function setArgonQuotaExhausted(exhausted = true, reason = '') {
    isArgonQuotaExhausted = exhausted;
    quotaExhaustedDetectedAt = exhausted ? Date.now() : 0;
    if (exhausted) {
      updateHud(
        'STANDBY',
        'Argon 额度已用尽 (冷却中)',
        reason || '官方使用限额已满，需等待数小时 · 本地执行官无缝接管',
        'QUOTA ⏳'
      );
    }
  }

  function findTargetModelOptionInOverlay(targetKeywords) {
    const overlayRoot = document.querySelector('.cdk-overlay-container');
    if (!overlayRoot) return null;

    const candidateSelectors = [
      'button[role="menuitem"]',
      'button[role="menuitemradio"]',
      '[role="option"]',
      'mat-option',
      '.mat-mdc-menu-item',
      '.bard-mode-list-button',
      '.cdk-overlay-pane button',
    ];

    const items = [];
    for (const sel of candidateSelectors) {
      overlayRoot.querySelectorAll(sel).forEach((el) => {
        if (isVisible(el) && !items.includes(el)) {
          if (!matchesThinkingTier(el, 'high') && !matchesThinkingTier(el, 'low') && !matchesThinkingTier(el, 'medium')) {
            items.push(el);
          }
        }
      });
    }

    try {
      const discovered = items.map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (discovered.length > 0) {
        reportStatus('模型下拉选项已展开', `发现菜单项: [${discovered.join(' | ')}]`);
      }
    } catch (_) {}

    for (const keyword of targetKeywords) {
      const kw = keyword.toLowerCase();
      for (const item of items) {
        const itemText = getElementDescriptor(item).toLowerCase();
        if (itemText.includes(kw)) {
          const isDisabled =
            item.disabled ||
            item.getAttribute('aria-disabled') === 'true' ||
            item.classList.contains('mat-mdc-menu-item-disabled');
          if (!isDisabled) {
            return {
              element: item,
              matchedKeyword: keyword,
              fullText: (item.innerText || '').replace(/\s+/g, ' ').trim(),
              alreadySelected: isElementSelected(item),
            };
          } else {
            // 选项存在但被官方置灰禁用 -> 100% 确诊官方额度耗尽！
            setArgonQuotaExhausted(true, 'Argon 选项被官方置灰禁用（当前周期额度已达上限）');
            return {
              element: item,
              matchedKeyword: keyword,
              fullText: (item.innerText || '').replace(/\s+/g, ' ').trim(),
              isDisabled: true,
              quotaExhausted: true,
            };
          }
        }
      }
    }
    return null;
  }

  function findThinkingTierOptionInOverlay(targetTier = 'high') {
    const overlayRoots = [
      document.querySelector('.cdk-overlay-container'),
      ...document.querySelectorAll('.cdk-overlay-pane'),
      ...document.querySelectorAll('[role="menu"]'),
      ...document.querySelectorAll('.mat-mdc-menu-panel'),
      document.body,
    ].filter(Boolean);

    const candidateSelectors = [
      'button[role="menuitem"]',
      'button[role="menuitemradio"]',
      'button[role="radio"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="radio"]',
      'mat-button-toggle button',
      'mat-button-toggle',
      'mat-radio-button',
      '.mat-mdc-radio-button',
      '[role="option"]',
      'mat-option',
      '.mat-mdc-menu-item',
      '.cdk-overlay-pane button',
      '.cdk-overlay-pane [tabindex="0"]',
      '.cdk-overlay-pane [role="button"]',
      'mat-chip-option',
      '[data-test-id*="thinking"]',
      '[data-test-id*="tier"]',
    ];

    const candidates = [];
    for (const root of overlayRoots) {
      for (const sel of candidateSelectors) {
        root.querySelectorAll(sel).forEach((el) => {
          if (isVisible(el) && !candidates.includes(el)) {
            candidates.push(el);
          }
        });
      }
    }

    // 1. 优先寻找直接匹配目标思考档位 (如 "高" / "High") 的选项
    for (const item of candidates) {
      if (matchesThinkingTier(item, targetTier)) {
        const clickable =
          item.tagName.toLowerCase() === 'mat-button-toggle' ||
          item.tagName.toLowerCase() === 'mat-radio-button'
            ? item.querySelector('button, input, [role="radio"]') || item
            : item;
        const isDisabled =
          clickable.disabled ||
          clickable.getAttribute('aria-disabled') === 'true' ||
          item.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) {
          return {
            element: clickable,
            alreadySelected: isElementSelected(item) || isElementSelected(clickable),
            label: getCleanElementText(item) || targetTier.toUpperCase(),
            isSubmenuTrigger: false,
          };
        }
      }
    }

    // 2. 若未直接出现档位，寻找“思考”/“推理”或 Argon 模型的二级子菜单触发器
    for (const item of candidates) {
      const clean = getCleanElementText(item).toLowerCase();
      const desc = getElementDescriptor(item).toLowerCase();
      if (
        !matchesThinkingTier(item, 'high') &&
        !matchesThinkingTier(item, 'low') &&
        !matchesThinkingTier(item, 'medium')
      ) {
        const hasSubmenuAttr =
          item.getAttribute('aria-haspopup') === 'menu' ||
          item.getAttribute('aria-haspopup') === 'true' ||
          item.hasAttribute('matmenutriggerfor') ||
          item.classList.contains('mat-mdc-menu-trigger') ||
          item.classList.contains('mat-menu-trigger');

        const hasChevronIcon = Array.from(item.querySelectorAll('mat-icon, svg, span, i')).some((icon) => {
          const iconName = (icon.getAttribute('fonticon') || icon.textContent || '').trim().toLowerCase();
          return /chevron_right|arrow_right|arrow_drop_down|expand_more|navigate_next/.test(iconName);
        });

        // 思考设置触发项
        const isThinkingTrigger =
          /^(thinking|reasoning|思考|深度思考|推理|思考模式|思考程度|思考预算)$/i.test(clean) ||
          /\b(thinking|reasoning)\b/i.test(desc) ||
          /(思考|推理)/.test(desc);

        // Argon 选项自身的二级菜单展开项（如 "Gemini 4 Argon >"）
        const isArgonSubmenu =
          /\b(argon|pro)\b/i.test(clean) && (hasSubmenuAttr || hasChevronIcon);

        if (isThinkingTrigger || isArgonSubmenu) {
          return {
            element: item,
            isSubmenuTrigger: true,
            label: clean || 'Thinking/Argon Submenu',
          };
        }
      }
    }

    return null;
  }

  async function ensureTargetModelAndThinking(preferredModel = 'Argon', preferredThinkingTier = 'high') {
    const targetModelKeywords = preferredModel
      ? [preferredModel.toLowerCase(), ...DEFAULT_TARGET_MODEL_KEYWORDS]
      : DEFAULT_TARGET_MODEL_KEYWORDS;
    const targetTier = (preferredThinkingTier || 'high').toLowerCase();

    if (checkArgonQuotaExhausted()) {
      throw new Error('[QUOTA_EXHAUSTED] 云端 Gemini 4 Argon 官方额度已耗尽（需等待几小时重置）。已触发自动退火，请由本地执行官接管解答。');
    }

    let finalModelLabel = preferredModel;
    let thinkingLocked = false;

    // 检查初始状态
    let switcherBtn = findModelSwitcherButton();
    if (switcherBtn) {
      const initialDesc = getElementDescriptor(switcherBtn);
      const isModelAlreadyArgon = initialDesc.toLowerCase().includes(targetModelKeywords[0]);
      const isAlreadyTargetThinking = isDescriptorAlreadyAtTier(initialDesc, targetTier);

      // 如果模型已经是 Argon 且思考深度已经是 High（例如按钮已明确显示 "Argon 高"），直接确认并跳过，零延迟零弹窗！
      if (isModelAlreadyArgon && isAlreadyTargetThinking) {
        thinkingLocked = true;
        finalModelLabel = (switcherBtn.innerText || '').replace(/\s+/g, ' ').trim() || preferredModel;
        reportStatus('双锁预检通过', `当前模型与思考深度已处于最高档位: [${finalModelLabel}]`);
        return {
          model: finalModelLabel,
          thinkingLevel: targetTier,
          thinkingLocked: true,
        };
      }

      // 阶段 1：若当前模型不是 Argon（如 Flash-Lite 或 Flash），先切为 Argon
      if (!isModelAlreadyArgon) {
        reportStatus(
          `正在切换模型 -> ${preferredModel}`,
          `当前为 [${(switcherBtn.innerText || 'Flash').trim()}]，打开菜单选择 ${preferredModel}...`
        );
        simulateRealClick(switcherBtn);

        let modelOpt = null;
        const waitStart = Date.now();
        while (Date.now() - waitStart < 2500) {
          await sleep(100);
          modelOpt = findTargetModelOptionInOverlay(targetModelKeywords);
          if (modelOpt) break;
        }

        if (modelOpt) {
          if (modelOpt.quotaExhausted) {
            await closeActiveOverlays();
            throw new Error('[QUOTA_EXHAUSTED] 云端 Gemini 4 Argon 官方额度已耗尽（选项已被官方禁用，需等待数小时重置）。已自动触发退火保护，请由本地执行官接管。');
          }
          if (!modelOpt.alreadySelected) {
            simulateRealClick(modelOpt.element);
            await sleep(500);
          }
          finalModelLabel = modelOpt.fullText || preferredModel;
        }
        await closeActiveOverlays();
        await sleep(350);
      }
    }

    // 阶段 2：强制锁定思考深度为目标档位 (HIGH / 高)
    switcherBtn = findModelSwitcherButton();
    if (switcherBtn) {
      const descNow = getElementDescriptor(switcherBtn);
      if (isDescriptorAlreadyAtTier(descNow, targetTier)) {
        thinkingLocked = true;
        finalModelLabel = (switcherBtn.innerText || '').replace(/\s+/g, ' ').trim() || finalModelLabel;
      } else {
        reportStatus(
          `锁定思考深度 -> ${targetTier.toUpperCase()}`,
          `当前状态 [${(switcherBtn.innerText || '').trim()}] 未呈现高思考，正在打开菜单配置...`
        );

        // 打开模型/思考菜单
        simulateRealClick(switcherBtn);

        let tierOpt = null;
        const waitStart = Date.now();
        while (Date.now() - waitStart < 2500) {
          await sleep(100);
          tierOpt = findThinkingTierOptionInOverlay(targetTier);
          if (tierOpt) break;
        }

        // 如果发现子菜单触发器（比如“思考”或“Thinking”或 Argon 的二级菜单），模拟展开并轮询捕获子项
        if (tierOpt && tierOpt.isSubmenuTrigger) {
          reportStatus('展开思考设置', `在菜单中展开 [${tierOpt.label}]...`);
          simulateHover(tierOpt.element);
          simulateRealClick(tierOpt.element);
          
          const subWaitStart = Date.now();
          while (Date.now() - subWaitStart < 2000) {
            await sleep(100);
            const foundTier = findThinkingTierOptionInOverlay(targetTier);
            if (foundTier && !foundTier.isSubmenuTrigger) {
              tierOpt = foundTier;
              break;
            }
          }
        }

        if (tierOpt && !tierOpt.isSubmenuTrigger) {
          if (!tierOpt.alreadySelected) {
            reportStatus(
              `选中推理档位 -> ${targetTier.toUpperCase()}`,
              `点击档位选项: [${tierOpt.label}]...`
            );
            simulateRealClick(tierOpt.element);
            await sleep(400);
          }
          thinkingLocked = true;
        }

        await closeActiveOverlays();
        await sleep(350);

        // 最终校验：再次确认模型按钮文本
        const finalBtn = findModelSwitcherButton();
        if (finalBtn) {
          const finalDesc = getElementDescriptor(finalBtn);
          if (isDescriptorAlreadyAtTier(finalDesc, targetTier)) {
            thinkingLocked = true;
            finalModelLabel = (finalBtn.innerText || '').replace(/\s+/g, ' ').trim();
          }
        }
      }
    }

    // 阶段 3：独立输入栏控件探测（如果有独立的 Thinking 药丸/单选组）
    if (!thinkingLocked) {
      const standaloneCtrl = findStandaloneThinkingButton(switcherBtn);
      if (standaloneCtrl) {
        if (standaloneCtrl.type === 'inline-group') {
          const highBtn = standaloneCtrl.elements.find((el) => matchesThinkingTier(el, targetTier));
          if (highBtn) {
            if (!isElementSelected(highBtn)) {
              simulateRealClick(highBtn);
              await sleep(300);
            }
            thinkingLocked = true;
          }
        } else if (standaloneCtrl.type === 'dropdown-button') {
          const chipEl = standaloneCtrl.element;
          const chipDesc = getElementDescriptor(chipEl);
          if (isDescriptorAlreadyAtTier(chipDesc, targetTier)) {
            thinkingLocked = true;
          } else {
            simulateRealClick(chipEl);
            let tierOpt = null;
            const waitStart = Date.now();
            while (Date.now() - waitStart < 2200) {
              await sleep(100);
              tierOpt = findThinkingTierOptionInOverlay(targetTier);
              if (tierOpt) break;
            }
            if (tierOpt && tierOpt.isSubmenuTrigger) {
              simulateHover(tierOpt.element);
              simulateRealClick(tierOpt.element);
              const subWaitStart = Date.now();
              while (Date.now() - subWaitStart < 2000) {
                await sleep(100);
                const foundTier = findThinkingTierOptionInOverlay(targetTier);
                if (foundTier && !foundTier.isSubmenuTrigger) {
                  tierOpt = foundTier;
                  break;
                }
              }
            }
            if (tierOpt && !tierOpt.isSubmenuTrigger) {
              if (!tierOpt.alreadySelected) {
                simulateRealClick(tierOpt.element);
                await sleep(350);
              }
              thinkingLocked = true;
            }
            await closeActiveOverlays();
          }
        }
      }
    }

    await closeActiveOverlays();

    const inputEl = findInputElement();
    if (inputEl) {
      inputEl.focus();
    }

    reportStatus(
      `双锁就绪: ${finalModelLabel} · Thinking=${thinkingLocked ? targetTier.toUpperCase() : 'DEFAULT'}`,
      thinkingLocked
        ? `已确认开启 ${targetTier.toUpperCase()} 深度思考模式`
        : `⚠️ 提示: 未能在界面锁定高思考开关，将以当前档位 (${finalModelLabel}) 发送`
    );

    return {
      model: finalModelLabel,
      thinkingLevel: targetTier,
      thinkingLocked,
    };
  }

  /**
   * 若需要新建会话但当前页面已有历史对话记录，尝试点击页面左上角的“发起新对话 (New chat)”按钮
   */
  async function ensureCleanNewChatIfRequired(forceNewChat) {
    if (!forceNewChat) return;
    const existingResponses = getModelResponseElements();
    const currentCid = getCurrentChatIdFromUrl();
    if (existingResponses.length === 0 && !currentCid) {
      return;
    }

    const newChatSelectors = [
      'a[href="/app"]',
      'a[href^="https://gemini.google.com/app"]',
      'button[data-test-id="new-chat-button"]',
      'button[aria-label*="New chat"]',
      'button[aria-label*="新对话"]',
      'button[aria-label*="发起新对话"]',
      '[data-test-id="side-nav-new-chat-button"]',
      'side-nav-button[data-test-id="new-chat"]',
    ];

    for (const sel of newChatSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        await sleep(800);
        return;
      }
    }

    // 强效兜底：直接跳转到 /app 根路径开启全新纯净对话
    if (currentCid) {
      window.location.href = 'https://gemini.google.com/app';
      await sleep(1500);
    }
  }

  async function injectPromptAndSend(promptText) {
    await closeActiveOverlays();

    // 关键自愈：如果页面当前残留着之前卡死的 Stop 按钮，先尝试点击停止并重置输入栏
    if (isStopButtonVisible()) {
      reportStatus('正在解除卡死状态', '检测到上一次生成残留的停止按钮，自动重置...');
      const oldStopBtn = findStopButton();
      if (oldStopBtn) {
        try { oldStopBtn.click(); } catch (_) {}
        await sleep(1000);
      }
    }

    const inputEl = await waitForInputReady(20000);

    inputEl.focus();
    await sleep(150);

    const queryCountBefore = getUserQueryElements().length;

    // 清空输入框并注入完整段落
    if (inputEl.tagName.toLowerCase() === 'textarea') {
      inputEl.value = promptText;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      inputEl.innerHTML = '';
      const lines = promptText.split('\n');
      for (const line of lines) {
        const p = document.createElement('p');
        p.textContent = line || '\u200B';
        inputEl.appendChild(p);
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

    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(350);

    // 等待发送按钮解除禁用并激活（至多 4 秒）
    let sendBtn = null;
    for (let waitRetry = 0; waitRetry < 15; waitRetry++) {
      sendBtn = findSendButton();
      if (sendBtn) break;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(250);
    }

    // 核心安全机制：绝对单次平稳触发（STRICT SINGLE SUBMISSION）
    // 坚决彻底移除任何并发连击与高频重试循环，杜绝任何多发风险！
    if (sendBtn) {
      reportStatus('正在提交提示词', '点击发送按钮（单次精准触发）...');
      simulateRealClick(sendBtn);
    } else {
      reportStatus('正在提交提示词', '通过回车键发送（单次精准触发）...');
      inputEl.focus();
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

    // 提交后耐心等待 Google 接收并进入生成状态（至多等待 8 秒缓冲期）
    const waitSubmitStart = Date.now();
    let sendConfirmed = false;
    while (Date.now() - waitSubmitStart < 8000) {
      await sleep(300);
      const currentInputText = (inputEl.innerText || '').trim();
      const queriesNow = getUserQueryElements().length;
      const stopVisible = isStopButtonVisible();
      const sendBtnNow = findSendButton();

      // 判定依据：满足任一即代表请求已被 Google 成功接纳处理
      if (
        stopVisible ||
        queriesNow > queryCountBefore ||
        !currentInputText ||
        !sendBtnNow
      ) {
        sendConfirmed = true;
        break;
      }
    }

    if (!sendConfirmed) {
      // 仅在整整 8 秒后界面依然毫无响应时，进行唯一一次单次回车兜底
      reportStatus('提交确认延迟', '等待超过 8s，尝试单次回车兜底...');
      inputEl.focus();
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

  async function waitForNewUserQuery(initialCount, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const queries = getUserQueryElements();
      if (queries.length > initialCount) {
        return queries[queries.length - 1];
      }
      await sleep(200);
    }
    const current = getUserQueryElements();
    return current.length > 0 ? current[current.length - 1] : null;
  }

  async function waitForGenerationComplete(targetUserQueryEl, projectName, timeoutMs = 600000) {
    const startTime = Date.now();
    let generationStarted = false;
    let lastProgressTime = Date.now();
    let lastObservedLength = 0;

    try {
      while (Date.now() - startTime < timeoutMs) {
        // 使用 800ms 轮询节奏，绝不挤占主线程，彻底消除“页面未响应”
        await sleep(800);

        // 探测 Google 官方安全策略拦截卡片（如触发敏感词拒答）
        const safetyBlock = findSafetyBlockElement();
        if (safetyBlock) {
          const blockText = (safetyBlock.textContent || '').replace(/\s+/g, ' ').trim();
          throw new Error(`[SAFETY_BLOCKED] Google 官方安全策略拦截: ${blockText || '触发敏感内容防护'}`);
        }

        const stopVisible = isStopButtonVisible();

        const responses = getModelResponseElements();
        const unhandledResponses = responses.filter((res) => !res.hasAttribute('data-argon-existing'));
        if (unhandledResponses.length === 0) {
          if (stopVisible) {
            generationStarted = true;
            reportStatus(`Argon 正在思考 [${projectName}]`, '云端准备中 (Stop 按钮已激活)...');
            // 如果 Stop 按钮亮起转圈已超 35 秒，但服务端连一个回复气泡容器都还没创建（Google 云端死锁 / 历史上下文过大超时）：
            if (Date.now() - startTime > 35000) {
              const stopBtn = findStopButton();
              if (stopBtn) {
                try { stopBtn.click(); } catch (_) {}
              }
              throw new Error(
                `[SESSION_OVERLOAD] Google 官方云端流式断流/超时（转圈超 35s 未创建回复气泡）。\n` +
                `根本原因：当前项目会话积累了过多历史长文本（超 5 万 DOM 节点），导致 Google 服务端推理上下文超载或死锁。\n` +
                `插件已自动点击停止按钮重置状态。强烈建议执行: node ask_argon.js --new-chat "你的问题" 开启极速新会话！`
              );
            }
          } else {
            // 没有 Stop 按钮，且过了 12 秒依然没有任何反应，说明网页端未能顺利发送或渲染
            if (Date.now() - startTime > 12000) {
              throw new Error(`[DISPATCH_LOST] 提示词提交 12 秒后未检测到 Google 生成状态。可能是网页端卡死或发送按钮失灵，建议刷新页面重试。`);
            }
          }
          continue;
        }

        const targetResponseNode = unhandledResponses[unhandledResponses.length - 1];

        // 核心性能优化：流式传输期间仅读取 textContent.length，严禁调用 innerText（绝不强制同步重排，零布局颠簸）
        const currentLength = (targetResponseNode.textContent || '').length;

        // 拒答快速检测：仅在文本极短时提取开头进行正则断言
        if (currentLength < 250) {
          const prefixText = (targetResponseNode.textContent || '').slice(0, 150).trim();
          if (
            /^(I cannot help with that|I'm unable to assist|作为人工智能模型，我无法|很抱歉，我不能|我是一个文本\s*AI|这超出了我的能力范围|我只是一个语言模型)/i.test(
              prefixText
            ) ||
            /(超出.*?能力范围|无法协助处理此类|无法满足这一请求|没法帮到你|beyond my capabilities)/i.test(prefixText)
          ) {
            throw new Error(`[SAFETY_REFUSAL] Argon 拒答: ${prefixText.slice(0, 80)}`);
          }
        }

        if (!generationStarted) {
          if (stopVisible || currentLength > 0) {
            generationStarted = true;
            lastProgressTime = Date.now();
            reportStatus(`Argon 正在思考/回复 [${projectName}]`, '已检测到生成状态');
          }
          continue;
        }

        if (currentLength !== lastObservedLength) {
          lastObservedLength = currentLength;
          lastProgressTime = Date.now();
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          reportStatus(
            `正在接收 [${projectName}] 回复...`,
            `已生成约 ${currentLength} 字符 (${elapsedSec}s)`
          );
        }

        // 核心稳定性仲裁 + 防死锁看门狗（Anti-Zombie Watchdog）：
        if (stopVisible) {
          // 场景 1：已转圈超 120 秒但未产生任何 1 个 Token（Google 官方云端掉线）
          // 场景 2：流式输出中途深度思考或卡顿超 300 秒（支持高深度长文本推理）
          const stuckAtStart = currentLength === 0 && (Date.now() - startTime > 120000);
          const stuckMidStream = currentLength > 0 && (Date.now() - lastProgressTime > 300000);

          if (stuckAtStart || stuckMidStream) {
            const stopBtn = findStopButton();
            if (stopBtn) {
              try { stopBtn.click(); } catch (_) {}
            }
            if (currentLength > 200) {
              return targetResponseNode;
            }
            throw new Error(`[BACKEND_HANG] Google 官方云端流式断流死锁（转圈超 ${stuckAtStart ? '120s 无首字' : '300s 无输出'}）。已自动点击停止按钮解除卡死。`);
          }
          continue;
        }

        // Stop 按钮已消失后的静默仲裁
        const quietDuration = Date.now() - lastProgressTime;
        const copyBtn = findCopyButtonForResponse(targetResponseNode);
        const isSubstantial = currentLength > 50;

        // 完工判定：Stop 按钮消失且（复制按钮已渲染 或 静默时间 >= 3000ms）
        if (isSubstantial && (copyBtn || quietDuration >= 3000)) {
          return targetResponseNode;
        }
      }

      // 超时兜底：若已有实质性模型回复（例如长文本推演），优先返回已有成果
      const fallbackResponses = getModelResponseElements();
      const fallbackUnhandled = fallbackResponses.filter((res) => !res.hasAttribute('data-argon-existing'));
      if (fallbackUnhandled.length > 0) {
        const candidate = fallbackUnhandled[fallbackUnhandled.length - 1];
        if ((candidate.textContent || '').length > 200) {
          return candidate;
        }
      }

      throw new Error('等待 Gemini 4 Argon 生成回复超时。请确认网页端未处于卡顿或遮罩状态。');
    } finally {
      // 循环结束无常驻资源需释放
    }
  }

  /**
   * 首轮新会话生成后，等待地址栏 URL 从 /app 更新为 /app/<chatId>
   */
  async function waitForChatIdInUrl(maxWaitMs = 3500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const cid = getCurrentChatIdFromUrl();
      if (cid) return cid;
      await sleep(250);
    }
    return getCurrentChatIdFromUrl();
  }

  function findCopyButtonForResponse(responseNode) {
    if (!responseNode) return null;

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
        const validBtns = btns.filter((b) => !b.closest('pre') && !b.closest('code-block'));
        if (validBtns.length > 0) {
          return validBtns[validBtns.length - 1];
        }
      }
    }
    return null;
  }

  function convertDomNodeToMarkdown(rootNode) {
    if (!rootNode) return '';

    const container =
      rootNode.querySelector('.markdown') ||
      rootNode.querySelector('message-content') ||
      rootNode;

    const clone = container.cloneNode(true);

    const noiseSelectors = [
      '.code-block-decoration',
      '.code-header',
      'button',
      'mat-icon',
      'script',
      'style',
      '.thought-container',
      'expandable-thought',
      '.thinking-container',
      'thought-box',
      'details.thought',
      '.thought-wrapper',
    ];
    for (const sel of noiseSelectors) {
      try {
        clone.querySelectorAll(sel).forEach((el) => el.remove());
      } catch (_) {}
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue || '';
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }

      const tag = node.tagName.toLowerCase();

      if (tag === 'pre') {
        const codeEl = node.querySelector('code');
        let lang = '';
        if (codeEl && codeEl.className) {
          const match = codeEl.className.match(/language-([a-zA-Z0-9_-]+)/);
          if (match) lang = match[1];
        }
        const rawCode = (codeEl ? codeEl.textContent : node.textContent) || '';
        return `\n\`\`\`${lang}\n${rawCode.replace(/\n+$/, '')}\n\`\`\`\n\n`;
      }

      if (tag === 'code' && (!node.parentElement || node.parentElement.tagName.toLowerCase() !== 'pre')) {
        return `\`${node.textContent || ''}\``;
      }

      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag.slice(1), 10);
        const hashes = '#'.repeat(level);
        return `\n${hashes} ${getChildrenText(node).trim()}\n\n`;
      }

      if (tag === 'p') {
        return `${getChildrenText(node).trim()}\n\n`;
      }

      if (tag === 'br') return '\n';
      if (tag === 'hr') return '\n---\n\n';
      if (tag === 'strong' || tag === 'b') return `**${getChildrenText(node)}**`;
      if (tag === 'em' || tag === 'i') return `*${getChildrenText(node)}*`;

      if (tag === 'blockquote') {
        const lines = getChildrenText(node).trim().split('\n');
        return '\n' + lines.map((l) => `> ${l}`).join('\n') + '\n\n';
      }

      if (tag === 'ul') {
        let out = '\n';
        Array.from(node.children).forEach((li) => {
          if (li.tagName && li.tagName.toLowerCase() === 'li') {
            out += `- ${getChildrenText(li).trim()}\n`;
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

  async function extractCleanMarkdown(responseNode, taskPrompt = '') {
    // 方案 1 (最优先且最稳定)：DOM 级结构化 Markdown 序列化提取
    const domMarkdown = convertDomNodeToMarkdown(responseNode);
    if (domMarkdown && domMarkdown.trim().length > 100) {
      return {
        markdown: domMarkdown.trim(),
        source: 'dom-markdown-serializer',
      };
    }

    // 方案 2：尝试页面自带的复制按钮拦截
    const copyBtn = findCopyButtonForResponse(responseNode);
    if (copyBtn) {
      const beforeClickTime = Date.now();
      lastCapturedClipboardText = '';
      copyBtn.click();
      await sleep(400);

      if (lastCapturedClipboardText && lastCapturedClipboardTime >= beforeClickTime) {
        return {
          markdown: lastCapturedClipboardText.trim(),
          source: 'clipboard-interceptor',
        };
      }

      try {
        const clipText = (await navigator.clipboard.readText()) || '';
        const trimmedClip = clipText.trim();
        // 关键校验：排除与用户 Prompt 相同或过短的内容
        const isNotPrompt = !taskPrompt || !taskPrompt.includes(trimmedClip.slice(0, 50));
        if (trimmedClip.length > 50 && isNotPrompt) {
          return {
            markdown: trimmedClip,
            source: 'navigator-clipboard',
          };
        }
      } catch (_) {}
    }

    if (domMarkdown && domMarkdown.trim().length > 0) {
      return {
        markdown: domMarkdown.trim(),
        source: 'dom-markdown-serializer',
      };
    }

    return {
      markdown: (responseNode ? responseNode.innerText : '').trim(),
      source: 'innerText-fallback',
    };
  }

  let currentActiveTaskId = null;

  async function handleAskArgonRequest(task) {
    if (isProcessingTask) {
      if (task.requestId && task.requestId === currentActiveTaskId) {
        // 同一任务重复投递，忽略跳过
        return;
      }
      sendMessageToBackground({
        type: 'ERROR',
        requestId: task.requestId,
        error: '当前页面正在执行另一个 Argon 提问任务，请稍候重试。',
      });
      return;
    }

    isProcessingTask = true;
    currentActiveTaskId = task.requestId;
    const projectName = task.projectName || 'default';
    const targetModel = task.model || 'Argon';
    const targetThinking = task.thinkingLevel || 'high';

    try {
      await waitForInputReady(20000);
      await waitForHistorySettled(2500);

      if (task.forceNewChat) {
        await ensureCleanNewChatIfRequired(true);
        await waitForInputReady(10000);
      }

      // 执行“模型 (Argon) + 思考深度 (High)”双重预检与自动锁定
      const lockResult = await ensureTargetModelAndThinking(targetModel, targetThinking);

      const activeCid = getCurrentChatIdFromUrl();
      const thinkingStatusTag = lockResult.thinkingLocked ? targetThinking.toUpperCase() : 'NORMAL';
      const badgeLabel = `${projectName} · ${thinkingStatusTag} · ${
        activeCid ? '#' + activeCid.slice(0, 6) : 'NEW'
      }`;

      reportStatus(
        `正在向 [${projectName}] 专属会话提问 (${lockResult.model} / ${thinkingStatusTag})...`,
        `Req: ${task.requestId.slice(0, 8)}`,
        badgeLabel
      );

      // 1. 将页面上当前已有的所有模型响应标记为 existing，绝对避免读取旧消息
      getModelResponseElements().forEach((el) => el.setAttribute('data-argon-existing', 'true'));

      const queryCountBefore = getUserQueryElements().length;

      await injectPromptAndSend(task.prompt);
      reportStatus(
        `已发送 [${projectName}] 提问`,
        `等待 Gemini 4 Argon (${targetThinking.toUpperCase()}) 深度推理与回复...`,
        badgeLabel
      );

      // 核心 1:1 会话隔离升级：提示词刚发出后立即探测 URL 中的新 chatId 并即时向本地回传持久化！
      // 绝不等数分钟回复结束才绑定，彻底杜绝单项目产生多条冗余会话！
      (async () => {
        try {
          const earlyCid = await waitForChatIdInUrl(6000);
          if (earlyCid && earlyCid !== task.chatId) {
            sendMessageToBackground({
              type: 'SESSION_BOUND',
              requestId: task.requestId,
              projectKey: task.projectKey,
              projectName,
              chatId: earlyCid,
              chatUrl: `https://gemini.google.com/app/${earlyCid}`,
            });
          }
        } catch (_) {}
      })();

      // 跟踪本轮提问所生成的最新 user-query 节点
      const latestUserQueryNode = await waitForNewUserQuery(queryCountBefore, 6000);

      // 开启 HIGH 思考深度后首字延迟增加，超时放宽至 360 秒
      const latestResponseNode = await waitForGenerationComplete(
        latestUserQueryNode,
        projectName,
        600000
      );
      if (latestResponseNode) {
        latestResponseNode.setAttribute('data-argon-existing', 'true');
      }
      reportStatus('生成完毕', '正在提取纯净 Markdown 与会话 ID...', badgeLabel);

      const { markdown, source } = await extractCleanMarkdown(latestResponseNode, task.prompt);
      if (!markdown) {
        throw new Error('提取到的回复内容为空。');
      }

      // 捕获当前会话的 chatId（特别是新项目首轮对话刚分配的 URL）
      const finalChatId = (await waitForChatIdInUrl(3500)) || task.chatId || null;
      const finalChatUrl = finalChatId
        ? `https://gemini.google.com/app/${finalChatId}`
        : window.location.href;

      const finalBadge = `${projectName} · ${thinkingStatusTag} · ${
        finalChatId ? '#' + finalChatId.slice(0, 6) : 'BOUND'
      }`;

      sendMessageToBackground({
        type: 'RESPONSE',
        requestId: task.requestId,
        projectKey: task.projectKey,
        projectName,
        chatId: finalChatId,
        chatUrl: finalChatUrl,
        model: lockResult.model,
        thinkingLevel: thinkingStatusTag,
        markdown,
        source,
        timestamp: Date.now(),
      });

      updateHud(
        'CONNECTED',
        `Argon Bridge: [${projectName}] 已完成`,
        `已回传 ${markdown.length} 字符 (${source} · ${thinkingStatusTag})`,
        finalBadge
      );
    } catch (err) {
      updateHud('ERROR', `Argon Bridge: [${projectName}] 失败`, err.message || '未知错误');
      sendMessageToBackground({
        type: 'ERROR',
        requestId: task.requestId,
        error: err.message || String(err),
      });
    } finally {
      isProcessingTask = false;
      currentActiveTaskId = null;
    }
  }

  // 纯被动式模型状态感知器（绝对静默原则：严禁在后台未经提问任务授权自动点击用户界面或切模）
  function initPassiveModelObserver() {
    const observeStateOnly = () => {
      if (isProcessingTask) return;
      const switcherBtn = findModelSwitcherButton();
      if (!switcherBtn) return;

      const desc = getElementDescriptor(switcherBtn).toLowerCase();

      if (desc.includes('lite') || desc.includes('flash-lite')) {
        if (checkArgonQuotaExhausted()) {
          updateHud(
            'STANDBY',
            'Argon 额度冷却中 (当前 Flash-Lite)',
            '官方额度已满 · 本地模型无缝接管中',
            'QUOTA ⏳'
          );
        }
      } else if (desc.includes('argon') || desc.includes('4 argon') || desc.includes('pro')) {
        isArgonQuotaExhausted = false;
      }

      // 会话过长探测（DOM 膨胀预警）：若当前会话回复卡片 >= 12，且未在提问中，在 HUD 提示优化
      const responseCount = getModelResponseElements().length;
      if (responseCount >= 12 && !isArgonQuotaExhausted) {
        const cid = getCurrentChatIdFromUrl();
        updateHud(
          'STANDBY',
          'Argon Bridge: 待命中',
          `当前会话已积累 ${responseCount} 条对话 (DOM 较重)，建议点击“新开会话”`,
          cid ? `#${cid.slice(0, 6)} ⚠️` : 'OVERLOAD ⚠️'
        );
      }
    };

    setTimeout(observeStateOnly, 2000);
    setInterval(observeStateOnly, 5000);
  }

  initPassiveModelObserver();
  createFloatingHud();
  connectToBackground();
})();
