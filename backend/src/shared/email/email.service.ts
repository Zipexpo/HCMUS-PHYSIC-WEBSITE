import { Injectable, Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import envConfig from '../config/config';
import { otpTemplate } from './templates/otp.template';
import { notificationTemplate } from './templates/notification.template';

/**
 * Gửi thư. Nhà cung cấp chọn bằng BIẾN MÔI TRƯỜNG `MAIL_PROVIDER`, không phải
 * bằng code — đổi nhà cung cấp sau này chỉ là sửa `.env` rồi khởi động lại.
 *
 * Mặc định là Resend: miễn phí tới 3.000 thư/tháng, không cần thẻ tín dụng,
 * không phải xin ra khỏi chế độ sandbox như AWS SES. Đường SES vẫn giữ nguyên
 * để lùi lại được.
 *
 * Resend gọi thẳng bằng `fetch` chứ không thêm thư viện: REST API của họ chỉ có
 * một endpoint, mà mỗi gói phụ thuộc là thêm dung lượng ảnh và thời gian build
 * — máy chủ đang rất chật đĩa.
 */

export class EmailNotConfiguredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EmailNotConfiguredError';
  }
}

export class EmailSendError extends Error {
  constructor(
    msg: string,
    readonly provider: string,
    readonly status?: number,
  ) {
    super(msg);
    this.name = 'EmailSendError';
  }
}

type Mail = { to: string; subject: string; html: string };

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private sesClient?: SESClient;

  /** Địa chỉ gửi. MAIL_FROM là chính, SES_FROM_ADDRESS giữ cho cấu hình cũ. */
  private get from(): string {
    const v = envConfig.MAIL_FROM || envConfig.SES_FROM_ADDRESS;
    if (!v) {
      throw new EmailNotConfiguredError(
        'Chưa khai MAIL_FROM — không biết gửi thư từ địa chỉ nào.',
      );
    }
    return v;
  }

  private async sendViaResend({ to, subject, html }: Mail): Promise<void> {
    const key = envConfig.RESEND_API_KEY;
    if (!key) {
      throw new EmailNotConfiguredError(
        'Chưa khai RESEND_API_KEY — không gửi thư được.',
      );
    }

    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to: [to], subject, html }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new EmailSendError(
        `Không gọi được Resend: ${(e as Error).message}`,
        'resend',
      );
    }

    if (!res.ok) {
      // In nguyên lời Resend nói: lỗi hay gặp là tên miền chưa xác minh hoặc
      // vượt 100 thư/ngày của gói miễn phí, và chỉ đọc đúng câu đó mới biết.
      const body = await res.text().catch(() => '');
      throw new EmailSendError(
        `Resend từ chối (HTTP ${res.status}): ${body.slice(0, 300)}`,
        'resend',
        res.status,
      );
    }
  }

  private async sendViaSes({ to, subject, html }: Mail): Promise<void> {
    const id = envConfig.AWS_ACCESS_KEY_ID;
    const secret = envConfig.AWS_SECRET_ACCESS_KEY;
    if (!id || !secret) {
      throw new EmailNotConfiguredError(
        'MAIL_PROVIDER=ses nhưng chưa khai khoá AWS.',
      );
    }
    this.sesClient ??= new SESClient({
      region: envConfig.AWS_REGION,
      credentials: { accessKeyId: id, secretAccessKey: secret },
    });
    try {
      await this.sesClient.send(
        new SendEmailCommand({
          Source: this.from,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' } },
          },
        }),
      );
    } catch (e) {
      throw new EmailSendError(`SES từ chối: ${(e as Error).message}`, 'ses');
    }
  }

  private async send(mail: Mail): Promise<void> {
    const provider = envConfig.MAIL_PROVIDER;
    try {
      if (provider === 'ses') await this.sendViaSes(mail);
      else await this.sendViaResend(mail);
    } catch (e) {
      // Ghi log KÈM nhà cung cấp và địa chỉ nhận. Lần trước mất khá lâu mới
      // lần ra là khoá AWS hỏng, vì lỗi chỉ hiện ở tầng gọi.
      this.logger.error(
        `Gửi thư thất bại [${provider}] tới ${mail.to}: ${(e as Error).message}`,
      );
      throw e;
    }
  }

  sendOTP(to: string, code: string) {
    return this.send({
      to,
      subject: `Mã đăng nhập ${code} — Khoa Vật lý`,
      html: otpTemplate({ code, expiresIn: envConfig.OTP_EXPIRES_IN }),
    });
  }

  sendNotification({
    to,
    title,
    message,
    link,
  }: {
    to: string;
    title: string;
    message: string;
    link?: string;
  }) {
    return this.send({
      to,
      subject: `Khoa Vật lý — ${title}`,
      html: notificationTemplate({ title, message, link }),
    });
  }
}
