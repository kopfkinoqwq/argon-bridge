/**
 * Argon Bridge v3.2.0 - Content Script for https://gemini.google.com/*
 * Full-Duplex Autonomous Agent Bus, Zero-Touch Clipboard, O(1) Watchdog & Entropy Guard
 * Features:
 * 1. Top-right HUD displaying connection state + active [Project <-> Chat ID] badge
 * 2. Automatic waiting for rich-textarea readiness after session switching
 * 3. In-page "New Chat" trigger if needed + URL Chat ID harvesting (/app/<chatId>)
 * 4. Dual-engine clean Markdown extraction (Clipboard hook + DOM serializer)
 * 5. Angular CDK / Material 3 工业级零死角双锁 (Argon + High) 与五级浮层清退引擎
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
  // 1. MAIN World 零触剪贴板协议常量 (Zero-Touch Clipboard Interception)
  // =========================================================================
  const MSG_SOURCE_CONTENT = 'ARGON_BRIDGE_CONTENT';
  const MSG_SOURCE_MAIN = 'ARGON_BRIDGE_MAIN';

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
            <span class="version-badge">v3.2.0</span>
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
  // 4. Google Gemini (Angular CDK / Material Menu) 工业级零死角菜单控制与双锁引擎 (v3.2.0)
  //    依据首席架构师审查报告：宿主定位收敛 + 拟真事件流 + 状态双重校验 + 五级递进式浮层彻底清退
  // =========================================================================
  const DEFAULT_TARGET_MODEL_KEYWORDS = ['argon', '4 argon', 'gemini 4', 'pro', 'advanced', 'deep think'];

  /**
   * 1. 基础可见性与几何校验（依据 Argon 规范，严防 0 尺寸/不可见元素）
   */
  function isVisible(el) {
    if (!el || !(el instanceof Element) || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity || '1') < 0.05
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  /**
   * 提取纯净可见文本（移除 icon 字体名如 "check"、"chevron_right"、"spark" 等干扰）
   */
  function getCleanElementText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll('mat-icon, .material-symbols-outlined, .google-symbols, svg, script, style')
      .forEach((icon) => icon.remove());
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function getElementDescriptor(el) {
    if (!el) return '';
    const clean = getCleanElementText(el);
    const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const aria = el.getAttribute('aria-label') || '';
    const tooltip = el.getAttribute('mattooltip') || el.getAttribute('title') || '';
    return `${clean} | ${raw} | ${aria} | ${tooltip}`.replace(/\s+/g, ' ').trim();
  }

  /**
   * 2. 向上收敛至真正的交互宿主 (杜绝命中内部 span/div 或外层 menu 容器)
   */
  const INTERACTIVE_ITEM_HOST_SELECTOR = [
    'button[role="menuitemradio"]',
    'button[role="menuitemcheckbox"]',
    'button[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitem"]',
    '[role="option"]',
    'button.mat-mdc-menu-item',
    'button.mat-menu-item',
    'mat-option',
    '[cdkMenuItem]',
    '[cdkMenuItemRadio]'
  ].join(', ');

  function resolveMenuItemHost(el) {
    if (!el || !(el instanceof Element)) return null;
    const closestHost = el.closest(INTERACTIVE_ITEM_HOST_SELECTOR);
    if (closestHost) return closestHost;

    if (el.getAttribute('role') === 'menu' || el.classList.contains('cdk-overlay-pane')) {
      return null;
    }
    return el.closest('button, [tabindex]') || el;
  }

  /**
   * 3. 精准判定菜单项是否已被选中
   *    - 注意：Angular Material 常在每个 radio 项内都渲染 <mat-icon>check</mat-icon>，
   *      未选中项仅通过 CSS opacity: 0 或 visibility: hidden 隐藏，必须校验图标真实可见性！
   */
  function isMenuItemSelected(itemEl) {
    const host = resolveMenuItemHost(itemEl);
    if (!host) return false;

    if (
      host.getAttribute('aria-checked') === 'true' ||
      host.getAttribute('aria-selected') === 'true' ||
      host.classList.contains('mdc-list-item--selected') ||
      host.classList.contains('mat-mdc-option-active')
    ) {
      return true;
    }

    const icons = host.querySelectorAll('mat-icon, .mat-mdc-menu-item-icon, svg, [class*="check"]');
    for (const icon of icons) {
      if (isVisible(icon)) {
        const iconText = (icon.textContent || '').trim().toLowerCase();
        if (iconText === 'check' || iconText === '✓' || iconText === '✔' || icon.tagName.toLowerCase() === 'svg') {
          return true;
        }
      }
    }

    const visibleText = (host.innerText || '').trim();
    return /^[✓✔]/.test(visibleText);
  }

  const isElementSelected = isMenuItemSelected; // 兼容别名

  /**
   * 4. 零死角定位二级菜单中的「高 / 超级详尽」真实可点击宿主
   *    - 严格规避「低 / 快速高效」中的“高”字子串碰撞
   *    - 严格锁定最顶层（二级子菜单）中的叶子可交互宿主
   */
  function findThinkingLevelHighOption() {
    const menuPanels = Array.from(
      document.querySelectorAll(
        '.cdk-overlay-container [role="menu"], .cdk-overlay-container .mat-mdc-menu-panel, .cdk-overlay-container .cdk-overlay-pane'
      )
    )
      .filter(isVisible)
      .reverse();

    const searchRoots = menuPanels.length > 0 ? menuPanels : [document];

    for (const root of searchRoots) {
      const candidates = Array.from(root.querySelectorAll(INTERACTIVE_ITEM_HOST_SELECTOR)).filter(
        (el) => {
          if (!isVisible(el)) return false;
          const hasPopup = el.getAttribute('aria-haspopup');
          if (hasPopup === 'true' || hasPopup === 'menu') return false;
          if (el.classList.contains('mat-mdc-menu-trigger') || el.classList.contains('mat-mdc-menu-submenu-trigger')) return false;
          return true;
        }
      );

      let bestMatch = null;
      let bestScore = 0;

      for (const host of candidates) {
        const rawText = (host.innerText || host.textContent || '').trim();
        const normText = rawText.replace(/\s+/g, ' ');

        // 【铁律】直接排除“低 / 快速高效”与“中 / 深度适中”，彻底杜绝“快速高效”中的“高”字误匹配！
        if (/快速高效|深度适中|^(?:✓|check\s*)?[低中](?:\s|$|\/)/i.test(normText)) {
          continue;
        }

        const lines = rawText
          .split('\n')
          .map((l) => l.replace(/^[✓✔]|^check$/gi, '').trim())
          .filter(Boolean);
        const primaryTitle = lines[0] || '';

        let score = 0;
        if (normText.includes('超级详尽')) score += 100;
        if (primaryTitle === '高' || /^高\s*\/\s*超级详尽/.test(normText)) score += 80;
        if (/^(?:✓|check\s*)?高(?:\s|$|\/)/.test(normText)) score += 50;
        if (/^high\b/i.test(primaryTitle) || /super\s*detailed/i.test(normText)) score += 40;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = host;
        }
      }

      if (bestMatch && bestScore >= 40) {
        return bestMatch;
      }
    }

    return null;
  }

  /**
   * 5. 等待元素动画结束、几何坐标稳定（防止缩放动画期间点击落空）
   */
  async function waitForGeometryStable(el, maxWaitMs = 250) {
    if (!el) return;
    const start = performance.now();
    let lastRect = el.getBoundingClientRect();

    while (performance.now() - start < maxWaitMs) {
      await sleep(35);
      if (!el.isConnected) return;
      const curRect = el.getBoundingClientRect();
      const delta =
        Math.abs(curRect.left - lastRect.left) +
        Math.abs(curRect.top - lastRect.top) +
        Math.abs(curRect.width - lastRect.width) +
        Math.abs(curRect.height - lastRect.height);

      if (delta < 0.5 && curRect.width > 4 && curRect.height > 4) {
        return;
      }
      lastRect = curRect;
    }
  }

  /**
   * 6. 派发带完整 keyCode (兼容 Chromium + Angular CDK) 的键盘事件
   */
  function dispatchCdkKeyEvent(target, type, key, code, keyCode) {
    if (!target) return;
    const ev = new KeyboardEvent(type, {
      key,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    });
    if (ev.keyCode !== keyCode) {
      try {
        Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
        Object.defineProperty(ev, 'which', { get: () => keyCode });
      } catch (_) {}
    }
    target.dispatchEvent(ev);
  }

  /**
   * 7. 模拟 100% 拟真浏览器指针悬停与点击事件流
   */
  function simulateHover(el) {
    if (!el || !isVisible(el)) return;
    const rect = el.getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    const common = {
      view: window,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    };

    el.dispatchEvent(new PointerEvent('pointerover', { ...common, bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...common, bubbles: false, cancelable: false }));
    el.dispatchEvent(new MouseEvent('mouseover', { ...common, bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { ...common, bubbles: false, cancelable: false }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...common, bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new MouseEvent('mousemove', { ...common, bubbles: true, cancelable: true, composed: true }));
  }

  function simulateLeave(el) {
    if (!el || !(el instanceof Element)) return;
    const common = { view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerout', { ...common, bubbles: true, cancelable: true }));
    el.dispatchEvent(new PointerEvent('pointerleave', { ...common, bubbles: false, cancelable: false }));
    el.dispatchEvent(new MouseEvent('mouseout', { ...common, bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseleave', { ...common, bubbles: false, cancelable: false }));
  }

  async function simulateRealClick(rawEl) {
    const el = resolveMenuItemHost(rawEl) || rawEl;
    if (!el || !isVisible(el)) return;

    const rect = el.getBoundingClientRect();
    const clientX = Math.round(rect.left + Math.max(4, rect.width / 2));
    const clientY = Math.round(rect.top + Math.max(4, rect.height / 2));

    const baseOpts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      detail: 1
    };

    const downOpts = {
      ...baseOpts,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    };

    const upOpts = {
      ...baseOpts,
      button: 0,
      buttons: 0,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    };

    // Step 1: 完整按下事件流
    el.dispatchEvent(new PointerEvent('pointerdown', downOpts));
    el.dispatchEvent(new MouseEvent('mousedown', downOpts));

    // Step 2: 赋予真实 DOM 焦点（模拟浏览器 mousedown 默认聚焦行为，激活 CDK FocusKeyManager）
    if (typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch (_) {}
    }
    await sleep(25);

    // Step 3: 完整抬起与带坐标 detail=1 的真实 click 事件
    el.dispatchEvent(new PointerEvent('pointerup', upOpts));
    el.dispatchEvent(new MouseEvent('mouseup', upOpts));
    el.dispatchEvent(new MouseEvent('click', upOpts));
  }

  /**
   * 8. 工业级 CDK 菜单项激活函数（自动向上收敛宿主 + 动画同步 + 多重兜底激活）
   */
  async function activateCdkMenuItem(rawItemEl) {
    const itemEl = resolveMenuItemHost(rawItemEl);
    if (!itemEl) return false;

    // 等待子菜单入场缩放动画彻底稳定
    await waitForGeometryStable(itemEl, 220);

    // 1. 悬停并聚焦宿主（使 Angular FocusKeyManager 将当前项设为 activeItem）
    simulateHover(itemEl);
    await sleep(50);
    if (typeof itemEl.focus === 'function') {
      try { itemEl.focus({ preventScroll: true }); } catch (_) {}
    }
    await sleep(50);

    // 2. 执行主点击流
    await simulateRealClick(itemEl);
    await sleep(160);

    // 判定是否成功：菜单已自动收起（最典型的成功标志）或当前项已变为选中态
    if (!isVisible(itemEl) || isMenuItemSelected(itemEl)) {
      return true;
    }

    // 3. 兜底 1：若仍未选中，调用一次原生 .click()
    if (typeof itemEl.focus === 'function') {
      try { itemEl.focus({ preventScroll: true }); } catch (_) {}
    }
    itemEl.click();
    await sleep(120);

    if (!isVisible(itemEl) || isMenuItemSelected(itemEl)) {
      return true;
    }

    // 4. 兜底 2：针对 CdkMenuItemRadio 派发带 keyCode=32 (Space) 与 keyCode=13 (Enter) 的键盘激活
    if (typeof itemEl.focus === 'function') {
      try { itemEl.focus({ preventScroll: true }); } catch (_) {}
    }
    dispatchCdkKeyEvent(itemEl, 'keydown', ' ', 'Space', 32);
    dispatchCdkKeyEvent(itemEl, 'keyup', ' ', 'Space', 32);
    await sleep(80);

    if (isVisible(itemEl) && !isMenuItemSelected(itemEl)) {
      dispatchCdkKeyEvent(itemEl, 'keydown', 'Enter', 'Enter', 13);
      dispatchCdkKeyEvent(itemEl, 'keyup', 'Enter', 'Enter', 13);
      await sleep(100);
    }

    return !isVisible(itemEl) || isMenuItemSelected(itemEl);
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

  /**
   * 9. 五级递进式浮层清退引擎：确保发送提示词前页面 Overlay 100% 物理消失
   */
  function getVisibleMenuOverlays() {
    const panes = Array.from(
      document.querySelectorAll(
        '.cdk-overlay-container .cdk-overlay-pane, .cdk-overlay-container [role="menu"], .cdk-overlay-container .mat-mdc-menu-panel'
      )
    );
    return panes.filter((el) => {
      if (!isVisible(el)) return false;
      // 仅针对包含菜单/列表项的浮层
      return Boolean(
        el.getAttribute('role') === 'menu' ||
          el.getAttribute('role') === 'listbox' ||
          el.querySelector('[role="menu"], [role="menuitem"], [role="menuitemradio"], [role="option"], .mat-mdc-menu-item')
      );
    });
  }

  async function closeActiveOverlays() {
    // === Stage 1: 解除所有菜单项与父级触发器的 Hover 锁 ===
    const hoveredNodes = document.querySelectorAll(
      '.cdk-overlay-container [role^="menuitem"], .cdk-overlay-container [role="menu"], [aria-expanded="true"]'
    );
    hoveredNodes.forEach(simulateLeave);
    await sleep(40);

    if (getVisibleMenuOverlays().length === 0) return true;

    // === Stage 2: 自底向上（先二级子菜单、再一级主菜单）对 [role="menu"] 本身派发 Escape ===
    for (let round = 0; round < 3; round++) {
      const visibleMenus = Array.from(
        document.querySelectorAll('.cdk-overlay-container [role="menu"], .cdk-overlay-container .mat-mdc-menu-panel')
      )
        .filter(isVisible)
        .reverse(); // 逆序：从最深层子菜单开始关闭

      if (visibleMenus.length === 0 && getVisibleMenuOverlays().length === 0) {
        return true;
      }

      for (const menuEl of visibleMenus) {
        const activeChild = menuEl.querySelector('[tabindex="0"], button, [role^="menuitem"]') || menuEl;
        if (typeof activeChild.focus === 'function') {
          try { activeChild.focus({ preventScroll: true }); } catch (_) {}
        }
        dispatchCdkKeyEvent(activeChild, 'keydown', 'Escape', 'Escape', 27);
        dispatchCdkKeyEvent(activeChild, 'keyup', 'Escape', 'Escape', 27);
        dispatchCdkKeyEvent(menuEl, 'keydown', 'Escape', 'Escape', 27);
        dispatchCdkKeyEvent(menuEl, 'keyup', 'Escape', 'Escape', 27);
        await sleep(60);
      }

      // 同步向 body / document 广播一次 Escape（触发 OverlayKeyboardDispatcher）
      dispatchCdkKeyEvent(document.activeElement || document.body, 'keydown', 'Escape', 'Escape', 27);
      dispatchCdkKeyEvent(document.body, 'keydown', 'Escape', 'Escape', 27);
      await sleep(60);

      if (getVisibleMenuOverlays().length === 0) return true;

      // === Stage 3: 逆序完整点击 Backdrop + 触发 OutsidePointerEvents ===
      const backdrops = Array.from(document.querySelectorAll('.cdk-overlay-backdrop'))
        .filter(isVisible)
        .reverse();

      for (const bd of backdrops) {
        await simulateRealClick(bd);
        await sleep(60);
      }

      if (getVisibleMenuOverlays().length === 0) return true;

      // 向页面左上角安全空白区 (2, 2) 派发完整指针点击，触发 CDK outsidePointerEvents()
      const safeTarget = document.body;
      const outOpts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: 2,
        clientY: 2,
        button: 0,
        detail: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      };
      safeTarget.dispatchEvent(new PointerEvent('pointerdown', { ...outOpts, buttons: 1 }));
      safeTarget.dispatchEvent(new MouseEvent('mousedown', { ...outOpts, buttons: 1 }));
      safeTarget.dispatchEvent(new PointerEvent('pointerup', { ...outOpts, buttons: 0 }));
      safeTarget.dispatchEvent(new MouseEvent('mouseup', { ...outOpts, buttons: 0 }));
      safeTarget.dispatchEvent(new MouseEvent('click', { ...outOpts, buttons: 0 }));
      await sleep(80);

      if (getVisibleMenuOverlays().length === 0) return true;
    }

    // === Stage 4: 若主菜单触发器仍处于 aria-expanded="true"，点击主触发按钮将其收起 ===
    const openTriggers = Array.from(
      document.querySelectorAll('button[aria-expanded="true"], [aria-haspopup="menu"][aria-expanded="true"]')
    ).filter((btn) => !btn.closest('.cdk-overlay-container') && isVisible(btn));

    for (const trigger of openTriggers) {
      await simulateRealClick(trigger);
      await sleep(100);
    }

    if (getVisibleMenuOverlays().length === 0) return true;

    // === Stage 5: 终极物理清退兜底（绝不允许任何僵尸 Overlay 残留遮挡正文） ===
    const zombiePanes = getVisibleMenuOverlays();
    for (const node of zombiePanes) {
      const pane = node.closest('.cdk-overlay-pane') || node;
      pane.style.setProperty('display', 'none', 'important');
      pane.style.setProperty('visibility', 'hidden', 'important');
      pane.style.setProperty('pointer-events', 'none', 'important');
    }

    const zombieBackdrops = document.querySelectorAll('.cdk-overlay-backdrop');
    zombieBackdrops.forEach((bd) => {
      bd.classList.remove('cdk-overlay-backdrop-showing');
      bd.style.setProperty('display', 'none', 'important');
      bd.style.setProperty('pointer-events', 'none', 'important');
    });

    await sleep(40);
    return getVisibleMenuOverlays().length === 0;
  }

  /**
   * 定位底部输入栏或顶部模型切换器药丸按钮
   */
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
      if (btn.closest('mat-sidenav') || btn.closest('pre') || btn.closest('model-response') || btn.closest('.cdk-overlay-container')) {
        continue;
      }
      const text = getCleanElementText(btn);
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

  // 会话级高思考锁定状态缓存（按 chatId 记录，同一会话内成功锁定一次后不再重复弹窗，新会话或无 chatId 则强制主动执行锁定）
  let sessionHighThinkingLockedChatId = null;

  /**
   * 检查底部模型药丸是否在界面上真正显式展示了独立思考档位标签（极少数 UI 变体会直接渲染 "Argon · 高"）
   * 注意：绝不可盲目匹配 aria 中的 "高级"，因为 "高级模型" 属于 Pro/Argon 模型本身的定语，绝非思考档位！
   */
  function isModelPillShowingExplicitHigh(btn) {
    if (!btn) return false;
    const clean = getCleanElementText(btn);
    // 仅当可见文本明确以 "高" 或 "High" 作为独立词/后缀呈现时才有效（如 "Argon 高"、"Argon · 高"、"Argon High"）
    if (/(\b(low|medium|minimal)\b|低|中)/i.test(clean)) return false;
    return /(\s|·|-|\()+(high|高)(\)|\s|$)/i.test(clean) || /^(高|high)$/i.test(clean);
  }

  /**
   * 在主模型菜单中查找“思考等级 ▶ / Thinking level”二级菜单入口触发器
   * 严苛过滤：彻底排除 3.1 Pro (高级推理 / Advanced reasoning) 及所有主模型，100% 锁定菜单底部的思考等级入口！
   */
  function findThinkingSubmenuTriggerInOverlay() {
    const container = document.querySelector('.cdk-overlay-container') || document.body;
    const items = Array.from(container.querySelectorAll(INTERACTIVE_ITEM_HOST_SELECTOR)).filter(isVisible);

    for (const rawItem of items) {
      const item = resolveMenuItemHost(rawItem) || rawItem;
      const text = getCleanElementText(item).toLowerCase();
      const raw = (item.innerText || item.textContent || '').toLowerCase();
      const aria = (item.getAttribute('aria-label') || '').toLowerCase();

      // 1. 绝对排除所有主模型选项（绝不可让 3.1 Pro 高级推理劫持触发器！）
      if (
        /\b(3\.1|3\.5|3\.8|4\s*argon|pro|flash|lite|argon|ultra)\b/i.test(text) ||
        /\b(3\.1|3\.5|3\.8|4\s*argon|pro|flash|lite|argon|ultra)\b/i.test(aria) ||
        /高级推理|复杂任务|极速回答|全方位帮助/i.test(text) ||
        /高级推理|复杂任务|极速回答|全方位帮助/i.test(raw)
      ) {
        continue;
      }

      // 2. 排除子选项本身（高/超级详尽、中/深度适中、低/快速高效）
      if (/快速高效|深度适中|超级详尽|extra\s*thorough/i.test(`${text} ${raw}`)) {
        continue;
      }

      // 3. 必须包含“思考等级”或“思考”关键词，且包含二级子菜单指示符（向右箭头或 aria-haspopup）
      const hasSubmenuCue =
        item.getAttribute('aria-haspopup') === 'menu' ||
        item.getAttribute('aria-haspopup') === 'true' ||
        item.classList.contains('mat-mdc-menu-submenu-trigger') ||
        item.classList.contains('mat-mdc-menu-trigger') ||
        item.querySelector('mat-icon, svg, .material-symbols-outlined') !== null ||
        /[▶>›»]/.test(raw);

      if (
        /(思考等级|思考深度|推理等级|thinking\s*level|thinking\s*tier)/i.test(`${text} ${aria}`) ||
        (hasSubmenuCue && /(思考|thinking)/i.test(`${text} ${aria}`))
      ) {
        return item;
      }
    }
    return null;
  }

  /**
   * 在主模型菜单中查找目标主模型项（如 "4 Argon / 复杂任务"）
   */
  function findTargetModelOptionInOverlay(targetKeywords) {
    const container = document.querySelector('.cdk-overlay-container') || document.body;
    const items = Array.from(container.querySelectorAll(INTERACTIVE_ITEM_HOST_SELECTOR)).filter(isVisible);

    for (const keyword of targetKeywords) {
      const kw = keyword.toLowerCase();
      for (const rawItem of items) {
        const item = resolveMenuItemHost(rawItem) || rawItem;
        const text = getCleanElementText(item).toLowerCase();
        // 排除“思考等级”触发器本身与子选项
        if (/(思考等级|thinking\s*level|超级详尽|快速高效|深度适中)/i.test(text)) continue;

        if (text.includes(kw)) {
          const isDisabled =
            item.disabled ||
            item.getAttribute('aria-disabled') === 'true' ||
            item.classList.contains('mat-mdc-menu-item-disabled');
          if (!isDisabled) {
            return {
              element: item,
              matchedKeyword: keyword,
              fullText: getCleanElementText(item),
              alreadySelected: isMenuItemSelected(item),
            };
          } else {
            // 选项存在但被官方置灰禁用 -> 确诊官方额度耗尽！
            setArgonQuotaExhausted(true, 'Argon 选项被官方置灰禁用（当前周期额度已达上限）');
            return {
              element: item,
              matchedKeyword: keyword,
              fullText: getCleanElementText(item),
              isDisabled: true,
              quotaExhausted: true,
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * 展开“思考等级 ▶”二级子菜单并激活“高 / 超级详尽”选项
   */
  async function expandSubmenuAndSelectTier(submenuTriggerEl) {
    if (!submenuTriggerEl) return false;

    const triggerHost = resolveMenuItemHost(submenuTriggerEl) || submenuTriggerEl;

    // 1. 采用“聚焦 + 悬停 + 物理点击 + 向右键”复合激活，确保 100% 触发 CDK matMenuTriggerFor 展开
    if (typeof triggerHost.focus === 'function') {
      try { triggerHost.focus({ preventScroll: true }); } catch (_) {}
    }
    simulateHover(triggerHost);
    await sleep(100);
    await simulateRealClick(triggerHost);
    dispatchCdkKeyEvent(triggerHost, 'keydown', 'ArrowRight', 'ArrowRight', 39);
    dispatchCdkKeyEvent(triggerHost, 'keyup', 'ArrowRight', 'ArrowRight', 39);

    // 2. 轮询等待二级子菜单在 DOM 中渲染并检索叶子选项
    let highHost = null;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 3500) {
      await sleep(100);
      highHost = findThinkingLevelHighOption();
      if (highHost) break;
    }

    if (!highHost) {
      console.warn('[Argon-Bridge] 未在二级子菜单中定位到「高 / 超级详尽」选项');
      return false;
    }

    // 3. 精准激活「高 / 超级详尽」叶子节点
    const alreadySelected = isMenuItemSelected(highHost);
    if (!alreadySelected) {
      reportStatus('锁定思考等级 -> HIGH', '已定位「高 / 超级详尽」宿主，正在激活...');
      const ok = await activateCdkMenuItem(highHost);
      await sleep(200);
      return ok;
    } else {
      reportStatus('思考深度已处于最高档', '「高 / 超级详尽」已处于勾选状态');
      await simulateRealClick(highHost);
      await sleep(100);
      return true;
    }
  }

  /**
   * 核心预检与双重锁定总控流水线：
   * 1. 确保主模型锁定为 4 Argon
   * 2. 确保二级子菜单“思考等级”锁定为“高 / 超级详尽”
   * 3. 彻底清空所有 CDK Overlay 浮层
   */
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

    try {
      const switcherBtn = findModelSwitcherButton();
      if (!switcherBtn) {
        return { model: finalModelLabel, thinkingLevel: targetTier, thinkingLocked: false };
      }

      const initialBtnText = getCleanElementText(switcherBtn);
      const isModelAlreadyTarget = initialBtnText.toLowerCase().includes(targetModelKeywords[0]);
      const currentCid = getCurrentChatIdFromUrl();

      // 会话级放行检查：只有当此会话在页面运行时中已经被成功锁过 High，或者按钮文本明确带 "高" 时才放行
      if (isModelAlreadyTarget && targetTier === 'high') {
        if (
          isModelPillShowingExplicitHigh(switcherBtn) ||
          (currentCid && sessionHighThinkingLockedChatId === currentCid)
        ) {
          await closeActiveOverlays();
          return {
            model: initialBtnText,
            thinkingLevel: targetTier,
            thinkingLocked: true,
          };
        }
      }

      // ---------------------------------------------------------------------
      // Pass 1：打开模型菜单，确保主模型切换至 4 Argon
      // ---------------------------------------------------------------------
      reportStatus(
        `正在对齐模型与思考深度 (${preferredModel} / ${targetTier.toUpperCase()})...`,
        `当前按钮为 [${initialBtnText || 'Flash'}]，呼出设置菜单...`
      );

      await simulateRealClick(switcherBtn);
      await sleep(350);

      let modelOpt = null;
      const modelWaitStart = Date.now();
      while (Date.now() - modelWaitStart < 2500) {
        modelOpt = findTargetModelOptionInOverlay(targetModelKeywords);
        if (modelOpt) break;
        await sleep(100);
      }

      if (modelOpt) {
        if (modelOpt.quotaExhausted) {
          await closeActiveOverlays();
          throw new Error('[QUOTA_EXHAUSTED] 云端 Gemini 4 Argon 官方额度已耗尽（选项已被官方禁用，需等待数小时重置）。已自动触发退火保护，请由本地执行官接管。');
        }
        if (!modelOpt.alreadySelected) {
          reportStatus('切换主模型', `选中目标模型 [${modelOpt.fullText}]...`);
          await activateCdkMenuItem(modelOpt.element);
          await sleep(400);
        }
        finalModelLabel = modelOpt.fullText || preferredModel;
      }

      // ---------------------------------------------------------------------
      // Pass 2：锁定“思考等级 -> 高 (超级详尽)”
      // ---------------------------------------------------------------------
      // 2a. 先直接在浮层中探测是否已露出“高 / 超级详尽”叶子选项
      let directHigh = findThinkingLevelHighOption();
      if (directHigh) {
        if (!isMenuItemSelected(directHigh)) {
          reportStatus('锁定思考深度', '直接命中「高 / 超级详尽」选项，激活中...');
          thinkingLocked = await activateCdkMenuItem(directHigh);
          await sleep(200);
        } else {
          thinkingLocked = true;
        }
      } else {
        // 2b. 探测“思考等级 ▶”触发器并展开二级子菜单
        let subTrigger = null;
        const trigWaitStart = Date.now();
        while (Date.now() - trigWaitStart < 2500) {
          subTrigger = findThinkingSubmenuTriggerInOverlay();
          if (subTrigger) break;
          await sleep(100);
        }

        if (subTrigger) {
          reportStatus('展开思考设置', '定位到 [思考等级] 选项，展开二级菜单...');
          thinkingLocked = await expandSubmenuAndSelectTier(subTrigger);
        } else {
          reportStatus('⚠️ 提示', '未在菜单中识别到独立思考等级触发器');
        }
      }

      if (thinkingLocked && currentCid) {
        sessionHighThinkingLockedChatId = currentCid;
      }
    } catch (err) {
      console.warn('[Argon-Bridge] Model/Thinking lock warning:', err);
    } finally {
      // ---------------------------------------------------------------------
      // Pass 3：五级递进式浮层彻底清退，确保 100% 物理消失
      // ---------------------------------------------------------------------
      await closeActiveOverlays();
    }

    // -----------------------------------------------------------------------
    // Pass 4：归还输入框焦点，准备接收并注入 Prompt
    // -----------------------------------------------------------------------
    const finalBtn = findModelSwitcherButton();
    if (finalBtn) {
      const updatedPillText = getCleanElementText(finalBtn);
      if (updatedPillText) {
        finalModelLabel = updatedPillText;
      }
    }

    const inputEl = findInputElement();
    if (inputEl) {
      try { inputEl.focus(); } catch (_) {}
    }

    reportStatus(
      `双锁就绪: [${finalModelLabel}]`,
      thinkingLocked
        ? `已确认锁定 ${targetTier.toUpperCase()} (超级详尽) 深度思考`
        : `以当前档位 (${finalModelLabel}) 执行`
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

  // =========================================================================
  // 5. 零触剪贴板捕获 (Zero-Touch Clipboard Interception)
  // =========================================================================

  /**
   * 在已锁定的尾节点容器内，精准定位【回复级】复制按钮，严防误触代码块复制按钮
   * @param {HTMLElement} activeTurnNode 当前轮次锁定的回复容器
   * @returns {HTMLButtonElement | null}
   */
  function findResponseCopyButton(activeTurnNode) {
    if (!activeTurnNode) return null;

    // 排除黑名单：代码块容器、内联代码、思考过程折叠容器、用户提问区
    const EXCLUDE_ZONE_SELECTOR = [
      'code-block',
      '.code-block',
      'pre',
      'code',
      '[class*="code-block"]',
      '[data-test-id*="code"]',
      'model-thoughts',
      '[data-test-id*="thought"]',
      'user-query',
    ].join(', ');

    // 优先从回复底部的 Action Bar 容器内查找
    const actionScope =
      activeTurnNode.querySelector('message-actions, .message-actions, .response-footer') || activeTurnNode;
    const candidateButtons = actionScope.querySelectorAll('button, [role="button"]');

    for (const btn of candidateButtons) {
      // 1. 铁律：一旦按钮位于代码块或排除区域内部，直接跳过
      if (btn.closest(EXCLUDE_ZONE_SELECTOR)) continue;

      // 2. 提取多维语义属性
      const testId = (btn.getAttribute('data-test-id') || '').toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
      const tooltip = (btn.getAttribute('mattooltip') || btn.getAttribute('title') || '').trim();
      const iconName = (
        btn.querySelector('mat-icon, [data-mat-icon-name]')?.getAttribute('data-mat-icon-name') ||
        btn.querySelector('mat-icon')?.textContent ||
        ''
      ).trim();

      const combinedSemantics = `${testId} | ${ariaLabel} | ${tooltip}`;

      // 3. 排除带有“代码 / code / 链接 / link / share”字样的特定复制按钮
      if (/code|代码|snippet|link|链接|share/i.test(combinedSemantics)) continue;

      // 4. 命中条件：test-id 匹配，或语义标签匹配 Copy/复制，或 Material 图标为 content_copy
      const isCopyTestId = testId === 'copy-button' || testId === 'action-copy-button';
      const isCopyLabel =
        /^(copy|copy response|复制|复制回答|复制内容)$/i.test(ariaLabel) ||
        /^(copy|copy response|复制|复制回答|复制内容)$/i.test(tooltip);
      const isCopyIcon = iconName === 'content_copy' && /copy|复制/i.test(combinedSemantics);

      if (isCopyTestId || isCopyLabel || isCopyIcon) {
        return btn;
      }
    }
    return null;
  }

  /**
   * DOM 渐进式兜底提取（仅在局部子树 activeTurnNode 内执行）
   */
  function extractDomFallback(activeTurnNode) {
    if (!activeTurnNode) return '';
    const markdownContainer =
      activeTurnNode.querySelector('.markdown, message-content, [class*="markdown-main-panel"]') || activeTurnNode;
    const domMd = convertDomNodeToMarkdown(markdownContainer);
    if (domMd && domMd.trim().length > 0) return domMd.trim();
    return (markdownContainer.innerText || markdownContainer.textContent || '').trim();
  }

  /**
   * 零触捕获主流程：ARM 装填 -> 等待 ACK -> 触发原生复制 -> 内存截获回传 -> 失败降级 DOM 提取
   * @param {HTMLElement} activeTurnNode
   * @returns {Promise<{ text: string, source: string }>}
   */
  async function extractMarkdownZeroTouch(activeTurnNode) {
    const copyBtn = findResponseCopyButton(activeTurnNode);
    if (!copyBtn) {
      return { text: extractDomFallback(activeTurnNode), source: 'DOM_FALLBACK_NO_BTN' };
    }

    const reqId = `argon_clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        window.postMessage(
          { source: MSG_SOURCE_CONTENT, type: 'ARGON_CLIPBOARD_DISARM', reqId },
          window.location.origin
        );
      };

      // 兜底总超时（4.2秒，略大于 MAIN World 的 4.0秒自动卸弹）
      const safetyTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ text: extractDomFallback(activeTurnNode), source: 'DOM_FALLBACK_TIMEOUT' });
      }, 4200);

      function onMessage(event) {
        if (event.source !== window || !event.data || event.data.source !== MSG_SOURCE_MAIN) return;
        if (event.data.reqId !== reqId) return;

        if (event.data.type === 'ARGON_CLIPBOARD_ARM_ACK') {
          // 收到 MAIN World 装填完毕确认后，立即触发原生复制按钮点击（彻底消除竞态）
          copyBtn.click();
        } else if (event.data.type === 'ARGON_CLIPBOARD_CAPTURED') {
          if (settled) return;
          settled = true;
          clearTimeout(safetyTimer);
          cleanup();
          resolve({ text: event.data.payload, source: `CLIPBOARD_HOOK (${event.data.method})` });
        } else if (event.data.type === 'ARGON_CLIPBOARD_TIMEOUT') {
          if (settled) return;
          settled = true;
          clearTimeout(safetyTimer);
          cleanup();
          resolve({ text: extractDomFallback(activeTurnNode), source: 'DOM_FALLBACK_HOOK_EXPIRED' });
        }
      }

      window.addEventListener('message', onMessage);

      // 发送装填指令
      window.postMessage(
        {
          source: MSG_SOURCE_CONTENT,
          type: 'ARGON_CLIPBOARD_ARM',
          reqId,
        },
        window.location.origin
      );
    });
  }

  // =========================================================================
  // 6. 尾节点游标锁定与局部看门狗引擎 (TailScopedWatchdog, 复杂度严格锁死 O(1))
  // =========================================================================
  class TailScopedWatchdog {
    constructor() {
      this.chatHistorySelector = 'infinite-scroller, [data-test-id="chat-history-container"], main';
      this.turnTagSelector = 'model-response, .conversation-container, [data-message-author-role="model"]';
    }

    /**
     * 步骤 1：在点击 Send 按钮【之前】调用，记录当前对话流的尾锚点快照
     */
    createPreSubmitAnchor() {
      const scroller = document.querySelector(this.chatHistorySelector) || document.body;
      const allTurns = scroller.querySelectorAll(this.turnTagSelector);
      const lastTurnBeforeSubmit = allTurns.length > 0 ? allTurns[allTurns.length - 1] : null;

      if (lastTurnBeforeSubmit) {
        lastTurnBeforeSubmit.setAttribute('data-argon-anchor-tail', 'true');
      }

      return {
        scroller,
        lastTurnBeforeSubmit,
        previousTurnCount: allTurns.length,
        submitTimestamp: performance.now(),
      };
    }

    /**
     * 步骤 2：点击 Send 后，原子锁定新增的 model-response 节点
     * 仅观察容器直接子层级变化，一旦捕获立即断开观察器
     */
    async lockNewResponseNode(anchor, timeoutMs = 20000) {
      const { scroller, lastTurnBeforeSubmit } = anchor;

      // 快速路径检查：是否已经同步挂载
      const findNewNode = () => {
        if (lastTurnBeforeSubmit && lastTurnBeforeSubmit.isConnected) {
          // 优先通过兄弟节点链向后顺藤摸瓜 (O(1) 指针跳转，完全不扫全表)
          let cursor = lastTurnBeforeSubmit.closest('.conversation-container') || lastTurnBeforeSubmit;
          while (cursor.nextElementSibling) {
            cursor = cursor.nextElementSibling;
            if (cursor.matches?.(this.turnTagSelector)) return cursor;
            const inner = cursor.querySelector?.('model-response');
            if (inner) return inner;
          }
        }
        // 兜底检查队尾元素是否不等于锚点
        const currentTurns = scroller.querySelectorAll(this.turnTagSelector);
        const newest = currentTurns[currentTurns.length - 1];
        if (newest && newest !== lastTurnBeforeSubmit) {
          return newest;
        }
        return null;
      };

      const immediateHit = findNewNode();
      if (immediateHit) return immediateHit;

      // 挂载轻量级观察器捕获新回合节点诞生
      return new Promise((resolve, reject) => {
        let observer = null;
        const timer = setTimeout(() => {
          if (observer) observer.disconnect();
          reject(new Error('WATCHDOG_LOCK_TIMEOUT: 未检测到新增回复容器，疑似 Single-Action 点击被吞或被框架拦截'));
        }, timeoutMs);

        observer = new MutationObserver(() => {
          const hit = findNewNode();
          if (hit) {
            clearTimeout(timer);
            observer.disconnect(); // 关键：捕获瞬间立即卸载 MutationObserver，杜绝流式吐字期间触发回调风暴！
            resolve(hit);
          }
        });

        observer.observe(scroller, { childList: true, subtree: true });
      });
    }

    /**
     * 步骤 3：在锁定的 activeTurnNode 局部子树内执行 O(1) 看门狗轮询
     * 包含：流式进度追踪、CoT 思考块遥测锁、以及四重门禁完成态判定
     */
    async waitForResponseComplete(activeTurnNode, anchor, options = {}) {
      const {
        pollIntervalMs = 350,
        maxWaitMs = 420000, // 支持 Argon High 深度长文本推理
        quiescenceTicksRequired = 3, // 连续 3 个 Tick 字数稳定且按钮就绪才算完成
        onStreamProgress = null,
      } = options;

      const telemetry = {
        hasCoTBlock: false,
        cotDetectedAt: null,
        firstContentTokenAt: null,
        totalChars: 0,
        suspectedSoftDowngrade: false,
      };

      let lastTextLength = -1;
      let stableTicks = 0;
      const startTime = performance.now();

      while (performance.now() - startTime < maxWaitMs) {
        await sleep(pollIntervalMs);

        // 1. 局部探测 CoT (Thinking Process / 思考过程折叠块) —— 第三把遥测锁
        if (!telemetry.hasCoTBlock) {
          const cotNode = activeTurnNode.querySelector(
            'model-thoughts, [data-test-id*="thought"], .thoughts-container, [aria-label*="Thinking"], [aria-label*="思考"]'
          );
          if (
            cotNode ||
            /Thinking|思考过程|Show thinking|展示思路/i.test((activeTurnNode.innerText || '').slice(0, 120))
          ) {
            telemetry.hasCoTBlock = true;
            telemetry.cotDetectedAt = Math.round(performance.now() - anchor.submitTimestamp);
          }
        }

        // 2. 局部读取当前正文长度 (仅查询局部 markdown 节点，耗时 < 0.2ms，零布局重排)
        const contentBox =
          activeTurnNode.querySelector('.markdown, message-content') || activeTurnNode;
        const currentLength = (contentBox.textContent || '').trim().length;

        if (currentLength > 0 && !telemetry.firstContentTokenAt) {
          telemetry.firstContentTokenAt = Math.round(performance.now() - anchor.submitTimestamp);
        }

        if (onStreamProgress && currentLength !== lastTextLength) {
          onStreamProgress({ chars: currentLength, hasCoT: telemetry.hasCoTBlock });
        }

        // 3. 完成态四重门禁校验 (Four-Gate Completion Assertion)
        // 门禁 A：全局输入框区域的 "Stop response / 停止生成" 按钮已消失
        const stopBtn = document.querySelector(
          'button[aria-label*="Stop"], button[aria-label*="停止"], [data-test-id="stop-button"], .stop-button'
        );
        const isGlobalStopGone = !stopBtn || stopBtn.offsetParent === null || stopBtn.disabled;

        // 门禁 B：局部子树内无 aria-busy 或加载动画正在运行
        const isLocalBusy =
          activeTurnNode.getAttribute('aria-busy') === 'true' ||
          Boolean(activeTurnNode.querySelector('[aria-busy="true"], mat-progress-bar, .loading-indicator'));

        // 门禁 C：局部子树底部的【回复级 Copy 按钮】已挂载并可见
        const copyBtn = findResponseCopyButton(activeTurnNode);
        const isCopyButtonReady = Boolean(copyBtn && !copyBtn.disabled);

        // 门禁 D：正文长度进入静默稳定期 (Quiescence)
        if (currentLength > 0 && currentLength === lastTextLength && isGlobalStopGone && !isLocalBusy && isCopyButtonReady) {
          stableTicks++;
        } else {
          stableTicks = 0;
        }

        lastTextLength = currentLength;
        telemetry.totalChars = currentLength;

        if (stableTicks >= quiescenceTicksRequired) {
          // 判定是否存在服务端静默软降级：若要求 High 深度思考，但无 CoT 块且首包极快 (<1500ms)
          if (!telemetry.hasCoTBlock && telemetry.firstContentTokenAt && telemetry.firstContentTokenAt < 1500) {
            telemetry.suspectedSoftDowngrade = true;
          }
          try {
            telemetry.domNodes = document.getElementsByTagName('*').length;
          } catch (_) {
            telemetry.domNodes = 0;
          }
          return { status: 'COMPLETED', telemetry };
        }
      }

      throw new Error('WATCHDOG_STREAM_TIMEOUT: 云端 Argon 响应超时');
    }
  }

  let currentActiveTaskId = null;

  async function handleAskArgonRequest(task) {
    if (isProcessingTask) {
      if (task.requestId && task.requestId === currentActiveTaskId) {
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

      // 1. 发送前记录当前尾锚点快照（Tail-Scoped Anchor O(1)）
      const watchdog = new TailScopedWatchdog();
      const anchor = watchdog.createPreSubmitAnchor();

      // 2. 单动作精准提交 (Single-Action)
      await injectPromptAndSend(task.prompt);
      reportStatus(
        `已发送 [${projectName}] 提问`,
        `等待 Gemini 4 Argon (${targetThinking.toUpperCase()}) 深度推理与回复...`,
        badgeLabel
      );

      // 3. 异步探测与即时绑定 URL 中的新 chatId
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

      // 4. 原子锁定新增的 model-response 尾节点 (O(1) 复杂度，完全不扫全表)
      const latestResponseNode = await watchdog.lockNewResponseNode(anchor, 20000);

      // 5. 在局部子树内执行高能效看门狗轮询，配合 CoT 遥测锁与四重门禁校验
      const { status, telemetry } = await watchdog.waitForResponseComplete(latestResponseNode, anchor, {
        maxWaitMs: 420000,
        onStreamProgress: ({ chars, hasCoT }) => {
          reportStatus(
            hasCoT ? `Argon 正在深度思考 [${projectName}]` : `正在接收 [${projectName}] 回复...`,
            `已生成约 ${chars} 字符${hasCoT ? ' (CoT 思考块已激活)' : ''}`,
            badgeLabel
          );
        },
      });

      reportStatus('生成完毕', '正在通过内存零触劫持提取 Markdown...', badgeLabel);

      // 6. 内存级零触提取 (Zero-Touch Clipboard Interception)
      const { text: markdown, source } = await extractMarkdownZeroTouch(latestResponseNode);
      if (!markdown) {
        throw new Error('提取到的回复内容为空。');
      }

      // 捕获当前会话的 chatId
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
        telemetry,
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
