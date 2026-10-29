/**
 * entropy_guard.js - Long-Session Entropy Reduction & Rolling Handover Protocol
 * Manages dual-watermark monitoring (Soft vs Hard), Architecture State Seed distillation,
 * and seamless session lineage handover without losing project constraints.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WATERMARKS = {
  SOFT_TURNS: 28,
  HARD_TURNS: 40,
  SOFT_DOM_NODES: 24000,
  HARD_DOM_NODES: 35000,
  SOFT_CUMULATIVE_CHARS: 160000,
  HARD_CUMULATIVE_CHARS: 240000,
};

/**
 * 检查当前会话的水位状态
 */
function checkWatermarks(metrics = {}) {
  const turns = metrics.turnCount || 0;
  const domNodes = metrics.lastDomNodes || metrics.domNodes || 0;
  const chars = metrics.cumulativeChars || 0;

  if (turns >= WATERMARKS.HARD_TURNS) {
    return { hitSoft: true, hitHard: true, reason: `HARD_WATERMARK_TURNS_${turns}` };
  }
  if (domNodes >= WATERMARKS.HARD_DOM_NODES) {
    return { hitSoft: true, hitHard: true, reason: `HARD_WATERMARK_DOM_${domNodes}` };
  }
  if (chars >= WATERMARKS.HARD_CUMULATIVE_CHARS) {
    return { hitSoft: true, hitHard: true, reason: `HARD_WATERMARK_CHARS_${chars}` };
  }

  if (turns >= WATERMARKS.SOFT_TURNS) {
    return { hitSoft: true, hitHard: false, reason: `SOFT_WATERMARK_TURNS_${turns}` };
  }
  if (domNodes >= WATERMARKS.SOFT_DOM_NODES) {
    return { hitSoft: true, hitHard: false, reason: `SOFT_WATERMARK_DOM_${domNodes}` };
  }
  if (chars >= WATERMARKS.SOFT_CUMULATIVE_CHARS) {
    return { hitSoft: true, hitHard: false, reason: `SOFT_WATERMARK_CHARS_${chars}` };
  }

  return { hitSoft: false, hitHard: false, reason: 'NORMAL' };
}

/**
 * 生成蒸馏指令（发给即将达到水位的旧会话）
 */
function buildDistillationPrompt(projectName) {
  return [
    '【系统级指令：EXEC_SESSION_HANDOVER_DISTILLATION】',
    `当前项目 [${projectName}] 会话即将达到长上下文熵增水位线。`,
    '请作为云端首席架构师，停止一切常规业务回答，立即将本会话自启动以来的全部核心记忆浓缩为一份高密度的《Architecture State Seed (v1)》。',
    '请严格按照以下 Markdown 模板输出（切勿遗漏代码块闭合，切勿发起反向探测）：',
    '',
    '# [ARGON-ARCHITECT-SEED]',
    '```json',
    '{',
    '  "__argon_seed_version__": "1.0",',
    `  "project_name": "${projectName}",`,
    '  "current_version": "v3.0.0",',
    `  "handover_timestamp": "${new Date().toISOString()}",`,
    '  "active_phase": "Production Phase 2 & 3"',
    '}',
    '```',
    '',
    '### 1. 核心架构基线与拓扑 (System Topology Baseline)',
    '- 简明列出当前已落盘生效的核心模块、文件职责、端口约定与通信链路（不超过 15 行）。',
    '',
    '### 2. 不可违背的架构铁律 (Immutable Architectural Invariants)',
    '- 列出所有已达成共识的设计约束（如：Single-Action 防重放、MAIN World 剪贴板零触劫持、O(1) 尾游标锁定、单文件 Daemon 端口复用等）。',
    '',
    '### 3. 已否决的历史废案与避坑指南 (Rejected Alternatives & Post-Mortems)',
    '- 【极重要】列出本会话中曾讨论或尝试过但已被证明不可行的方案及原因（防止新会话中的你重新提出这些错误方案）。',
    '',
    '### 4. 关键接口契约与数据结构快照 (Core Contracts & Schemas)',
    '- 保留当前正在高频交互的核心函数签名、消息协议字段或状态机状态定义。',
    '',
    '### 5. 当前施工断点与下一阶段待办 (Active Checkpoint & Next Actions)',
    '- 最后完成动作：<刚落地的具体改动>',
    '- 当前悬而未决的焦点问题：<正在攻关的技术点>',
    '- 下一步计划 (Next Steps)：<优先级排序的 1-3 项任务>',
  ].join('\n');
}

/**
 * 生成新会话唤醒注入模板（发送给全新开启的 Gemini 会话第 1 轮）
 */
function buildBootstrapPrompt({ generation = 1, parentSessionId = '', seedContent = '' }) {
  return [
    `【系统级协议：ARGON_BRIDGE_SESSION_BOOTSTRAP (Generation ${generation})】`,
    '你是本项目的【云端首席架构师 (Gemini 4 Argon)】，正在与【本地执行官 (Gemini 3.8 Flash)】通过 `argon-bridge` 双脑协同总线协作。',
    parentSessionId ? `由于上一代会话 (${parentSessionId}) 达到上下文容量水位，现已完成无损滚动压缩。` : '',
    '',
    '### 一、你的反向探测权限声明 (Reverse Tool-Calling Capability)',
    '当你在后续对话中需要查看本地真实代码、搜索符号或检查 Git 改动才能做出精准架构裁决时，切勿盲目猜测！',
    '你只需在回复中输出专属指令块，本地守护进程会自动抓取文件内容并在下一轮回填给你：',
    '```argon-probe',
    '{',
    '  "__argon_protocol__": "REVERSE_PROBE_V1",',
    '  "reason": "简述需要探测的原因",',
    '  "probes": [',
    '    { "op": "READ_FILE", "path": "相对路径", "startLine": 1, "endLine": 150 },',
    '    { "op": "SEARCH_CODE", "pattern": "正则或关键字", "glob": "*.js" },',
    '    { "op": "GIT_DIFF", "target": "HEAD" },',
    '    { "op": "LIST_DIR", "path": "目录相对路径", "depth": 2 }',
    '  ]',
    '}',
    '```',
    '',
    '### 二、继承自上一代会话的架构状态种子 (Inherited Architecture State Seed)',
    '',
    seedContent.trim() || '（无历史种子，初始化会话基线）',
    '',
    `请确认已完整加载上述架构记忆与反向探测协议，仅需简短回复：[SEED_ACK: Generation ${generation} Ready]，随后等待本地执行官的具体指令。`,
  ].join('\n');
}

/**
 * 将蒸馏出的 Seed 实体持久化到项目根目录下的 .argon/seeds/
 */
function saveSeedSnapshot(projectRoot, generation, seedContent) {
  const seedsDir = path.join(projectRoot, '.argon', 'seeds');
  if (!fs.existsSync(seedsDir)) {
    fs.mkdirSync(seedsDir, { recursive: true });
  }
  const seedFile = path.join(seedsDir, `gen-${generation}-seed.md`);
  fs.writeFileSync(seedFile, seedContent.trim() + '\n', 'utf8');
  return path.relative(projectRoot, seedFile).replace(/\\/g, '/');
}

module.exports = {
  WATERMARKS,
  checkWatermarks,
  buildDistillationPrompt,
  buildBootstrapPrompt,
  saveSeedSnapshot,
};
