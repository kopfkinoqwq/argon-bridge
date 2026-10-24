/**
 * Argon Bridge v2.0 - Content Script for https://gemini.google.com/*
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
            <span class="title" id="title">Argon Bridge v2</span>
            <span class="project-badge" id="badge">${initialChatId ? '#' + initialChatId.slice(0, 8) : 'New Chat'}</span>
          </div>
          <span class="detail" id="detail">初始化中...</span>
        </div>
        <button class="btn-reconnect" id="reconnectBtn" title="手动触发连接本地 17420 端口">立即连接</button>
      </div>
    `;

    document.documentElement.appendChild(host);

    hudState.host = host;
    hudState.dotEl = shadow.getElementById('dot');
    hudState.titleEl = shadow.getElementById('title');
    hudState.badgeEl = shadow.getElementById('badge');
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
      'button[aria-label*="中断"]',
      '.stop-icon',
      'mat-icon[fonticon="stop"]',
      'mat-icon[data-mat-icon-name="stop"]',
      'button[data-test-id*="stop"]',
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
  const DEFAULT_TARGET_MODEL_KEYWORDS = ['argon', '4 argon', 'pro', 'advanced', 'deep think'];

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

    if (/\b(flash-lite|3\.8\s*flash|3\.5\s*flash|gemini\s*4\s*argon|gemini\s*3)\b/i.test(rawText) && rawText.length > 25) {
      return false;
    }

    if (tierKey === 'high') {
      if (/^(low|medium|minimal|低|中)\b/i.test(rawText)) return false;
      if (
        /\b(high|maximum|extra\s*thorough)\b/i.test(rawText) ||
        /\b(high)\b/i.test(ariaText) ||
        /^(高|深度|深度思考|深度推理|最大|最高)(\s|$|（|\()/i.test(rawText) ||
        /(思考|推理|thinking|effort|level).*?(high|高|深度|最大)/i.test(`${rawText}${ariaText}`)
      ) {
        return true;
      }
    } else if (tierKey === 'low') {
      if (
        /\b(low|minimal)\b/i.test(rawText) ||
        /\b(low|minimal)\b/i.test(ariaText) ||
        /^(低|轻量|快速|浅度)(\s|$|（|\()/i.test(rawText)
      ) {
        return true;
      }
    } else if (tierKey === 'medium') {
      if (
        /\b(medium|balanced)\b/i.test(rawText) ||
        /\b(medium)\b/i.test(ariaText) ||
        /^(中|中等|标准|均衡)(\s|$|（|\()/i.test(rawText)
      ) {
        return true;
      }
    }

    return false;
  }

  function isDescriptorAlreadyAtTier(descText, targetTier = 'high') {
    if (!descText) return false;
    const norm = descText.replace(/\s+/g, ' ').trim().toLowerCase();
    const synonyms = THINKING_LEVEL_SYNONYMS[targetTier] || THINKING_LEVEL_SYNONYMS.high;

    if (targetTier === 'high' && /(\b(low|medium|minimal)\b|[:：\s](低|中|轻量|标准)(?:$|\s|\)))/i.test(norm)) {
      return false;
    }

    for (const word of synonyms) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = /^[a-z]+$/i.test(word) ? new RegExp(`\\b${escaped}\\b`, 'i') : new RegExp(escaped, 'i');
      if (reg.test(norm)) {
        return true;
      }
    }
    return false;
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
          }
        }
      }
    }
    return null;
  }

  function findThinkingTierOptionInOverlay(targetTier = 'high') {
    const overlayRoot = document.querySelector('.cdk-overlay-container');
    if (!overlayRoot) return null;

    const candidateSelectors = [
      'mat-button-toggle button',
      'mat-button-toggle',
      'button[role="radio"]',
      'button[role="menuitemradio"]',
      'button[role="menuitem"]',
      '[role="option"]',
      'mat-option',
      '.mat-mdc-menu-item',
      '.cdk-overlay-pane button',
    ];

    const candidates = [];
    for (const sel of candidateSelectors) {
      overlayRoot.querySelectorAll(sel).forEach((el) => {
        if (isVisible(el) && !candidates.includes(el)) {
          candidates.push(el);
        }
      });
    }

    for (const item of candidates) {
      if (matchesThinkingTier(item, targetTier)) {
        const clickable =
          item.tagName.toLowerCase() === 'mat-button-toggle'
            ? item.querySelector('button') || item
            : item;
        const isDisabled =
          clickable.disabled ||
          clickable.getAttribute('aria-disabled') === 'true' ||
          item.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) {
          return {
            element: clickable,
            alreadySelected: isElementSelected(item) || isElementSelected(clickable),
            label: (item.innerText || '').replace(/\s+/g, ' ').trim() || targetTier.toUpperCase(),
          };
        }
      }
    }

    for (const item of candidates) {
      const desc = getElementDescriptor(item).toLowerCase();
      if (
        /\b(thinking\s*level|thinking\s*effort|reasoning|思考深度|推理程度|思考模式)\b/i.test(desc) &&
        !matchesThinkingTier(item, 'high') &&
        !matchesThinkingTier(item, 'low')
      ) {
        return {
          element: item,
          isSubmenuTrigger: true,
          label: (item.innerText || '').replace(/\s+/g, ' ').trim(),
        };
      }
    }

    return null;
  }

  async function ensureTargetModelAndThinking(preferredModel = 'Argon', preferredThinkingTier = 'high') {
    const targetModelKeywords = preferredModel
      ? [preferredModel.toLowerCase(), ...DEFAULT_TARGET_MODEL_KEYWORDS]
      : DEFAULT_TARGET_MODEL_KEYWORDS;
    const targetTier = (preferredThinkingTier || 'high').toLowerCase();

    let finalModelLabel = preferredModel;
    let thinkingLocked = false;

    // 阶段 A：检查并锁定目标模型 (Argon)
    const switcherBtn = findModelSwitcherButton();
    if (switcherBtn) {
      const currentBtnDesc = getElementDescriptor(switcherBtn);
      const currentBtnText = (switcherBtn.innerText || '').replace(/\s+/g, ' ').trim();
      const isModelAlreadyTarget = currentBtnDesc.toLowerCase().includes(targetModelKeywords[0]);

      if (!isModelAlreadyTarget) {
        reportStatus(
          `检测到当前模型为 [${currentBtnText || 'Flash'}]`,
          `正在切换模型至 ${preferredModel} 并准备锁定 ${targetTier.toUpperCase()} 推理深度...`
        );

        simulateRealClick(switcherBtn);

        let modelOpt = null;
        const waitStart = Date.now();
        while (Date.now() - waitStart < 2500) {
          await sleep(100);
          modelOpt = findTargetModelOptionInOverlay(targetModelKeywords);
          if (modelOpt) break;
        }

        const inlineThinkingPre = findThinkingTierOptionInOverlay(targetTier);
        if (inlineThinkingPre && !inlineThinkingPre.isSubmenuTrigger) {
          if (!inlineThinkingPre.alreadySelected) {
            simulateRealClick(inlineThinkingPre.element);
            await sleep(220);
          }
          thinkingLocked = true;
        }

        if (modelOpt) {
          if (!modelOpt.alreadySelected) {
            simulateRealClick(modelOpt.element);
            await sleep(450);
          }
          finalModelLabel = modelOpt.fullText || preferredModel;
        } else {
          await closeActiveOverlays();
        }
      } else {
        finalModelLabel = currentBtnText || preferredModel;
      }
    }

    // 阶段 B：探测底部输入栏独立 Thinking Effort 胶囊按钮或内联组
    const refreshedModelBtn = findModelSwitcherButton();
    if (refreshedModelBtn) {
      const txt = (refreshedModelBtn.innerText || '').replace(/\s+/g, ' ').trim();
      if (txt) finalModelLabel = txt;
    }

    const standaloneCtrl = findStandaloneThinkingButton(refreshedModelBtn);

    if (standaloneCtrl) {
      if (standaloneCtrl.type === 'inline-group') {
        const highBtn = standaloneCtrl.elements.find((el) => matchesThinkingTier(el, targetTier));
        if (highBtn) {
          if (!isElementSelected(highBtn)) {
            reportStatus(
              `正在调整推理程度 -> ${targetTier.toUpperCase()}`,
              '点击输入栏内联 High 思考档位...'
            );
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
          reportStatus(
            `检测到思考深度为 [${(chipEl.innerText || 'Low').trim()}]`,
            `正在切换推理程度至 ${targetTier.toUpperCase()} (深度思考)...`
          );

          simulateRealClick(chipEl);

          let tierOpt = null;
          const waitStart = Date.now();
          while (Date.now() - waitStart < 2200) {
            await sleep(100);
            tierOpt = findThinkingTierOptionInOverlay(targetTier);
            if (tierOpt) break;
          }

          if (tierOpt && tierOpt.isSubmenuTrigger) {
            simulateRealClick(tierOpt.element);
            await sleep(300);
            tierOpt = findThinkingTierOptionInOverlay(targetTier);
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

    // 阶段 C：若未锁定，复查模型菜单内的内嵌 Thinking 切换器
    if (!thinkingLocked && refreshedModelBtn) {
      const modelBtnDesc = getElementDescriptor(refreshedModelBtn);
      if (isDescriptorAlreadyAtTier(modelBtnDesc, targetTier)) {
        thinkingLocked = true;
      } else {
        simulateRealClick(refreshedModelBtn);

        let tierOpt = null;
        const waitStart = Date.now();
        while (Date.now() - waitStart < 2200) {
          await sleep(100);
          tierOpt = findThinkingTierOptionInOverlay(targetTier);
          if (tierOpt) break;
        }

        if (tierOpt && tierOpt.isSubmenuTrigger) {
          simulateRealClick(tierOpt.element);
          await sleep(300);
          tierOpt = findThinkingTierOptionInOverlay(targetTier);
        }

        if (tierOpt && !tierOpt.isSubmenuTrigger) {
          if (!tierOpt.alreadySelected) {
            reportStatus(
              `正在锁定推理程度 -> ${targetTier.toUpperCase()}`,
              `在模型菜单内切换至 ${tierOpt.label}...`
            );
            simulateRealClick(tierOpt.element);
            await sleep(350);
          }
          thinkingLocked = true;
        }

        await closeActiveOverlays();
      }
    }

    await closeActiveOverlays();

    const inputEl = findInputElement();
    if (inputEl) {
      inputEl.focus();
    }

    reportStatus(
      `双锁就绪: ${finalModelLabel} · Thinking=${targetTier.toUpperCase()}`,
      thinkingLocked
        ? `已确认开启 ${targetTier.toUpperCase()} 深度思考模式`
        : `模型已锁定 (${finalModelLabel})`
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
    ];

    for (const sel of newChatSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        await sleep(800);
        return;
      }
    }
  }

  async function injectPromptAndSend(promptText) {
    await closeActiveOverlays();

    const inputEl = await waitForInputReady(20000);

    inputEl.focus();
    await sleep(150);

    if (inputEl.tagName.toLowerCase() === 'textarea') {
      inputEl.value = promptText;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

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

    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(350);

    let sendBtn = findSendButton();
    for (let retry = 0; retry < 5 && !sendBtn; retry++) {
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
      sendBtn = findSendButton();
    }

    if (sendBtn) {
      simulateRealClick(sendBtn);
    } else {
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

  async function waitForGenerationComplete(targetUserQueryEl, projectName, timeoutMs = 360000) {
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

        // 探测 Google 官方安全策略拦截卡片（如触发敏感词拒答）
        const safetyBlock = findSafetyBlockElement();
        if (safetyBlock) {
          const blockText = (safetyBlock.innerText || '').replace(/\s+/g, ' ').trim();
          throw new Error(`[SAFETY_BLOCKED] Google 官方安全策略拦截: ${blockText || '触发敏感内容防护'}`);
        }

        const responses = getModelResponseElements();

        // 绝对安全隔离：只接受本次提问后新生成的 model-response，严禁匹配任何已有历史节点
        const unhandledResponses = responses.filter((res) => !res.hasAttribute('data-argon-existing'));
        if (unhandledResponses.length === 0) {
          // 本轮模型的响应容器尚未渲染挂载，继续等待
          continue;
        }

        const targetResponseNode = unhandledResponses[unhandledResponses.length - 1];

        const currentText = (targetResponseNode.innerText || '').trim();
        const stopVisible = isStopButtonVisible();

        // 检查回答内是否出现拒答固定句式
        if (/^(I cannot help with that|I'm unable to assist|作为人工智能模型，我无法|很抱歉，我不能)/i.test(currentText)) {
          throw new Error(`[SAFETY_REFUSAL] Argon 拒答: ${currentText.slice(0, 80)}`);
        }

        if (!generationStarted) {
          if (stopVisible || currentText.length > 0) {
            generationStarted = true;
            lastMutationTime = Date.now();
            reportStatus(`Argon 正在回复 [${projectName}]`, '已检测到流式输出');
          }
          continue;
        }

        if (currentText !== lastObservedText) {
          lastObservedText = currentText;
          lastMutationTime = Date.now();
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          reportStatus(
            `正在接收 [${projectName}] 回复...`,
            `已生成 ${currentText.length} 字符 (${elapsedSec}s)`
          );
        }

        const quietDuration = Date.now() - lastMutationTime;
        const isSubstantial = currentText.length > 30;
        const isNotJustThinking =
          !/^thinking(\.\.\.)?$/i.test(currentText) &&
          !/^思考中(\.\.\.)?$/i.test(currentText);

        if (!stopVisible && isSubstantial && isNotJustThinking && quietDuration >= 3500) {
          await sleep(600);
          if (!isStopButtonVisible()) {
            return targetResponseNode;
          }
        }
      }
      throw new Error('等待 Gemini 4 Argon 生成回复超时。请确认网页端未处于卡顿或遮罩状态。');
    } finally {
      observer.disconnect();
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
      const badgeLabel = `${projectName} · ${targetThinking.toUpperCase()} · ${
        activeCid ? '#' + activeCid.slice(0, 6) : 'NEW'
      }`;

      reportStatus(
        `正在向 [${projectName}] 专属会话提问 (${lockResult.model} / ${targetThinking.toUpperCase()})...`,
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

      // 跟踪本轮提问所生成的最新 user-query 节点
      const latestUserQueryNode = await waitForNewUserQuery(queryCountBefore, 6000);

      // 开启 HIGH 思考深度后首字延迟增加，超时放宽至 360 秒
      const latestResponseNode = await waitForGenerationComplete(
        latestUserQueryNode,
        projectName,
        360000
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

      const finalBadge = `${projectName} · ${targetThinking.toUpperCase()} · ${
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
        thinkingLevel: lockResult.thinkingLevel,
        markdown,
        source,
        timestamp: Date.now(),
      });

      updateHud(
        'CONNECTED',
        `Argon Bridge: [${projectName}] 已完成`,
        `已回传 ${markdown.length} 字符 (${source} · ${targetThinking.toUpperCase()})`,
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

  // 监听单页路由跳转与新建会话：自动检测并切换为高阶架构师模型 + High 深度思考（守护普通用户手动新建对话）
  function initAutoModelGuard() {
    let lastUrl = window.location.href;
    const checkAndEnforce = async () => {
      const cid = getCurrentChatIdFromUrl();
      if (!cid) {
        await sleep(1200);
        await ensureTargetModelAndThinking('Argon', 'high');
      }
    };

    setTimeout(checkAndEnforce, 2000);

    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        checkAndEnforce();
      }
    }, 1500);
  }

  initAutoModelGuard();
  createFloatingHud();
  connectToBackground();
})();
