"use client";

import { useState } from "react";
import { DocumentResults } from "../ai-ui/DocumentResults";
import type { DocumentResultsComponent } from "../ai-ui/types";
import { searchDocuments } from "../../lib/documentApi";

interface Props {
  token: string;
}

function toSnippet(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

export function DocumentSearchPanel({ token }: Props) {
  const [query, setQuery] = useState("");
  const [component, setComponent] = useState<DocumentResultsComponent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = query.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const results = await searchDocuments(token, text, 8);
      setComponent({
        type: "document_results",
        id: `document-results-${Date.now()}`,
        title: "相关文件片段",
        items: results.map((item) => ({
          chunkId: item.id,
          documentId: item.documentId,
          filename: item.filename,
          mimeType: item.mimeType,
          chunkIndex: item.chunkIndex,
          snippet: toSnippet(item.content),
          score: item.score,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-800">语义搜索</h2>
        <p className="mt-1 text-xs text-gray-500">按语义检索已处理文件。</p>
      </div>

      <form onSubmit={(event) => void runSearch(event)} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索文件内容"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "搜索中" : "搜索"}
        </button>
      </form>

      <p className="text-xs leading-5 text-gray-500">
        结果按文档分块匹配；同一文件可能出现多条，表示不同分块命中。
      </p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {component && <DocumentResults component={component} />}
    </section>
  );
}
