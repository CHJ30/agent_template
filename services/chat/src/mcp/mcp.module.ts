import { Module } from '@nestjs/common';
import { McpProxyService } from './mcp-proxy.service.js';
import { McpProxyController } from './mcp-proxy.controller.js';
import { MCPClientService } from './mcp-client.service.js';
import { WebSearchMcpService } from './web-search-mcp.service.js';
import { WebSearchMcpController } from './web-search-mcp.controller.js';

@Module({
  controllers: [McpProxyController, WebSearchMcpController],
  providers: [McpProxyService, MCPClientService, WebSearchMcpService],
  exports: [MCPClientService, WebSearchMcpService],
})
export class McpModule {}
