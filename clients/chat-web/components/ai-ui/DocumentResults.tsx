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
        {component.items.map((item) => {
          const params = new URLSearchParams({
            chunk: item.chunkId,
            version: item.documentVersion,
            start: String(item.startOffset),
            end: String(item.endOffset),
          });
          return (
          <div
            key={`${item.documentId}-${item.chunkId}`}
            className="px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-800">{item.sourceTitle}</div>
                <div className="mt-0.5 text-[10px] text-gray-500">
                  版本 {item.documentVersion}
                  {item.sectionTitle ? ` · ${item.sectionTitle}` : ""}
                  {item.pageNumber ? ` · 第 ${item.pageNumber} 页` : ""}
                </div>
                <Link
                  href={`/documents/${item.documentId}?${params.toString()}`}
                  className="mt-1 line-clamp-3 border-l-2 border-blue-500 pl-2 text-xs leading-5 text-gray-600 underline decoration-dotted underline-offset-2 hover:bg-blue-50 hover:text-blue-800"
                  title="点击跳转到原文并高亮引用范围"
                >
                  {item.snippet}
                </Link>
              </div>
              <div className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                {formatScore(item.score)}
              </div>
            </div>
            {typeof item.chunkIndex === "number" && (
              <div className="mt-2 text-[11px] text-gray-500">
                分块 {item.chunkIndex + 1} · {item.startOffset}-{item.endOffset} · {item.chunkId.slice(0, 8)}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
