"use client";

import Link from "next/link";
import type { DocumentRecord } from "../../lib/documentApi";
import { deleteDocument, formatFileSize, processDocument } from "../../lib/documentApi";

interface Props {
  token: string;
  documents: DocumentRecord[];
  compact?: boolean;
  onChanged?: () => void;
}

function statusClass(status: string) {
  switch (status) {
    case "done":
      return "bg-green-50 text-green-700 ring-green-200";
    case "error":
      return "bg-red-50 text-red-700 ring-red-200";
    case "processing":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    default:
      return "bg-gray-50 text-gray-700 ring-gray-200";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "done":
      return "已完成";
    case "error":
      return "失败";
    case "processing":
      return "处理中";
    case "pending":
      return "待处理";
    default:
      return status;
  }
}

export function DocumentList({ token, documents, compact = false, onChanged }: Props) {
  async function handleProcess(id: string) {
    await processDocument(token, id);
    onChanged?.();
  }

  async function handleDelete(id: string) {
    await deleteDocument(token, id);
    onChanged?.();
  }

  if (documents.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
        暂无文件
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="divide-y divide-gray-100">
        {documents.map((doc) => (
          <div key={doc.id} className="px-4 py-3 transition-colors hover:bg-gray-50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/documents/${doc.id}`}
                  className="block truncate text-sm font-medium text-gray-800 hover:text-blue-700"
                >
                  {doc.filename}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{formatFileSize(doc.size)}</span>
                  <span>{doc.chunkCount} 个分块</span>
                  {!compact && <span>{new Date(doc.createdAt).toLocaleString()}</span>}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ring-1 ${statusClass(doc.status)}`}>
                {statusLabel(doc.status)}
              </span>
            </div>

            {!compact && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/documents/${doc.id}`}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-white"
                >
                  打开
                </Link>
                <button
                  type="button"
                  onClick={() => void handleProcess(doc.id)}
                  className="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                >
                  处理
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(doc.id)}
                  className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
