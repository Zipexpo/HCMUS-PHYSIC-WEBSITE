import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { ActiveUser } from '../shared/decorators/active-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import type { AccessTokenPayload } from '../shared/types/jwt.type';
import {
  ChuyenKhoaBodySchema,
  DeNghiListResSchema,
  DeNghiResSchema,
  ListDeNghiQuerySchema,
  QuyetDeNghiBodySchema,
  TaoDeNghiBodySchema,
  TuChoiDeNghiBodySchema,
} from './de-nghi-sua.model';
import { DeNghiSuaService } from './de-nghi-sua.service';

class TaoDeNghiBodyDTO extends createZodDto(TaoDeNghiBodySchema) {}
class QuyetDeNghiBodyDTO extends createZodDto(QuyetDeNghiBodySchema) {}
class TuChoiDeNghiBodyDTO extends createZodDto(TuChoiDeNghiBodySchema) {}
class ChuyenKhoaBodyDTO extends createZodDto(ChuyenKhoaBodySchema) {}
class ListDeNghiQueryDTO extends createZodDto(ListDeNghiQuerySchema) {}
class DeNghiResDTO extends createZodDto(DeNghiResSchema) {}
class DeNghiListResDTO extends createZodDto(DeNghiListResSchema) {}

/**
 * Đề nghị chỉnh sửa công trình đã khai (Khoa chốt 20/11/2026) — xem
 * de-nghi-sua.service.ts. Mọi cán bộ có tài khoản đều gửi được; quyền quyết kiểm
 * trong service (người khai, hoặc quản trị Khoa khi đã chuyển / quá hạn).
 */
@Controller('scholar')
@Roles(RoleName.Lecturer, RoleName.Admin, RoleName.SuperAdmin)
export class DeNghiSuaController {
  constructor(private readonly service: DeNghiSuaService) {}

  @Post('publications/:id/edit-requests')
  @ZodSerializerDto(DeNghiResDTO)
  tao(
    @ActiveUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() body: TaoDeNghiBodyDTO,
  ) {
    return this.service.tao(user.userId, user.roleName, id, body);
  }

  @Get('publications/:id/edit-requests')
  @ZodSerializerDto(DeNghiListResDTO)
  theoBai(@ActiveUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.service.theoBai(user.userId, user.roleName, id);
  }

  @Get('edit-requests')
  @ZodSerializerDto(DeNghiListResDTO)
  danhSach(@ActiveUser() user: AccessTokenPayload, @Query() q: ListDeNghiQueryDTO) {
    return this.service.danhSach(user.userId, user.roleName, q);
  }

  @Post('edit-requests/:rid/accept')
  @ZodSerializerDto(DeNghiResDTO)
  chapNhan(
    @ActiveUser() user: AccessTokenPayload,
    @Param('rid') rid: string,
    @Body() body: QuyetDeNghiBodyDTO,
  ) {
    return this.service.chapNhan(user.userId, user.roleName, rid, body.response);
  }

  @Post('edit-requests/:rid/reject')
  @ZodSerializerDto(DeNghiResDTO)
  tuChoi(
    @ActiveUser() user: AccessTokenPayload,
    @Param('rid') rid: string,
    @Body() body: TuChoiDeNghiBodyDTO,
  ) {
    return this.service.tuChoi(user.userId, user.roleName, rid, body.response);
  }

  @Post('edit-requests/:rid/escalate')
  @ZodSerializerDto(DeNghiResDTO)
  chuyenKhoa(
    @ActiveUser() user: AccessTokenPayload,
    @Param('rid') rid: string,
    @Body() body: ChuyenKhoaBodyDTO,
  ) {
    return this.service.chuyenKhoa(user.userId, user.roleName, rid, body.note);
  }

  @Post('edit-requests/:rid/withdraw')
  @ZodSerializerDto(DeNghiResDTO)
  rut(@ActiveUser() user: AccessTokenPayload, @Param('rid') rid: string) {
    return this.service.rut(user.userId, user.roleName, rid);
  }
}
