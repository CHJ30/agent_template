"use client";

import Link from "next/link";
import type { DocumentResultsComponent } from "./types";
import { formatScore } from "../../lib/documentApi";

interface Props {
  component: DocumentResultsComponent;
}

export function DocumentResults({ component }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800">{component.title ?? "相关文件片段"}</h3>
      </div>

      <div className="max-h-[420px] divide-y divide-gray-100 overflow-y-auto">
        {component.items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">未找到匹配文件</div>
        )}
        {component.items.map((item) => (
          <Link
            key={`${item.documentId}-${item.chunkId}`}
            href={`/documents/${item.documentId}?chunk=${encodeURIComponent(item.chunkId)}`}
            className="block px-4 py-3 transition-colors hover:bg-blue-50/60"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-800">{item.filename}</div>
                <div className="mt-1 line-clamp-3 text-xs leading-5 text-gray-600">{item.snippet}</div>
              </div>
              <div className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                {formatScore(item.score)}
              </div>
            </div>
            {typeof item.chunkIndex === "number" && (
              <div className="mt-2 text-[11px] text-gray-400">分块 {item.chunkIndex + 1}</div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
