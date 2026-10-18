看起来你在输入标题后可能不小心按到了回车（Gemini 网页端默认回车直接发送）。不过作为你的首席系统架构师，仅凭 **“多项目专属会话绑定与自动切流 (Project-to-Chat 1:1 Mapping)”** 这一核心命题，我已经完整推演出你需要的 **v2.0 架构升级方案**。

如果你手里还有未粘贴完的补充细节，随时继续发给我，我立刻为你微调；如果你想直接落地这套多项目隔离机制，可以直接将下方完整的 **`PLAN.md` (v2.0)** 交给本地 **Antigravity (Gemini 3.8 Flash)** 执行覆盖升级。

---

## 核心架构升级设计（v1.0 $\rightarrow$ v2.0）

在多项目并行开发时，若所有本地项目共用同一个 Gemini 网页端对话窗口，会导致不同项目的代码上下文严重串味。**v2.0 架构通过四大核心机制实现“一项目一专属会话”的 1:1 自动绑定与切流**：

1. **本地项目指纹自动识别 (`Project Identity`)**：
* 当在任意项目目录下运行 `ask_argon.js` 时，自动按优先级提取项目标识：`--project <name>` 参数 > `--cwd <dir>` 指定目录 > 本地 `.argon.json` > 当前 Git 仓库/目录名。


2. **双层持久化会话注册表 (`Dual-Layer Session Registry`)**：
* **项目级配置 (`.argon.json`)**：自动保存在当前项目根目录下，记录该项目绑定的 `chatId` 与 `chatUrl`（`[https://gemini.google.com/app/](https://gemini.google.com/app/)<chatId>`）。
* **全局级注册表 (`~/.argon-bridge/sessions.json`)**：跨目录汇总所有项目的会话映射，支持随时通过 `node ask_argon.js --list` 查看所有已绑定项目。


3. **`background.js` 跨页面状态机路由 (`Stateful Tab Router`)**：
* **多标签页智能命中**：若 Chrome 中已打开多个 Gemini 标签页，优先直接命中 URL 匹配 `/app/<chatId>` 的标签页，实现**零刷新秒级提问**。
* **单标签页自动切流**：若当前标签页处于其他项目的会话中，由 `background.js` 将提问任务挂起至内存队列 (`pendingTask`)，自动驱动标签页跳转至目标项目的 `/app/<chatId>`（或新项目的 `/app` 新会话），等待页面加载及输入框就绪后自动注入提问，彻底解决页面跳转导致 `content.js` 重载丢消息的问题。


4. **首轮对话 `chatId` 自动回采 (`Chat ID Harvesting`)**：
* 新项目首次提问时自动在 `/app` 发起新对话，并在首轮流式生成结束后，自动从浏览器地址栏捕获新分配的 `/app/<chatId>`，随 Markdown 回复一并传回本地写入 `.argon.json`。



---

# `PLAN.md` — `argon-bridge` v2.0 多项目专属会话绑定与自动切流施工蓝图

## 0. 执行指令（致本地 Antigravity / Gemini 3.8 Flash）

请严格按照以下路径与完整源码，将 `argon-bridge` 升级至 **v2.0（支持 Project-to-Chat 1:1 Mapping）**。严禁省略或截断任何代码：

* `./AGENTS.md`
* `./package.json`
* `./ask_argon.js`
* `./extension/manifest.json`
* `./extension/background.js`
* `./extension/content.js`

---

## 1. 协作宪章：`./AGENTS.md`

请在项目根目录覆盖更新 `./AGENTS.md`：

```markdown
# AGENTS.md — 本地与云端双脑协同开发宪章 (Argon-Bridge v2.0 Protocol)

## 1. 角色定义与多项目会话隔离机制
本项目采用 **“云端架构师 (Gemini 4 Argon) + 本地执行官 (Gemini 3.8 Flash)”** 协同架构，并启用 **Project-to-Chat 1:1 Mapping（多项目专属会话绑定与自动切流）**：
- 每个本地项目拥有独立的 `.argon.json` 会话绑定文件，对应浏览器端唯一的 `https://gemini.google.com/app/<chatId>` 专属对话。
- 首次在某个项目中调用 `ask_argon.js` 时，浏览器会自动开启一个全新的 Gemini 4 Argon 会话，并在首轮回复后自动将生成的 `chatId` 持久化至本地 `.argon.json` 与全局 `~/.argon-bridge/sessions.json`。
- 后续在该项目下发起的所有提问，浏览器都会自动切流（或路由）至该项目绑定的专属 Gemini 会话，绝不与其他项目串味。

## 2. 跨模型通讯工具：`ask_argon.js` (v2.0)

### 常用调用方式
1. **在当前项目下直接提问（自动识别并路由到当前项目的专属会话）**：
   ```bash
   node /path/to/ask_argon.js "请帮我审查当前模块的状态机设计"

```

2. **显式指定项目名称或项目工作目录（适合跨目录集中调用）**：
```bash
node ask_argon.js --project "payment-service" --file prompt.md --out PLAN.md
# 或指定目标项目根目录（将在该目录下读写 .argon.json）
node ask_argon.js --cwd /workspace/payment-service --file prompt.md

```


3. **强制为当前项目开启全新会话（重置上下文并重新绑定新 `chatId`）**：
```bash
node ask_argon.js --new-chat "我们开始重构 V3 版本，请作为架构师初始化上下文"

```


4. **手动绑定已有 Gemini 会话 URL 或 ID 到当前项目**：
```bash
node ask_argon.js --bind "[https://gemini.google.com/app/1a2b3c4d5e6f7g8h](https://gemini.google.com/app/1a2b3c4d5e6f7g8h)"

```


5. **查看本地所有项目的会话绑定列表**：
```bash
node ask_argon.js --list

```



## 3. 协同触发准则

当本地执行官（Gemini 3.8 Flash）遇到以下情况时，必须运行 `node ask_argon.js` 向当前项目绑定的 Gemini 4 Argon 专属会话请教：

1. **架构级决策**：涉及新建核心模块、修改通信协议或跨文件重构。
2. **连续报错熔断**：同一 Bug 尝试修复 **2 次** 仍未解决。
3. **阶段性验收**：核心功能开发完毕后，需将变更摘要同步给该项目专属的 Argon 会话以保持架构上下文同步。

```

---

## 2. 核心源码文件清单

### 2.1 `./package.json`

覆盖更新 `./package.json`：

```json
{
  "name": "argon-bridge",
  "version": "2.0.0",
  "description": "Zero-bloat WebSocket bridge with 1:1 Project-to-Chat session mapping and auto-routing for Web Gemini 4 Argon",
  "main": "ask_argon.js",
  "bin": {
    "ask-argon": "./ask_argon.js"
  },
  "scripts": {
    "ask": "node ask_argon.js",
    "sessions": "node ask_argon.js --list",
    "test:ping": "node ask_argon.js \"请确认当前项目的专属会话绑定状态，并回复：Argon Bridge v2.0 1:1 会话路由正常。\""
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "MIT"
}

```

---

### 2.2 `./ask_argon.js`

覆盖更新 `./ask_argon.js`（新增项目指纹识别、`.argon.json` 与 `~/.argon-bridge/sessions.json` 双层持久化、`--project` / `--cwd` / `--new-chat` / `--bind` / `--list` 支持）：

```javascript
#!/usr/bin/env node
/**
 * argon-bridge v2.0: Local CLI & Project-to-Chat 1:1 Session Manager
 * Port: 17420 (127.0.0.1)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 17420;
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes
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
  --chat-id       临时或显式指定要路由到的 Gemini Chat ID / URL
  --bind          将当前项目手动绑定到指定的 Gemini Chat URL 或 Chat ID
  --list, -l      列出全局所有已绑定的项目与专属 Gemini 会话映射
  --file, -f      从指定文件读取提问内容
  --out, -o       将 Argon 的回复写入指定文件（如 PLAN.md）
  --timeout, -t   超时时间（毫秒，默认 300000）
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
    bindTarget: null,
    listOnly: false,
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

  if (!config.prompt) {
    logError('提问内容不能为空。请提供提问字符串或使用 --file <path> 指定文件。');
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
          type: 'ASK_ARGON',
          requestId,
          projectKey: projectCtx.projectKey,
          projectName: projectCtx.projectName,
          projectPath: projectCtx.workDir,
          chatId: projectCtx.chatId,
          chatUrl: projectCtx.chatUrl,
          forceNewChat: projectCtx.isNewChat,
          prompt: effectivePrompt,
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

        logSuccess(`已收到 [${projectCtx.projectName}] 专属会话回复！(提取方式: ${source}, 长度: ${markdown.length} 字符)`);

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
        logWarn('Chrome 插件连接暂时断开，等待重连中...');
        promptDispatched = false;
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

```

---

### 2.3 `./extension/manifest.json`

覆盖更新 `./extension/manifest.json`（升级版本号至 `2.0.0`）：

```json
{
  "manifest_version": 3,
  "name": "Argon Bridge v2.0 (1:1 Project-to-Chat Router)",
  "version": "2.0.0",
  "description": "Bridges local CLI / Google Antigravity with Web Gemini 4 Argon featuring 1:1 Project-to-Chat auto-routing",
  "permissions": [
    "tabs",
    "scripting",
    "storage",
    "alarms",
    "clipboardRead",
    "clipboardWrite"
  ],
  "host_permissions": [
    "https://gemini.google.com/*",
    "http://127.0.0.1:17420/*",
    "http://localhost:17420/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "https://gemini.google.com/*"
      ],
      "js": [
        "content.js"
      ],
      "run_at": "document_idle"
    }
  ]
}

```

---

### 2.4 `./extension/background.js`

覆盖更新 `./extension/background.js`。
**核心升级**：引入 `routeAndExecuteTask` 状态机与 `pendingNavigationTask` 挂起队列。当需要跨项目切换会话 URL（如从项目 A 的 `/app/aaa` 切流到项目 B 的 `/app/bbb` 或新建会话 `/app`）时，`background.js` 负责驱动标签页跳转并在新页面 `content.js` 握手就绪后无缝投递提问指令。

```javascript
/**
 * Argon Bridge v2.0 - Background Service Worker & Stateful Session Router
 * Handles:
 * 1. Persistent WebSocket link to ws://127.0.0.1:17420
 * 2. 1:1 Project-to-Chat Tab Routing (multi-tab matching or single-tab URL switching)
 * 3. Pending task buffering across full-page navigations
 */

const WS_URL = 'ws://127.0.0.1:17420';
const RECONNECT_INTERVAL_MS = 1500;
const ALARM_NAME = 'argon-bridge-reconnect-alarm';

let ws = null;
let isConnecting = false;
let reconnectTimer = null;
const contentPorts = new Map(); // tabId -> Port

// 当触发页面 URL 跳转切流时，暂存待执行的提问任务，等待目标页面 content.js 就绪后立刻投递
let pendingNavigationTask = null; // { tabId, taskPayload, createdAt }

function extractChatIdFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  const match = urlStr.match(/gemini\.google\.com\/(?:u\/\d+\/)?app\/([a-zA-Z0-9_-]+)/);
  return match && match[1] ? match[1] : null;
}

function isCleanNewChatUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return /gemini\.google\.com\/(?:u\/\d+\/)?app\/?(?:\?.*)?$/.test(urlStr);
}

function broadcastWsState(state, detail = '', projectInfo = null) {
  for (const [tabId, port] of contentPorts.entries()) {
    try {
      port.postMessage({
        type: 'BRIDGE_STATE',
        state,
        detail,
        projectInfo,
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
            client: 'argon-bridge-mv3-v2',
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
        await routeAndExecuteTask(data);
      } else if (data.type === 'ACK') {
        broadcastWsState('CONNECTED', `已完成 [${data.projectName || '项目'}] 回复同步`);
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
  } catch (_) {
    isConnecting = false;
    ws = null;
    scheduleReconnect();
  }
}

/**
 * 核心 1:1 会话路由器：
 * 根据 taskPayload 中的 chatId / forceNewChat 决定直接投递还是切流跳转
 */
async function routeAndExecuteTask(taskPayload) {
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (!tabs || tabs.length === 0) {
    sendToLocalCli({
      type: 'ERROR',
      requestId: taskPayload.requestId,
      error: '未找到已打开的 https://gemini.google.com 标签页，请在 Chrome 中打开 Gemini 网页版。',
    });
    return;
  }

  const targetChatId = taskPayload.forceNewChat ? null : taskPayload.chatId;
  const projectLabel = taskPayload.projectName || '未命名项目';

  // 情况 1：该项目已绑定专属 chatId
  if (targetChatId) {
    // 1a. 检查是否已经有打开的标签页正好停留在该 chatId
    const matchedTab = tabs.find((t) => extractChatIdFromUrl(t.url) === targetChatId);
    if (matchedTab && matchedTab.id) {
      sendToLocalCli({
        type: 'STATUS',
        status: `已命中项目 [${projectLabel}] 的专属会话标签页`,
        detail: `chatId: ${targetChatId}`,
      });
      await dispatchTaskToTab(matchedTab.id, taskPayload);
      return;
    }

    // 1b. 没有现成匹配的标签页 -> 选择当前激活（或第一个）Gemini 标签页，自动切流跳转到目标专属会话 URL
    const tabToSwitch = tabs.find((t) => t.active) || tabs[0];
    const targetUrl = `https://gemini.google.com/app/${targetChatId}`;

    sendToLocalCli({
      type: 'STATUS',
      status: `正在为项目 [${projectLabel}] 自动切流至专属会话...`,
      detail: targetUrl,
    });

    pendingNavigationTask = {
      tabId: tabToSwitch.id,
      taskPayload,
      createdAt: Date.now(),
    };

    await chrome.tabs.update(tabToSwitch.id, { url: targetUrl });
    return;
  }

  // 情况 2：新项目首次提问 或 显式指定 --new-chat
  const activeTab = tabs.find((t) => t.active) || tabs[0];

  // 如果当前标签页已经是干净的 /app 新会话页且没有强制刷新需求，先交由 content.js 判断或直接新建
  if (isCleanNewChatUrl(activeTab.url) && !taskPayload.forceNewChat) {
    sendToLocalCli({
      type: 'STATUS',
      status: `正在为项目 [${projectLabel}] 初始化专属新会话...`,
      detail: 'https://gemini.google.com/app',
    });
    await dispatchTaskToTab(activeTab.id, taskPayload);
    return;
  }

  // 否则驱动标签页跳转到干净的 https://gemini.google.com/app 开启全新会话
  sendToLocalCli({
    type: 'STATUS',
    status: `正在为项目 [${projectLabel}] 切换至全新 Gemini 会话窗口...`,
    detail: 'https://gemini.google.com/app',
  });

  pendingNavigationTask = {
    tabId: activeTab.id,
    taskPayload,
    createdAt: Date.now(),
  };

  await chrome.tabs.update(activeTab.id, { url: 'https://gemini.google.com/app' });
}

async function dispatchTaskToTab(tabId, taskPayload) {
  const port = contentPorts.get(tabId);
  if (port) {
    try {
      port.postMessage(taskPayload);
      return;
    } catch (_) {
      contentPorts.delete(tabId);
    }
  }

  try {
    await chrome.tabs.sendMessage(tabId, taskPayload);
  } catch (err) {
    sendToLocalCli({
      type: 'ERROR',
      requestId: taskPayload.requestId,
      error: `无法向目标 Gemini 标签页投递任务 (${err.message})，请确认页面已加载完成。`,
    });
  }
}

// 监听来自 content.js 的长连接
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'argon-keepalive-port') return;

  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
  if (tabId) {
    contentPorts.set(tabId, port);
  }

  const isConnected = ws && ws.readyState === WebSocket.OPEN;
  port.postMessage({
    type: 'BRIDGE_STATE',
    state: isConnected ? 'CONNECTED' : 'STANDBY',
    detail: isConnected ? '已连接本地 CLI (17420)' : '待命：等待本地运行 ask_argon.js',
    timestamp: Date.now(),
  });

  connectWebSocket(false);

  // 检查该 tabId 是否有因切流跳转而挂起的提问任务
  if (tabId && pendingNavigationTask && pendingNavigationTask.tabId === tabId) {
    const taskToRun = pendingNavigationTask.taskPayload;
    pendingNavigationTask = null;
    setTimeout(() => {
      dispatchTaskToTab(tabId, taskToRun);
    }, 600);
  }

  port.onMessage.addListener(async (msg) => {
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

    if (msg.type === 'STATUS' || msg.type === 'ERROR') {
      sendToLocalCli(msg);
      return;
    }

    if (msg.type === 'RESPONSE') {
      // 将项目与会话映射同步备份至 chrome.storage.local
      if (msg.projectKey && msg.chatId) {
        try {
          const store = await chrome.storage.local.get(['argonSessions']);
          const sessions = store.argonSessions || {};
          sessions[msg.projectKey] = {
            projectName: msg.projectName,
            chatId: msg.chatId,
            chatUrl: msg.chatUrl,
            updatedAt: Date.now(),
          };
          await chrome.storage.local.set({ argonSessions: sessions });
        } catch (_) {}
      }
      sendToLocalCli(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId) {
      contentPorts.delete(tabId);
    }
  });
});

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

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    connectWebSocket(false);
  }
});

connectWebSocket(false);

```

---

### 2.5 `./extension/content.js`

覆盖更新 `./extension/content.js`。
**核心升级**：

1. **支持页面跳转后的输入框异步等待 (`waitForInputReady`)**：当 `background.js` 自动切流跳转到目标项目的 `/app/<chatId>` 时，耐心等待 Gemini 富文本编辑器挂载完成再注入提问。
2. **右上角悬浮窗增加 `[Project <-> ChatID]` 实时徽章**：一眼看清当前网页正在为哪个本地项目服务。
3. **首轮对话 URL `chatId` 自动捕获 (`waitForChatIdInUrl`)**：新项目首轮生成完毕后，自动提取地址栏中的 `/app/<chatId>` 并回传给本地 `ask_argon.js` 落盘保存。

```javascript
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
    return Array.from(document.querySelectorAll('.markdown'));
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

  async function waitForGenerationComplete(initialCount, initialLastText, projectName, timeoutMs = 280000) {
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
        if (!stopVisible && currentText.length > 0 && quietDuration >= 2600) {
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

  async function extractCleanMarkdown(responseNode) {
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

    const domMarkdown = convertDomNodeToMarkdown(responseNode);
    if (domMarkdown && domMarkdown.length > 0) {
      return {
        markdown: domMarkdown,
        source: 'dom-markdown-serializer',
      };
    }

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
        error: '当前页面正在执行另一个 Argon 提问任务，请稍候重试。',
      });
      return;
    }

    isProcessingTask = true;
    const projectName = task.projectName || 'default';

    try {
      await waitForInputReady(20000);

      if (task.forceNewChat) {
        await ensureCleanNewChatIfRequired(true);
      }

      const activeCid = getCurrentChatIdFromUrl();
      const badgeLabel = `${projectName} · ${activeCid ? '#' + activeCid.slice(0, 6) : 'NEW'}`;

      reportStatus(`正在向 [${projectName}] 专属会话提问...`, `Req: ${task.requestId.slice(0, 8)}`, badgeLabel);

      const existingResponses = getModelResponseElements();
      const initialCount = existingResponses.length;
      const initialLastText =
        initialCount > 0 ? (existingResponses[initialCount - 1].innerText || '').trim() : '';

      await injectPromptAndSend(task.prompt);
      reportStatus(`已发送 [${projectName}] 提问`, '等待 Gemini 4 Argon 响应...', badgeLabel);

      const latestResponseNode = await waitForGenerationComplete(
        initialCount,
        initialLastText,
        projectName
      );
      reportStatus('生成完毕', '正在提取纯净 Markdown 与会话 ID...', badgeLabel);

      const { markdown, source } = await extractCleanMarkdown(latestResponseNode);
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
    }
  }

  createFloatingHud();
  connectToBackground();
})();

```

---

## 3. 本地升级部署与多项目切流验收命令

文件全部覆盖保存后，请按以下三步完成 v2.0 升级与多项目自动切流测试：

### 第一步：重新加载 Chrome 插件

1. 打开 Chrome `chrome://extensions/` 页面，找到 **Argon Bridge**，点击右下角的 **刷新图标 ($\circlearrowright$)**。
2. 刷新已打开的 `[https://gemini.google.com/](https://gemini.google.com/)` 页面，右上角悬浮窗将显示 **`Argon Bridge v2`** 及当前会话徽章。

### 第二步：测试项目 A 与项目 B 的 1:1 自动绑定与切流

在本地终端依次运行以下命令，观察浏览器自动开启新会话、自动绑定 `chatId` 以及在两个项目间自动切流的效果：

```bash
# 1. 模拟项目 alpha 首次提问（浏览器将自动在 /app 开启新会话，并在完成后自动保存 chatId）
node ask_argon.js --project "project-alpha" "你好，这里是项目 Alpha，请记住我们的项目代号是 ALPHA-001，简短回复确认即可。"

# 2. 模拟切换到另一个项目 beta 首次提问（浏览器将自动切流开启第二个全新会话，绝不与 Alpha 串味）
node ask_argon.js --project "project-beta" "你好，这里是项目 Beta，请记住我们的项目代号是 BETA-999，简短回复确认即可。"

# 3. 查看全局已绑定的所有项目与专属 Gemini 会话 URL
node ask_argon.js --list

# 4. 再次向项目 alpha 提问（验证浏览器是否自动切回 Alpha 的专属会话并准确说出代号 ALPHA-001！）
node ask_argon.js --project "project-alpha" "请问我们这个项目的代号是什么？"

```
