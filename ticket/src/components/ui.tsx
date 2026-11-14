import type { TicketStatus } from "@/generated/prisma/enums";
import {
  STATUS_LABEL,
  STATUS_LABEL_REPORTER,
  STATUS_TAG_DARK,
  STATUS_TAG_LIGHT,
  STATUS_TONE,
} from "@/lib/labels";

/**
 * Hai lớp đường cong chảy từ vùng sáng xuống dải đá phiến. Lớp trước đổ bóng
 * ngược lên nên trông như nổi khỏi mặt trang. Dùng drop-shadow của CSS thay
 * cho filter SVG để nhiều đường cong trên cùng trang không đụng id.
 */
export function CurveDown({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1440 150"
      preserveAspectRatio="none"
      className={"relative z-[1] -mb-px block h-[70px] w-full sm:h-[110px] lg:h-[150px] " + className}
    >
      <path
        className="curve-shadow"
        d="M0 150 V60 C 160 0, 330 0, 480 60 S 760 140, 920 80 S 1200 -10, 1320 30 S 1440 70, 1440 70 V150Z"
        fill="var(--slate-back)"
      />
      <path
        className="curve-shadow"
        d="M0 150 V105 C 210 35, 380 55, 540 105 S 840 155, 1000 95 S 1270 45, 1440 100 V150Z"
        fill="var(--slate)"
      />
      {/* Dải phẳng không đổ bóng phủ mép dưới, khỏi lộ đường viền mờ ở chỗ nối. */}
      <rect y="138" width="1440" height="12" fill="var(--slate)" />
    </svg>
  );
}

/** Đường cong ngược: từ dải tối trở lại vùng sáng. */
export function CurveUp() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1440 110"
      preserveAspectRatio="none"
      className="-mt-px block h-[50px] w-full sm:h-[80px] lg:h-[110px]"
      style={{ background: "var(--slate)" }}
    >
      <path
        className="curve-shadow"
        d="M0 110 V70 C 240 10, 520 10, 760 60 S 1180 110, 1440 40 V110Z"
        fill="var(--shell)"
      />
      <rect y="100" width="1440" height="10" fill="var(--shell)" />
    </svg>
  );
}

export function Led({ color, off }: { color?: string; off?: boolean }) {
  return (
    <span
      aria-hidden
      className={"led" + (off ? " led-off" : "")}
      style={color ? ({ "--c": color } as React.CSSProperties) : undefined}
    />
  );
}

/** Nhãn trạng thái lõm xuống, có đèn LED. `dark` khi đặt trên dải tối. */
export function StatusPill({
  status,
  dark,
  label,
}: {
  status: TicketStatus;
  dark?: boolean;
  label?: string;
}) {
  if (status === "WAITING" && !dark) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-[var(--amber)] px-3 py-1 text-xs font-medium text-[#22252a]">
        {label ?? STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <span
      className={
        (dark ? "press-d text-[var(--on-dark)]" : "press") +
        " inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
      }
    >
      <Led color={STATUS_TONE[status]} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function Initials({ name, dark }: { name: string; dark?: boolean }) {
  const s = name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={
        (dark ? "raise-d" : "raise") +
        " flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      }
    >
      {s}
    </span>
  );
}

/** "3 phút trước", "2 ngày trước". */
export function tuBayGio(d: Date): string {
  const giay = Math.floor((Date.now() - d.getTime()) / 1000);
  if (giay < 60) return "vừa xong";
  const phut = Math.floor(giay / 60);
  if (phut < 60) return `${phut} phút trước`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ trước`;
  const ngay = Math.floor(gio / 24);
  if (ngay < 30) return `${ngay} ngày trước`;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/**
 * Bước của phiếu trên thanh tiến độ 5 ô (đã gửi → tiếp nhận → xử lý → xong →
 * đóng). Chờ bổ sung vẫn ở bước xử lý. Đã đóng / không xử lý = qua hết.
 */
export const STEP_OF: Record<TicketStatus, number> = {
  NEW: 0,
  ACKNOWLEDGED: 1,
  IN_PROGRESS: 2,
  WAITING: 2,
  RESOLVED: 3,
  CLOSED: 5,
  REJECTED: 5,
};

/**
 * Thanh tiến độ 5 ô, đúng ngữ nghĩa thiết kế:
 *   ô đã qua     = nổi khối trung tính
 *   ô hiện tại   = BẠC HÀ phát sáng — hoặc HỔ PHÁCH nếu đang chờ người gửi
 *   ô chưa tới   = trống
 * Hổ phách chỉ xuất hiện khi phiếu chờ chính người gửi, nên nhìn lướt cả danh
 * sách là thấy ngay phiếu nào đang cần mình.
 *
 * `tone`: "dark" khi đặt trên dải đá phiến, "light" khi trên nền sáng.
 */
export function ProgressCells({
  status,
  tone = "dark",
  className = "",
}: {
  status: TicketStatus;
  tone?: "dark" | "light";
  className?: string;
}) {
  const cur = STEP_OF[status];
  const wait = status === "WAITING";
  const past =
    tone === "dark"
      ? { bg: "#c9ccc9", sh: "inset 0 1px 0 rgba(255,255,255,.6), 0 2px 4px rgba(0,0,0,.35)" }
      : { bg: "#4b5050", sh: "inset 0 1px 0 rgba(255,255,255,.25), 0 2px 3px rgba(0,0,0,.3)" };
  const now = wait
    ? { bg: "#e9b949", sh: "0 0 10px rgba(233,185,73,.8)" }
    : tone === "dark"
      ? { bg: "#7fcbb4", sh: "0 0 12px rgba(127,203,180,.6)" }
      : { bg: "#5fb39a", sh: "0 0 10px rgba(95,179,154,.7)" };
  const label =
    cur >= 5
      ? STATUS_LABEL[status]
      : `Bước ${cur + 1} trên 5: ${STATUS_LABEL[status]}`;
  return (
    <span
      role="img"
      aria-label={label}
      className={
        (tone === "dark" ? "press-d" : "press") +
        " flex gap-1.5 rounded-full p-[7px] " +
        className
      }
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const c = i < cur ? past : i === cur ? now : null;
        return (
          <span
            key={i}
            className="h-2.5 flex-1 rounded-full"
            style={c ? { background: c.bg, boxShadow: c.sh } : undefined}
          />
        );
      })}
    </span>
  );
}

/** Nhãn trạng thái dạng viên thuốc màu, đúng bảng màu thiết kế. */
export function StatusTag({
  status,
  dark,
  reporter,
  className = "",
}: {
  status: TicketStatus;
  dark?: boolean;
  /** Nhìn từ phía người gửi: "Chờ thầy/cô bổ sung" thay vì "Chờ bổ sung". */
  reporter?: boolean;
  className?: string;
}) {
  const c = (dark ? STATUS_TAG_DARK : STATUS_TAG_LIGHT)[status];
  return (
    <span
      className={
        "inline-flex items-center justify-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium " +
        className
      }
      style={{ background: c.bg, color: c.fg }}
    >
      {reporter ? STATUS_LABEL_REPORTER[status] : STATUS_LABEL[status]}
    </span>
  );
}

/** Mũi tên chéo ↗ dùng trong núm và liên kết. */
export function ArrowUpRight({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

/** Núm hổ phách mang mũi tên — đầu bên phải của nút chính. */
export function KnobArrow({ size = 40 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="knob flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size }}
    >
      <ArrowUpRight size={Math.round(size * 0.4)} />
    </span>
  );
}

/** "THỨ SÁU · 13.11.2026" — dòng ngày trên đầu trang chủ. */
export function homNay(d = new Date()): string {
  const thu = [
    "CHỦ NHẬT",
    "THỨ HAI",
    "THỨ BA",
    "THỨ TƯ",
    "THỨ NĂM",
    "THỨ SÁU",
    "THỨ BẢY",
  ];
  // Ép múi giờ Việt Nam: máy chủ chạy UTC, không ép thì sau 17 giờ chiều là
  // trang báo sang ngày hôm sau.
  const vn = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const dd = String(vn.getDate()).padStart(2, "0");
  const mm = String(vn.getMonth() + 1).padStart(2, "0");
  return `${thu[vn.getDay()]} · ${dd}.${mm}.${vn.getFullYear()}`;
}
