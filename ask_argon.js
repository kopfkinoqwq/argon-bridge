#!/usr/bin/env node
/**
 * argon-bridge v3.2: Local CLI, 1:1 Session Router & Dual-Mode Fallback Policy Switch
 * Port: 17420 (127.0.0.1)
 *
 * Fallback Policy Modes:
 *   - "ask"  (ON / interactive): Halt immediately on failure/timeout/refusal; MUST ask user and wait. (Exit Code 20)
 *   - "auto" (OFF / silent):     Automatically fall back to local model without asking user.          (Exit Code 21)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// 导入增强组件 (Reverse Probe & Entropy Guard)
let parseReverseProbeDirective = null;
let buildProbeResponsePrompt = null;
let MAX_PROBE_ROUNDS = 3;
try {
  const rp = require('./reverse_probe');
  parseReverseProbeDirective = rp.parseReverseProbeDirective;
  buildProbeResponsePrompt = rp.buildProbeResponsePrompt;
  MAX_PROBE_ROUNDS = rp.MAX_PROBE_ROUNDS || 3;
} catch (_) {}

let checkWatermarks = null;
try {
  const eg = require('./entropy_guard');
  checkWatermarks = eg.checkWatermarks;
} catch (_) {}

const DEFAULT_PORT = 17420;
const DEFAULT_TIMEOUT_MS = 600000; // 默认 600秒 (10分钟)，充足保障 Gemini 4 Argon High 深度思考与长文本输出
const LOCAL_CONFIG_FILENAME = '.argon.json';
const GLOBAL_REGISTRY_DIR = path.join(os.homedir(), '.argon-bridge');
const GLOBAL_REGISTRY_FILE = path.join(GLOBAL_REGISTRY_DIR, 'sessions.json');
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_REGISTRY_DIR, 'config.json');

const EXIT_CODE_ASK_USER = 20;
const EXIT_CODE_AUTO_TAKEOVER = 21;

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

/**
 * 将各种用户/CLI 输入的开关别名归一化为标准的 'ask' 或 'auto'
 */
function normalizeFallbackPolicy(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim().toLowerCase();
  if (['ask', 'on', 'true', '1', 'interactive', 'strict', 'prompt', '开'].includes(s)) {
    return 'ask';
  }
  if (['auto', 'off', 'false', '0', 'silent', 'local', 'takeover', '关'].includes(s)) {
    return 'auto';
  }
  return null;
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

function ensureGlobalDir() {
  if (!fs.existsSync(GLOBAL_REGISTRY_DIR)) {
    fs.mkdirSync(GLOBAL_REGISTRY_DIR, { recursive: true });
  }
}

function loadGlobalConfig() {
  const defaults = {
    version: '3.2.0',
    defaultFallbackPolicy: 'ask',
    defaultModel: 'Argon',
    defaultThinkingLevel: 'high',
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    detectSafetyRefusal: true,
    updatedAt: new Date().toISOString(),
  };
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf8'));
      const normPolicy = normalizeFallbackPolicy(parsed.defaultFallbackPolicy) || 'ask';
      return { ...defaults, ...parsed, defaultFallbackPolicy: normPolicy };
    }
  } catch (err) {
    logWarn(`读取全局配置文件失败，使用默认值: ${err.message}`);
  }
  return defaults;
}

function saveGlobalConfig(newConfig) {
  try {
    ensureGlobalDir();
    const merged = {
      ...loadGlobalConfig(),
      ...newConfig,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    return merged;
  } catch (err) {
    logError(`写入全局配置 ${GLOBAL_CONFIG_FILE} 失败: ${err.message}`);
    return null;
  }
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
    ensureGlobalDir();
    fs.writeFileSync(GLOBAL_REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  } catch (err) {
    logWarn(`写入全局会话注册表失败: ${err.message}`);
  }
}

function loadLocalProjectConfig(localConfigPath) {
  if (!fs.existsSync(localConfigPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 解析项目上下文与四级优先级回退策略：
 * CLI --fallback > ENV ARGON_FALLBACK_MODE > .argon.json fallbackPolicy > ~/.argon-bridge/config.json defaultFallbackPolicy
 */
function detectProjectContext(options) {
  const workDir = path.resolve(options.cwd || process.cwd());
  const localConfigPath = path.join(workDir, LOCAL_CONFIG_FILENAME);
  const localConfig = loadLocalProjectConfig(localConfigPath);
  const globalConfig = loadGlobalConfig();

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

  // 计算四级回退策略优先级
  const cliPolicy = normalizeFallbackPolicy(options.fallback);
  const envPolicy = normalizeFallbackPolicy(process.env.ARGON_FALLBACK_MODE);
  const projectPolicy =
    (localConfig && normalizeFallbackPolicy(localConfig.fallbackPolicy)) ||
    (globalEntry && normalizeFallbackPolicy(globalEntry.fallbackPolicy));
  const globalPolicy = normalizeFallbackPolicy(globalConfig.defaultFallbackPolicy) || 'ask';

  let effectiveFallbackPolicy = globalPolicy;
  let fallbackPolicySource = `global (${GLOBAL_CONFIG_FILE})`;

  if (projectPolicy) {
    effectiveFallbackPolicy = projectPolicy;
    fallbackPolicySource = `project (${localConfigPath})`;
  }
  if (envPolicy) {
    effectiveFallbackPolicy = envPolicy;
    fallbackPolicySource = 'env (ARGON_FALLBACK_MODE)';
  }
  if (cliPolicy) {
    effectiveFallbackPolicy = cliPolicy;
    fallbackPolicySource = 'cli (--fallback)';
  }

  return {
    projectKey,
    projectName,
    workDir,
    localConfigPath,
    localConfig,
    globalConfig,
    chatId,
    chatUrl: buildChatUrl(chatId),
    isNewChat: Boolean(options.newChat || !chatId),
    effectiveFallbackPolicy,
    fallbackPolicySource,
    projectPolicy: projectPolicy || null,
    globalPolicy,
  };
}

/**
 * 持久化项目的会话 ID 或项目级回退策略
 */
function persistProjectSession(ctx, chatId, chatUrl, customFallbackPolicy = undefined) {
  const existingLocal = loadLocalProjectConfig(ctx.localConfigPath) || {};
  const cleanId =
    normalizeChatId(chatId) ||
    normalizeChatId(chatUrl) ||
    normalizeChatId(existingLocal.chatId) ||
    ctx.chatId ||
    null;

  const finalUrl = buildChatUrl(cleanId);
  const nowIso = new Date().toISOString();

  const resolvedPolicy =
    customFallbackPolicy !== undefined
      ? customFallbackPolicy
      : normalizeFallbackPolicy(existingLocal.fallbackPolicy) || ctx.projectPolicy || undefined;

  const record = {
    projectKey: ctx.projectKey,
    projectName: ctx.projectName,
    projectPath: ctx.workDir,
    chatId: cleanId,
    chatUrl: finalUrl,
    ...(resolvedPolicy ? { fallbackPolicy: resolvedPolicy } : {}),
    updatedAt: nowIso,
  };

  try {
    fs.writeFileSync(ctx.localConfigPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  } catch (err) {
    logWarn(`无法写入项目本地配置 ${ctx.localConfigPath}: ${err.message}`);
  }

  const registry = loadGlobalRegistry();
  registry.projects[ctx.projectKey] = record;
  saveGlobalRegistry(registry);

  return record;
}

/**
 * 检测网页端返回的内容是否属于 Google 官方安全策略罐头拒答 (Canned Safety Refusal)
 */
function detectOfficialRefusal(markdownText) {
  if (!markdownText || typeof markdownText !== 'string') {
    return { isRefusal: true, reason: '返回内容为空 (Empty Response)' };
  }
  const trimmed = markdownText.trim();
  if (trimmed.length === 0) {
    return { isRefusal: true, reason: '返回内容为空白字符串' };
  }

  // 官方罐头拒答通常很短（小于 180 字符）且包含特定模板句式
  if (trimmed.length <= 180) {
    const refusalPatterns = [
      /我是一个文本\s*AI.*超出了我的能力范围/i,
      /作为一个人工智能.*我无法/i,
      /我还在不断学习中.*暂时无法回答/i,
      /抱歉，我无法协助处理此请求/i,
      /I'm a text-based AI,?\s*and that's outside my capabilities/i,
      /I cannot fulfill this request/i,
      /I'm sorry,?\s*but I can't help with that/i,
    ];
    for (const pattern of refusalPatterns) {
      if (pattern.test(trimmed)) {
        return {
          isRefusal: true,
          reason: `触发 Google 官方安全策略拒答拦截 ("${trimmed.replace(/\s+/g, ' ')}")`,
        };
      }
    }
  }
  return { isRefusal: false, reason: null };
}

/**
 * 核心回退策略执行器：当发生任何超时、断连、DOM 错误或安全拒答时调用
 * 向 stdout 与 stderr 输出强语义的 [ARGON_FALLBACK_DIRECTIVE] 块，供本地 Gemini 3.8 Flash 精确遵循
 */
function triggerFallbackDirectiveAndExit(ctx, failureCategory, failureDetail, cleanupFn) {
  const mode = ctx.effectiveFallbackPolicy; // 'ask' | 'auto'

  process.stderr.write('\n' + '='.repeat(78) + '\n');
  logError(`云端 Gemini 4 Argon 调用未完成 | 故障类别: ${failureCategory}`);
  logError(`故障详情: ${failureDetail}`);
  logInfo(
    `当前生效回退策略开关 (Fallback Policy): [${mode.toUpperCase()}] (来源: ${ctx.fallbackPolicySource})`
  );
  process.stderr.write('='.repeat(78) + '\n');

  if (mode === 'ask') {
    const directiveBlock = [
      `[ARGON_FALLBACK_DIRECTIVE]`,
      `POLICY_SWITCH=ON (ask / interactive)`,
      `FAILURE_CATEGORY=${failureCategory}`,
      `PROJECT_NAME=${ctx.projectName}`,
      `CHAT_URL=${ctx.chatUrl}`,
      `FAILURE_REASON=${failureDetail}`,
      `MANDATORY_AGENT_ACTION=HALT_AND_ASK_USER`,
      `INSTRUCTION_TO_LOCAL_AGENT:`,
      `  1. 【绝对禁令】当前回退策略开关为「开 (ask)」。严禁本地模型 (Gemini 3.8 Flash) 擅自接管任务或编写业务代码！`,
      `  2. 【强制挂起】请立即停止后续工具调用，向用户展示以下结构化询问并等待用户回复：`,
      `     - 报告故障原因: ${failureCategory} (${failureDetail})`,
      `     - 选项 1: 【重试云端 Argon】(等待用户检查浏览器或允许脱敏改写 Prompt 后重新运行 ask_argon.js)`,
      `     - 选项 2: 【授权本次由本地模型接管】(仅本次跳过 Argon，由本地模型直接完成)`,
      `     - 选项 3: 【将回退开关切换为 auto 并继续】(运行 node ask_argon.js --set-fallback auto 并由本地模型完成全部工作)`,
      `[/ARGON_FALLBACK_DIRECTIVE]`,
    ].join('\n');

    process.stdout.write(directiveBlock + '\n');
    cleanupFn(EXIT_CODE_ASK_USER);
  } else {
    const directiveBlock = [
      `[ARGON_FALLBACK_DIRECTIVE]`,
      `POLICY_SWITCH=OFF (auto / silent)`,
      `FAILURE_CATEGORY=${failureCategory}`,
      `PROJECT_NAME=${ctx.projectName}`,
      `CHAT_URL=${ctx.chatUrl}`,
      `FAILURE_REASON=${failureDetail}`,
      `MANDATORY_AGENT_ACTION=AUTO_LOCAL_TAKEOVER`,
      `INSTRUCTION_TO_LOCAL_AGENT:`,
      `  1. 【静默接管】当前回退策略开关为「关 (auto)」。严禁向用户提问或中断任务流！`,
      `  2. 【全速推进】请本地执行官 (Gemini 3.8 Flash) 立即接管首席架构师职责，利用本地模型能力独立、完整地完成全部剩余开发任务。`,
      `  3. 【交付备注】在全部工作完成后的最终汇报末尾，附注说明本次因云端 ${failureCategory} 已按 auto 策略由本地模型自动接管完成。`,
      `[/ARGON_FALLBACK_DIRECTIVE]`,
    ].join('\n');

    process.stdout.write(directiveBlock + '\n');
    cleanupFn(EXIT_CODE_AUTO_TAKEOVER);
  }
}

function printStatus(ctx) {
  const modeLabel =
    ctx.effectiveFallbackPolicy === 'ask'
      ? '\x1b[33m开 (ask / 失败时强制询问用户并挂起)\x1b[0m'
      : '\x1b[32m关 (auto / 失败时自动由本地模型静默接管)\x1b[0m';

  process.stderr.write(`
\x1b[1m=== Argon-Bridge v3.2 状态与回退策略面板 ===\x1b[0m
  当前项目名称 : ${ctx.projectName} (${ctx.projectKey})
  项目工作目录 : ${ctx.workDir}
  本地配置文件 : ${ctx.localConfigPath} (${fs.existsSync(ctx.localConfigPath) ? '已存在' : '未创建'})
  全局配置文件 : ${GLOBAL_CONFIG_FILE}
  绑定会话 ID  : ${ctx.chatId || '未绑定 (下次提问将自动新建)'}
  绑定会话 URL : ${ctx.chatUrl}
  --------------------------------------------------------
  生效回退开关 : ${modeLabel}
  策略生效来源 : ${ctx.fallbackPolicySource}
  项目级开关值 : ${ctx.projectPolicy || '(未单独设置，继承全局)'}
  全局默认开关 : ${ctx.globalPolicy}
\n`);
}

function printSessionList() {
  const registry = loadGlobalRegistry();
  const globalCfg = loadGlobalConfig();
  const entries = Object.values(registry.projects || {});
  process.stderr.write(
    `\n\x1b[1m=== Argon Bridge 全局配置 ===\x1b[0m\n` +
      `  全局默认回退开关 (defaultFallbackPolicy): \x1b[36m${globalCfg.defaultFallbackPolicy}\x1b[0m (${GLOBAL_CONFIG_FILE})\n`
  );
  if (entries.length === 0) {
    logInfo('当前尚无已绑定的项目会话记录。');
    return;
  }
  process.stderr.write('\n\x1b[1m=== 已绑定项目会话列表 (1:1 Mapping) ===\x1b[0m\n');
  for (const item of entries) {
    const pMode = item.fallbackPolicy || `继承全局 (${globalCfg.defaultFallbackPolicy})`;
    process.stderr.write(
      `- \x1b[32m${item.projectName}\x1b[0m (${item.projectKey})\n` +
        `  目录: ${item.projectPath}\n` +
        `  会话: ${item.chatUrl} (chatId: ${item.chatId || 'N/A'})\n` +
        `  回退开关: ${pMode} | 更新: ${item.updatedAt}\n`
    );
  }
  process.stderr.write('\n');
}

function printHelp() {
  process.stderr.write(`
用法:
  node ask_argon.js "提问内容" [--fallback ask|auto]
  node ask_argon.js --file <prompt.md> [--out <PLAN.md>] [--fallback ask|auto]
  node ask_argon.js --set-fallback <ask|auto|on|off> [--global]
  node ask_argon.js --status
  node ask_argon.js --list

核心参数说明 (v3.2):
  --fallback, -F      单次提问临时指定回退模式: ask (开: 询问用户) 或 auto (关: 本地自动接管)
  --set-fallback      持久化设置回退模式开关 (默认写入当前项目 .argon.json，加 --global 写入全局配置)
  --global, -g        配合 --set-fallback 使用，修改 ~/.argon-bridge/config.json 全局默认开关
  --status, -s        查看当前项目的会话绑定详情与生效的回退策略开关状态
  --project, -P       指定项目名称
  --cwd, -C           指定目标项目根目录路径
  --new-chat, -N      强制为当前项目创建新的 Gemini 会话并更新绑定
  --bind              手动绑定指定的 Gemini Chat URL 或 Chat ID 到当前项目
  --list, -l          列出全局配置及所有已绑定的项目会话映射
  --file, -f          从指定文件读取提问内容
  --out, -o           将 Argon 的回复写入指定文件（如 PLAN.md）
  --timeout, -t       超时时间（毫秒，默认 600000 即 600 秒）
  --no-refusal-check  禁用官方罐头安全拒答检测
  --help, -h          显示本帮助信息
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
    statusOnly: false,
    fallback: null,
    setFallback: null,
    isGlobal: false,
    model: 'Argon',
    thinkingLevel: 'high',
    noRefusalCheck: false,
    port: DEFAULT_PORT,
    timeoutMs: null,
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
    } else if (arg === '--status' || arg === '-s') {
      config.statusOnly = true;
    } else if (arg === '--fallback' || arg === '-F') {
      config.fallback = args[++i];
    } else if (arg === '--set-fallback') {
      config.setFallback = args[++i];
    } else if (arg === '--global' || arg === '-g') {
      config.isGlobal = true;
    } else if (arg === '--model' || arg === '-m') {
      config.model = args[++i] || 'Argon';
    } else if (arg === '--thinking') {
      config.thinkingLevel = args[++i] || 'high';
    } else if (arg === '--no-refusal-check') {
      config.noRefusalCheck = true;
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

  return { config, positional };
}

function main() {
  const { config, positional } = parseArgs(process.argv);

  if (config.listOnly) {
    printSessionList();
    process.exit(0);
  }

  const projectCtx = detectProjectContext(config);

  if (config.statusOnly) {
    printStatus(projectCtx);
    process.exit(0);
  }

  // 处理持久化设置回退策略开关 (--set-fallback ask|auto [--global])
  if (config.setFallback !== null) {
    const targetMode = normalizeFallbackPolicy(config.setFallback);
    if (!targetMode) {
      logError(`无效的回退策略模式 "${config.setFallback}"。可选值: ask (开) | auto (关)`);
      process.exit(1);
    }

    if (config.isGlobal) {
      saveGlobalConfig({ defaultFallbackPolicy: targetMode });
      logSuccess(
        `已将【全局默认】回退策略开关设置为: ${targetMode.toUpperCase()} (${
          targetMode === 'ask' ? '开: 失败时询问用户' : '关: 失败时本地自动接管'
        })`
      );
      logInfo(`全局配置文件已更新: ${GLOBAL_CONFIG_FILE}`);
    } else {
      persistProjectSession(projectCtx, projectCtx.chatId, projectCtx.chatUrl, targetMode);
      logSuccess(
        `已将项目 [${projectCtx.projectName}] 的回退策略开关设置为: ${targetMode.toUpperCase()} (${
          targetMode === 'ask' ? '开: 失败时询问用户' : '关: 失败时本地自动接管'
        })`
      );
      logInfo(`项目配置文件已更新: ${projectCtx.localConfigPath}`);
    }
    process.exit(0);
  }

  if (config.bindTarget) {
    const saved = persistProjectSession(projectCtx, config.bindTarget, config.bindTarget);
    if (!saved || !saved.chatId) {
      logError(`无效的 Chat URL 或 Chat ID: ${config.bindTarget}`);
      process.exit(1);
    }
    logSuccess(`已将项目 [${projectCtx.projectName}] 手动绑定至会话: ${saved.chatUrl}`);
    logInfo(`本地配置文件已更新: ${projectCtx.localConfigPath}`);
    process.exit(0);
  }

  // 读取提问内容
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

  const timeoutMs = config.timeoutMs || projectCtx.globalConfig.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
  let currentPrompt = projectCtx.isNewChat
    ? `[Argon-Bridge Project Session Init | Project: ${projectCtx.projectName} | Path: ${projectCtx.workDir}]\n\n${config.prompt}`
    : config.prompt;

  const requestId = crypto.randomUUID();
  let promptDispatched = false;
  let isCompleted = false;
  let probeRound = 0;
  let activeWs = null;

  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: config.port,
  });

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

  const timeoutHandle = setTimeout(() => {
    if (!isCompleted) {
      triggerFallbackDirectiveAndExit(
        projectCtx,
        'TIMEOUT_420S',
        `等待 Gemini 4 Argon 响应超过阈值 (${Math.round(timeoutMs / 1000)}s)，可能是网络中断、插件未连接或超长深度推理超时。`,
        cleanupAndExit
      );
    }
  }, timeoutMs);

  wss.on('listening', () => {
    logInfo(`本地 WebSocket 服务已启动: ws://127.0.0.1:${config.port}`);
    logInfo(
      `项目: [${projectCtx.projectName}] | 会话: ${
        projectCtx.isNewChat ? '新建专属会话 (New Chat)' : projectCtx.chatUrl
      }`
    );
    logInfo(
      `回退开关: [${projectCtx.effectiveFallbackPolicy.toUpperCase()}] (${
        projectCtx.effectiveFallbackPolicy === 'ask'
          ? '开: 异常时强制询问用户'
          : '关: 异常时自动本地接管'
      }) | 超时上限: ${Math.round(timeoutMs / 1000)}s`
    );
  });

  wss.on('error', (err) => {
    if (isCompleted) return;
    const reason =
      err.code === 'EADDRINUSE'
        ? `本地端口 ${config.port} 已被占用，可能存在未退出的残留 ask_argon.js 进程。`
        : `WebSocket Server 异常: ${err.message}`;
    triggerFallbackDirectiveAndExit(projectCtx, 'WS_SERVER_ERROR', reason, cleanupAndExit);
  });

  wss.on('connection', (ws) => {
    activeWs = ws;
    logSuccess('Chrome 插件已连接！正在下发项目路由、双重锁定与提问指令...');

    function sendPromptToExtension(promptToSend) {
      if (isCompleted) return;
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
          forceNewChat: probeRound === 0 ? projectCtx.isNewChat : false,
          model: config.model,
          thinkingLevel: config.thinkingLevel,
          prompt: promptToSend,
          timestamp: Date.now(),
        })
      );
    }

    const dispatchTimer = setTimeout(() => {
      sendPromptToExtension(currentPrompt);
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
        sendPromptToExtension(currentPrompt);
        return;
      }

      if (msg.type === 'STATUS') {
        logInfo(`[浏览器状态] ${msg.status}${msg.detail ? ' - ' + msg.detail : ''}`);
        return;
      }

      if (msg.type === 'ERROR') {
        if (isCompleted) return;
        triggerFallbackDirectiveAndExit(
          projectCtx,
          'BROWSER_DOM_ERROR',
          msg.error || '浏览器插件执行 DOM 注入或模型切流时报告未知错误',
          cleanupAndExit
        );
        return;
      }

      if (msg.type === 'RESPONSE') {
        if (isCompleted) return;

        const markdown = (msg.markdown || '').trim();
        const source = msg.source || 'unknown';
        const returnedChatId = normalizeChatId(msg.chatId) || normalizeChatId(msg.chatUrl);

        // 先保存会话 chatId（即便本轮触发安全拒答，会话 URL 本身也是有效绑定的）
        if (returnedChatId) {
          const savedRecord = persistProjectSession(projectCtx, returnedChatId, msg.chatUrl);
          if (savedRecord && (projectCtx.isNewChat || projectCtx.chatId !== savedRecord.chatId)) {
            logSuccess(`已自动绑定项目 [${projectCtx.projectName}] <-> 专属会话: ${savedRecord.chatUrl}`);
          }
        }

        // 检查是否触发了官方罐头安全拒答
        const shouldCheckRefusal =
          !config.noRefusalCheck && projectCtx.globalConfig.detectSafetyRefusal !== false;
        if (shouldCheckRefusal) {
          const refusalCheck = detectOfficialRefusal(markdown);
          if (refusalCheck.isRefusal) {
            try {
              ws.send(JSON.stringify({ type: 'ACK', requestId, projectName: projectCtx.projectName }));
            } catch (_) {}
            triggerFallbackDirectiveAndExit(
              projectCtx,
              'OFFICIAL_SAFETY_REFUSAL',
              refusalCheck.reason,
              cleanupAndExit
            );
            return;
          }
        }

        // 检查云端 Argon 是否输出了反向探测指令 (Reverse Probe)
        if (typeof parseReverseProbeDirective === 'function') {
          const probeDirective = parseReverseProbeDirective(markdown);
          if (probeDirective && probeRound < MAX_PROBE_ROUNDS) {
            probeRound++;
            const probeSummary = probeDirective.probes
              .map((p) => `${p.op}(${p.path || p.pattern || p.target || '.'})`)
              .join(', ');
            logWarn(`[Argon-Probe ${probeRound}/${MAX_PROBE_ROUNDS}] 🔍 云端首席架构师正在反向探测本地代码: ${probeSummary}`);
            currentPrompt = buildProbeResponsePrompt(projectCtx.workDir, probeDirective, probeRound);
            sendPromptToExtension(currentPrompt);
            return;
          }
        }

        // 检查会话熵减水位线 (Entropy-Guard)
        if (typeof checkWatermarks === 'function') {
          const watermarkStatus = checkWatermarks({
            turnCount: (projectCtx.localConfig?.turnCount || 0) + 1,
            domNodes: msg.telemetry?.domNodes || 0,
            cumulativeChars: (projectCtx.localConfig?.cumulativeChars || 0) + markdown.length,
          });
          if (watermarkStatus.hitSoft) {
            logWarn(
              `♻️ [Argon-Entropy-Guard] 当前会话已触达软水位线 (${watermarkStatus.reason})。建议在合适时机使用 --new-chat 触发架构状态交接！`
            );
          }
        }

        isCompleted = true;
        logSuccess(
          `已收到 [${projectCtx.projectName}] 专属会话回复！(提取方式: ${source}, 长度: ${markdown.length} 字符)`
        );

        try {
          ws.send(JSON.stringify({ type: 'ACK', requestId, projectName: projectCtx.projectName }));
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
