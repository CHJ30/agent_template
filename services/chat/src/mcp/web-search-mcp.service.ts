import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface WebSearchResponse {
  query: string;
  mode: 'tavily' | 'mock';
  results: WebSearchResult[];
}

@Injectable()
export class WebSearchMcpService implements OnModuleDestroy {
  private readonly logger = new Logger(WebSearchMcpService.name);
  private process: ChildProcess | null = null;
  private initialized = false;
  private msgId = 1;
  private buf = '';
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  private get serverPath(): string {
    if (process.env.WEB_SEARCH_MCP_PATH) return process.env.WEB_SEARCH_MCP_PATH;
    // Canonical location: mcp-servers/web-search/ at monorepo root
    const canonical = join(__dirname, '../../../../../mcp-servers/web-search/dist/index.js');
    if (existsSync(canonical)) return canonical;
    throw new Error(
      `web-search MCP server not found at ${canonical}. Run: cd mcp-servers/web-search && bun run build`,
    );
  }

  private startProcess(): ChildProcess {
    this.logger.log(`Starting web-search MCP server: node ${this.serverPath}`);
    const proc = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (chunk: string) => {
      this.buf += chunk;
      const lines = this.buf.split('\n');
      this.buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const msg = JSON.parse(t) as { id?: number };
          if (msg.id != null) {
            const entry = this.pending.get(msg.id);
            if (entry) {
              clearTimeout(entry.timer);
              this.pending.delete(msg.id);
              entry.resolve(msg);
            }
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    proc.stderr!.on('data', (d: Buffer) =>
      this.logger.warn(`[web-search-mcp] ${d.toString().trimEnd()}`),
    );

    proc.on('exit', (code) => {
      this.logger.warn(`web-search MCP server exited (code ${code})`);
      this.initialized = false;
      this.process = null;
    });

    return proc;
  }

  private ensureProcess(): ChildProcess {
    if (this.process && !this.process.killed) return this.process;
    this.initialized = false;
    this.process = this.startProcess();
    return this.process;
  }

  private send(method: string, params: unknown): Promise<unknown> {
    const proc = this.ensureProcess();
    const id = this.msgId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    proc.stdin!.write(JSON.stringify(msg) + '\n');

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private notify(method: string, params: unknown = {}): void {
    const proc = this.ensureProcess();
    proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  private async ensureInit(): Promise<void> {
    this.ensureProcess();
    if (this.initialized) return;
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'law-agent-web-search', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
    this.initialized = true;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<WebSearchResponse> {
    await this.ensureInit();
    const resp = await this.send('tools/call', { name, arguments: args }) as {
      result?: { content?: Array<{ type: string; text?: string }> };
    };
    const text = resp.result?.content?.find((c) => c.type === 'text')?.text ?? '{}';
    return JSON.parse(text) as WebSearchResponse;
  }

  onModuleDestroy(): void {
    this.process?.kill();
    this.process = null;
    this.initialized = false;
  }
}
