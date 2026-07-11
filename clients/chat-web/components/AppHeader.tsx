"use client";

import Link from "next/link";
import { USERS, USER_KEYS, type UserKey } from "../lib/demoUsers";

interface Props {
  userKey: UserKey;
  onUserKeyChange: (key: UserKey) => void;
  active?: "chat" | "documents" | "pipeline";
  documentCount?: number;
}

export function AppHeader({ userKey, onUserKeyChange, active = "chat", documentCount }: Props) {
  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-base font-semibold text-gray-800">
          需求分析助手
        </Link>
        <nav className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 text-xs">
          <Link
            href="/"
            className={[
              "rounded-md px-3 py-1.5 font-medium transition-colors",
              active === "chat" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900",
            ].join(" ")}
          >
            对话
          </Link>
          <Link
            href="/documents"
            className={[
              "rounded-md px-3 py-1.5 font-medium transition-colors",
              active === "documents" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900",
            ].join(" ")}
          >
            文件{typeof documentCount === "number" ? ` ${documentCount}` : ""}
          </Link>
          <Link
            href="/pipeline-demo"
            className={[
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors",
              active === "pipeline" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900",
            ].join(" ")}
          >
            联合流水线
            <span className="rounded bg-rose-100 px-1 py-0.5 text-[8px] font-bold leading-none text-rose-700">TEST</span>
          </Link>
          <Link
            href="/tests"
            className="rounded-md px-3 py-1.5 font-medium text-gray-600 transition-colors hover:text-gray-900"
          >
            测试
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">当前用户：</span>
        {USER_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onUserKeyChange(key)}
            className={[
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              userKey === key
                ? "bg-blue-600 text-white"
                : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50",
            ].join(" ")}
          >
            {USERS[key].name}
          </button>
        ))}
      </div>
    </header>
  );
}
