import { API_BASE } from "./demoUsers";

export interface DocumentRecord {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  size: number;
  filePath?: string | null;
  storageType: string;
  status: string;
  chunkCount: number;
  createdAt: string;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  version: string;
  contentHash?: string | null;
}

export interface DocumentChunk {
  id: string;
  content: string;
  chunkIndex: number;
  documentVersion: string;
  sectionTitle?: string | null;
  pageNumber?: number | null;
  startOffset: number;
  endOffset: number;
  contentHash: string;
}

export interface DocumentSearchResult {
  id: string;
  content: string;
  documentId: string;
  filename: string;
  mimeType: string;
  chunkIndex: number;
  score: number;
  sourceTitle: string;
  sourceUrl?: string | null;
  sectionTitle?: string | null;
  pageNumber?: number | null;
  startOffset: number;
  endOffset: number;
  documentVersion: string;
  contentHash: string;
}

export interface CitationVerification {
  valid: boolean;
  reasons: string[];
  exactText: string;
  documentVersion: string;
}

export interface TaskEvent {
  id?: string;
  userId?: string;
  taskType: string;
  taskId: string;
  status: "pending" | "processing" | "done" | "error";
  message?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  readAt?: string | null;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(message || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchDocuments(token: string): Promise<DocumentRecord[]> {
  const res = await fetch(`${API_BASE}/api/documents`, {
    headers: authHeaders(token),
    cache: "no-store",
  });
  return parseJson<DocumentRecord[]>(res);
}

export async function fetchDocument(token: string, id: string): Promise<DocumentRecord> {
  const res = await fetch(`${API_BASE}/api/documents/${id}`, {
    headers: authHeaders(token),
    cache: "no-store",
  });
  return parseJson<DocumentRecord>(res);
}

export async function fetchDocumentChunks(token: string, id: string): Promise<DocumentChunk[]> {
  const res = await fetch(`${API_BASE}/api/documents/${id}/chunks`, {
    headers: authHeaders(token),
    cache: "no-store",
  });
  return parseJson<DocumentChunk[]>(res);
}

export async function verifyCitation(
  token: string,
  citation: {
    documentId: string;
    documentVersion: string;
    chunkId: string;
    startOffset: number;
    endOffset: number;
    quote: string;
    contentHash: string;
  },
): Promise<CitationVerification> {
  const res = await fetch(`${API_BASE}/api/documents/citations/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(citation),
  });
  return parseJson<CitationVerification>(res);
}

export async function uploadDocument(token: string, file: File): Promise<DocumentRecord> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_BASE}/api/documents/upload`, {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
  return parseJson<DocumentRecord>(res);
}

export async function processDocument(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/documents/${id}/process`, {
    method: "POST",
    headers: authHeaders(token),
  });
  await parseJson<unknown>(res);
}

export async function uploadAndProcessDocument(token: string, file: File): Promise<DocumentRecord> {
  const doc = await uploadDocument(token, file);
  await processDocument(token, doc.id);
  return doc;
}

export async function deleteDocument(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/documents/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  await parseJson<unknown>(res);
}

export async function searchDocuments(
  token: string,
  query: string,
  topK = 8,
): Promise<DocumentSearchResult[]> {
  const res = await fetch(`${API_BASE}/api/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ query, topK }),
  });
  return parseJson<DocumentSearchResult[]>(res);
}

export async function fetchTaskHistory(
  token: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: TaskEvent[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const res = await fetch(`${API_BASE}/api/tasks/history?${params}`, {
    headers: authHeaders(token),
    cache: "no-store",
  });
  return parseJson(res);
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function formatScore(score: number): string {
  return `${Math.max(0, Math.min(100, score * 100)).toFixed(1)}%`;
}
