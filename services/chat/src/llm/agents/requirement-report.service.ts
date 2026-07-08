import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('requirement-report');

export interface RequirementReportInput {
  reportId: string;
  userId?: string;
  input: string;
  extracted?: string;
  analysisResult?: string;
  risk?: string;
  summary: string;
  status?: string;
}

/**
 * Persists completed requirement-analysis reports so a later query-intent
 * message (e.g. "查询 REQ-20260708-123 的状态") can look up the real report
 * instead of the LLM fabricating a plausible-looking answer.
 *
 * Never throws — DB unavailability degrades to "no report found" rather
 * than breaking the orchestrator's streaming response.
 */
@Injectable()
export class RequirementReportService {
  constructor(private readonly prisma: PrismaService) {}

  async save(report: RequirementReportInput): Promise<void> {
    try {
      await this.prisma.requirement_reports.create({
        data: {
          id:             report.reportId,
          userId:         report.userId,
          input:          report.input,
          extracted:      report.extracted,
          analysisResult: report.analysisResult,
          risk:           report.risk,
          summary:        report.summary,
          status:         report.status ?? 'completed',
        },
      });
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), reportId: report.reportId },
        'report_persist_failed',
      );
    }
  }

  async findById(reportId: string) {
    try {
      return await this.prisma.requirement_reports.findUnique({ where: { id: reportId } });
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), reportId }, 'report_lookup_failed');
      return null;
    }
  }
}
