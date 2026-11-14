import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import z from 'zod';

config({ path: '.env' });

if (!fs.existsSync(path.resolve('./.env'))) {
  console.log('Cannot find env file');
  process.exit(1);
}

const configSchema = z.object({
  DATABASE_URL: z.string(),
  PORT: z.string().optional(),
  BETTER_AUTH_SECRET: z.string(),
  BETTER_AUTH_URL: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_REDIRECT_URI: z
    .string()
    .default('http://localhost:3001/auth/google/callback'),
  GOOGLE_CLIENT_REDIRECT_URI: z
    .string()
    .default('http://localhost:3000/oauth-google-callback'),
  // 2 phut qua ngan de mo hop thu, tim thu, go ma. 10 phut vua du ma van
  // khong de ma song lau.
  OTP_EXPIRES_IN: z.string().default('10m'),
  // ── Gui thu ───────────────────────────────────────────────────────────────
  // Chon nha cung cap bang bien moi truong, khong phai bang code: doi nha cung
  // cap sau nay chi la sua .env rồi khoi dong lai.
  MAIL_PROVIDER: z.enum(['resend', 'ses']).default('resend'),
  RESEND_API_KEY: z.string().optional(),
  /// Dia chi gui, vd: "Khoa Vat ly <no-reply@phys.hcmus.edu.vn>".
  /// cat dau nhay bao quanh neu co — .env cu tung luu 'a@b.com' KEM dau nhay,
  /// khien dia chi gui khong hop le ma loi bao ra rat kho hieu.
  MAIL_FROM: z
    .string()
    .optional()
    .transform((v) => v?.replace(/^['"]|['"]$/g, '').trim()),
  // AWS giu lai lam duong lui. TUY CHON — thieu thi backend van khoi dong duoc,
  // vi khi dung Resend thi khong can den chung.
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('ap-southeast-1'),
  SES_FROM_ADDRESS: z
    .string()
    .optional()
    .transform((v) => v?.replace(/^['"]|['"]$/g, '').trim()),
  SENTRY_DSN: z.string().optional(),
  NODE_ENV: z.string().optional(),
  FRONTEND_URL: z.string(),
  ACCESS_TOKEN_SECRET: z.string(),
  ACCESS_TOKEN_EXPIRES_IN: z.string(),
  REFRESH_TOKEN_SECRET: z.string(),
  REFRESH_TOKEN_EXPIRES_IN: z.string(),
  ADMIN_FIRST_NAME: z.string().min(1).max(100),
  ADMIN_LAST_NAME: z.string().min(1).max(100),
  ADMIN_PASSWORD: z.string().min(1).max(100),
  ADMIN_EMAIL: z.email(),
  REDIS_URL: z.string(),
});

const configServer = configSchema.safeParse(process.env);
if (!configServer.success) {
  console.log('Declared values in env file is not valid');
  console.error(configServer.error);
  process.exit(1);
}

const envConfig = configServer.data;
export default envConfig;
