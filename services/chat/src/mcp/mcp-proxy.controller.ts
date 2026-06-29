import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
} from '@nestjs/common';
import { McpProxyService } from './mcp-proxy.service.js';

@Controller('mcp')
export class McpProxyController {
  constructor(private readonly svc: McpProxyService) {}

  @Post('connect')
  @HttpCode(200)
  connect() {
    return this.svc.connect();
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect() {
    this.svc.disconnect();
    return { status: 'disconnected' };
  }

  @Get('tools')
  listTools() {
    return this.svc.listTools();
  }

  @Get('resources')
  listResources() {
    return this.svc.listResources();
  }

  @Get('prompts')
  listPrompts() {
    return this.svc.listPrompts();
  }

  @Post('call-tool')
  @HttpCode(200)
  callTool(@Body() body: { name: string; args?: Record<string, unknown> }) {
    return this.svc.callTool(body.name, body.args ?? {});
  }

  @Get('messages')
  getMessages() {
    return this.svc.messages;
  }

  @Delete('messages')
  @HttpCode(204)
  clearMessages() {
    this.svc.clearMessages();
  }
}
