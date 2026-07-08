import { Controller, Post, Body, Get, Param, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OrchestratorService, TEST_CASES, ANALYSIS_TEST_CASES, SUPERVISOR_TEST_CASES } from './orchestrator.service.js';
import type { UIResponse, StreamEnvelope } from './orchestrator.service.js';
import { RequirementReportService } from './requirement-report.service.js';

@Controller('api/agents')
export class AgentsController {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly requirementReportService: RequirementReportService,
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
