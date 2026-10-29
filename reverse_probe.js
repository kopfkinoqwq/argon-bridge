/**
 * reverse_probe.js - Argon Reverse Tool-Calling Protocol (REVERSE_PROBE_V1)
 * Enables Gemini 4 Argon to autonomously probe local project code/AST/git diff
 * with strict security sandboxing, path traversal blocking, and secret redaction.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ============================================================================
// 常量与安全护栏配置
// ============================================================================
const MAX_PROBE_ROUNDS = 3;             // 单次提问允许 Argon 连续反向探测的最大轮次
const MAX_LINES_PER_FILE = 300;         // 单次 READ_FILE 最大允许读取行数
const MAX_TOTAL_PROBE_CHARS = 24000;    // 单轮回填给 Argon 的最大总字符数

// 严禁云端读取的敏感文件黑名单正则
const SECRET_FILE_DENYLIST = /(^|\/)(\.env(\..+)?|.*\.pem|.*\.key|id_rsa.*|\.git\/config|\.npmrc|\.pypirc)$/i;

// 敏感 Token / Key 自动脱敏正则
const SECRET_CONTENT_REDACTOR = /(AIza[0-9A-Za-z-_]{35}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xox[baprs]-[0-9a-zA-Z-]{10,})/g;

/**
 * 1. 从 Argon 返回的 Markdown 中无损解析反向探测指令
 * 同时支持 ```argon-probe 围栏提取与 DOM Fallback 哨兵字段提取
 */
function parseReverseProbeDirective(markdownText) {
  if (!markdownText || !markdownText.includes('REVERSE_PROBE_V1')) {
    return null;
  }

  // 优先匹配标准 ```argon-probe ... ``` 或 ```json ... ``` 代码块
  const fencedRegex = /```(?:argon-probe|json)?\s*([\s\S]*?"__argon_protocol__"\s*:\s*"REVERSE_PROBE_V1"[\s\S]*?)```/i;
  const match = markdownText.match(fencedRegex);

  let jsonCandidate = match ? match[1].trim() : null;

  // 若降级到了 DOM innerText（丢失了 ``` 围栏），使用大括号平衡提取包含哨兵的 JSON 对象
  if (!jsonCandidate) {
    const sentinelIdx = markdownText.indexOf('"REVERSE_PROBE_V1"');
    const startBrace = markdownText.lastIndexOf('{', sentinelIdx);
    if (startBrace !== -1) {
      let depth = 0;
      for (let i = startBrace; i < markdownText.length; i++) {
        if (markdownText[i] === '{') depth++;
        else if (markdownText[i] === '}') {
          depth--;
          if (depth === 0) {
            jsonCandidate = markdownText.slice(startBrace, i + 1);
            break;
          }
        }
      }
    }
  }

  if (!jsonCandidate) return null;

  try {
    const parsed = JSON.parse(jsonCandidate);
    if (parsed.__argon_protocol__ === 'REVERSE_PROBE_V1' && Array.isArray(parsed.probes) && parsed.probes.length > 0) {
      return parsed;
    }
  } catch (err) {
    process.stderr.write(`\x1b[33m[Argon-Probe Warn]\x1b[0m 检测到反向探测哨兵但 JSON 解析失败: ${err.message}\n`);
  }
  return null;
}

/**
 * 2. 路径安全沙箱校验（严格限制在当前项目根目录内，阻断 ../ 与符号链接逃逸）
 */
function resolveSafeProjectPath(projectRoot, relativeTarget) {
  const realRoot = fs.realpathSync(projectRoot);
  const resolved = path.resolve(realRoot, String(relativeTarget || '.'));

  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
    throw new Error(`SECURITY_PATH_TRAVERSAL_BLOCKED: 拒绝访问项目目录外的路径 (${relativeTarget})`);
  }

  const normalizedRel = path.relative(realRoot, resolved).replace(/\\/g, '/');
  if (SECRET_FILE_DENYLIST.test(normalizedRel)) {
    throw new Error(`SECURITY_SECRET_FILE_BLOCKED: 拒绝读取敏感凭据文件 (${normalizedRel})`);
  }

  // 若目标已存在，检查真实物理路径防止软链接逃逸
  if (fs.existsSync(resolved)) {
    const realTarget = fs.realpathSync(resolved);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      throw new Error(`SECURITY_SYMLINK_ESCAPE_BLOCKED: 符号链接指向项目外部 (${relativeTarget})`);
    }
  }

  return { resolved, normalizedRel };
}

/**
 * 3. 执行单个只读探测原语 (READ_FILE / SEARCH_CODE / GIT_DIFF / LIST_DIR)
 */
function executeSingleProbe(projectRoot, probe) {
  const op = String(probe.op || '').toUpperCase();

  if (op === 'READ_FILE') {
    const { resolved, normalizedRel } = resolveSafeProjectPath(projectRoot, probe.path);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return `[ERROR] 文件不存在: ${normalizedRel}`;
    }
    const rawContent = fs.readFileSync(resolved, 'utf8').replace(SECRET_CONTENT_REDACTOR, '[REDACTED_SECRET]');
    const allLines = rawContent.split(/\r?\n/);
    const startLine = Math.max(1, parseInt(probe.startLine, 10) || 1);
    const endLine = Math.min(
      allLines.length,
      parseInt(probe.endLine, 10) || (startLine + MAX_LINES_PER_FILE - 1),
      startLine + MAX_LINES_PER_FILE - 1
    );

    const numberedSlice = allLines
      .slice(startLine - 1, endLine)
      .map((line, idx) => `${String(startLine + idx).padStart(4, ' ')} | ${line}`)
      .join('\n');

    const truncNotice =
      endLine < allLines.length
        ? `\n... [文件共 ${allLines.length} 行，当前展示 ${startLine}-${endLine} 行。如需后续内容请指定 startLine: ${endLine + 1}]`
        : '';

    return `### FILE: ${normalizedRel} (Lines ${startLine}-${endLine} of ${allLines.length})\n\`\`\`\n${numberedSlice}\n\`\`\`${truncNotice}`;
  }

  if (op === 'SEARCH_CODE') {
    const pattern = String(probe.pattern || '').trim();
    if (!pattern) return '[ERROR] SEARCH_CODE 缺少 pattern 参数';
    const args = ['-n', '--no-heading', '--color=never', '-m', '30'];
    if (probe.glob) args.push('-g', String(probe.glob));
    args.push(pattern, '.');

    try {
      // 优先使用 ripgrep (rg)
      const out = execFileSync('rg', args, { cwd: projectRoot, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
      return `### SEARCH_CODE: "${pattern}"\n\`\`\`\n${out.replace(SECRET_CONTENT_REDACTOR, '[REDACTED]').trim() || '无匹配结果'}\n\`\`\``;
    } catch (rgErr) {
      if (rgErr.status === 1) return `### SEARCH_CODE: "${pattern}"\n(无匹配结果)`;
      try {
        const gitOut = execFileSync('git', ['grep', '-n', '-I', pattern], { cwd: projectRoot, encoding: 'utf8', timeout: 5000 });
        return `### SEARCH_CODE (git grep): "${pattern}"\n\`\`\`\n${gitOut.slice(0, 8000)}\n\`\`\``;
      } catch (_) {
        return `### SEARCH_CODE: "${pattern}"\n(未找到匹配或搜索超时)`;
      }
    }
  }

  if (op === 'GIT_DIFF') {
    let statusOut = '';
    let diffOut = '';
    try {
      statusOut = execFileSync('git', ['status', '--short'], { cwd: projectRoot, encoding: 'utf8', timeout: 4000 });
      diffOut = execFileSync('git', ['diff', probe.target || 'HEAD', '--unified=3'], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (err) {
      return `### GIT_DIFF\n(Git 探测不可用或非 Git 仓库: ${err.message})`;
    }
    return `### GIT_STATUS\n\`\`\`\n${statusOut.trim() || 'Clean working tree'}\n\`\`\`\n### GIT_DIFF\n\`\`\`diff\n${diffOut.slice(0, 10000)}\n\`\`\``;
  }

  if (op === 'LIST_DIR') {
    const { resolved, normalizedRel } = resolveSafeProjectPath(projectRoot, probe.path || '.');
    const maxDepth = Math.min(3, Math.max(1, parseInt(probe.depth, 10) || 2));
    const lines = [];

    function walk(dir, currentDepth, prefix = '') {
      if (currentDepth > maxDepth || lines.length >= 150) return;
      try {
        const entries = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => !['node_modules', '.git', 'dist', 'build', '.next', '.gemini'].includes(e.name));
        for (const entry of entries) {
          lines.push(`${prefix}${entry.isDirectory() ? '📁 ' : '📄 '}${entry.name}`);
          if (entry.isDirectory() && currentDepth < maxDepth) {
            walk(path.join(dir, entry.name), currentDepth + 1, prefix + '  ');
          }
        }
      } catch (_) {}
    }
    walk(resolved, 1);
    return `### LIST_DIR: ${normalizedRel || '.'} (depth=${maxDepth})\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
  }

  return `[ERROR] 不支持的探测原语: ${op}`;
}

/**
 * 4. 组装反向探测回填结果包 (Follow-up Observation Envelope)
 */
function buildProbeResponsePrompt(projectRoot, directive, currentRound) {
  const results = [];
  for (const probe of directive.probes.slice(0, 6)) {
    try {
      results.push(executeSingleProbe(projectRoot, probe));
    } catch (err) {
      results.push(`### PROBE_ERROR (${probe.op}: ${probe.path || ''})\n> ${err.message}`);
    }
  }

  let combinedPayload = results.join('\n\n');
  if (combinedPayload.length > MAX_TOTAL_PROBE_CHARS) {
    combinedPayload =
      combinedPayload.slice(0, MAX_TOTAL_PROBE_CHARS) +
      `\n\n...[系统截断：单轮探测返回超过 ${MAX_TOTAL_PROBE_CHARS} 字符上限，请缩小行号范围]`;
  }

  const circuitBreakerNotice =
    currentRound >= MAX_PROBE_ROUNDS
      ? `\n\n⚠️ **【系统级熔断提示：当前已达到单次任务最大反向探测轮次 (${currentRound}/${MAX_PROBE_ROUNDS})。请立即基于以上探测结果给出最终架构设计与裁决方案，切勿再次输出 \`argon-probe\` 指令！】**`
      : `\n\n（当前探测轮次：${currentRound}/${MAX_PROBE_ROUNDS}。若信息已充足请直接输出最终架构方案；若仍需追踪深层调用链，可继续发起探测。）`;

  return [
    `【系统自动回填：ARGON_REVERSE_PROBE_RESULT (Round ${currentRound}/${MAX_PROBE_ROUNDS})】`,
    `以下是本地守护进程针对你的探测请求（原因：${directive.reason || '上下文补齐'}）采集到的真实本地仓库快照：`,
    '',
    combinedPayload,
    circuitBreakerNotice,
  ].join('\n');
}

module.exports = {
  MAX_PROBE_ROUNDS,
  parseReverseProbeDirective,
  resolveSafeProjectPath,
  executeSingleProbe,
  buildProbeResponsePrompt,
};
