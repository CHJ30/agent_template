import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SseService } from './sse.service.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

@Controller('api/sse')
@UseGuards(JwtAuthGuard)
export class SseController {
  constructor(private readonly sseService: SseService) {}

  /**
   * Long-lived SSE stream of this user's task_events. Registers the
   * connection, sends a heartbeat comment every 30s to keep the connection
   * alive through proxies, and cleans up on disconnect.
   */
  @Get('tasks')
  tasks(
    @CurrentUser() user: { userId: string },
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    this.sseService.addConnection(user.userId, res);
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.sseService.removeConnection(user.userId, res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  }
}
