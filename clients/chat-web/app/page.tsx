"use client";
import { useState } from "react";
import { AIChatContainer } from "../components/ai-ui/AIChatContainer";

const USERS = {
  alice: {
    name: "Alice",
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMSIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.etoW-VgwcnfEPPOcBTxxTrRSHWfyEaSArrdCyqNGIns",
  },
  bob: {
    name: "Bob",
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMiIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.81bNean8CFDSh19FbauV-AnkHS0u1ZxHGRbaWuBOaX8",
  },
} as const;

type UserKey = keyof typeof USERS;

export default function HomePage() {
  const [userKey, setUserKey] = useState<UserKey>("alice");
  const user = USERS[userKey];

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <h1 className="text-base font-semibold text-gray-800">需求分析助手</h1>
        <div className="flex items-center gap-3">
          <a
            href="/graph-test"
            className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
          >
            图谱测试
          </a>
          <a
            href="/analysis-test"
            className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
          >
            ReAct 测试
          </a>
          <a
            href="/supervisor-test"
            className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Supervisor 测试
          </a>
          <a
            href="/production-test"
            className="rounded-lg border border-amber-200 px-3 py-1 text-xs text-amber-600 hover:bg-amber-50 transition-colors"
          >
            生产加固
          </a>
          <a
            href="/mcp-inspector"
            className="rounded-lg border border-purple-200 px-3 py-1 text-xs text-purple-600 hover:bg-purple-50 transition-colors"
          >
            MCP Inspector
          </a>
          <a
            href="/web-search-test"
            className="rounded-lg border border-teal-200 px-3 py-1 text-xs text-teal-600 hover:bg-teal-50 transition-colors"
          >
            Web Search
          </a>
          <a
            href="/skills-demo"
            className="rounded-lg border border-indigo-200 px-3 py-1 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            Skills Demo
          </a>
          <span className="text-gray-200">|</span>
          <span className="text-xs text-gray-500">当前用户：</span>
          {(Object.keys(USERS) as UserKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setUserKey(k)}
              className={[
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                userKey === k
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50",
              ].join(" ")}
            >
              {USERS[k].name}
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden p-6">
        <div className="mx-auto w-full max-w-2xl">
          <AIChatContainer token={user.token} title={`需求分析助手 · ${user.name}`} />
        </div>
      </main>
    </div>
  );
}
