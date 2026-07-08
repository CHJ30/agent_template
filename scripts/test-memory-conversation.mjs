// Live integration test for the PostgreSQL-backed conversation memory
// mechanism (services/chat/src/llm/memory/runnable-memory.service.ts).
//
// Requires the backend to be running (bun run dev in services/chat) with a
// reachable Postgres and a working OpenAI connection.
//
// Flow: create a conversation -> send 4 chat rounds on the same sessionId
// (== conversationId) -> verify the model recalls earlier turns -> verify
// getHistory() returns exactly 8 persisted messages (4 human + 4 ai) ->
// delete the conversation.
//
// Usage: node scripts/test-memory-conversation.mjs
//        BACKEND_URL=https://your-backend node scripts/test-memory-conversation.mjs

import assert from "node:assert/strict";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8081";

// Pre-generated dev JWT for user-001 (same one used across the chat-web test
// pages) — signed with the default JWT_SECRET in services/chat/.env.
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMSIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.etoW-VgwcnfEPPOcBTxxTrRSHWfyEaSArrdCyqNGIns";

const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

const TEST_ROUNDS = [
  "我叫小明，我正在开发一个电商系统的购物车模块",
  "这个模块需要支持满减优惠券功能",
  "我提到的系统类型是什么？",
  "我叫什么名字？",
];

async function createConversation(title) {
  const res = await fetch(`${BACKEND}/api/conversations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`create conversation failed: HTTP ${res.status}`);
  return res.json();
}

async function memoryChat(sessionId, input) {
  const res = await fetch(`${BACKEND}/api/memory/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId, input }),
  });
  if (!res.ok) throw new Error(`memory chat failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.content;
}

async function memoryHistory(sessionId) {
  const res = await fetch(`${BACKEND}/api/memory/history/${sessionId}`, { headers });
  if (!res.ok) throw new Error(`memory history failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.messages;
}

async function deleteConversation(id) {
  const res = await fetch(`${BACKEND}/api/conversations/${id}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`delete conversation failed: HTTP ${res.status}`);
}

let conversationId;
try {
  console.log(`[memory-test] backend = ${BACKEND}`);

  const conv = await createConversation(`memory-test · ${new Date().toISOString()}`);
  conversationId = conv.id;
  console.log(`[memory-test] created conversation ${conversationId}`);

  const replies = [];
  for (const [i, input] of TEST_ROUNDS.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const reply = await memoryChat(conversationId, input);
    replies.push(reply);
    console.log(`[memory-test] round ${i + 1} reply: ${reply.slice(0, 80)}${reply.length > 80 ? "…" : ""}`);
  }

  assert.ok(replies[2]?.includes("电商"), 'round 3 reply should recall the "电商" domain mentioned in round 1');
  assert.ok(replies[3]?.includes("小明"), 'round 4 reply should recall the name "小明" mentioned in round 1');
  console.log("[memory-test] multi-turn coherence check passed");

  const history = await memoryHistory(conversationId);
  assert.equal(history.length, 8, `expected 8 persisted messages (4 human + 4 ai), got ${history.length}`);
  const humanCount = history.filter((m) => m.type === "human").length;
  const aiCount = history.filter((m) => m.type === "ai").length;
  assert.equal(humanCount, 4, `expected 4 human messages, got ${humanCount}`);
  assert.equal(aiCount, 4, `expected 4 ai messages, got ${aiCount}`);
  console.log("[memory-test] getHistory() message-count check passed (8 total: 4 human + 4 ai)");

  await deleteConversation(conversationId);
  console.log(`[memory-test] deleted conversation ${conversationId}`);

  console.log("\n✅ Memory conversation test passed.");
} catch (err) {
  console.error("\n❌ Memory conversation test failed:", err.message);
  if (conversationId) {
    try {
      await deleteConversation(conversationId);
      console.error(`[memory-test] cleaned up conversation ${conversationId} after failure`);
    } catch { /* best-effort cleanup */ }
  }
  process.exit(1);
}
