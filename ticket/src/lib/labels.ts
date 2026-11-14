// Nhãn và màu dùng được ở cả client lẫn server — KHÔNG import db ở đây,
// nếu không trang client sẽ kéo cả driver Postgres vào trình duyệt.
import type { TicketStatus } from "@/generated/prisma/enums";

/** Nhãn tiếng Việt — gom một chỗ để giao diện và email dùng chung. */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "Mới gửi",
  ACKNOWLEDGED: "Đã tiếp nhận",
  IN_PROGRESS: "Đang xử lý",
  WAITING: "Chờ bổ sung",
  RESOLVED: "Đã xong",
  CLOSED: "Đã đóng",
  REJECTED: "Không xử lý",
};

/** Màu đèn LED cho từng trạng thái (giá trị CSS, dùng cho biến --c). */
export const STATUS_TONE: Record<TicketStatus, string> = {
  NEW: "var(--sky)",
  ACKNOWLEDGED: "var(--peach)",
  IN_PROGRESS: "var(--amber)",
  WAITING: "var(--amber)",
  RESOLVED: "var(--mint)",
  CLOSED: "#9aa09d",
  REJECTED: "var(--rose)",
};

export const PRIORITY_TONE = {
  LOW: "#9aa09d",
  NORMAL: "var(--mint)",
  HIGH: "var(--peach)",
  URGENT: "var(--rose)",
} as const;

export const PRIORITY_LABEL = {
  LOW: "Thấp",
  NORMAL: "Bình thường",
  HIGH: "Cao",
  URGENT: "Khẩn",
} as const;

/** Trạng thái coi là ĐANG MỞ — dùng cho bộ lọc mặc định và số đếm. */
export const OPEN_STATUSES: TicketStatus[] = [
  "NEW",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "WAITING",
];


/**
 * Màu nhãn trạng thái, lấy NGUYÊN từ bản thiết kế (artboard "Phiếu của tôi"
 * và "Trang chủ"). Hai bộ: trên nền sáng thì nhãn pastel chữ đậm; trên dải tối
 * thì nhãn đặc màu. Hổ phách CHỈ dành cho "đang chờ bạn".
 */
export const STATUS_TAG_LIGHT: Record<TicketStatus, { bg: string; fg: string }> = {
  NEW: { bg: "#3b4040", fg: "#f1f0ec" },
  ACKNOWLEDGED: { bg: "#dde8ee", fg: "#2c4a58" },
  IN_PROGRESS: { bg: "#d6eee6", fg: "#1f5e47" },
  WAITING: { bg: "#f6e3b0", fg: "#5e4300" },
  RESOLVED: { bg: "#d5ede4", fg: "#1f5e47" },
  CLOSED: { bg: "#e2e1dd", fg: "#4a4d4b" },
  REJECTED: { bg: "#f3dcd6", fg: "#8a2e1e" },
};
export const STATUS_TAG_DARK: Record<TicketStatus, { bg: string; fg: string }> = {
  NEW: { bg: "#f1ede4", fg: "#22252a" },
  ACKNOWLEDGED: { bg: "#9cc3d5", fg: "#22252a" },
  IN_PROGRESS: { bg: "#7fcbb4", fg: "#22252a" },
  WAITING: { bg: "#e9b949", fg: "#22252a" },
  RESOLVED: { bg: "#7fcbb4", fg: "#22252a" },
  CLOSED: { bg: "#c4c7c4", fg: "#22252a" },
  REJECTED: { bg: "#d98a7e", fg: "#22252a" },
};

/**
 * Nhãn trạng thái NHÌN TỪ PHÍA NGƯỜI GỬI. "Chờ bổ sung" đổi thành lời gọi thẳng
 * người đọc, vì đó là việc duy nhất mà nếu họ không làm thì phiếu đứng yên.
 */
export const STATUS_LABEL_REPORTER: Record<TicketStatus, string> = {
  ...STATUS_LABEL,
  WAITING: "Chờ thầy/cô bổ sung",
};

/**
 * Mức độ trình bày theo ẢNH HƯỞNG chứ không theo chữ "cao/thấp": người gửi
 * khó tự xếp mức độ, nhưng biết rõ công việc của mình bị ảnh hưởng ra sao.
 */
export const PRIORITY_IMPACT = {
  LOW: "Bất tiện nhỏ, có cách làm khác",
  NORMAL: "Làm chậm công việc nhưng vẫn làm được",
  HIGH: "Không làm được một việc quan trọng",
  URGENT: "Công việc dừng hẳn, cần xử lý ngay",
} as const;
