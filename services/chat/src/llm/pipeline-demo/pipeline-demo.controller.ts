import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PipelineDemoService, type PipelineDemoEvent } from './pipeline-demo.service.js';

@Controller('api/pipeline-demo')
export class PipelineDemoController {
  constructor(private readonly pipelineDemoService: PipelineDemoService) {}

  @Get('cases')
  listCases() {
    return this.pipelineDemoService.listCases();
  }

  @Post('stream')
  @HttpCode(200)
  async stream(
    @Body() body: { caseId?: string },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (event: PipelineDemoEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 10_000);

    try {
      for await (const event of this.pipelineDemoService.stream(body.caseId ?? '')) {
        write(event);
        if (event.type === 'pipeline_complete' || event.type === 'error') break;
      }
    } catch (error) {
      write({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }
}
