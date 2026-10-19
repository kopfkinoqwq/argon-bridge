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

  function simulateRealClick(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function findModelDropdownTrigger() {
    // 1. 精确选择器：涵盖底部输入栏与顶部 bard-mode-switcher
    const explicitSelectors = [
      'bard-mode-switcher button',
      '[data-test-id="bard-mode-menu-button"]',
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
        if (btn && btn.offsetParent !== null) {
          const txt = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
          if (/flash|argon|pro|advanced|deep think|gemini|\d\.\d/i.test(txt)) {
            return btn;
          }
        }
      }
    }

    // 2. 启发式探测：扫描可见按钮，定位模型代号按钮
    const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const btn of allButtons) {
      if (!btn || btn.offsetParent === null) continue;
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

  /**
   * 智能模型检测与自动切换：
   * 在新建会话或处于干净的 /app 页面时，自动检测当前模型是否为高阶模型（如 Argon / Pro / Advanced / Thinking）
   * 若非高阶模型（如默认为 Flash / Fast），自动点击菜单完成切换，彻底解决默认模型偏离问题
   */
  async function ensureTargetModel(targetModelKeywords = ['Argon', 'Pro', 'Advanced', 'Thinking']) {
    try {
      const triggerBtn = findModelDropdownTrigger();
      if (!triggerBtn) return false;

      const currentText = (triggerBtn.innerText || '').trim();
      const currentAria = (triggerBtn.getAttribute('aria-label') || '').trim();
      const combinedText = `${currentText} ${currentAria}`.toLowerCase();

      // 如果当前按钮已经处于高阶模型（包含任意目标关键词），直接放行
      const isAlreadyTarget = targetModelKeywords.some((kw) => combinedText.includes(kw.toLowerCase()));
      if (isAlreadyTarget) {
        return true;
      }

      // 当前处于 Flash / Fast 或未知普通模型，展开下拉菜单
      simulateRealClick(triggerBtn);
      await sleep(350);

      const overlayRoot = document.querySelector('.cdk-overlay-container') || document.body;
      const menuSelectors = [
        'button[role="menuitem"]',
        'button[role="menuitemradio"]',
        '[role="option"]',
        'mat-option',
        '.mat-mdc-menu-item',
        '.bard-mode-list-button',
        '.cdk-overlay-pane button',
      ];

      let targetOption = null;
      for (let i = 0; i < 12; i++) {
        const items = [];
        for (const sel of menuSelectors) {
          overlayRoot.querySelectorAll(sel).forEach((el) => {
            if (el && el.offsetParent !== null && !items.includes(el)) {
              items.push(el);
            }
          });
        }

        for (const kw of targetModelKeywords) {
          const lowerKw = kw.toLowerCase();
          for (const item of items) {
            const itemText = (item.innerText || item.textContent || '').replace(/\s+/g, ' ').toLowerCase();
            if (itemText.includes(lowerKw)) {
              const isDisabled =
                item.disabled ||
                item.getAttribute('aria-disabled') === 'true' ||
                item.classList.contains('mat-mdc-menu-item-disabled');
              if (!isDisabled) {
                targetOption = item;
                break;
              }
            }
          }
          if (targetOption) break;
        }

        if (targetOption) break;
        await sleep(150);
      }

      if (targetOption) {
        simulateRealClick(targetOption);
        await sleep(400);
        reportStatus('模型自动锁定', '已将模型自动切换至高阶架构师模式 (Argon/Pro)');
        return true;
      } else {
        // 未匹配到则按 Escape 键关闭浮层，避免遮挡
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(150);
      }
    } catch (_) {}
    return false;
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
    const inputEl = await waitForInputReady(20000);

    inputEl.focus();
    await sleep(120);

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

    await sleep(350);

    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
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

  async function waitForGenerationComplete(targetUserQueryEl, projectName, timeoutMs = 280000) {
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

        // 核心安全隔离：寻找严格位于本轮 targetUserQueryEl 之后的 model-response，彻底防止读取历史上一轮旧消息
        let targetResponseNode = null;
        if (targetUserQueryEl) {
          const following = responses.filter((res) => {
            const pos = targetUserQueryEl.compareDocumentPosition(res);
            return Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING);
          });
          if (following.length > 0) {
            targetResponseNode = following[following.length - 1];
          }
        } else if (responses.length > 0) {
          targetResponseNode = responses[responses.length - 1];
        }

        if (!targetResponseNode) {
          // 本轮模型的响应容器尚未渲染挂载，继续等待
          continue;
        }

        const currentText = (targetResponseNode.innerText || '').trim();
        const stopVisible = isStopButtonVisible();

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
      throw new Error('等待 Gemini 4 Argon 生成回复超时。');
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

    try {
      await waitForInputReady(20000);
      await waitForHistorySettled(2500);

      const activeCid = getCurrentChatIdFromUrl();
      const isNewChat = !activeCid || Boolean(task.forceNewChat);

      if (task.forceNewChat) {
        await ensureCleanNewChatIfRequired(true);
      }

      // 如果是全新会话，自动确保切换至 Pro / Advanced 架构师模型
      if (isNewChat) {
        await ensureTargetModel(['Pro', 'Advanced', 'Thinking', 'Argon']);
      }

      const badgeLabel = `${projectName} · ${activeCid ? '#' + activeCid.slice(0, 6) : 'NEW'}`;

      reportStatus(`正在向 [${projectName}] 专属会话提问...`, `Req: ${task.requestId.slice(0, 8)}`, badgeLabel);

      const queryCountBefore = getUserQueryElements().length;

      await injectPromptAndSend(task.prompt);
      reportStatus(`已发送 [${projectName}] 提问`, '等待 Gemini 4 Argon 响应...', badgeLabel);

      // 跟踪本轮提问所生成的最新 user-query 节点
      const latestUserQueryNode = await waitForNewUserQuery(queryCountBefore, 6000);

      const latestResponseNode = await waitForGenerationComplete(
        latestUserQueryNode,
        projectName
      );
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

      const finalBadge = `${projectName} · ${finalChatId ? '#' + finalChatId.slice(0, 6) : 'BOUND'}`;

      sendMessageToBackground({
        type: 'RESPONSE',
        requestId: task.requestId,
        projectKey: task.projectKey,
        projectName,
        chatId: finalChatId,
        chatUrl: finalChatUrl,
        markdown,
        source,
        timestamp: Date.now(),
      });

      updateHud(
        'CONNECTED',
        `Argon Bridge: [${projectName}] 已完成`,
        `已回传 ${markdown.length} 字符 (${source})`,
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

  // 监听单页路由跳转与新建会话：自动检测并切换为高阶架构师模型（守护普通用户手动新建对话）
  function initAutoModelGuard() {
    let lastUrl = window.location.href;
    const checkAndEnforce = async () => {
      const cid = getCurrentChatIdFromUrl();
      if (!cid) {
        await sleep(1200);
        await ensureTargetModel(['Pro', 'Advanced', 'Thinking', 'Argon']);
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
