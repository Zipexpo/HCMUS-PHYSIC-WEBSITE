import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repo';
import { ScholarModule } from '../scholar/scholar.module';

@Module({
  // ScholarModule cho StaffPageService — tạo cán bộ / gán đơn vị xong thì tự dựng
  // trang nhân sự cá nhân để người đó lên danh sách "Đội ngũ" công khai.
  imports: [ScholarModule],
  controllers: [AdminController],
  providers: [AdminService, AdminRepository],
})
export class AdminModule {}
