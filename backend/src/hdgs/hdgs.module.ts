import { Module } from '@nestjs/common';
import { HdgsController } from './hdgs.controller';
import { HdgsService } from './hdgs.service';

/** Bộ tính điểm HĐGS ngành Vật lý — module riêng, chỉ đọc dữ liệu công bố + lưu phần tự nhập. */
@Module({
  controllers: [HdgsController],
  providers: [HdgsService],
})
export class HdgsModule {}
