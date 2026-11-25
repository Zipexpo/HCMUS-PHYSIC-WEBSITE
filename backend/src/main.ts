import './sentry/instrument';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './sentry/sentry.filter';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { ZodValidationPipe } from 'nestjs-zod';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Cây puckData của một trang di trú dễ vượt xa 100kb — mức mặc định của
  // body-parser trong Express. Trang dài nhất hiện nay 3,1MB và 72 trang vượt
  // 100kb, nên lưu trong trình sửa layout trả 413 "request entity too large"
  // mà giao diện chỉ hiện một dòng đỏ khó hiểu. Nới lên 25MB: đủ chỗ cho trang
  // dài nhất cộng biên, vẫn là chặn trên rõ ràng chứ không bỏ ngỏ.
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { limit: '25mb', extended: true });
  // Behind the sandbox reverse-proxy: trust the first proxy hop so req.ip
  // reflects the real client IP (X-Forwarded-For) — required for per-client
  // rate limiting to work instead of bucketing everyone under the proxy IP.
  app.set('trust proxy', 1);

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalPipes(new ZodValidationPipe());
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.useGlobalFilters(
    new AllExceptionsFilter(httpAdapter),
    new HttpExceptionFilter(),
  );
  const allowedOrigins = (
    process.env.FRONTEND_URLS ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000,http://localhost:3002'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  // Admin-uploaded microsites (/uploads/static-sites/**) are self-contained pages
  // with their own inline scripts/styles, shown in an iframe. The app's strict
  // helmet CSP + X-Frame-Options would blank them out. They're trusted content
  // (SuperAdmin upload only), so drop those two headers for that path prefix.
  app.use(
    '/uploads/static-sites',
    (_req: Request, res: Response, next: NextFunction) => {
      res.removeHeader('Content-Security-Policy');
      res.removeHeader('X-Frame-Options');
      next();
    },
  );
  // Minh chứng sáng kiến: danh sách công nhận có tên + mã người học → KHÔNG phục vụ
  // tĩnh; chỉ tải qua GET /scholar/decision-files/:fileId (có đăng nhập).
  app.use('/uploads/initiative-evidence', (_req: Request, res: Response) => {
    res.status(404).end();
  });
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
