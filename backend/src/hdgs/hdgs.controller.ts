import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { ActiveUser } from '../shared/decorators/active-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import { XemThongKeGuard } from '../scholar/xem-thong-ke.guard';
import { HdgsQuerySchema, NhapTayBodySchema } from './hdgs.model';
import { HdgsService } from './hdgs.service';

class HdgsQueryDTO extends createZodDto(HdgsQuerySchema) {}
class NhapTayBodyDTO extends createZodDto(NhapTayBodySchema) {}

/**
 * Bộ tính điểm HĐGS ngành Vật lý (Khoa chốt 20/11/2026): mỗi cán bộ xem và nhập
 * phần của mình; Khoa (admin hoặc canViewStats — XemThongKeGuard) xem cả Khoa.
 */
@Controller('scholar/hdgs')
@Roles(RoleName.Lecturer, RoleName.Admin, RoleName.SuperAdmin)
export class HdgsController {
  constructor(private readonly service: HdgsService) {}

  @Get('luat')
  luat() {
    return this.service.luat();
  }

  @Get('me')
  cuaToi(@ActiveUser('userId') userId: string, @Query() q: HdgsQueryDTO) {
    return this.service.cuaToi(userId, q);
  }

  @Put('me/:publicationId')
  luu(
    @ActiveUser('userId') userId: string,
    @Param('publicationId') publicationId: string,
    @Body() body: NhapTayBodyDTO,
  ) {
    return this.service.luuNhapTay(userId, publicationId, body);
  }

  @Get('faculty')
  @UseGuards(XemThongKeGuard)
  caKhoa(@Query() q: HdgsQueryDTO) {
    return this.service.caKhoa(q);
  }

  @Get('faculty/:userId')
  @UseGuards(XemThongKeGuard)
  cuaNguoi(@Param('userId') userId: string, @Query() q: HdgsQueryDTO) {
    return this.service.cuaNguoi(userId, q);
  }
}
