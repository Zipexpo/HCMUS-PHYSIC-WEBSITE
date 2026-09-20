# glibc (Debian) base — required by onnxruntime-node (the @xenova/transformers
# embedding backend), whose native .so is built against glibc and cannot load on
# Alpine/musl (ERR_DLOPEN_FAILED: ld-linux-x86-64.so.2 missing).
FROM node:20-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

FROM base AS deps
COPY package.json ./
# build toolchain in case any native dep must compile from source (most ship
# glibc prebuilds, so this is a safety net); cleaned up in the same layer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# The backend build context is ./backend, which has no pnpm-lock.yaml (the lockfile
# lives at the monorepo root and isn't reachable here) — install from package.json.
RUN pnpm install --prod=false --no-frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# nest build (swc + type-check) cần hơn heap 2GB mặc định của Node
ENV NODE_OPTIONS=--max-old-space-size=3072
RUN pnpm exec prisma generate
RUN pnpm exec nest build

FROM base AS runner
ENV NODE_ENV=production
# OCR minh chứng đề tài: pdftotext/pdftoppm (poppler) + tesseract với gói tiếng
# Việt. Endpoint scholar/projects/parse-documents gọi chúng qua child_process để
# đọc hợp đồng scan và thuyết minh. Xem project-doc.service.ts.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     poppler-utils tesseract-ocr tesseract-ocr-vie \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/initialScript ./initialScript
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/prisma.config.ts ./
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
