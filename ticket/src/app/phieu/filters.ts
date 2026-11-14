/**
 * Bộ lọc của danh sách phiếu — toàn bộ nằm trên URL để dán link cho đồng
 * nghiệp, bấm Quay lại hay F5 đều giữ nguyên đúng màn hình đang xem.
 */

export type Params = Record<string, string | undefined>;

export const RANGES = [
  { k: "hom-nay", label: "Hôm nay" },
  { k: "7", label: "7 ngày" },
  { k: "30", label: "30 ngày" },
  { k: "hk", label: "Học kỳ này" },
  { k: "nam", label: "Năm nay" },
  { k: "tat-ca", label: "Tất cả" },
] as const;

const DAY = 86_400_000;

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Mốc bắt đầu học kỳ hiện tại theo lịch thường dùng của Trường:
 * HK I từ tháng 9 tới hết tháng 1, HK II từ tháng 2 tới tháng 6, hè tháng 7–8.
 */
function semesterStart(now: Date): Date {
  const m = now.getMonth(); // 0 = tháng 1
  const y = now.getFullYear();
  if (m >= 8) return new Date(y, 8, 1);
  if (m === 0) return new Date(y - 1, 8, 1);
  if (m <= 5) return new Date(y, 1, 1);
  return new Date(y, 6, 1);
}

/** Khoảng thời gian [from, to) theo tham số `tg`, hoặc `tu`/`den` tự chọn. */
export function resolveRange(p: Params): {
  key: string;
  from?: Date;
  to?: Date;
  label: string;
} {
  const now = new Date();
  const parse = (s?: string) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const tu = parse(p.tu);
  const den = parse(p.den);
  if (tu || den) {
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(d);
    return {
      key: "tuy-chon",
      from: tu,
      // `den` tính trọn ngày đó.
      to: den ? new Date(den.getTime() + DAY) : undefined,
      label: `${tu ? fmt(tu) : "…"} – ${den ? fmt(den) : "nay"}`,
    };
  }
  const key = RANGES.some((r) => r.k === p.tg) ? p.tg! : "tat-ca";
  const label = RANGES.find((r) => r.k === key)!.label;
  const today = startOfDay(now);
  switch (key) {
    case "hom-nay":
      return { key, from: today, label };
    case "7":
      return { key, from: new Date(today.getTime() - 6 * DAY), label };
    case "30":
      return { key, from: new Date(today.getTime() - 29 * DAY), label };
    case "hk":
      return { key, from: semesterStart(now), label };
    case "nam":
      return { key, from: new Date(now.getFullYear(), 0, 1), label };
    default:
      return { key, label };
  }
}

/** Tạo link giữ các tham số đang có, đè/xoá theo `patch` (undefined = xoá). */
export function hrefWith(base: string, p: Params, patch: Params): string {
  const q = new URLSearchParams();
  const merged = { ...p, ...patch };
  for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
  // Đổi bộ lọc thì về trang 1, trừ khi chính patch là đổi trang.
  if (!("trang" in patch)) q.delete("trang");
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** Nhóm theo mốc thời gian để danh sách dài vẫn dễ dò. */
export function bucketOf(d: Date): string {
  const today = startOfDay(new Date()).getTime();
  const t = d.getTime();
  if (t >= today) return "Hôm nay";
  if (t >= today - DAY) return "Hôm qua";
  if (t >= today - 6 * DAY) return "Tuần này";
  if (t >= today - 29 * DAY) return "Tháng này";
  return "Cũ hơn";
}

export function monthOf(d: Date): string {
  return `Tháng ${d.getMonth() + 1} · ${d.getFullYear()}`;
}

/** Gom mảng đã sắp xếp thành các nhóm liền nhau, giữ thứ tự. */
export function groupRuns<T>(items: T[], key: (t: T) => string) {
  const out: { label: string; items: T[] }[] = [];
  for (const it of items) {
    const k = key(it);
    const last = out[out.length - 1];
    if (last && last.label === k) last.items.push(it);
    else out.push({ label: k, items: [it] });
  }
  return out;
}

/** Chuỗi conic-gradient cho đĩa tròn từ các phần có màu. */
export function pie(parts: { n: number; color: string }[]): string {
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (!total) return "conic-gradient(var(--slate-deep) 0 360deg)";
  let acc = 0;
  const stops = parts
    .filter((p) => p.n > 0)
    .map((p) => {
      const a = (acc / total) * 360;
      acc += p.n;
      const b = (acc / total) * 360;
      return `${p.color} ${a}deg ${b}deg`;
    });
  return `conic-gradient(${stops.join(", ")})`;
}

export const DAY_MS = DAY;
