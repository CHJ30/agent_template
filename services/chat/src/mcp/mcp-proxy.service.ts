import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface McpMessage {
  direction: 'send' | 'recv';
  msg: unknown;
  ts: number;
}

@Injectable()
export class McpProxyService implements OnModuleDestroy {
  private readonly logger = new Logger(McpProxyService.name);
  private process: ChildProcess | null = null;
  private initialized = false;
  private msgId = 1;
  private buf = '';
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  readonly messages: McpMessage[] = [];

  private get serverPath(): string {
    if (process.env.MCP_SERVER_PATH) return process.env.MCP_SERVER_PATH;
    // Canonical location after migration to mcp-servers/
    const canonical = join(__dirname, '../../../../../mcp-servers/requirement-tools/dist/index.js');
    if (existsSync(canonical)) return canonical;
    // Legacy fallback (services/mcp-server/)
    return join(process.cwd(), '../mcp-server/dist/index.js');
  }

  private startProcess(): ChildProcess {
    this.logger.log(`Starting MCP server: node ${this.serverPath}`);
    const proc = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
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
          this.messages.push({ direction: 'recv', msg, ts: Date.now() });
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
      this.logger.warn(`[mcp-server] ${d.toString().trimEnd()}`),
    );

    proc.on('exit', (code) => {
      this.logger.warn(`MCP server exited (code ${code})`);
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
    this.messages.push({ direction: 'send', msg, ts: Date.now() });
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
    const msg = { jsonrpc: '2.0', method, params };
    this.messages.push({ direction: 'send', msg, ts: Date.now() });
    proc.stdin!.write(JSON.stringify(msg) + '\n');
  }

  async connect(): Promise<unknown> {
    this.ensureProcess();
    if (this.initialized) return { status: 'already_connected' };
    const resp = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'law-agent-inspector', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
    this.initialized = true;
    return resp;
  }

  async listTools(): Promise<unknown> {
    await this.connect();
    return this.send('tools/list', {});
  }

  async listResources(): Promise<unknown> {
    await this.connect();
    return this.send('resources/list', {});
  }

  async listPrompts(): Promise<unknown> {
    await this.connect();
    return this.send('prompts/list', {});
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    return this.send('tools/call', { name, arguments: args });
  }

  clearMessages(): void {
    this.messages.length = 0;
  }

  disconnect(): void {
    this.process?.kill();
    this.process = null;
    this.initialized = false;
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
