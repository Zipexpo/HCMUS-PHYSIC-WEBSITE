/**
 * THỜI HẠN theo giờ hành chính: thứ Hai–thứ Sáu, 7:30–11:30 và 13:00–17:00
 * (giờ Việt Nam) — 8 giờ làm việc một ngày. Phiếu gửi tối thứ Sáu thì đồng
 * hồ chạy từ 7:30 sáng thứ Hai.
 *
 * Ngày lễ chưa trừ: thêm vào HOLIDAYS khi cần (yyyy-mm-dd).
 */
export const SLA_HOURS = {
  URGENT: { response: 2, resolve: 8 },
  HIGH: { response: 4, resolve: 16 },
  NORMAL: { response: 8, resolve: 40 },
  LOW: { response: 16, resolve: 80 },
} as const;
export type Priority = keyof typeof SLA_HOURS;

const HOLIDAYS = new Set<string>([]);

const VN_OFFSET = 7 * 3_600_000;
const SHIFTS: [number, number][] = [
  [7.5, 11.5],
  [13, 17],
];

/** Cộng `hours` giờ làm việc vào mốc `from`. */
export function addBusinessHours(from: Date, hours: number): Date {
  let left = hours * 3_600_000;
  // Làm việc trên "giờ Việt Nam" giả lập bằng UTC dịch +7, rồi dịch về.
  let t = from.getTime() + VN_OFFSET;
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const d = new Date(t);
    const day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const iso = new Date(day0).toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso)) {
      for (const [a, b] of SHIFTS) {
        const s = day0 + a * 3_600_000;
        const e = day0 + b * 3_600_000;
        if (t >= e) continue;
        const start = Math.max(t, s);
        const take = Math.min(left, e - start);
        left -= take;
        t = start + take;
        if (left <= 0) return new Date(t - VN_OFFSET);
      }
    }
    t = day0 + 24 * 3_600_000; // sang đầu ngày hôm sau
  }
  return new Date(t - VN_OFFSET);
}

/** Số giờ làm việc nằm giữa hai mốc (a < b). */
export function businessHoursBetween(a: Date, b: Date): number {
  let t = a.getTime() + VN_OFFSET;
  const end = b.getTime() + VN_OFFSET;
  let ms = 0;
  for (let guard = 0; guard < 4000 && t < end; guard++) {
    const d = new Date(t);
    const day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const iso = new Date(day0).toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso)) {
      for (const [x, y] of SHIFTS) {
        const s = Math.max(t, day0 + x * 3_600_000);
        const e = Math.min(end, day0 + y * 3_600_000);
        if (e > s) ms += e - s;
      }
    }
    t = day0 + 24 * 3_600_000;
  }
  return ms / 3_600_000;
}

/** Một dòng đổi trạng thái trong lịch sử phiếu (TicketEvent kind "status"). */
export type StatusEvent = { createdAt: Date; fromValue: string | null; toValue: string | null };

// Nhãn trạng thái như được ghi trong lịch sử (lib/labels.ts). Không import để
// file này dùng được ở mọi nơi; nhãn mà đổi thì sửa cả ở đây.
const WAITING_LABEL = "Chờ bổ sung";
const DONE_LABELS = ["Đã xong", "Đã đóng", "Không xử lý"];
const isDone = (v: string | null) => !!v && DONE_LABELS.some((l) => v.startsWith(l));

/**
 * Đồng hồ thời hạn của MỘT phiếu, dựng lại từ lịch sử trạng thái:
 *   - Bắt đầu lúc gửi (phiếu phải duyệt: lúc được duyệt).
 *   - Thời gian "Chờ bổ sung" KHÔNG tính: bóng đang ở phía người gửi.
 *   - Phiếu đã xong / đã đóng bị mở lại → đồng hồ chạy lại từ lúc mở lại.
 */
export function slaClock(start: Date, events: StatusEvent[], now = new Date()) {
  let from = start;
  let paused = 0;
  let waitSince: Date | null = null;
  const evs = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const e of evs) {
    if (e.createdAt < from) continue;
    if (isDone(e.fromValue) && !isDone(e.toValue)) {
      from = e.createdAt;
      paused = 0;
      waitSince = null;
    }
    if (waitSince && !e.toValue?.startsWith(WAITING_LABEL)) {
      paused += businessHoursBetween(waitSince, e.createdAt);
      waitSince = null;
    }
    if (!waitSince && e.toValue?.startsWith(WAITING_LABEL)) waitSince = e.createdAt;
  }
  if (waitSince && now > waitSince) paused += businessHoursBetween(waitSince, now);
  return { from, paused };
}

/**
 * Hạn phản hồi đầu và hạn xử lý xong. Truyền `events` (lịch sử trạng thái) để
 * trừ thời gian chờ người gửi và tính lại khi phiếu bị mở lại.
 */
export function deadlines(createdAt: Date, priority: Priority, events: StatusEvent[] = []) {
  const h = SLA_HOURS[priority];
  const { from, paused } = slaClock(createdAt, events);
  return {
    response: addBusinessHours(from, h.response + paused),
    resolve: addBusinessHours(from, h.resolve + paused),
  };
}

/** "2 giờ", "1 ngày" — mô tả thời hạn cho người đọc. */
export const slaText = (h: number) => (h >= 8 && h % 8 === 0 ? `${h / 8} ngày làm việc` : `${h} giờ làm việc`);
