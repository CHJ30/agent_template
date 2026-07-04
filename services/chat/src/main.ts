import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ResponseInterceptor } from './observability/response.interceptor.js';
import { AllExceptionsFilter } from './observability/all-exceptions.filter.js';

// nest start --watch 通过 Turbo 运行时，Bun 不会自动加载 .env；手动解析
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^=#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Prevent unhandled LLM / network rejections from crashing the process.
// NestJS exception filters catch errors from request handlers, but async
// callbacks that escape the request context (e.g. background retries inside
// LangChain) can still reach this handler.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3002' });
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = process.env.PORT ?? 8081;
  await app.listen(port);
  console.log(`Chat service running on http://localhost:${port}`);
}
bootstrap();
