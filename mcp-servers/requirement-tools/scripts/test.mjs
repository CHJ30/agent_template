/**
 * MCP Server smoke-test — sends JSON-RPC 2.0 messages over stdio and prints results.
 *
 * Usage:
 *   bun run build   # compile first
 *   node scripts/test.mjs
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = spawn("node", [join(ROOT, "dist", "index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

// ─── Message bus ──────────────────────────────────────────────────────────────

let _id = 1;
const _pending = new Map(); // id → { resolve, timer }
let _buf = "";

server.stdout.setEncoding("utf8");
server.stdout.on("data", (chunk) => {
  _buf += chunk;
  const lines = _buf.split("\n");
  _buf = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const msg = JSON.parse(t);
      const entry = _pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        _pending.delete(msg.id);
        entry.resolve(msg);
      }
    } catch { /* ignore non-JSON lines */ }
  }
});

server.on("error", (err) => { console.error("Server error:", err); process.exit(1); });

function send(method, params) {
  const id = _id++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(id);
      reject(new Error(`Timeout: ${method} (id=${id})`));
    }, 30_000);
    _pending.set(id, { resolve, timer });
  });
}

const notify = (method, params = {}) =>
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

const callTool = (name, args) => send("tools/call", { name, arguments: args });

// ─── Output ───────────────────────────────────────────────────────────────────

const DIV = "─".repeat(62);

function printResult(title, response) {
  console.log(`\n${DIV}\n▶  ${title}\n${DIV}`);
  if (response.error) {
    console.error("ERROR:", JSON.stringify(response.error, null, 2));
    return;
  }
  const text = response.result?.content?.[0]?.text;
  if (text) {
    try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
    catch { console.log(text); }
  }
}

// ─── Initialize ───────────────────────────────────────────────────────────────

const init = await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1.0.0" },
});
const si = init.result?.serverInfo;
console.log(`✓ 已连接  ${si?.name} v${si?.version}`);
notify("notifications/initialized");

// ─── 1. analyze_completeness — 覆盖全部 6 维度 ────────────────────────────────
printResult(
  "analyze_completeness — 完整需求（应得 100 分）",
  await callTool("analyze_completeness", {
    requirementText:
      "作为运营管理员，需要批量导出用户数据，支持 Excel 格式，优先级 P1，" +
      "需要经理审批后才能下载，P99 响应时间小于 3 秒，当数据量超过 10 万条时分批处理",
  }),
);

// ─── 2. analyze_completeness — 仅含功能描述 ──────────────────────────────────
printResult(
  "analyze_completeness — 仅功能描述（应缺少 5 个维度）",
  await callTool("analyze_completeness", {
    requirementText: "开发一个用户登录页面",
  }),
);

// ─── 3. estimate_complexity — 高复杂度 ───────────────────────────────────────
printResult(
  "estimate_complexity — AI+实时+集成+权限，多端（应为 XL）",
  await callTool("estimate_complexity", {
    requirementText:
      "开发实时消息推送系统，集成第三方支付，需要 RBAC 权限管理，包含 AI 智能推荐算法",
    techStack: "前端 + 后端 + 移动端",
  }),
);

// ─── 4. estimate_complexity — 低复杂度 ───────────────────────────────────────
printResult(
  "estimate_complexity — 无复杂因子（应为 S）",
  await callTool("estimate_complexity", {
    requirementText: "在用户详情页新增一个修改备注的输入框",
  }),
);

// ─── 5. check_conflicts — 有冲突 ─────────────────────────────────────────────
printResult(
  "check_conflicts — REQ-001 应高度冲突",
  await callTool("check_conflicts", {
    newRequirement:
      "开发用户权限管理模块，支持角色分配和权限审批，管理员可以设置用户角色",
    existingRequirements: [
      {
        id: "REQ-001",
        title: "用户管理",
        description: "支持用户注册登录，角色分配和权限控制，管理员可以管理用户账号",
      },
      {
        id: "REQ-002",
        title: "订单系统",
        description: "用户下单、支付、物流跟踪，支持退款申请",
      },
    ],
  }),
);

// ─── 6. check_conflicts — 无冲突 ─────────────────────────────────────────────
printResult(
  "check_conflicts — 无冲突",
  await callTool("check_conflicts", {
    newRequirement: "开发数据大屏展示模块，展示销售额、DAU 等核心指标",
    existingRequirements: [
      {
        id: "REQ-003",
        title: "订单系统",
        description: "用户下单、支付、物流跟踪，支持退款申请",
      },
    ],
  }),
);

// ─── 7. generate_user_stories ─────────────────────────────────────────────────
printResult(
  "generate_user_stories — 3 条故事（角色=运营管理员）",
  await callTool("generate_user_stories", {
    requirementText:
      "作为运营管理员，能够批量导出用户数据，支持按时间范围和地区筛选，" +
      "需要经理审批才能下载，并且记录完整的审计日志，优先级 P1",
    maxStories: 3,
  }),
);

// ─── Done ─────────────────────────────────────────────────────────────────────

server.stdin.end();
await new Promise((resolve) => server.on("close", resolve));
console.log(`\n${DIV}\n✓  全部测试完成\n${DIV}\n`);
