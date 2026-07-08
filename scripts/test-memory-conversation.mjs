// Live integration test for the PostgreSQL-backed conversation memory
// mechanism (services/chat/src/llm/memory/runnable-memory.service.ts).
//
// Requires the backend to be running (bun run dev in services/chat) with a
// reachable Postgres and a working OpenAI connection.
//
// Test 1 — multi-turn coherence: create a conversation -> send 4 chat rounds
// on the same sessionId (== conversationId) -> verify the model recalls
// earlier turns -> verify getHistory() returns exactly 8 persisted messages
// (4 human + 4 ai) -> delete the conversation.
//
// Test 2 — cross-user access denied: create a conversation as user-001, then
// query its history using user-002's token -> expect HTTP 403 (the
// conversation exists but isn't owned by user-002) -> delete with the
// owner's token.
//
// Usage: node scripts/test-memory-conversation.mjs
//        BACKEND_URL=https://your-backend node scripts/test-memory-conversation.mjs

import assert from "node:assert/strict";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8081";

// Pre-generated dev JWTs for user-001 / user-002 (same ones used across the
// chat-web test pages) — signed with the default JWT_SECRET in
// services/chat/.env.
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMSIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.etoW-VgwcnfEPPOcBTxxTrRSHWfyEaSArrdCyqNGIns";
const OTHER_USER_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMiIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.81bNean8CFDSh19FbauV-AnkHS0u1ZxHGRbaWuBOaX8";

const authHeaders = (token) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });
const headers = authHeaders(TOKEN);

const TEST_ROUNDS = [
  "我叫小明，我正在开发一个电商系统的购物车模块",
  "这个模块需要支持满减优惠券功能",
  "我提到的系统类型是什么？",
  "我叫什么名字？",
];

async function createConversation(title, token = TOKEN) {
  const res = await fetch(`${BACKEND}/api/conversations`, {
    method: "POST",
    headers: authHeaders(token),
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

async function memoryHistory(sessionId, token = TOKEN) {
  const res = await fetch(`${BACKEND}/api/memory/history/${sessionId}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`memory history failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.messages;
}

async function deleteConversation(id, token = TOKEN) {
  const res = await fetch(`${BACKEND}/api/conversations/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`delete conversation failed: HTTP ${res.status}`);
}

let failed = false;

// ─── Test 1: multi-turn coherence ─────────────────────────────────────────────
async function testMultiTurnMemory() {
  let conversationId;
  try {
    const conv = await createConversation(`memory-test · ${new Date().toISOString()}`);
    conversationId = conv.id;
    console.log(`[multi-turn] created conversation ${conversationId}`);

    const replies = [];
    for (const [i, input] of TEST_ROUNDS.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const reply = await memoryChat(conversationId, input);
      replies.push(reply);
      console.log(`[multi-turn] round ${i + 1} reply: ${reply.slice(0, 80)}${reply.length > 80 ? "…" : ""}`);
    }

    assert.ok(replies[2]?.includes("电商"), 'round 3 reply should recall the "电商" domain mentioned in round 1');
    assert.ok(replies[3]?.includes("小明"), 'round 4 reply should recall the name "小明" mentioned in round 1');
    console.log("[multi-turn] multi-turn coherence check passed");

    const history = await memoryHistory(conversationId);
    assert.equal(history.length, 8, `expected 8 persisted messages (4 human + 4 ai), got ${history.length}`);
    const humanCount = history.filter((m) => m.type === "human").length;
    const aiCount = history.filter((m) => m.type === "ai").length;
    assert.equal(humanCount, 4, `expected 4 human messages, got ${humanCount}`);
    assert.equal(aiCount, 4, `expected 4 ai messages, got ${aiCount}`);
    console.log("[multi-turn] getHistory() message-count check passed (8 total: 4 human + 4 ai)");

    await deleteConversation(conversationId);
    console.log(`[multi-turn] deleted conversation ${conversationId}`);
    console.log("✅ Test 1 (multi-turn memory) passed.\n");
  } catch (err) {
    failed = true;
    console.error("❌ Test 1 (multi-turn memory) failed:", err.message);
    if (conversationId) {
      try {
        await deleteConversation(conversationId);
        console.error(`[multi-turn] cleaned up conversation ${conversationId} after failure`);
      } catch { /* best-effort cleanup */ }
    }
  }
}

// ─── Test 2: cross-user access denied ─────────────────────────────────────────
// user-001 creates a conversation; user-002 (a different, unrelated account)
// tries to read its history — must be rejected with 403, not silently
// succeed or leak data.
async function testCrossUserAccessDenied() {
  let conversationId;
  try {
    const conv = await createConversation(`cross-user-test · ${new Date().toISOString()}`, TOKEN);
    conversationId = conv.id;
    console.log(`[cross-user] user-001 created conversation ${conversationId}`);

    const res = await fetch(`${BACKEND}/api/memory/history/${conversationId}`, {
      headers: authHeaders(OTHER_USER_TOKEN),
    });
    console.log(`[cross-user] user-002 queried user-001's session -> HTTP ${res.status}`);
    assert.equal(res.status, 403, `expected HTTP 403 when querying another user's session, got ${res.status}`);
    console.log("[cross-user] cross-user access correctly denied (403)");

    await deleteConversation(conversationId, TOKEN);
    console.log(`[cross-user] deleted conversation ${conversationId}`);
    console.log("✅ Test 2 (cross-user access denied) passed.\n");
  } catch (err) {
    failed = true;
    console.error("❌ Test 2 (cross-user access denied) failed:", err.message);
    if (conversationId) {
      try {
        await deleteConversation(conversationId, TOKEN);
        console.error(`[cross-user] cleaned up conversation ${conversationId} after failure`);
      } catch { /* best-effort cleanup */ }
    }
  }
}

console.log(`[memory-test] backend = ${BACKEND}\n`);
await testMultiTurnMemory();
await testCrossUserAccessDenied();

if (failed) {
  console.error("❌ Memory conversation tests failed.");
  process.exit(1);
}
console.log("✅ All memory conversation tests passed.");
