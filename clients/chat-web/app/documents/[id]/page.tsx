"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../../components/AppHeader";
import { useDemoUser } from "../../../components/useDemoUser";
import { TaskNotifications } from "../../../components/documents/TaskNotifications";
import { USERS } from "../../../lib/demoUsers";
import {
  deleteDocument,
  fetchDocument,
  fetchDocumentChunks,
  formatFileSize,
  processDocument,
  type DocumentChunk,
  type DocumentRecord,
} from "../../../lib/documentApi";

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

function HighlightedChunk({ chunk, start, end }: { chunk: DocumentChunk; start: number | null; end: number | null }) {
  const localStart = start === null ? 0 : Math.max(0, Math.min(chunk.content.length, start - chunk.startOffset));
  const localEnd = end === null ? chunk.content.length : Math.max(localStart, Math.min(chunk.content.length, end - chunk.startOffset));
  if (localStart === localEnd) return <>{chunk.content}</>;
  return <>{chunk.content.slice(0, localStart)}<mark className="bg-yellow-300 text-black">{chunk.content.slice(localStart, localEnd)}</mark>{chunk.content.slice(localEnd)}</>;
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [userKey, setUserKey] = useDemoUser();
  const [record, setRecord] = useState<DocumentRecord | null>(null);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const user = USERS[userKey];
  const chunkId = searchParams.get("chunk");
  const requestedVersion = searchParams.get("version");
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const requestedStart = startParam !== null && Number.isFinite(Number(startParam)) ? Number(startParam) : null;
  const requestedEnd = endParam !== null && Number.isFinite(Number(endParam)) ? Number(endParam) : null;

  const documentId = useMemo(() => {
    const raw = params.id;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params.id]);

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [doc, docChunks] = await Promise.all([
        fetchDocument(user.token, documentId),
        fetchDocumentChunks(user.token, documentId),
      ]);
      setRecord(doc);
      setChunks(docChunks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [documentId, user.token]);

  useEffect(() => {
    void loadDocument();
  }, [loadDocument]);

  useEffect(() => {
    if (!chunkId || chunks.length === 0) return;
    window.requestAnimationFrame(() => {
      window.document.getElementById(`chunk-${chunkId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [chunkId, chunks.length]);

  async function handleProcess() {
    await processDocument(user.token, documentId);
    await loadDocument();
  }

  async function handleDelete() {
    await deleteDocument(user.token, documentId);
    router.push("/documents");
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <AppHeader active="documents" userKey={userKey} onUserKeyChange={setUserKey} />

      <main className="flex-1 p-6">
        <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-4">
            <Link href="/documents" className="text-sm font-medium text-blue-700 hover:text-blue-800">
              返回文件库
            </Link>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading && (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
                正在加载文件
              </div>
            )}

            {!loading && record && (
              <>
                <div className="rounded-lg border border-gray-200 bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h1 className="truncate text-xl font-semibold text-gray-900">{record.filename}</h1>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
                        <span>{formatFileSize(record.size)}</span>
                        <span>{record.mimeType}</span>
                        <span>{record.chunkCount} 个分块</span>
                        <span>{new Date(record.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClass(record.status)}`}>
                      {statusLabel(record.status)}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleProcess()}
                      className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50"
                    >
                      处理
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-gray-800">分块内容</h2>
                  {chunks.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                      暂无分块
                    </div>
                  ) : (
                    chunks.map((chunk) => {
                      const active = chunk.id === chunkId;
                      return (
                        <article
                          key={chunk.id}
                          id={`chunk-${chunk.id}`}
                          className={[
                            "rounded-lg border bg-white p-4 transition-colors",
                            active ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-200",
                          ].join(" ")}
                        >
                          <div className="mb-2 text-xs font-medium text-gray-400">
                            分块 {chunk.chunkIndex + 1}
                            {chunk.sectionTitle ? ` · ${chunk.sectionTitle}` : ""}
                            {chunk.pageNumber ? ` · 第 ${chunk.pageNumber} 页` : ""}
                            {` · 版本 ${chunk.documentVersion} · ${chunk.startOffset}-${chunk.endOffset}`}
                          </div>
                          {active && requestedVersion && requestedVersion !== chunk.documentVersion && (
                            <div className="mb-2 bg-amber-100 px-2 py-1 text-xs text-amber-800">引用版本与当前文档版本不一致</div>
                          )}
                          <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
                            {active ? <HighlightedChunk chunk={chunk} start={requestedStart} end={requestedEnd} /> : chunk.content}
                          </p>
                        </article>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>

          <aside className="space-y-4">
            <TaskNotifications
              token={user.token}
              onTaskEvent={(event) => {
                if (event.taskId === documentId) void loadDocument();
              }}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}
