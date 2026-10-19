import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodSerializerDto } from 'nestjs-zod';
import { ActiveUser } from '../shared/decorators/active-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import {
  ApDungBodyDTO,
  ApDungResDTO,
  GoiYQueryDTO,
  GoiYResDTO,
  LechQueryDTO,
  LechResDTO,
  NapBangBodyDTO,
  NapBangResDTO,
  TaiCoreResDTO,
  TinhTrangBangResDTO,
} from './xep-hang.dto';
import { XepHangService } from './xep-hang.service';

/**
 * Bảng xếp hạng SCImago / CORE — GỢI Ý mã Phụ lục 2 lúc khai công bố.
 * Giảng viên chỉ đọc gợi ý; nạp bảng là việc của quản trị (mỗi năm một lần).
 */
@Controller('scholar/rankings')
@Roles(RoleName.Lecturer, RoleName.Admin, RoleName.SuperAdmin)
export class XepHangController {
  constructor(private readonly xepHang: XepHangService) {}

  @Get('suggest')
  @ZodSerializerDto(GoiYResDTO)
  goiY(@Query() q: GoiYQueryDTO) {
    return this.xepHang.goiY(q);
  }

  @Get('status')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(TinhTrangBangResDTO)
  tinhTrang() {
    return this.xepHang.tinhTrang();
  }

  /**
   * Nạp tệp CSV tải từ SCImago ("Download data" ở journalrank.php, KHÔNG lọc) hoặc
   * CORE (nút Export ở portal.core.edu.au/conf-ranks). Bảng SJR đầy đủ ~11 MB.
   */
  @Post('import')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 40 * 1024 * 1024 } }),
  )
  @ZodSerializerDto(NapBangResDTO)
  nap(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: NapBangBodyDTO,
  ) {
    if (!file?.buffer?.length) {
      throw new UnprocessableEntityException([
        { field: 'file', error: 'Chọn tệp CSV để nạp.' },
      ]);
    }
    const text = file.buffer.toString('utf8');
    return body.loai === 'sjr'
      ? this.xepHang.napSjr(text)
      : this.xepHang.napCore(text);
  }

  /**
   * Tải CORE thẳng từ portal.core.edu.au (hai phiên bản mới nhất) — khỏi tải tệp
   * bằng tay. Ngày 2 hằng tháng máy chủ cũng tự kiểm phiên bản mới (xem service).
   */
  @Post('core/auto')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(TaiCoreResDTO)
  taiCore() {
    return this.xepHang.taiCore(true);
  }

  /** Bài có mã khác bảng xếp hạng trong một khoảng tháng — soát cả Khoa một lượt. */
  @Get('lech')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(LechResDTO)
  lech(@Query() q: LechQueryDTO) {
    return this.xepHang.lechMa(q.tu, q.den);
  }

  /** Áp mã của bảng cho một bài lệch (ghi AuditLog, báo ACADsoom đồng bộ lại). */
  @Post('lech/:id/ap-dung')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(ApDungResDTO)
  apDung(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: ApDungBodyDTO,
  ) {
    return this.xepHang.apDungMa(userId, id, body.tuMa);
  }
}
