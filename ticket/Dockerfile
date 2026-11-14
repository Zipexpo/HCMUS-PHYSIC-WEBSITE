# syntax=docker/dockerfile:1
# Hệ phiếu hỗ trợ (ticket, :3003).
#
# Build từ GỐC REPO, không phải từ ticket/, vì cần pnpm-lock.yaml dùng chung:
#   docker compose -f docker-compose.sandbox.yml build ticket
FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

FROM base AS builder
# Chỉ copy các package.json trước rồi mới cài: lớp install được cache lại khi
# mã nguồn đổi mà phụ thuộc không đổi. Đĩa máy chủ rất căng nên mọi lớp cache
# dùng lại được đều đáng giá.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY frontend-public/package.json frontend-public/
COPY ticket/package.json ticket/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter ticket...

COPY ticket ./ticket
ENV NEXT_TELEMETRY_DISABLED=1
# Máy 4GB: chặn heap để build không bị OOM.
ENV NODE_OPTIONS=--max-old-space-size=2048
WORKDIR /app/ticket
# prisma generate cần URL để đọc datasource, nhưng KHÔNG kết nối lúc build —
# giá trị giả này chỉ để qua bước kiểm cú pháp.
ENV TICKET_DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm exec prisma generate
RUN --mount=type=cache,target=/app/ticket/.next/cache pnpm exec next build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=builder /app/ticket/.next/standalone ./
COPY --from=builder /app/ticket/.next/static ./ticket/.next/static
# Prisma engine + client đã sinh: standalone trace không phải lúc nào cũng mang
# theo đủ, copy thẳng cho chắc.
COPY --from=builder /app/ticket/src/generated ./ticket/src/generated
COPY --from=builder /app/ticket/prisma ./ticket/prisma
EXPOSE 3003
ENV PORT=3003
ENV HOSTNAME=0.0.0.0
CMD ["node", "ticket/server.js"]
