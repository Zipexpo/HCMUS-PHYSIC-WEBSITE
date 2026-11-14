import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";

// Một client dùng chung cho cả tiến trình. Next ở chế độ dev nạp lại module
// liên tục, nên không giữ lại thì mỗi lần sửa code lại mở thêm một pool tới
// Postgres cho đến khi hết kết nối.
const globalForPrisma = globalThis as unknown as {
  ticketPrisma?: PrismaClient;
};

function create(): PrismaClient {
  const url = process.env.TICKET_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Thiếu TICKET_DATABASE_URL — hệ ticket dùng CSDL RIÊNG, không dùng chung với CMS.",
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString: url, max: 5 })),
  });
}

export const prisma: PrismaClient =
  globalForPrisma.ticketPrisma ?? (globalForPrisma.ticketPrisma = create());
