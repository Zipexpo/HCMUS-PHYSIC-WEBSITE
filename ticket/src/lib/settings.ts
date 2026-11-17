import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * THÔNG BÁO SỰ CỐ CHUNG — một dòng hiện đầu mọi trang.
 *
 * Khi web Khoa đang chập chờn, hai chục người sẽ gửi hai chục phiếu giống nhau.
 * Một dòng "đã biết, đang xử lý, dự kiến xong lúc…" chặn được phần lớn số đó,
 * và người dùng thấy Khoa nắm được tình hình — đỡ sốt ruột hơn là im lặng.
 */
export type Notice = {
  message: string;
  /** "warn" = đang có sự cố; "info" = thông tin (bảo trì có lịch, đã khắc phục…). */
  level: "warn" | "info";
  byName: string;
  at: string;
};

export async function getNotice(): Promise<Notice | null> {
  const row = await prisma.ticketSetting.findUnique({ where: { key: "notice" } }).catch(() => null);
  const v = row?.value as Notice | null | undefined;
  return v && typeof v.message === "string" && v.message.trim() ? v : null;
}

export async function setNotice(n: Notice | null): Promise<void> {
  if (!n) {
    await prisma.ticketSetting.deleteMany({ where: { key: "notice" } });
    return;
  }
  const value = n as unknown as Prisma.InputJsonValue;
  await prisma.ticketSetting.upsert({
    where: { key: "notice" },
    create: { key: "notice", value },
    update: { value },
  });
}

/**
 * Giữ chỗ một việc "mỗi ngày một lần" (vd thư tóm tắt sáng). Trả về true nếu
 * CHÍNH lần gọi này giành được — dù có nhiều tiến trình cùng chạy, chỉ một
 * cái nhận true. Dựa vào UPDATE … WHERE value <> mới: đã ghi rồi thì không
 * trả dòng nào.
 */
export async function claimOncePer(key: string, stamp: string): Promise<boolean> {
  const v = JSON.stringify(stamp);
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "TicketSetting" ("key", "value", "updatedAt") VALUES (${key}, ${v}::jsonb, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
      WHERE "TicketSetting"."value" IS DISTINCT FROM EXCLUDED."value"
    RETURNING "key"`;
  return rows.length > 0;
}
