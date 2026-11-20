import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsPublic } from '../shared/decorators/auth.decorator';
import { ActiveUser } from '../shared/decorators/active-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import type { AccessTokenPayload } from '../shared/types/jwt.type';
import { IntegrationSecretGuard } from './integration-secret.guard';
import { DON_DIR, ThoaThuanService } from './thoa-thuan.service';

class KhongDongYBodyDTO extends createZodDto(z.object({ reason: z.string().trim().min(10).max(2000) })) {}
class DanhSachQueryDTO extends createZodDto(
  z.object({
    hop: z.enum(['ky', 'lap']).default('ky'),
    tatCa: z
      .string()
      .optional()
      .transform((v) => v === '1' || v === 'true'),
  }),
) {}
class QuyetBodyDTO extends createZodDto(
  z.object({
    ok: z.boolean(),
    note: z.string().trim().max(2000).nullish(),
    by: z.string().trim().min(1).max(300),
  }),
) {}
class TichHopQueryDTO extends createZodDto(
  z.object({
    status: z
      .enum(['CHO_KY', 'CHO_DUYET', 'DA_DUYET', 'KHOA_TU_CHOI', 'BI_TU_CHOI_KY', 'HET_HIEU_LUC'])
      .optional(),
  }),
) {}

const banQuetStorage = diskStorage({
  destination: DON_DIR,
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});
const chiPdfHoacAnh = (
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, ok: boolean) => void,
) => {
  const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
  cb(ok ? null : new UnprocessableEntityException([{ field: 'file', error: 'Chỉ nhận PDF hoặc ảnh (JPG, PNG).' }]), ok);
};

const guiTep = (res: Response, f: { mimeType: string; originalName: string }, kieu: 'inline' | 'attachment') =>
  res.set({
    'Content-Type': f.mimeType,
    'Content-Disposition': `${kieu}; filename*=UTF-8''${encodeURIComponent(f.originalName)}`,
  });

/**
 * Đơn thoả thuận Cách 1 (Khoa chốt 20/11/2026) — phía người dùng phys-profile.
 * Đơn tự lập khi đại diện khai mới / đổi tỷ lệ (ScholarService gọi
 * ThoaThuanService.capNhatSauKhiLuu); ở đây chỉ xem, ký, không đồng ý, tải bản quét.
 */
@Controller('scholar')
@Roles(RoleName.Lecturer, RoleName.Admin, RoleName.SuperAdmin)
export class ThoaThuanController {
  constructor(private readonly service: ThoaThuanService) {}

  @Get('share-agreements')
  danhSach(@ActiveUser('userId') userId: string, @Query() q: DanhSachQueryDTO) {
    return this.service.danhSach(userId, q.hop, q.tatCa);
  }

  @Get('share-agreements/:id')
  mot(@ActiveUser() u: AccessTokenPayload, @Param('id') id: string) {
    return this.service.mot(id, u.userId, u.roleName);
  }

  @Get('publications/:id/share-agreement')
  cuaBai(@ActiveUser() u: AccessTokenPayload, @Param('id') id: string) {
    return this.service.cuaBai(id, u.userId, u.roleName);
  }

  @Post('share-agreements/:id/sign')
  ky(@ActiveUser() u: AccessTokenPayload, @Param('id') id: string) {
    return this.service.ky(id, u.userId, u.roleName);
  }

  @Post('share-agreements/:id/decline')
  khongDongY(@ActiveUser() u: AccessTokenPayload, @Param('id') id: string, @Body() body: KhongDongYBodyDTO) {
    return this.service.khongDongY(id, u.userId, u.roleName, body.reason);
  }

  @Post('share-agreements/:id/scan')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: banQuetStorage,
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: chiPdfHoacAnh,
    }),
  )
  taiBanQuet(
    @ActiveUser() u: AccessTokenPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new UnprocessableEntityException([{ field: 'file', error: 'Cần chọn tệp bản quét đơn có chữ ký.' }]);
    }
    return this.service.taiBanQuet(id, u.userId, u.roleName, file);
  }

  @Get('share-agreements/:id/scan')
  async banQuet(
    @ActiveUser() u: AccessTokenPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.service.banQuet(id, u.userId, u.roleName);
    guiTep(res, f, 'inline');
    return new StreamableFile(f.stream);
  }
}

/**
 * Kênh máy-với-máy cho hàng duyệt ACADsoom (cùng khoá x-acadsoom-secret như mọi
 * kênh tích hợp). Khoa duyệt / từ chối ở ACADsoom → ghi về đây → kênh NCKH gửi tỷ
 * lệ (đã duyệt) hoặc không gửi (chưa duyệt → Cách 2).
 */
@Controller('integration')
@IsPublic()
@UseGuards(IntegrationSecretGuard)
export class ThoaThuanIntegrationController {
  constructor(private readonly service: ThoaThuanService) {}

  @Get('share-agreements')
  danhSach(@Query() q: TichHopQueryDTO) {
    return this.service.tichHopDanhSach(q.status);
  }

  @Get('share-agreements/:id/scan')
  async banQuet(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const f = await this.service.banQuet(id);
    guiTep(res, f, 'inline');
    return new StreamableFile(f.stream);
  }

  @Post('share-agreements/:id/decision')
  quyet(@Param('id') id: string, @Body() body: QuyetBodyDTO) {
    return this.service.tichHopQuyet(id, { ok: body.ok, note: body.note, by: body.by });
  }
}
