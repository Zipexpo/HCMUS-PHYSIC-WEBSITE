import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';
import { ActiveUser } from '../shared/decorators/active-user.decorator';
import { IsPublic } from '../shared/decorators/auth.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import type { AccessTokenPayload } from '../shared/types/jwt.type';
import { IntegrationSecretGuard } from './integration-secret.guard';
import { IntegrationQueryDTO } from './scholar.dto';
import { XemThongKeGuard } from './xem-thong-ke.guard';
import {
  CreateSangKienBodySchema,
  DanhSachDuyetQuerySchema,
  DongBoTrangBodySchema,
  DuyetBodySchema,
  HienTrenWebBodySchema,
  TaiLenTepQdBodySchema,
  TepQdListResSchema,
  TepQdQuerySchema,
  IntegrationSangKienResSchema,
  LoiMoiSangKienResSchema,
  NhanTenBodySchema,
  SangKienListResSchema,
  SangKienResSchema,
  TraLoiMoiBodySchema,
  TraMaQuerySchema,
  TraMaResSchema,
  UpdateSangKienBodySchema,
} from './sang-kien.model';
import { SK_EVIDENCE_DIR, SangKienService } from './sang-kien.service';

const minhChungStorage = diskStorage({
  destination: SK_EVIDENCE_DIR,
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});
const chiPdfHoacAnh = (
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, ok: boolean) => void,
) => {
  const ok = file.mimetype === 'application/pdf' || file.mimetype === 'image/png' || file.mimetype === 'image/jpeg';
  cb(ok ? null : new UnprocessableEntityException([{ field: 'file', error: 'Chỉ nhận PDF hoặc ảnh (JPG, PNG).' }]), ok);
};
class HienTrenWebBodyDTO extends createZodDto(HienTrenWebBodySchema) {}
class TepQdQueryDTO extends createZodDto(TepQdQuerySchema) {}
class TepQdListResDTO extends createZodDto(TepQdListResSchema) {}
class TaiLenTepQdBodyDTO extends createZodDto(TaiLenTepQdBodySchema) {}
class DongBoTrangBodyDTO extends createZodDto(DongBoTrangBodySchema) {}

class CreateSangKienBodyDTO extends createZodDto(CreateSangKienBodySchema) {}
class UpdateSangKienBodyDTO extends createZodDto(UpdateSangKienBodySchema) {}
class ListSangKienQueryDTO extends createZodDto(z.object({ q: z.string().max(200).optional() })) {}
class TraMaQueryDTO extends createZodDto(TraMaQuerySchema) {}
class NhanTenBodyDTO extends createZodDto(NhanTenBodySchema) {}
class TraLoiMoiBodyDTO extends createZodDto(TraLoiMoiBodySchema) {}
class SangKienResDTO extends createZodDto(SangKienResSchema) {}
class SangKienListResDTO extends createZodDto(SangKienListResSchema) {}
class TraMaResDTO extends createZodDto(TraMaResSchema) {}
class LoiMoiSangKienResDTO extends createZodDto(LoiMoiSangKienResSchema) {}
class IntegrationSangKienResDTO extends createZodDto(IntegrationSangKienResSchema) {}
class DanhSachDuyetQueryDTO extends createZodDto(DanhSachDuyetQuerySchema) {}
class DuyetBodyDTO extends createZodDto(DuyetBodySchema) {}

/**
 * Sáng kiến được công nhận — phía người dùng phys-profile. Xem SangKienService.
 * Đường `lookup` và `initiative-claims` đặt TRƯỚC `initiatives/:id`.
 */
@Controller('scholar')
@Roles(RoleName.Lecturer, RoleName.Admin, RoleName.SuperAdmin)
export class SangKienController {
  constructor(private readonly service: SangKienService) {}

  @Get('initiatives')
  @ZodSerializerDto(SangKienListResDTO)
  list(@ActiveUser('userId') userId: string, @Query() q: ListSangKienQueryDTO) {
    return this.service.list(userId, q.q);
  }

  /** Tra mã số trước khi khai — đã có thì mời gắn tên thay vì khai bản thứ hai. */
  @Get('initiatives/lookup')
  @ZodSerializerDto(TraMaResDTO)
  traMa(@ActiveUser('userId') userId: string, @Query() q: TraMaQueryDTO) {
    return this.service.traMa(q.code, userId);
  }

  /** Quản trị Khoa: sáng kiến chờ duyệt (mặc định) / đã từ chối / đã duyệt. */
  @Get('initiatives/review')
  @UseGuards(XemThongKeGuard)
  @ZodSerializerDto(SangKienListResDTO)
  danhSachDuyet(@Query() q: DanhSachDuyetQueryDTO) {
    return this.service.danhSachDuyet(q.status);
  }

  /** Quản trị Khoa quyết: duyệt, hoặc không duyệt (bắt buộc lý do). */
  @Post('initiatives/:id/review')
  @UseGuards(XemThongKeGuard)
  @ZodSerializerDto(SangKienResDTO)
  duyet(@ActiveUser('userId') userId: string, @Param('id') id: string, @Body() body: DuyetBodyDTO) {
    return this.service.duyet(userId, id, body.ok, body.note);
  }

  /**
   * Quản trị: đưa mục «Sáng kiến» lên trang nhân sự của MỌI người có tên (một lượt
   * sau khi Khoa nạp danh sách). Chỉ thay dòng do máy sinh, không xuất bản nháp.
   */
  @Post('initiatives-staff-pages/sync')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  dongBoTrang(@Body() body: DongBoTrangBodyDTO) {
    return this.service.dongBoTrangTatCa(body.dryRun ?? false);
  }

  // ── Minh chứng DÙNG CHUNG theo quyết định (tải một lần cho cả QĐ) ──────────
  /** Tệp đã có của một QĐ (số + ngày) — form khai mới hỏi trước để khỏi tải lại. */
  @Get('decision-files')
  @ZodSerializerDto(TepQdListResDTO)
  tepCuaQd(@Query() q: TepQdQueryDTO) {
    return this.service.tepCuaQuyetDinh(q.decisionNo, q.decisionDate);
  }

  /** Đọc một tệp minh chứng — ai đăng nhập cũng xem được. */
  @Get('decision-files/:fileId')
  async docTepQd(
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.service.docTepQd(fileId);
    res.set({
      'Content-Type': f.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.originalName)}`,
    });
    return new StreamableFile(f.stream);
  }

  /** Gỡ tệp tải nhầm — người đã tải hoặc quản trị Khoa. */
  @Delete('decision-files/:fileId')
  async goTepQd(@ActiveUser() u: AccessTokenPayload, @Param('fileId') fileId: string) {
    return this.service.goTepQd(u.userId, await this.service.laQuanTri(u.userId, u.roleName), fileId);
  }

  /**
   * Tải tệp minh chứng cho QĐ của sáng kiến này (PDF hoặc ảnh, ≤ 50 MB) — dùng chung
   * cho MỌI sáng kiến cùng số QĐ + năm. Tác giả đã xác nhận hoặc quản trị Khoa.
   */
  @Post('initiatives/:id/decision-files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: minhChungStorage,
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: chiPdfHoacAnh,
    }),
  )
  @ZodSerializerDto(SangKienResDTO)
  async taiLenTepQd(
    @ActiveUser() u: AccessTokenPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: TaiLenTepQdBodyDTO,
  ) {
    if (!file) {
      throw new UnprocessableEntityException([{ field: 'file', error: 'Cần chọn một tệp minh chứng.' }]);
    }
    const qt = await this.service.laQuanTri(u.userId, u.roleName);
    return this.service.taiLenTepQd(u.userId, qt, id, file, body.label);
  }

  /** Bật / tắt hiện sáng kiến này trên trang nhân sự của chính mình. */
  @Patch('initiatives/:id/show-on-web')
  doiHienTrenWeb(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: HienTrenWebBodyDTO,
  ) {
    return this.service.doiHienTrenWeb(userId, id, body.showOnWeb);
  }

  @Get('initiatives/:id')
  @ZodSerializerDto(SangKienResDTO)
  findOne(@ActiveUser('userId') userId: string, @Param('id') id: string) {
    return this.service.findOne(id, userId);
  }

  @Post('initiatives')
  @ZodSerializerDto(SangKienResDTO)
  create(@ActiveUser('userId') userId: string, @Body() body: CreateSangKienBodyDTO) {
    return this.service.create(userId, body);
  }

  @Patch('initiatives/:id')
  @ZodSerializerDto(SangKienResDTO)
  update(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: UpdateSangKienBodyDTO,
  ) {
    return this.service.update(userId, id, body);
  }

  /** «Rút tên» — không còn ai đã xác nhận thì sáng kiến bị xoá mềm. */
  @Delete('initiatives/:id')
  remove(@ActiveUser('userId') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }

  /** «Tôi là tác giả — gắn tên tôi» vào sáng kiến người khác đã khai. */
  @Post('initiatives/:id/join')
  @ZodSerializerDto(SangKienResDTO)
  nhanTen(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: NhanTenBodyDTO,
  ) {
    return this.service.nhanTen(userId, id, body.authorId);
  }

  @Get('initiative-claims/pending')
  @ZodSerializerDto(LoiMoiSangKienResDTO)
  loiMoi(@ActiveUser('userId') userId: string) {
    return this.service.loiMoi(userId);
  }

  @Post('initiative-claims/:id')
  traLoi(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: TraLoiMoiBodyDTO,
  ) {
    return this.service.traLoiMoi(userId, id, body.accept);
  }
}

/**
 * Kênh máy-với-máy cho ACADsoom — cùng khoá bí mật với /integration/publications.
 * Trả DỮ KIỆN, không trả điểm: tính vào Mục I 3a / phiếu 2C C26 là việc của ACADsoom.
 */
@Controller('integration')
@IsPublic()
@UseGuards(IntegrationSecretGuard)
export class SangKienIntegrationController {
  constructor(private readonly service: SangKienService) {}

  @Get('initiatives')
  @ZodSerializerDto(IntegrationSangKienResDTO)
  list(@Query() query: IntegrationQueryDTO) {
    return this.service.integrationList(query);
  }
}
