import { prisma } from "@/lib/db";
import type { StatusEvent } from "@/lib/sla";

/**
 * Lịch sử đổi trạng thái của nhiều phiếu một lượt — để tính hạn (lib/sla.ts
 * `deadlines`) có trừ thời gian chờ người gửi và tính lại khi mở lại.
 */
export async function statusEvents(ids: string[]): Promise<Map<string, StatusEvent[]>> {
  const out = new Map<string, StatusEvent[]>();
  if (!ids.length) return out;
  const rows = await prisma.ticketEvent
    .findMany({
      where: { ticketId: { in: ids }, kind: "status" },
      orderBy: { createdAt: "asc" },
      select: { ticketId: true, createdAt: true, fromValue: true, toValue: true },
    })
    .catch(() => []);
  for (const r of rows) {
    const list = out.get(r.ticketId) ?? [];
    list.push(r);
    out.set(r.ticketId, list);
  }
  return out;
}
