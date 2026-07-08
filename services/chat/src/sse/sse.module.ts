import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SseService } from './sse.service.js';
import { SseController } from './sse.controller.js';
import { TaskEventController } from './task-event.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [SseController, TaskEventController],
  providers: [SseService],
  exports: [SseService],
})
export class SseModule {}
