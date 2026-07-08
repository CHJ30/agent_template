"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../components/AppHeader";
import { useDemoUser } from "../../components/useDemoUser";
import { DocumentDropzone } from "../../components/documents/DocumentDropzone";
import { DocumentList } from "../../components/documents/DocumentList";
import { DocumentSearchPanel } from "../../components/documents/DocumentSearchPanel";
import { TaskNotifications } from "../../components/documents/TaskNotifications";
import { USERS } from "../../lib/demoUsers";
import { fetchDocuments, type DocumentRecord } from "../../lib/documentApi";

type StatusFilter = "all" | "pending" | "processing" | "done" | "error";

const FILTERS: StatusFilter[] = ["all", "pending", "processing", "done", "error"];

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "全部",
  pending: "待处理",
  processing: "处理中",
  done: "已完成",
  error: "失败",
};

export default function DocumentsPage() {
  const [userKey, setUserKey] = useDemoUser();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const user = USERS[userKey];

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocuments(await fetchDocuments(user.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const visibleDocuments = useMemo(
    () => documents.filter((doc) => filter === "all" || doc.status === filter),
    [documents, filter],
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <AppHeader
        active="documents"
        userKey={userKey}
        onUserKeyChange={setUserKey}
        documentCount={documents.length}
      />

      <main className="flex-1 p-6">
        <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">文件库</h1>
                <p className="mt-1 text-sm text-gray-500">共 {documents.length} 个文件</p>
              </div>
              <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1">
                {FILTERS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    className={[
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      filter === item ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50",
                    ].join(" ")}
                  >
                    {FILTER_LABELS[item]}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
                正在加载文件
              </div>
            ) : (
              <DocumentList
                token={user.token}
                documents={visibleDocuments}
                onChanged={() => void loadDocuments()}
              />
            )}
          </section>

          <aside className="space-y-4">
            <DocumentDropzone
              token={user.token}
              onUploaded={(doc) => {
                setDocuments((prev) => [doc, ...prev.filter((item) => item.id !== doc.id)]);
                void loadDocuments();
              }}
            />
            <DocumentSearchPanel token={user.token} />
            <TaskNotifications token={user.token} onTaskEvent={() => void loadDocuments()} />
          </aside>
        </div>
      </main>
    </div>
  );
}
