#!/usr/bin/env node
/**
 * argon-bridge v2.3.6: Local CLI & Project-to-Chat 1:1 Session Manager
 * Port: 17420 (127.0.0.1)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 17420;
const DEFAULT_TIMEOUT_MS = 420000; // 7 minutes (supports deep reasoning and TTFT delay)
const LOCAL_CONFIG_FILENAME = '.argon.json';
const GLOBAL_REGISTRY_DIR = path.join(os.homedir(), '.argon-bridge');
const GLOBAL_REGISTRY_FILE = path.join(GLOBAL_REGISTRY_DIR, 'sessions.json');

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

function loadGlobalRegistry() {
  try {
    if (fs.existsSync(GLOBAL_REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(GLOBAL_REGISTRY_FILE, 'utf8'));
    }
  } catch (err) {
    logWarn(`读取全局会话注册表失败，将重新初始化: ${err.message}`);
  }
  return { projects: {} };
}

function saveGlobalRegistry(registry) {
  try {
    if (!fs.existsSync(GLOBAL_REGISTRY_DIR)) {
      fs.mkdirSync(GLOBAL_REGISTRY_DIR, { recursive: true });
    }
    fs.writeFileSync(GLOBAL_REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  } catch (err) {
    logWarn(`写入全局会话注册表失败: ${err.message}`);
  }
}

function detectProjectContext(options) {
  const workDir = path.resolve(options.cwd || process.cwd());
  const localConfigPath = path.join(workDir, LOCAL_CONFIG_FILENAME);

  let localConfig = null;
  if (fs.existsSync(localConfigPath)) {
    try {
      localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
    } catch (_) {}
  }

  // 决定项目名称：CLI --project > .argon.json > package.json name > 目录名
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

  // 生成唯一 Project Key（若显式传入 --project 则按名称索引，否则结合路径哈希防重名）
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
  };
}

function persistProjectSession(ctx, chatId, chatUrl) {
  const cleanId = normalizeChatId(chatId) || normalizeChatId(chatUrl);
  if (!cleanId) return false;

  const finalUrl = buildChatUrl(cleanId);
  const nowIso = new Date().toISOString();

  const record = {
    projectKey: ctx.projectKey,
    projectName: ctx.projectName,
    projectPath: ctx.workDir,
    chatId: cleanId,
    chatUrl: finalUrl,
    updatedAt: nowIso,
  };

  // 1. 写入项目根目录下的 .argon.json
  try {
    fs.writeFileSync(ctx.localConfigPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  } catch (err) {
    logWarn(`无法写入项目本地配置 ${ctx.localConfigPath}: ${err.message}`);
  }

  // 2. 写入全局 ~/.argon-bridge/sessions.json
  const registry = loadGlobalRegistry();
  registry.projects[ctx.projectKey] = record;
  saveGlobalRegistry(registry);

  return record;
}

function printSessionList() {
  const registry = loadGlobalRegistry();
  const entries = Object.values(registry.projects || {});
  if (entries.length === 0) {
    logInfo('当前尚无已绑定的项目会话记录。');
    return;
  }
  process.stderr.write('\n\x1b[1m=== Argon Bridge 已绑定项目会话列表 (1:1 Mapping) ===\x1b[0m\n');
  for (const item of entries) {
    process.stderr.write(
      `- \x1b[32m${item.projectName}\x1b[0m (${item.projectKey})\n` +
        `  目录: ${item.projectPath}\n` +
        `  会话: ${item.chatUrl} (chatId: ${item.chatId})\n` +
        `  更新: ${item.updatedAt}\n`
    );
  }
  process.stderr.write('\n');
}

function printHelp() {
  process.stderr.write(`
用法:
  node ask_argon.js "提问内容"
  node ask_argon.js --file <prompt.md> [--out <PLAN.md>] [--project <name>] [--cwd <dir>]
  node ask_argon.js --new-chat "开启当前项目的全新专属对话"
  node ask_argon.js --bind <chatUrl_or_chatId> [--project <name>] [--cwd <dir>]
  node ask_argon.js --list

核心参数说明 (v2.0 多项目会话路由):
  --project, -P   指定项目名称（默认自动读取当前目录 .argon.json 或 package.json）
  --cwd, -C       指定目标项目根目录路径（默认当前工作目录 process.cwd()）
  --new-chat, -N  强制为当前项目创建新的 Gemini 会话并更新绑定
  --model, -m     指定目标模型名称（默认 Argon，自动锁定高阶架构师模型）
  --thinking      指定推理程度/思考深度（high | medium | low，默认 high）
  --chat-id       临时或显式指定要路由到的 Gemini Chat ID / URL
  --bind          将当前项目手动绑定到指定的 Gemini Chat URL 或 Chat ID
  --list, -l      列出全局所有已绑定的项目与专属 Gemini 会话映射
  --file, -f      从指定文件读取提问内容
  --out, -o       将 Argon 的回复写入指定文件（如 PLAN.md）
  --timeout, -t   超时时间（毫秒，默认 420000 即 7 分钟）
  --port, -p      本地 WebSocket 监听端口（默认 17420）
  --help, -h      显示本帮助信息
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    prompt: '',
    filePath: null,
    outPath: null,
    project: null,
    cwd: null,
    chatId: null,
    newChat: false,
    reload: false,
    model: 'Argon',
    thinkingLevel: 'high',
    bindTarget: null,
    listOnly: false,
    getLatest: false,
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
    } else if (arg === '--reload' || arg === '-r') {
      config.reload = true;
    } else if (arg === '--latest' || arg === '--fetch' || arg === '-L') {
      config.getLatest = true;
    } else if (arg === '--bind') {
      config.bindTarget = args[++i];
    } else if (arg === '--list' || arg === '-l' || arg === '--list-sessions') {
      config.listOnly = true;
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

  if (config.listOnly || config.bindTarget) {
    return config;
  }

  if (config.filePath) {
    const baseDir = config.cwd ? path.resolve(config.cwd) : process.cwd();
    const resolvedFile = path.isAbsolute(config.filePath)
      ? config.filePath
      : path.resolve(baseDir, config.filePath);
    if (!fs.existsSync(resolvedFile)) {
      logError(`找不到指定的输入文件: ${resolvedFile}`);
      process.exit(1);
    }
    config.prompt = fs.readFileSync(resolvedFile, 'utf8').trim();
  } else if (positional.length > 0) {
    config.prompt = positional.join(' ').trim();
  }

  if (!config.prompt && !config.getLatest) {
    logError('提问内容不能为空。请提供提问字符串或使用 --file <path> 指定文件，或使用 --latest 提取最新回复。');
    printHelp();
    process.exit(1);
  }

  return config;
}

function main() {
  const config = parseArgs(process.argv);

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
    logSuccess(`已将项目 [${projectCtx.projectName}] 手动绑定至会话: ${saved.chatUrl}`);
    logInfo(`本地配置文件已更新: ${projectCtx.localConfigPath}`);
    process.exit(0);
  }

  // 如果是新项目首次会话，自动注入轻量级项目身份头，帮助 Gemini 4 Argon 建立专属记忆
  const effectivePrompt = projectCtx.isNewChat
    ? `[Argon-Bridge Project Session Init | Project: ${projectCtx.projectName} | Path: ${projectCtx.workDir}]\n\n${config.prompt}`
    : config.prompt;

  const requestId = crypto.randomUUID();
  let promptDispatched = false;
  let isCompleted = false;

  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: config.port,
  });

  const timeoutHandle = setTimeout(() => {
    if (!isCompleted) {
      logError(`等待超时 (${config.timeoutMs / 1000}s)。请确认 Chrome 插件已启用且已登录 https://gemini.google.com`);
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
    process.stderr.write(`\n\x1b[1;35m╭──────────────────────────────────────────────────────────────╮\x1b[0m\n`);
    process.stderr.write(`\x1b[1;35m│  🧠 双脑协同：正在连线云端首席架构师 Gemini 4 Argon (v2.3.6)... │\x1b[0m\n`);
    process.stderr.write(`\x1b[1;35m╰──────────────────────────────────────────────────────────────╯\x1b[0m\n\n`);
    logInfo(`本地 WebSocket 服务已启动: ws://127.0.0.1:${config.port}`);
    logInfo(
      `当前项目: [${projectCtx.projectName}] | 路由模式: ${
        projectCtx.isNewChat
          ? '新建专属会话 (New Chat)'
          : `定向切流 -> ${projectCtx.chatUrl}`
      }`
    );
    logInfo(`等待 Chrome 插件连接并执行会话路由...`);
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logError(`端口 ${config.port} 已被占用，请等待上一个 ask_argon.js 任务完成。`);
    } else {
      logError(`WebSocket Server 异常: ${err.message}`);
    }
    cleanupAndExit(1);
  });

  wss.on('connection', (ws) => {
    logSuccess('Chrome 插件已连接！正在下发项目路由与提问指令...');

    function sendPromptToExtension() {
      if (promptDispatched || isCompleted) return;
      promptDispatched = true;
      ws.send(
        JSON.stringify({
          type: config.getLatest ? 'GET_LATEST_RESPONSE' : 'ASK_ARGON',
          requestId,
          projectKey: projectCtx.projectKey,
          projectName: projectCtx.projectName,
          projectPath: projectCtx.workDir,
          chatId: projectCtx.chatId,
          chatUrl: projectCtx.chatUrl,
          forceNewChat: projectCtx.isNewChat,
          reload: Boolean(config.reload),
          model: config.model || 'Argon',
          thinkingLevel: config.thinkingLevel || 'high',
          prompt: effectivePrompt || '',
          timestamp: Date.now(),
        })
      );
    }

    const dispatchTimer = setTimeout(() => {
      sendPromptToExtension();
    }, 250);

    ws.on('message', (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString('utf8'));
      } catch (_) {
        return;
      }

      if (msg.type === 'HELLO') {
        clearTimeout(dispatchTimer);
        sendPromptToExtension();
        return;
      }

      if (msg.type === 'STATUS') {
        logInfo(`[浏览器路由状态] ${msg.status}${msg.detail ? ' - ' + msg.detail : ''}`);
        return;
      }

      if (msg.type === 'SESSION_BOUND') {
        const returnedChatId = normalizeChatId(msg.chatId) || normalizeChatId(msg.chatUrl);
        if (returnedChatId) {
          const savedRecord = persistProjectSession(projectCtx, returnedChatId, msg.chatUrl);
          if (savedRecord) {
            logSuccess(`[会话即时绑定] 项目 [${projectCtx.projectName}] 已成功锁定专属会话: ${savedRecord.chatUrl}`);
          }
        }
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
        const returnedChatId = normalizeChatId(msg.chatId) || normalizeChatId(msg.chatUrl);

        process.stderr.write(`\n\x1b[1;32m╭──────────────────────────────────────────────────────────────╮\x1b[0m\n`);
        process.stderr.write(`\x1b[1;32m│  🏛️ 架构师蓝图已送达：云端 Gemini 4 Argon 输出完毕！          │\x1b[0m\n`);
        process.stderr.write(`\x1b[1;32m╰──────────────────────────────────────────────────────────────╯\x1b[0m\n\n`);

        const modelLabel = msg.model || 'Argon';
        const thinkingLabel = msg.thinkingLevel || 'HIGH';
        logSuccess(`已收到 [${projectCtx.projectName}] 专属会话回复！(模型: ${modelLabel}, 深度思考: ${thinkingLabel}, 提取: ${source}, 长度: ${markdown.length} 字符)`);

        // 持久化保存或更新当前项目绑定的 chatId
        if (returnedChatId) {
          const savedRecord = persistProjectSession(projectCtx, returnedChatId, msg.chatUrl);
          if (savedRecord && (projectCtx.isNewChat || projectCtx.chatId !== savedRecord.chatId)) {
            logSuccess(
              `已自动绑定项目 [${projectCtx.projectName}] <-> 专属会话: ${savedRecord.chatUrl}`
            );
            logInfo(`会话映射已写入: ${projectCtx.localConfigPath}`);
          }
        } else {
          logWarn('未能从当前页面 URL 中解析出具体的 chatId，下次提问将继续尝试提取。');
        }

        try {
          ws.send(JSON.stringify({ type: 'ACK', requestId }));
        } catch (_) {}

        if (config.outPath) {
          const baseDir = config.cwd ? path.resolve(config.cwd) : process.cwd();
          const resolvedOut = path.isAbsolute(config.outPath)
            ? config.outPath
            : path.resolve(baseDir, config.outPath);
          fs.writeFileSync(resolvedOut, markdown + '\n', 'utf8');
          logSuccess(`回复已成功写入文件: ${resolvedOut}`);
        }

        process.stdout.write(markdown + '\n');
        cleanupAndExit(0);
      }
    });

    ws.on('close', () => {
      if (!isCompleted) {
        logWarn('Chrome 插件连接暂时断开，等待重连与响应回传...');
      }
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
