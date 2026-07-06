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
        <h1 className="text-base font-semibold text-gray-800">Requirement Analysis Assistant</h1>
        <div className="flex items-center gap-3">
          <a
            href="/tests"
            className="rounded-lg border border-blue-200 px-3 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50"
          >
            Tests
          </a>
          <span className="text-gray-200">|</span>
          <span className="text-xs text-gray-500">Current user:</span>
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
          <AIChatContainer token={user.token} title={`Requirement Analysis Assistant · ${user.name}`} />
        </div>
      </main>
    </div>
  );
}
