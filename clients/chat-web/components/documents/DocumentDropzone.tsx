"use client";

import { useRef, useState } from "react";
import type { DocumentRecord } from "../../lib/documentApi";
import { uploadAndProcessDocument } from "../../lib/documentApi";

const ACCEPT = ".txt,.md,.markdown,.pdf,.doc,.docx";

interface Props {
  token: string;
  onUploaded?: (doc: DocumentRecord) => void;
}

export function DocumentDropzone({ token, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length === 0 || uploading) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of selected) {
        const doc = await uploadAndProcessDocument(token, file);
        onUploaded?.(doc);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFiles(event.dataTransfer.files);
      }}
      className={[
        "rounded-lg border border-dashed bg-white p-4 transition-colors",
        dragging ? "border-blue-500 bg-blue-50" : "border-gray-300",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">上传文件</h2>
          <p className="mt-1 text-xs text-gray-500">TXT、Markdown、PDF、DOCX · 最大 10 MB</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? "上传中" : "选择文件"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void handleFiles(event.target.files);
        }}
      />

      <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
        将文件拖到这里，加入可检索文件库。
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </section>
  );
}
