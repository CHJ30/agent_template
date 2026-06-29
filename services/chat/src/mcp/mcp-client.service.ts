import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPClientConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Request timeout in ms (default: 30 000) */
  timeout?: number;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

@Injectable()
export class MCPClientService implements OnModuleDestroy {
  private readonly logger = new Logger(MCPClientService.name);
  private client: Client | null = null;
  private _tools: MCPTool[] = [];
  private _connected = false;

  /**
   * Spawn a stdio MCP server and complete the MCP handshake.
   * Also caches the tools list so callers don't need an extra round-trip.
   */
  async connect(config: MCPClientConfig): Promise<void> {
    if (this._connected) await this.close();

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
    });

    this.client = new Client(
      { name: 'law-agent-client', version: '1.0.0' },
      { capabilities: {} },
    );

    await this.client.connect(transport);
    this._connected = true;
    this.logger.log(
      `Connected: ${config.command} ${(config.args ?? []).join(' ')}`,
    );

    // Pre-warm tool cache
    const result = await this.client.listTools();
    this._tools = result.tools as MCPTool[];
    this.logger.log(`Cached ${this._tools.length} tool(s)`);
  }

  isConnected(): boolean {
    return this._connected;
  }

  /** Returns a shallow copy of the cached tools list. */
  getTools(): MCPTool[] {
    return [...this._tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || !this._connected) {
      throw new Error('MCPClientService: not connected — call connect() first');
    }
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (e) {
        this.logger.warn(`close() error ignored: ${e}`);
      }
      this.client = null;
    }
    this._connected = false;
    this._tools = [];
    this.logger.log('MCP client disconnected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
