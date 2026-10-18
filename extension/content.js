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
    hudState.dotEl.className = `status-dot ${state}`;
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
    updateHud('WORKING', `Argon Bridge: ${status}`, detail);
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
          reportStatus('正在接收流式输出...', `已生成 ${currentText.length} 字符 (${elapsedSec}s)`);
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
        return `\n\`\`\`${lang}\n${rawCode.replace(/\n+$/, '')}\n\`\`\`\n\n`;
      }

      if (tag === 'code' && (!node.parentElement || node.parentElement.tagName.toLowerCase() !== 'pre')) {
        return `\`${node.textContent || ''}\``;
      }

      // 处理标题
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag.slice(1), 10);
        const hashes = '#'.repeat(level);
        return `\n${hashes} ${ getChildrenText(node).trim() }\n\n`;
      }

      if (tag === 'p') {
        return `${getChildrenText(node).trim()}\n\n`;
      }

      if (tag === 'br') {
        return '\n';
      }

      if (tag === 'hr') {
        return '\n---\n\n';
      }

      if (tag === 'strong' || tag === 'b') {
        return `**${getChildrenText(node)}**`;
      }

      if (tag === 'em' || tag === 'i') {
        return `*${getChildrenText(node)}*`;
      }

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
      reportStatus('正在向 Argon 提问...', `Request ID: ${task.requestId.slice(0, 8)}`);

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

      updateHud('CONNECTED', 'Argon Bridge: 已完成', `已回传 ${markdown.length} 字符 (${source})`);
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
