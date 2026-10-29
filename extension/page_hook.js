/**
 * Argon Bridge - page_hook.js (MAIN World)
 * Injected at document_start in the MAIN world to intercept Clipboard API calls
 * completely bypassing CSP, without touching host OS clipboard or requiring window focus.
 */
(() => {
  'use strict';
  if (window.__ARGON_CLIPBOARD_HOOK_INSTALLED__) return;
  window.__ARGON_CLIPBOARD_HOOK_INSTALLED__ = true;

  const MSG_SOURCE_CONTENT = 'ARGON_BRIDGE_CONTENT';
  const MSG_SOURCE_MAIN = 'ARGON_BRIDGE_MAIN';
  const ARM_TIMEOUT_MS = 4000; // 4秒自动卸弹防死锁

  const state = {
    armed: false,
    reqId: null,
    timer: null,
  };

  function disarm(reason = 'normal') {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const prevReqId = state.reqId;
    state.armed = false;
    state.reqId = null;
    return prevReqId;
  }

  function emitCaptured(text, method) {
    const reqId = disarm('captured');
    window.postMessage(
      {
        source: MSG_SOURCE_MAIN,
        type: 'ARGON_CLIPBOARD_CAPTURED',
        reqId,
        method,
        payload: String(text ?? ''),
        timestamp: Date.now(),
      },
      window.location.origin
    );
  }

  // 监听来自 ISOLATED World (content.js) 的装填/卸弹指令
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== MSG_SOURCE_CONTENT) {
      return;
    }

    const { type, reqId } = event.data;

    if (type === 'ARGON_CLIPBOARD_ARM') {
      disarm('re-arm');
      state.armed = true;
      state.reqId = reqId;

      // 4秒自动卸弹看门狗：防止点击失效后污染用户后续手动 Ctrl+C
      state.timer = setTimeout(() => {
        if (state.armed && state.reqId === reqId) {
          disarm('timeout');
          window.postMessage(
            {
              source: MSG_SOURCE_MAIN,
              type: 'ARGON_CLIPBOARD_TIMEOUT',
              reqId,
            },
            window.location.origin
          );
        }
      }, ARM_TIMEOUT_MS);

      // 发送 ACK 确认装填完毕，消除跨 World 异步竞态
      window.postMessage(
        {
          source: MSG_SOURCE_MAIN,
          type: 'ARGON_CLIPBOARD_ARM_ACK',
          reqId,
        },
        window.location.origin
      );
    } else if (type === 'ARGON_CLIPBOARD_DISARM') {
      disarm('manual_disarm');
    }
  });

  // 1. 劫持 Clipboard.prototype.writeText (主路径)
  if (typeof Clipboard !== 'undefined' && Clipboard.prototype) {
    const rawWriteText = Clipboard.prototype.writeText;
    const rawWrite = Clipboard.prototype.write;

    Clipboard.prototype.writeText = function (text) {
      if (state.armed) {
        emitCaptured(text, 'Clipboard.writeText');
        // 核心：直接返回 fulfilled Promise，彻底阻断系统剪贴板写入，绕过窗口焦点校验！
        return Promise.resolve();
      }
      return rawWriteText.apply(this, arguments);
    };

    // 2. 劫持 Clipboard.prototype.write (防御富文本 ClipboardItem 写入变体)
    if (typeof rawWrite === 'function') {
      Clipboard.prototype.write = function (items) {
        if (state.armed && Array.isArray(items) && items.length > 0) {
          const item = items[0];
          if (item && item.types && item.types.includes('text/plain')) {
            return item
              .getType('text/plain')
              .then((blob) => blob.text())
              .then((text) => {
                emitCaptured(text, 'Clipboard.write');
              });
          }
        }
        return rawWrite.apply(this, arguments);
      };
    }
  }

  // 3. 兜底劫持传统 document.execCommand('copy') 路径
  const rawExecCommand = document.execCommand;
  if (typeof rawExecCommand === 'function') {
    document.execCommand = function (command, ...args) {
      if (state.armed && String(command).toLowerCase() === 'copy') {
        const selection = window.getSelection ? window.getSelection().toString() : '';
        if (selection) {
          emitCaptured(selection, 'document.execCommand');
          return true;
        }
      }
      return rawExecCommand.call(this, command, ...args);
    };
  }
})();
