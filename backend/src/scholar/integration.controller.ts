import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { IsPublic } from '../shared/decorators/auth.decorator';
import {
  IntegrationProjectResDTO,
  IntegrationActivityResDTO,
  IntegrationPublicationResDTO,
  IntegrationGradStudyResDTO,
  IntegrationStaffResDTO,
  IntegrationQueryDTO,
} from './scholar.dto';
import { IntegrationSecretGuard } from './integration-secret.guard';
import { ScholarService } from './scholar.service';
import { ProjectService } from './project.service';
import { ActivityService } from './activity.service';

/**
 * Kênh máy-với-máy cho ACADsoom.
 *
 * @IsPublic() ở đây KHÔNG có nghĩa là mở: nó tắt lớp xác thực bằng phiên đăng
 * nhập, rồi IntegrationSecretGuard chắn lại bằng khoá bí mật dùng chung. Không
 * có khoá thì endpoint từ chối phục vụ.
 *
 * Trả DỮ KIỆN, không trả giờ quy đổi — hệ số là quy định của Trường/Khoa, đã cài
 * ở ACADsoom (src/lib/nv2Hours.js). Và chỉ trả bài ĐÃ PHÂN LOẠI: bài chưa chọn
 * mã Phụ lục 2 không tồn tại đối với ACADsoom, nên "không chỉnh thì không được
 * tính" là ràng buộc dữ liệu chứ không phải lời nhắc trên giao diện.
 */
@Controller('integration')
@IsPublic()
@UseGuards(IntegrationSecretGuard)
export class ScholarIntegrationController {
  constructor(
    private readonly service: ScholarService,
    private readonly projects: ProjectService,
    private readonly activities: ActivityService,
  ) {}

  @Get('publications')
  @ZodSerializerDto(IntegrationPublicationResDTO)
  publications(@Query() query: IntegrationQueryDTO) {
    return this.service.integrationList(query);
  }

  /** Hoạt động KHCN khác — Bảng 3. Giờ cố định cho một người, không chia. */
  @Get('activities')
  @ZodSerializerDto(IntegrationActivityResDTO)
  listActivities(@Query() query: IntegrationQueryDTO) {
    return this.activities.integrationList(query);
  }

  /** Đề tài đã chọn mã Bảng 2, thành viên đã xác nhận. Không trả giờ. */
  @Get('projects')
  @ZodSerializerDto(IntegrationProjectResDTO)
  listProjects(@Query() query: IntegrationQueryDTO) {
    return this.projects.integrationList(query);
  }

  /**
   * Tệp MINH CHỨNG của đề tài — để ACADsoom proxy cho người duyệt xem thẳng,
   * khỏi bắt tải lại thứ đã có bên web Khoa. Chắn bằng x-acadsoom-secret
   * (IntegrationSecretGuard) chứ không phải phiên người dùng; `inline` để mở
   * ngay trong trình duyệt.
   */
  @Get('projects/:projectId/evidences/:evidenceId/file')
  async projectEvidenceFile(
    @Param('projectId') projectId: string,
    @Param('evidenceId') evidenceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.projects.integrationEvidenceFile(
      projectId,
      evidenceId,
    );
    res.set({
      'Content-Type': f.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(
        f.originalName,
      )}`,
    });
    return new StreamableFile(f.stream);
  }

  /**
   * Diện đang học sau đại học. Kéo giảm định mức ở ACADsoom (tới 50% + giờ
   * chuẩn), nên là dữ kiện tính toán chứ không phải nhãn. ACADsoom gán vào
   * `Term.hocTap` theo bậc + quốc gia, và tự cắt theo cửa sổ năm học.
   */
  @Get('grad-study')
  @ZodSerializerDto(IntegrationGradStudyResDTO)
  gradStudy(@Query() query: IntegrationQueryDTO) {
    return this.service.gradStudyIntegrationList(query);
  }

  /**
   * Hồ sơ nhân sự (Mục 10) — web Khoa LÀM CHỦ, ACADsoom kéo về không sửa. Trả
   * dữ kiện người + đơn vị, KHÔNG trả giờ/định mức.
   */
  @Get('staff')
  @ZodSerializerDto(IntegrationStaffResDTO)
  staff(@Query() query: IntegrationQueryDTO) {
    return this.service.staffIntegrationList(query);
  }
}
