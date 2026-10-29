#!/usr/bin/env node
/**
 * argon-bridge v3.0.0: Full-Duplex Autonomous Agent Bus & Entropy Guard
 * Role A: Background Daemon Multiplexer (Port 17420, MV3 SW Keep-Alive, FIFO Queue)
 * Role B: Thin CLI Client (Self-Bootstrapping, Reverse Tool-Calling, Watermark Rolling)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { WebSocketServer, WebSocket } = require('ws');

const {
  MAX_PROBE_ROUNDS,
  parseReverseProbeDirective,
  buildProbeResponsePrompt,
} = require('./reverse_probe');

const {
  checkWatermarks,
  buildDistillationPrompt,
  buildBootstrapPrompt,
  saveSeedSnapshot,
} = require('./entropy_guard');

const DEFAULT_PORT = 17420;
const HOST = '127.0.0.1';
const DAEMON_FLAG = '--argon-daemon';
const GLOBAL_DIR = path.join(os.homedir(), '.argon-bridge');
const SESSIONS_FILE = path.join(GLOBAL_DIR, 'sessions.json');
const LOCAL_CONFIG_FILENAME = '.argon.json';
const DAEMON_IDLE_EXIT_MS = 30 * 60 * 1000; // 30分钟无请求自动优雅退出

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

// ============================================================================
// 工具函数：原子写盘与多项目会话映射
// ============================================================================
function normalizeChatId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/gemini\.google\.com\/(?:u\/\d+\/)?app\/([a-zA-Z0-9_-]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  if (/^[a-zA-Z0-9_-]{6,64}$/.test(trimmed) && trimmed.toLowerCase() !== 'app') {
    return trimmed;
  }
  return null;
}

function buildChatUrl(chatId) {
  return chatId ? `https://gemini.google.com/app/${chatId}` : 'https://gemini.google.com/app';
}

function atomicWriteJson(filePath, dataObj) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(dataObj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpFile, filePath);
}

function loadGlobalRegistry() {
  if (!fs.existsSync(SESSIONS_FILE)) return { projects: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    if (!parsed.projects) parsed.projects = {};
    return parsed;
  } catch (_) {
    return { projects: {} };
  }
}

function detectProjectContext(options = {}) {
  const workDir = path.resolve(options.cwd || process.cwd());
  const localConfigPath = path.join(workDir, LOCAL_CONFIG_FILENAME);

  let localConfig = null;
  if (fs.existsSync(localConfigPath)) {
    try {
      localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
    } catch (_) {}
  }

  let projectName = options.project;
  if (!projectName && localConfig && localConfig.projectName) {
    projectName = localConfig.projectName;
  }
  if (!projectName) {
    const pkgPath = path.join(workDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name) projectName = pkg.name;
      } catch (_) {}
    }
  }
  if (!projectName) {
    projectName = path.basename(workDir) || 'default-project';
  }

  const pathHash = crypto.createHash('sha1').update(workDir).digest('hex').slice(0, 8);
  const projectKey = options.project
    ? `proj:${options.project}`
    : (localConfig && localConfig.projectKey) || `${projectName}@${pathHash}`;

  const registry = loadGlobalRegistry();
  const globalEntry = registry.projects[projectKey] || null;

  let chatId = null;
  if (!options.newChat) {
    if (options.chatId) {
      chatId = normalizeChatId(options.chatId);
    } else if (localConfig && localConfig.chatId) {
      chatId = normalizeChatId(localConfig.chatId);
    } else if (globalEntry && globalEntry.chatId) {
      chatId = normalizeChatId(globalEntry.chatId);
    }
  }

  return {
    projectKey,
    projectName,
    workDir,
    localConfigPath,
    chatId,
    chatUrl: buildChatUrl(chatId),
    isNewChat: Boolean(options.newChat || !chatId),
    metrics: localConfig?.metrics || { turnCount: 0, cumulativeChars: 0 },
  };
}

function persistProjectSession(ctx, chatId, chatUrl, extraMetrics = {}) {
  const cleanId = normalizeChatId(chatId) || normalizeChatId(chatUrl);
  if (!cleanId) return null;

  const finalUrl = buildChatUrl(cleanId);
  const nowIso = new Date().toISOString();

  let existing = {};
  if (fs.existsSync(ctx.localConfigPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(ctx.localConfigPath, 'utf8'));
    } catch (_) {}
  }

  const currentMetrics = existing.metrics || { turnCount: 0, cumulativeChars: 0 };
  const updatedMetrics = {
    turnCount: (currentMetrics.turnCount || 0) + (extraMetrics.addTurn ? 1 : 0),
    cumulativeChars: (currentMetrics.cumulativeChars || 0) + (extraMetrics.addChars || 0),
    lastDomNodes: extraMetrics.domNodes || currentMetrics.lastDomNodes || 0,
    lastUpdated: nowIso,
  };

  const record = {
    schemaVersion: '3.0.0',
    projectKey: ctx.projectKey,
    projectName: ctx.projectName,
    projectPath: ctx.workDir,
    chatId: cleanId,
    chatUrl: finalUrl,
    updatedAt: nowIso,
    metrics: updatedMetrics,
    sessionLineage: existing.sessionLineage || [],
  };

  try {
    atomicWriteJson(ctx.localConfigPath, record);
  } catch (err) {
    logWarn(`无法写入项目本地配置 ${ctx.localConfigPath}: ${err.message}`);
  }

  const registry = loadGlobalRegistry();
  registry.projects[ctx.projectKey] = record;
  atomicWriteJson(SESSIONS_FILE, registry);

  return record;
}

function printSessionList() {
  const registry = loadGlobalRegistry();
  const entries = Object.values(registry.projects || {});
  if (entries.length === 0) {
    logInfo('当前尚无已绑定的项目会话记录。');
    return;
  }
  process.stderr.write('\n\x1b[1m=== Argon Bridge 已绑定项目专属会话列表 (1:1 Mapping) ===\x1b[0m\n');
  for (const item of entries) {
    const metrics = item.metrics || {};
    process.stderr.write(
      `- \x1b[32m${item.projectName}\x1b[0m (${item.projectKey})\n` +
        `  目录: ${item.projectPath}\n` +
        `  会话: ${item.chatUrl} (chatId: ${item.chatId})\n` +
        `  轮次: ${metrics.turnCount || 0} 轮 | 字符: ${metrics.cumulativeChars || 0} | DOM: ${metrics.lastDomNodes || 0}\n` +
        `  更新: ${item.updatedAt}\n`
    );
  }
  process.stderr.write('\n');
}

// ============================================================================
// 角色 A：常驻守护进程 (Daemon Multiplexer)
// ============================================================================
function startDaemonServer(port = DEFAULT_PORT) {
  let activeExtensionWs = null;
  const pendingRpcMap = new Map();
  const executionQueue = [];
  let isProcessingQueue = false;
  let idleTimer = null;

  function resetIdleTimer() {
    if (!DAEMON_IDLE_EXIT_MS) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (executionQueue.length === 0 && pendingRpcMap.size === 0) {
        process.exit(0);
      }
    }, DAEMON_IDLE_EXIT_MS);
  }

  async function drainQueue() {
    if (isProcessingQueue || executionQueue.length === 0) return;
    isProcessingQueue = true;

    while (executionQueue.length > 0) {
      const job = executionQueue.shift();
      try {
        const result = await dispatchToExtension(job.payload);
        if (result && result.chatId) {
          const ctx = {
            projectKey: job.payload.projectKey,
            projectName: job.payload.projectName,
            workDir: job.payload.projectPath,
            localConfigPath: path.join(job.payload.projectPath, LOCAL_CONFIG_FILENAME),
          };
          persistProjectSession(ctx, result.chatId, result.chatUrl, {
            addTurn: true,
            addChars: (result.markdown || '').length,
            domNodes: result.telemetry?.domNodes || 0,
          });
        }
        job.resolve(result);
      } catch (err) {
        job.reject(err);
      }
    }

    isProcessingQueue = false;
    resetIdleTimer();
  }

  async function dispatchToExtension(payload, waitConnectMs = 25000) {
    const startWait = Date.now();
    while (!activeExtensionWs || activeExtensionWs.readyState !== WebSocket.OPEN) {
      if (Date.now() - startWait > waitConnectMs) {
        throw new Error('DAEMON_NO_EXTENSION: Chrome MV3 插件未连接，请确认浏览器已开启并登录 Gemini 网页版');
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const { requestId, timeoutMs = 420000 } = payload;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRpcMap.delete(requestId);
        reject(new Error(`DAEMON_RPC_TIMEOUT: 请求 ${requestId} 超过 ${timeoutMs / 1000}s 未响应`));
      }, timeoutMs);

      pendingRpcMap.set(requestId, { resolve, reject, timer, payload });

      activeExtensionWs.send(
        JSON.stringify({
          type: 'ASK_ARGON',
          ...payload,
        })
      );
    });
  }

  const server = http.createServer((req, res) => {
    resetIdleTimer();

    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          daemonPid: process.pid,
          extensionConnected: Boolean(activeExtensionWs && activeExtensionWs.readyState === WebSocket.OPEN),
          queueLength: executionQueue.length,
          busy: isProcessingQueue,
        })
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/api/ask') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'INVALID_JSON' }));
          return;
        }

        executionQueue.push({
          payload,
          resolve: (result) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, data: result }));
          },
          reject: (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
          },
        });

        drainQueue();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    activeExtensionWs = ws;

    const keepAliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        try {
          ws.send(JSON.stringify({ type: 'DAEMON_HEARTBEAT', ts: Date.now() }));
        } catch (_) {}
      }
    }, 20000);

    ws.on('message', (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString('utf8'));
      } catch (_) {
        return;
      }

      if (msg.type === 'SESSION_BOUND') {
        const item = pendingRpcMap.get(msg.requestId);
        if (item) {
          const ctx = {
            projectKey: item.payload.projectKey,
            projectName: item.payload.projectName,
            workDir: item.payload.projectPath,
            localConfigPath: path.join(item.payload.projectPath, LOCAL_CONFIG_FILENAME),
          };
          persistProjectSession(ctx, msg.chatId, msg.chatUrl);
        }
        return;
      }

      if (msg.type === 'STATUS') {
        process.stderr.write(`\x1b[36m[浏览器状态]\x1b[0m ${msg.status}${msg.detail ? ' - ' + msg.detail : ''}\n`);
        return;
      }

      if (msg.type === 'RESPONSE' && msg.requestId && pendingRpcMap.has(msg.requestId)) {
        const { resolve, timer } = pendingRpcMap.get(msg.requestId);
        clearTimeout(timer);
        pendingRpcMap.delete(msg.requestId);
        resolve(msg);
        return;
      }

      if (msg.type === 'ERROR' && msg.requestId && pendingRpcMap.has(msg.requestId)) {
        const { reject, timer } = pendingRpcMap.get(msg.requestId);
        clearTimeout(timer);
        pendingRpcMap.delete(msg.requestId);
        reject(new Error(msg.error || '未知浏览器端异常'));
        return;
      }
    });

    ws.on('close', () => {
      clearInterval(keepAliveInterval);
      if (activeExtensionWs === ws) activeExtensionWs = null;
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      process.exit(0);
    }
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    resetIdleTimer();
  });
}

// ============================================================================
// 角色 B：薄客户端 CLI (全双工自治循环与长会话熵减监控)
// ============================================================================
function checkDaemonHealth(port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://${HOST}:${port}/api/health`, { timeout: 400 }, (res) => {
      let data = '';
      res.on('data', (c) => {
        data += c;
      });
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(data) : null);
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function ensureDaemonRunning(port = DEFAULT_PORT) {
  let health = await checkDaemonHealth(port);
  if (health) return health;

  const child = spawn(process.execPath, [__filename, DAEMON_FLAG, '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 35; i++) {
    await new Promise((r) => setTimeout(r, 100));
    health = await checkDaemonHealth(port);
    if (health) return health;
  }

  throw new Error(`无法在端口 ${port} 拉起 argon-bridge 守护进程`);
}

function sendRpcToDaemon(port, payloadObj, timeoutMs) {
  const payloadStr = JSON.stringify(payloadObj);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port,
        path: '/api/ask',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
        },
        timeout: timeoutMs + 5000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (_) {
            reject(new Error(`Daemon 响应解析失败: ${raw}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('CLI 等待 Daemon 调度超时'));
    });

    req.write(payloadStr);
    req.end();
  });
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const config = {
    prompt: '',
    filePath: null,
    outPath: null,
    project: null,
    cwd: null,
    chatId: null,
    newChat: false,
    model: 'Argon',
    thinkingLevel: 'high',
    bindTarget: null,
    listOnly: false,
    port: DEFAULT_PORT,
    timeoutMs: 420000,
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' || arg === '-f') {
      config.filePath = args[++i];
    } else if (arg === '--out' || arg === '-o') {
      config.outPath = args[++i];
    } else if (arg === '--project' || arg === '-P') {
      config.project = args[++i];
    } else if (arg === '--cwd' || arg === '-C') {
      config.cwd = args[++i];
    } else if (arg === '--model' || arg === '-m') {
      config.model = args[++i];
    } else if (arg === '--thinking' || arg === '--effort') {
      config.thinkingLevel = args[++i];
    } else if (arg === '--chat-id') {
      config.chatId = args[++i];
    } else if (arg === '--new-chat' || arg === '-N' || arg === '--reset') {
      config.newChat = true;
    } else if (arg === '--bind') {
      config.bindTarget = args[++i];
    } else if (arg === '--list' || arg === '-l' || arg === '--list-sessions') {
      config.listOnly = true;
    } else if (arg === '--port' || arg === '-p') {
      config.port = parseInt(args[++i], 10) || DEFAULT_PORT;
    } else if (arg === '--timeout' || arg === '-t') {
      config.timeoutMs = parseInt(args[++i], 10) || 420000;
    } else if (arg === DAEMON_FLAG) {
      // 内部标志
    } else {
      positional.push(arg);
    }
  }

  if (config.filePath) {
    const baseDir = config.cwd ? path.resolve(config.cwd) : process.cwd();
    const resolvedFile = path.isAbsolute(config.filePath)
      ? config.filePath
      : path.resolve(baseDir, config.filePath);
    if (fs.existsSync(resolvedFile)) {
      config.prompt = fs.readFileSync(resolvedFile, 'utf8').trim();
    }
  } else if (positional.length > 0) {
    config.prompt = positional.join(' ').trim();
  }

  return config;
}

async function runCliClient() {
  const config = parseCliArgs(process.argv);

  if (config.listOnly) {
    printSessionList();
    process.exit(0);
  }

  const projectCtx = detectProjectContext(config);

  if (config.bindTarget) {
    const saved = persistProjectSession(projectCtx, config.bindTarget, config.bindTarget);
    if (!saved) {
      logError(`无效的 Chat URL 或 Chat ID: ${config.bindTarget}`);
      process.exit(1);
    }
    logSuccess(`已将项目 [${projectCtx.projectName}] 绑定至专属会话: ${saved.chatUrl}`);
    process.exit(0);
  }

  if (!config.prompt) {
    process.stderr.write(`\n用法: node ask_argon.js "你的提问内容" [--out PLAN.md] [--new-chat]\n`);
    process.exit(1);
  }

  // 1. 确保常驻 Daemon 正在运行
  await ensureDaemonRunning(config.port);

  // 2. 播报双脑协同横幅
  process.stderr.write(`\n\x1b[1;35m╭──────────────────────────────────────────────────────────────╮\x1b[0m\n`);
  process.stderr.write(`\x1b[1;35m│  🧠 双脑协同：正在连线云端首席架构师 Gemini 4 Argon (v3.0.0)... │\x1b[0m\n`);
  process.stderr.write(`\x1b[1;35m╰──────────────────────────────────────────────────────────────╯\x1b[0m\n\n`);
  logInfo(
    `当前项目: [${projectCtx.projectName}] | 路由模式: ${
      projectCtx.isNewChat ? '新建专属会话 (New Chat)' : `定向切流 -> ${projectCtx.chatUrl}`
    }`
  );

  let currentPrompt = projectCtx.isNewChat
    ? `[Argon-Bridge Project Session Init | Project: ${projectCtx.projectName} | Path: ${projectCtx.workDir}]\n\n${config.prompt}`
    : config.prompt;

  let round = 0;
  let finalResult = null;

  // 3. 全双工自治循环 (Full-Duplex Dialog Loop)：支持 Argon 连续自主发起本地探测 (最多 3 轮)
  while (round <= MAX_PROBE_ROUNDS) {
    const requestId = crypto.randomUUID();
    const payload = {
      requestId,
      projectKey: projectCtx.projectKey,
      projectName: projectCtx.projectName,
      projectPath: projectCtx.workDir,
      chatId: projectCtx.chatId,
      chatUrl: projectCtx.chatUrl,
      forceNewChat: round === 0 ? projectCtx.isNewChat : false,
      model: config.model || 'Argon',
      thinkingLevel: config.thinkingLevel || 'high',
      prompt: currentPrompt,
      timeoutMs: config.timeoutMs,
    };

    const responseData = await sendRpcToDaemon(config.port, payload, config.timeoutMs);

    if (!responseData.ok) {
      logError(`执行失败: ${responseData.error}`);
      process.exit(2);
    }

    finalResult = responseData.data;

    // 检查云端 Argon 是否输出了反向探测指令
    const probeDirective = parseReverseProbeDirective(finalResult.markdown || '');
    if (!probeDirective || round >= MAX_PROBE_ROUNDS) {
      break;
    }

    round++;
    const probeSummary = probeDirective.probes
      .map((p) => `${p.op}(${p.path || p.pattern || p.target || '.'})`)
      .join(', ');
    process.stderr.write(
      `\n\x1b[1;33m[Argon-Probe ${round}/${MAX_PROBE_ROUNDS}]\x1b[0m 🔍 云端首席架构师正在反向探测本地代码: ${probeSummary}\n`
    );

    currentPrompt = buildProbeResponsePrompt(projectCtx.workDir, probeDirective, round);
  }

  const markdown = (finalResult.markdown || '').trim();
  const source = finalResult.source || 'zero-touch-hook';
  const modelLabel = finalResult.model || 'Argon';
  const thinkingLabel = finalResult.thinkingLevel || 'HIGH';

  process.stderr.write(`\n\x1b[1;32m╭──────────────────────────────────────────────────────────────╮\x1b[0m\n`);
  process.stderr.write(`\x1b[1;32m│  🏛️ 架构师蓝图已送达：云端 Gemini 4 Argon 输出完毕！          │\x1b[0m\n`);
  process.stderr.write(`\x1b[1;32m╰──────────────────────────────────────────────────────────────╯\x1b[0m\n\n`);

  logSuccess(
    `已收到 [${projectCtx.projectName}] 专属会话回复！(模型: ${modelLabel}, 深度思考: ${thinkingLabel}, 提取: ${source}, 长度: ${markdown.length} 字符)`
  );

  // 4. 服务端静默软降级遥测警告（第三把锁）
  if (finalResult.telemetry && finalResult.telemetry.suspectedSoftDowngrade) {
    logWarn('⚠️ [WARN: DEGRADED_SUSPECTED] 未检测到 CoT 思考块且首包过快 (<1.5s)，警惕云端静默降级！');
  }

  // 5. 熵减水位线评估（Entropy-Guard）
  const watermarkStatus = checkWatermarks({
    turnCount: projectCtx.metrics?.turnCount || 1,
    domNodes: finalResult.telemetry?.domNodes || 0,
    cumulativeChars: (projectCtx.metrics?.cumulativeChars || 0) + markdown.length,
  });

  if (watermarkStatus.hitSoft) {
    logWarn(
      `♻️ [Argon-Entropy-Guard] 当前会话已触达软水位线 (${watermarkStatus.reason})。建议在合适时机使用 --new-chat 触发架构状态交接！`
    );
  }

  // 6. 若指定了 --out 输出文件，落盘写入
  if (config.outPath) {
    const baseDir = config.cwd ? path.resolve(config.cwd) : process.cwd();
    const resolvedOut = path.isAbsolute(config.outPath)
      ? config.outPath
      : path.resolve(baseDir, config.outPath);
    fs.writeFileSync(resolvedOut, markdown + '\n', 'utf8');
    logSuccess(`回复已成功写入文件: ${resolvedOut}`);
  }

  // 7. 标准输出纯净 Markdown 供上层工具消费
  process.stdout.write(markdown + '\n');
}

// ============================================================================
// 主入口分流器
// ============================================================================
if (process.argv.includes(DAEMON_FLAG)) {
  const portIndex = process.argv.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(process.argv[portIndex + 1], 10) || DEFAULT_PORT : DEFAULT_PORT;
  startDaemonServer(port);
} else {
  runCliClient().catch((err) => {
    logError(err.message || String(err));
    process.exit(1);
  });
}
