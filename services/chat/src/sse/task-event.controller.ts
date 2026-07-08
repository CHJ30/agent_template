import { Controller, Get, Patch, Param, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Controller('api/tasks')
@UseGuards(JwtAuthGuard)
export class TaskEventController {
  constructor(private readonly prisma: PrismaService) {}

  /** Paginated task_events history for the current user, newest first. */
  @Get('history')
  async history(
    @CurrentUser() user: { userId: string },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const take = Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const currentPage = Math.max(Number(page) || 1, 1);
    const skip = (currentPage - 1) * take;

    const [items, total] = await Promise.all([
      this.prisma.task_events.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.task_events.count({ where: { userId: user.userId } }),
    ]);

    return { items, total, page: currentPage, pageSize: take };
  }

  // A single logical task (e.g. one document being processed) can emit
  // several events over its lifecycle (pending/processing/done/error), all
  // sharing the same `taskId` — so these two routes operate on ALL events
  // for that taskId, not a single task_events row.

  /** All events for a given taskId (chronological), scoped to the caller. */
  @Get(':taskId')
  async findByTaskId(
    @CurrentUser() user: { userId: string },
    @Param('taskId') taskId: string,
  ) {
    const events = await this.prisma.task_events.findMany({
      where: { taskId, userId: user.userId },
      orderBy: { createdAt: 'asc' },
    });
    if (events.length === 0) throw new NotFoundException(`No task_events found for taskId ${taskId}`);
    return events;
  }

  /** Marks every unread event for a given taskId as read. */
  @Patch(':taskId/read')
  async markRead(
    @CurrentUser() user: { userId: string },
    @Param('taskId') taskId: string,
  ) {
    const result = await this.prisma.task_events.updateMany({
      where: { taskId, userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, updated: result.count };
  }
}
