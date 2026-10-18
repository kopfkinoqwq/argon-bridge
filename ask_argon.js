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
  process.stderr.write(`\x1b[36m[Argon-Bridge]\x1b[0m ${msg}\n`);
}

function logSuccess(msg) {
  process.stderr.write(`\x1b[32m[Argon-Bridge]\x1b[0m ${msg}\n`);
}

function logWarn(msg) {
  process.stderr.write(`\x1b[33m[Argon-Bridge]\x1b[0m ${msg}\n`);
}

function logError(msg) {
  process.stderr.write(`\x1b[31m[Argon-Bridge Error]\x1b[0m ${msg}\n`);
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
      logError(`找不到指定的输入文件: ${resolvedFile}`);
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
      logError(`等待超时 (${config.timeoutMs / 1000}s)。请确认：`);
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
    logInfo(`本地 WebSocket 服务已启动: ws://127.0.0.1:${config.port}`);
    logInfo(`请求 ID: ${requestId} | 提问长度: ${config.prompt.length} 字符`);
    logInfo(`正在等待 Chrome 插件连接 (若未自动连接，请点击 Gemini 网页右上角状态球)...`);
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logError(`端口 ${config.port} 已被占用。请等待上一个 ask_argon.js 进程结束，或检查残留进程。`);
    } else {
      logError(`WebSocket Server 异常: ${err.message}`);
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
        logWarn(`收到非 JSON 消息: ${rawData}`);
        return;
      }

      if (msg.type === 'HELLO') {
        clearTimeout(dispatchTimer);
        sendPromptToExtension();
        return;
      }

      if (msg.type === 'STATUS') {
        logInfo(`[浏览器状态] ${msg.status}${msg.detail ? ' - ' + msg.detail : ''}`);
        return;
      }

      if (msg.type === 'ERROR') {
        logError(`浏览器端执行失败: ${msg.error || '未知错误'}`);
        cleanupAndExit(1);
        return;
      }

      if (msg.type === 'RESPONSE') {
        if (isCompleted) return;
        isCompleted = true;

        const markdown = (msg.markdown || '').trim();
        const source = msg.source || 'unknown';
        logSuccess(`已收到 Gemini 4 Argon 完整回复！(提取方式: ${source}, 长度: ${markdown.length} 字符)`);

        // 发送确认帧
        try {
          ws.send(JSON.stringify({ type: 'ACK', requestId }));
        } catch (_) {}

        // 如果指定了 --out，写入目标文件
        if (config.outPath) {
          const resolvedOut = path.resolve(process.cwd(), config.outPath);
          fs.writeFileSync(resolvedOut, markdown + '\n', 'utf8');
          logSuccess(`回复已成功写入文件: ${resolvedOut}`);
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
      logWarn(`连接通道异常: ${err.message}`);
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
