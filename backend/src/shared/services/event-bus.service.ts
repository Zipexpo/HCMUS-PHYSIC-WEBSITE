import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';

/**
 * Báo cho các app khác (ACADsoom, PHYsoom) biết dữ liệu ở web Khoa vừa đổi.
 *
 * KHÔNG dùng MQTT: các app kia chạy serverless trên Vercel, mỗi hàm chỉ sống
 * theo một request nên không giữ được kết nối để subscribe. Đẩy bằng HTTP.
 *
 * ── Webhook KHÔNG đảm bảo đồng bộ, và ở đây không giả vờ là có ──────────────
 * Gói tin có thể mất: bên nhận đang deploy, hàm nguội quá 8 giây, mạng rớt,
 * hoặc chính backend này khởi động lại giữa chừng. Thử lại vài lần chỉ giảm xác
 * suất mất, không khử được.
 *
 * Nên webhook ở đây chỉ là CÚ HÍCH cho nhanh. Bảo đảm nằm ở chỗ khác:
 * `GET /integration/publications?since=…` và `/integration/projects?since=…`
 * trả mọi thay đổi kể từ mốc bên nhận đang giữ, kèm cờ `removed`. Bên nhận gọi
 * nó khi nhận webhook (đường nhanh) VÀ theo lịch định kỳ (lưới an toàn). Mất
 * webhook thì lần chạy theo lịch kế tiếp vá lại — hệ thống tự lành, chứ không
 * phụ thuộc vào việc mỗi gói tin đều tới nơi.
 *
 * Sự kiện cố ý MỎNG: chỉ có loại, id, và những ai bị ảnh hưởng — KHÔNG kèm nội
 * dung. Hai lý do: đường webhook không phân quyền theo người dùng nên nhét dữ
 * liệu vào là phát tán; và payload dày sẽ lệch với CSDL ngay khi có bản cập
 * nhật tiếp theo. Bên nhận biết "có cái đổi rồi" rồi tự gọi API lấy bản mới
 * nhất, với đúng quyền của họ.
 */

export type DomainEvent = {
  /** publication.changed · project.changed · profile.changed · staff-page.changed */
  event: string;
  /** Id của bản ghi vừa đổi, nếu có. */
  id?: string | null;
  /** Những người bị ảnh hưởng — để bên nghe biết cần lấy lại của ai. */
  userIds?: string[];
  /** Chi tiết nhỏ, không nhạy cảm (vd slug trang vừa dựng lại). */
  key?: string | null;
  /**
   * Địa chỉ của chính những người bị ảnh hưởng — CHỈ cho sự kiện mà bên nhận
   * phải BÁO TIN cho họ (vd `publication.role-removed`). userId của web Khoa
   * không có nghĩa ở bên kia, còn địa chỉ công vụ thì vốn đã in trên trang nhân sự.
   */
  emails?: string[];
  at: string;
};

/** Giãn dần giữa các lần thử: bên nhận đang deploy thì vài giây sau mới sống lại. */
const RETRY_DELAYS_MS = [0, 2_000, 15_000];

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  /** Chỉ than phiền một lần cho mỗi đích — đừng làm ngập nhật ký. */
  private warned = new Set<string>();

  private readonly webhooks = (process.env.EVENT_WEBHOOKS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  private readonly secret = process.env.EVENT_WEBHOOK_SECRET ?? '';

  /**
   * Phát một sự kiện. KHÔNG await ở chỗ gọi, và cũng không có gì để await —
   * giảng viên bấm Lưu là xong, không phải chờ ACADsoom trả lời.
   */
  emit(event: string, data: Omit<DomainEvent, 'event' | 'at'> = {}): void {
    if (this.webhooks.length === 0) return;

    const payload: DomainEvent = {
      event,
      at: new Date().toISOString(),
      ...data,
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-event': event,
    };
    // Ký để bên nhận biết gói tin thật sự từ web Khoa — endpoint của họ mở ra
    // Internet, ai gửi cũng tới được.
    if (this.secret) {
      headers['x-signature'] = createHmac('sha256', this.secret)
        .update(body)
        .digest('hex');
    }

    for (const url of this.webhooks) {
      void this.deliver(url, headers, body);
    }
  }

  private async deliver(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<void> {
    let last = '';
    for (const wait of RETRY_DELAYS_MS) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) return;
        // 4xx là lỗi cấu hình (sai khoá, sai đường dẫn) — thử lại cũng vậy thôi.
        if (res.status >= 400 && res.status < 500) {
          this.warnOnce(url, `HTTP ${res.status}`);
          return;
        }
        last = `HTTP ${res.status}`;
      } catch (err: unknown) {
        last = err instanceof Error ? err.message : String(err);
      }
    }
    // Bỏ cuộc là ĐÚNG: bên nhận còn đường quét lại theo `?since=`, nên mất một
    // cú hích không có nghĩa là mất dữ liệu.
    this.warnOnce(url, `${last} — bỏ qua, chờ bên nhận quét lại theo ?since=`);
  }

  private warnOnce(url: string, msg: string) {
    if (this.warned.has(url)) return;
    this.warned.add(url);
    this.logger.warn(`Không gọi được webhook ${url}: ${msg}`);
  }
}
