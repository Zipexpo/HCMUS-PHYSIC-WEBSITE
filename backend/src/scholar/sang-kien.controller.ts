import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';
import { ActiveUser } from '../shared/decorators/active-user.decorator';
import { IsPublic } from '../shared/decorators/auth.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import { IntegrationSecretGuard } from './integration-secret.guard';
import { IntegrationQueryDTO } from './scholar.dto';
import { XemThongKeGuard } from './xem-thong-ke.guard';
import {
  CreateSangKienBodySchema,
  DanhSachDuyetQuerySchema,
  DuyetBodySchema,
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
import { SangKienService } from './sang-kien.service';

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
