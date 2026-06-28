import { Controller, Post, Body, Get } from '@nestjs/common';
import { OrchestratorService, TEST_CASES, ANALYSIS_TEST_CASES, SUPERVISOR_TEST_CASES } from './orchestrator.service.js';
import type { UIResponse } from './orchestrator.service.js';

@Controller('api/agents')
export class AgentsController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

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
