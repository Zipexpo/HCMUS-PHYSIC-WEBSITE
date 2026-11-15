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

export function deadlines(createdAt: Date, priority: Priority) {
  const h = SLA_HOURS[priority];
  return {
    response: addBusinessHours(createdAt, h.response),
    resolve: addBusinessHours(createdAt, h.resolve),
  };
}

/** "2 giờ", "1 ngày" — mô tả thời hạn cho người đọc. */
export const slaText = (h: number) => (h >= 8 && h % 8 === 0 ? `${h / 8} ngày làm việc` : `${h} giờ làm việc`);
