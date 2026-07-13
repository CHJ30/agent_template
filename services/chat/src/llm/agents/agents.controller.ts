import { Controller, Post, Body, Get, Param, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OrchestratorService, TEST_CASES, ANALYSIS_TEST_CASES, SUPERVISOR_TEST_CASES } from './orchestrator.service.js';
import type { UIResponse, StreamEnvelope } from './orchestrator.service.js';
import { RequirementReportService } from './requirement-report.service.js';
import { MessageService } from '../../message/message.service.js';
import { CONTEXT_TEST_CASES, runContextTestCase } from '../context/context-test-runner.js';

@Controller('api/agents')
export class AgentsController {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly requirementReportService: RequirementReportService,
    private readonly messageService: MessageService,
  ) {}

  /** Fetches a previously generated + persisted requirement report by id. */
  @Get('report/:reportId')
  async getReport(@Param('reportId') reportId: string) {
    const report = await this.requirementReportService.findById(reportId.toUpperCase());
    if (!report) throw new NotFoundException(`Report ${reportId} not found`);
    return report;
  }

  @Post('orchestrate')
  orchestrate(@Body() body: { input: string; skipClarification?: boolean }) {
    return this.orchestratorService.orchestrate(body.input, body.skipClarification ?? false);
  }

  /** Minimal LLM call to verify the API key and proxy are reachable. */
  @Get('ping')
  ping() {
    return this.orchestratorService.ping();
  }

  @Get('context-test/cases')
  getContextTestCases() {
    return CONTEXT_TEST_CASES;
  }

  @Post('context-test/run')
  runContextTest(@Body() body: { caseId: number }) {
    return runContextTestCase(body.caseId);
  }

  /** Returns test-case metadata (no LLM calls) — used by the frontend to render cards. */
  @Get('graph-test/cases')
  getTestCases() {
    return TEST_CASES.map(({ id, description, input, expectedIntent, acceptableIntents, maxDurationMs }) => ({
      id,
      description,
      input,
      expectedIntent,
      acceptableIntents,
      maxDurationMs,
    }));
  }

  /** Runs a single test case and returns the result. */
  @Post('graph-test')
  runTestCase(@Body() body: { caseId: number }) {
    return this.orchestratorService.runTestCase(body.caseId);
  }

  /** Returns analysis sub-graph test-case metadata (no LLM calls). */
  @Get('analysis-test/cases')
  getAnalysisTestCases() {
    return ANALYSIS_TEST_CASES.map(({ id, description, input, expectsToolCalls, expectedTools }) => ({
      id,
      description,
      input,
      expectsToolCalls,
      expectedTools,
    }));
  }

  /** Runs a single analysis sub-graph test case and returns the result. */
  @Post('analysis-test')
  runAnalysisTest(@Body() body: { caseId: number }) {
    return this.orchestratorService.runAnalysisTest(body.caseId);
  }

  /** Returns supervisor test-case metadata (no LLM calls). */
  @Get('supervisor-test/cases')
  getSupervisorTestCases() {
    return SUPERVISOR_TEST_CASES.map(({ id, description, input, expectedExperts }) => ({
      id, description, input, expectedExperts,
    }));
  }

  /** Runs a single supervisor + multi-expert test case. */
  @Post('supervisor-test')
  runSupervisorTest(@Body() body: { caseId: number }) {
    return this.orchestratorService.runSupervisorTest(body.caseId);
  }

  /**
   * SSE streaming variant of `orchestrate`. Pushes a single, unified message
   * envelope over one long-lived connection — the client dispatches on
   * `messageType` (markdown / ui / progress / agent_start / agent_end / done / error).
   */
  @Post('orchestrate-stream')
  async orchestrateStream(
    @Body() body: { input: string; skipClarification?: boolean; sessionId?: string },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable reverse-proxy buffering
    res.flushHeaders(); // establish the connection immediately — no 30s black-box wait

    const write = (event: StreamEnvelope) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.orchestratorService.orchestrateStream(
        body.input,
        body.skipClarification ?? false,
        body.sessionId,
      )) {
        if (res.writableEnded) break; // client disconnected
        write(event);
        if (event.messageType === 'done' || event.messageType === 'error') break;
      }
    } catch (err) {
      if (!res.writableEnded) {
        write({ messageType: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /** Resumes a paused summary-review interrupt with the user's decision. */
  @Post('orchestrate-resume-stream')
  async resumeOrchestrateStream(
    @Body() body: {
      threadId: string;
      confirmed: boolean;
      critique?: string;
    },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (event: StreamEnvelope) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.orchestratorService.resumeSummaryReviewStream(
        body.threadId,
        body.confirmed,
        body.critique ?? '',
      )) {
        if (res.writableEnded) break;
        write(event);
        if (event.messageType === 'done' || event.messageType === 'error') break;
      }
    } catch (err) {
      if (!res.writableEnded) {
        write({ messageType: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /** Resumes a persisted clarification form interrupt. */
  @Post('orchestrate-clarification-resume-stream')
  async resumeClarificationStream(
    @Body() body: {
      threadId: string;
      answers?: Record<string, string>;
      conversationId?: string;
      componentId?: string;
    },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const write = (event: StreamEnvelope) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    let clientConnected = true;
    res.on('close', () => { clientConnected = false; });
    let finalContent = '';
    let nextComponent: Record<string, unknown> | null = null;
    let terminalError = '';
    let progress = 45;
    const agentSteps: Array<{ agent: string; label: string; status: 'active' | 'done' }> = [];
    try {
      for await (const event of this.orchestratorService.resumeClarificationStream(
        body.threadId,
        body.answers ?? {},
      )) {
        if (event.messageType === 'ui' && event.component &&
          (event.component.type === 'form' || event.component.type === 'confirmation')) {
          nextComponent = event.component;
        }
        if (event.messageType === 'done' && event.content) finalContent = event.content;
        if (event.messageType === 'error') terminalError = event.error ?? '执行失败';
        if (event.messageType === 'progress' && typeof event.progress === 'number') progress = event.progress;
        if ((event.messageType === 'agent_start' || event.messageType === 'agent_end') && event.agent) {
          const existing = agentSteps.find((step) => step.agent === event.agent);
          const status = event.messageType === 'agent_end' ? 'done' as const : 'active' as const;
          if (existing) existing.status = status;
          else agentSteps.push({ agent: event.agent, label: event.label ?? event.agent, status });
        }
        if (body.conversationId && body.componentId &&
          (event.messageType === 'progress' || event.messageType === 'agent_start' || event.messageType === 'agent_end')) {
          await this.messageService.updateInteractionProgress(
            body.conversationId,
            body.componentId,
            progress,
            agentSteps,
          );
        }
        if (clientConnected && !res.writableEnded) write(event);
        if (event.messageType === 'done' || event.messageType === 'error') break;
      }
      if (body.conversationId && body.componentId) {
        await this.messageService.finishInteraction(body.conversationId, body.componentId, {
          status: terminalError ? 'failed' : nextComponent ? 'pending_hitl' : 'completed',
          content: finalContent,
          component: nextComponent,
          error: terminalError || undefined,
          agentSteps,
          progress: nextComponent ? progress : terminalError ? progress : 100,
        });
      }
    } catch (error) {
      if (body.conversationId && body.componentId) {
        await this.messageService.finishInteraction(body.conversationId, body.componentId, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (clientConnected && !res.writableEnded) write({ messageType: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /** Runs orchestrate + transforms to UI-friendly response with pipeline steps. */
  @Post('orchestrate-ui')
  async orchestrateUi(
    @Body() body: { input: string; skipClarification?: boolean },
  ): Promise<UIResponse> {
    const result = await this.orchestratorService.orchestrate(
      body.input,
      body.skipClarification ?? false,
    );
    return this.orchestratorService.toUIResponse(result);
  }

  /** Forces specific experts to fail (for testing graceful degradation). */
  @Post('degradation-test')
  runDegradationTest(
    @Body() body: { forceFailExperts?: string[] },
  ) {
    return this.orchestratorService.runDegradationTest(body.forceFailExperts ?? ['performance']);
  }
}
