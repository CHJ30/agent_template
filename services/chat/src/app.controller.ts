import { Controller, Get, Post, Body } from '@nestjs/common';
import { AppService } from './app.service.js';
import { RequirementService } from './llm/requirement.service.js';
import type { RequirementResult } from '@autix/contracts';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly requirementService: RequirementService,
  ) {}

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('hello')
  getHello() {
    return this.appService.getHello();
  }

  @Post('requirement/extract')
  extractRequirement(@Body() body: { input: string }): Promise<RequirementResult> {
    return this.requirementService.extract(body.input);
  }
}
