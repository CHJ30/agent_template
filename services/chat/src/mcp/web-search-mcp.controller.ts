import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { WebSearchMcpService } from './web-search-mcp.service.js';

@Controller('web-search')
export class WebSearchMcpController {
  constructor(private readonly svc: WebSearchMcpService) {}

  @Post('search-competitors')
  @HttpCode(200)
  searchCompetitors(
    @Body() body: { query: string; domain?: string },
  ) {
    return this.svc.callTool('search_competitors', body);
  }

  @Post('search-best-practices')
  @HttpCode(200)
  searchBestPractices(
    @Body() body: { topic: string; industry?: string },
  ) {
    return this.svc.callTool('search_best_practices', body);
  }

  @Post('search-tech-stack')
  @HttpCode(200)
  searchTechStack(
    @Body() body: { technology: string; useCase?: string },
  ) {
    return this.svc.callTool('search_tech_stack', body);
  }
}
