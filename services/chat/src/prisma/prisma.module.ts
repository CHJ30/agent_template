import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { CostTrackingService } from '../llm/cost/cost-tracking.service.js';

@Global()
@Module({
  providers: [PrismaService, CostTrackingService],
  exports: [PrismaService, CostTrackingService],
})
export class PrismaModule {}
