import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // CSDL RIÊNG của hệ ticket — cố ý không dùng chung DATABASE_URL với CMS,
    // để không bao giờ lỡ tay chạy `db push` lên CSDL của web Khoa.
    url: process.env["TICKET_DATABASE_URL"],
  },
});
