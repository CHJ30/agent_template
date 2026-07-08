import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskStatus } from '@prisma/client';
import { createLogger } from '../observability/logger.js';

const log = createLogger('sse');

const TASK_EVENTS_RETENTION_DAYS = 30;

export interface TaskEventInput {
  taskType: string;
  taskId: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Push notification hub: keeps one Set of live SSE connections per userId
 * (a user can have several open tabs), persists every emitted event to
 * `task_events` first (so history/polling still works if nobody is
 * connected), then fans it out to whichever connections are currently open.
 */
@Injectable()
export class SseService {
  // One user can have multiple tabs/connections open simultaneously.
  private readonly connections = new Map<string, Set<Response>>();

  constructor(private readonly prisma: PrismaService) {}

  addConnection(userId: string, res: Response): void {
    let set = this.connections.get(userId);
    if (!set) {
      set = new Set();
      this.connections.set(userId, set);
    }
    set.add(res);
    log.debug({ userId, connections: set.size }, 'sse_connection_added');
  }

  removeConnection(userId: string, res: Response): void {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.connections.delete(userId);
    log.debug({ userId, connections: set.size }, 'sse_connection_removed');
  }

  /** Persists the event, then pushes it to every online connection for userId. */
  async emit(userId: string, event: TaskEventInput): Promise<void> {
    let saved: unknown = event;
    try {
      saved = await this.prisma.task_events.create({
        data: {
          userId,
          taskType: event.taskType,
          taskId: event.taskId,
          status: event.status as TaskStatus,
          message: event.message,
          metadata: event.metadata as object | undefined,
        },
      });
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), userId, taskId: event.taskId },
        'task_event_persist_failed',
      );
    }

    const set = this.connections.get(userId);
    if (!set || set.size === 0) return;

    const payload = `data: ${JSON.stringify(saved)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err), userId }, 'sse_write_failed');
        set.delete(res);
      }
    }
  }

  /**
   * Periodic cleanup: drop any connection whose underlying socket has
   * already closed (missed a 'close' event for whatever reason), and purge
   * task_events older than 30 days.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanup(): Promise<void> {
    let deadConnections = 0;
    for (const [userId, set] of this.connections) {
      for (const res of set) {
        if (res.writableEnded || res.destroyed) {
          set.delete(res);
          deadConnections += 1;
        }
      }
      if (set.size === 0) this.connections.delete(userId);
    }
    if (deadConnections > 0) {
      log.debug({ deadConnections }, 'sse_dead_connections_pruned');
    }

    const cutoff = new Date(Date.now() - TASK_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const result = await this.prisma.task_events.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        log.info({ deleted: result.count }, 'task_events_cleanup');
      }
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'task_events_cleanup_failed');
    }
  }
}
