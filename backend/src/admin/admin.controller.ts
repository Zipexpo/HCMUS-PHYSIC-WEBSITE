import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminService } from './admin.service';
import {
  AddHeroBackgroundBodyDTO,
  AdminListQueryDTO,
  AdminListResDTO,
  AdminItemDTO,
  AdminMessageResDTO,
  CreateStaffBodyDTO,
  HeroBackgroundListResDTO,
  ResetAdminPasswordBodyDTO,
  UpdateAdminProfileBodyDTO,
} from './admin.dto';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import { IsPublic } from '../shared/decorators/auth.decorator';
import { ActiveUser } from '../shared/decorators/active-user.decorator';

@Controller('admins')
@Roles(RoleName.SuperAdmin)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Thư viện ảnh nền hero ──────────────────────────────────────────────────
  // GET công khai — phys-profile (token giảng viên) đọc để chọn nền; thêm/xoá
  // chỉ admin (kế thừa @Roles cấp class).
  @Get('hero-backgrounds')
  @IsPublic()
  @ZodSerializerDto(HeroBackgroundListResDTO)
  listHeroBackgrounds() {
    return this.adminService.listHeroBackgrounds();
  }

  @Post('hero-backgrounds')
  addHeroBackground(
    @Body() body: AddHeroBackgroundBodyDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.adminService.addHeroBackground(
      body.url,
      body.name ?? null,
      userId,
    );
  }

  @Delete('hero-backgrounds/:id')
  @ZodSerializerDto(AdminMessageResDTO)
  removeHeroBackground(@Param('id') id: string) {
    return this.adminService.removeHeroBackground(id);
  }

  @Get()
  @ZodSerializerDto(AdminListResDTO)
  list(@Query() query: AdminListQueryDTO) {
    return this.adminService.list(query);
  }

  /** Danh sách CÁN BỘ (giảng viên) — trang quản lý cán bộ, tách khỏi admin. */
  @Get('staff')
  @ZodSerializerDto(AdminListResDTO)
  listStaff(@Query() query: AdminListQueryDTO) {
    return this.adminService.listStaff(query);
  }

  /** Tạo CÁN BỘ (không mật khẩu — khác Create Admin). */
  @Post('staff')
  @ZodSerializerDto(AdminItemDTO)
  createStaff(@Body() body: CreateStaffBodyDTO) {
    return this.adminService.createStaff(body);
  }

  @Patch(':id/suspend')
  @ZodSerializerDto(AdminMessageResDTO)
  suspend(@Param('id') id: string) {
    return this.adminService.suspend(id);
  }

  @Patch(':id/restore')
  @ZodSerializerDto(AdminMessageResDTO)
  restore(@Param('id') id: string) {
    return this.adminService.restore(id);
  }

  @Post(':id/reset-password')
  @ZodSerializerDto(AdminMessageResDTO)
  resetPassword(
    @Param('id') id: string,
    @Body() body: ResetAdminPasswordBodyDTO,
  ) {
    return this.adminService.resetPassword(id, body);
  }

  /** Sửa hồ sơ tài khoản (Mục 10): ngạch/chức vụ/học vị/MSCB/đơn vị… */
  @Patch(':id/profile')
  @ZodSerializerDto(AdminItemDTO)
  updateProfile(
    @Param('id') id: string,
    @Body() body: UpdateAdminProfileBodyDTO,
  ) {
    return this.adminService.updateProfile(id, body);
  }
}
