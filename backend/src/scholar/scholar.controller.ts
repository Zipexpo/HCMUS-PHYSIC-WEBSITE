import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { diskStorage } from 'multer';
import { ZodSerializerDto } from 'nestjs-zod';
import { IsPublic } from '../shared/decorators/auth.decorator';
import { ActiveUser } from '../shared/decorators/active-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import {
  ClaimResponseBodyDTO,
  CreatePublicationBodyDTO,
  ImportFileBodyDTO,
  ImportPreviewResDTO,
  ListPublicationsQueryDTO,
  OrcidImportBodyDTO,
  PendingClaimListResDTO,
  PublicationListResDTO,
  PublicationResDTO,
  ResolveBodyDTO,
  ResolvePreviewResDTO,
  ScholarProfileResDTO,
  SetEducationBodyDTO,
  SetNameVariantsBodyDTO,
  CreateProjectBodyDTO,
  ListProjectsQueryDTO,
  PendingProjectListResDTO,
  ActivityListResDTO,
  ActivityResDTO,
  ActivityClaimListResDTO,
  RespondActivityClaimBodyDTO,
  CreateActivityBodyDTO,
  ListActivitiesQueryDTO,
  PeopleQueryDTO,
  PeopleResDTO,
  ProjectClaimBodyDTO,
  UpdateActivityBodyDTO,
  ProjectListResDTO,
  ProjectResDTO,
  StaffPageResDTO,
  DepartmentStaffResDTO,
  SyncStaffPageBodyDTO,
  UpdateProjectBodyDTO,
  StatsResDTO,
  FacultyDetailResDTO,
  FacultyReportResDTO,
  UpdateStaffPageBodyDTO,
  UpdatePublicationBodyDTO,
  UpdateScholarProfileBodyDTO,
} from './scholar.dto';
import { ScholarService } from './scholar.service';
import { StaffPageService } from './staff-page.service';
import { ProjectService } from './project.service';
import { ActivityService } from './activity.service';
import { PhotoRequiredException } from './scholar.error';

// Cùng thư mục và cùng cách đặt tên với module media, để ảnh chân dung nằm chung
// kho với mọi tệp khác của web Khoa (uploads/ được mount ra ngoài container).
const UPLOADS_DIR = join(process.cwd(), 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const FIVE_MINUTES_MS = 300_000;

/**
 * API của app hồ sơ khoa học (profile.phys.hcmus.edu.vn).
 *
 * Mở cho cả LECTURER lẫn admin: giảng viên khai bài của mình, admin văn phòng
 * khoa cần xem để tổng hợp. Phân quyền chi tiết nằm ở service — mỗi người chỉ
 * đọc/sửa được công trình mà họ là tác giả ĐÃ XÁC NHẬN.
 */
@Controller('scholar')
@Roles(RoleName.Lecturer, RoleName.Admin, RoleName.SuperAdmin)
export class ScholarController {
  constructor(
    private readonly service: ScholarService,
    private readonly staffPage: StaffPageService,
    private readonly projects: ProjectService,
    private readonly activities: ActivityService,
  ) {}

  // ── Đội ngũ bộ môn (công khai) ────────────────────────────────────────────
  // Trang danh sách nhân sự lấy đội ngũ MỘT bộ môn từ đây (khối
  // DepartmentStaffAuto). Không auth — dữ liệu vốn đã công khai trên trang. Nguồn
  // là các trang cá nhân dưới `{slug}/nhan-su/…`, nên ảnh/tên luôn khớp hồ sơ.
  @Get('public/department-staff/:slug')
  @IsPublic()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(FIVE_MINUTES_MS)
  @ZodSerializerDto(DepartmentStaffResDTO)
  departmentStaff(@Param('slug') slug: string) {
    return this.staffPage.departmentStaff(slug);
  }

  // ── Lý lịch khoa học ──────────────────────────────────────────────────────
  @Get('me')
  @ZodSerializerDto(ScholarProfileResDTO)
  me(@ActiveUser('userId') userId: string) {
    return this.service.getProfile(userId);
  }

  @Patch('me')
  @ZodSerializerDto(ScholarProfileResDTO)
  updateMe(
    @ActiveUser('userId') userId: string,
    @Body() body: UpdateScholarProfileBodyDTO,
  ) {
    return this.service.updateProfile(userId, body);
  }

  /** Bộ tên thường dùng khi đăng báo — nền của việc khớp tác giả. */
  @Patch('me/name-variants')
  @ZodSerializerDto(ScholarProfileResDTO)
  setNameVariants(
    @ActiveUser('userId') userId: string,
    @Body() body: SetNameVariantsBodyDTO,
  ) {
    return this.service.setNameVariants(userId, body);
  }

  /**
   * Quá trình đào tạo — thay cả danh sách một lần.
   *
   * Dòng nào máy đọc được từ trang nhân sự cũ thì đã nằm sẵn ở đây; người dùng
   * sửa lại rồi lưu là nó thành dòng chính chủ. Xem `setEducation()`.
   */
  @Patch('me/education')
  @ZodSerializerDto(ScholarProfileResDTO)
  setEducation(
    @ActiveUser('userId') userId: string,
    @Body() body: SetEducationBodyDTO,
  ) {
    return this.service.setEducation(userId, body);
  }

  // ── Nhập liệu ─────────────────────────────────────────────────────────────
  /** Dán DOI / link / arXiv / ISBN → xem trước, chưa lưu gì. */
  @Post('resolve')
  @ZodSerializerDto(ResolvePreviewResDTO)
  resolve(@ActiveUser('userId') userId: string, @Body() body: ResolveBodyDTO) {
    return this.service.resolveOne(userId, body.input);
  }

  /** Nội dung file .bib / .ris / CSL-JSON xuất từ Mendeley, Zotero, EndNote. */
  @Post('import/file')
  @ZodSerializerDto(ImportPreviewResDTO)
  importFile(
    @ActiveUser('userId') userId: string,
    @Body() body: ImportFileBodyDTO,
  ) {
    return this.service.importFile(userId, body.content);
  }

  @Post('import/orcid')
  @ZodSerializerDto(ImportPreviewResDTO)
  importOrcid(
    @ActiveUser('userId') userId: string,
    @Body() body: OrcidImportBodyDTO,
  ) {
    return this.service.importFromOrcid(userId, body);
  }

  // ── Công trình ────────────────────────────────────────────────────────────
  @Get('publications')
  @ZodSerializerDto(PublicationListResDTO)
  list(
    @ActiveUser('userId') userId: string,
    @Query() query: ListPublicationsQueryDTO,
  ) {
    return this.service.list(userId, query);
  }

  @Get('publications/:id')
  @ZodSerializerDto(PublicationResDTO)
  findOne(@ActiveUser('userId') userId: string, @Param('id') id: string) {
    return this.service.findOne(id, userId);
  }

  /** Trùng DOI với bài đã có thì KHÔNG tạo bản mới — chỉ gắn thêm người gọi. */
  @Post('publications')
  @ZodSerializerDto(PublicationResDTO)
  create(
    @ActiveUser('userId') userId: string,
    @Body() body: CreatePublicationBodyDTO,
  ) {
    return this.service.create(userId, body);
  }

  @Patch('publications/:id')
  @ZodSerializerDto(PublicationResDTO)
  update(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: UpdatePublicationBodyDTO,
  ) {
    return this.service.update(userId, id, body);
  }

  @Delete('publications/:id')
  remove(@ActiveUser('userId') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }

  // ── Xác nhận tác giả ──────────────────────────────────────────────────────
  /** Bài do đồng nghiệp gắn tên bạn vào, đang chờ bạn trả lời. */
  @Get('claims/pending')
  @ZodSerializerDto(PendingClaimListResDTO)
  pendingClaims(@ActiveUser('userId') userId: string) {
    return this.service.pendingClaims(userId);
  }

  @Post('claims/:publicationId')
  @ZodSerializerDto(PublicationResDTO)
  respond(
    @ActiveUser('userId') userId: string,
    @Param('publicationId') publicationId: string,
    @Body() body: ClaimResponseBodyDTO,
  ) {
    return this.service.respondToClaim(userId, publicationId, body);
  }

  // ── Đề tài, dự án NCKH (Bảng 2) ───────────────────────────────────────────
  @Get('projects')
  @ZodSerializerDto(ProjectListResDTO)
  listProjects(
    @ActiveUser('userId') userId: string,
    @Query() query: ListProjectsQueryDTO,
  ) {
    return this.projects.list(userId, query);
  }

  @Get('projects/:id')
  @ZodSerializerDto(ProjectResDTO)
  findProject(@ActiveUser('userId') userId: string, @Param('id') id: string) {
    return this.projects.findOne(id, userId);
  }

  /** Người khai mặc định là chủ nhiệm; thành viên được gắn tên phải tự xác nhận. */
  @Post('projects')
  @ZodSerializerDto(ProjectResDTO)
  createProject(
    @ActiveUser('userId') userId: string,
    @Body() body: CreateProjectBodyDTO,
  ) {
    return this.projects.create(userId, body);
  }

  @Patch('projects/:id')
  @ZodSerializerDto(ProjectResDTO)
  updateProject(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: UpdateProjectBodyDTO,
  ) {
    return this.projects.update(userId, id, body);
  }

  @Delete('projects/:id')
  removeProject(@ActiveUser('userId') userId: string, @Param('id') id: string) {
    return this.projects.remove(userId, id);
  }

  /** Người trong Khoa, để chọn làm thành viên đề tài. Không có tài khoản đơn vị. */
  @Get('people')
  @ZodSerializerDto(PeopleResDTO)
  people(@Query() query: PeopleQueryDTO) {
    return this.service.people(query.q);
  }

  // ── Hoạt động KHCN khác (Bảng 3) ────────────────────────────────────────
  //
  // Không có route xác nhận như công bố và đề tài: Bảng 3 tính giờ cố định cho
  // MỘT người, nên hoạt động là của riêng người khai, không ai phải xác nhận hộ.

  @Get('activities')
  @ZodSerializerDto(ActivityListResDTO)
  listActivities(
    @ActiveUser('userId') userId: string,
    @Query() query: ListActivitiesQueryDTO,
  ) {
    return this.activities.list(userId, query);
  }

  @Get('activities/:id')
  @ZodSerializerDto(ActivityResDTO)
  findActivity(@ActiveUser('userId') userId: string, @Param('id') id: string) {
    return this.activities.findOne(id, userId);
  }

  @Post('activities')
  @ZodSerializerDto(ActivityResDTO)
  createActivity(
    @ActiveUser('userId') userId: string,
    @Body() body: CreateActivityBodyDTO,
  ) {
    return this.activities.create(userId, body);
  }

  @Patch('activities/:id')
  @ZodSerializerDto(ActivityResDTO)
  updateActivity(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: UpdateActivityBodyDTO,
  ) {
    return this.activities.update(userId, id, body);
  }

  @Delete('activities/:id')
  removeActivity(
    @ActiveUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.activities.remove(userId, id);
  }

  /** Lời mời đồng thực hiện (giải thưởng) đang chờ chính mình xác nhận. */
  @Get('activity-claims/pending')
  @ZodSerializerDto(ActivityClaimListResDTO)
  pendingActivities(@ActiveUser('userId') userId: string) {
    return this.activities.pendingClaims(userId);
  }

  @Post('activity-claims/:activityId')
  respondActivity(
    @ActiveUser('userId') userId: string,
    @Param('activityId') activityId: string,
    @Body() body: RespondActivityClaimBodyDTO,
  ) {
    return this.activities.respondClaim(userId, activityId, body.accept);
  }

  @Get('project-claims/pending')
  @ZodSerializerDto(PendingProjectListResDTO)
  pendingProjects(@ActiveUser('userId') userId: string) {
    return this.projects.pending(userId);
  }

  @Post('project-claims/:projectId')
  @ZodSerializerDto(ProjectResDTO)
  respondProject(
    @ActiveUser('userId') userId: string,
    @Param('projectId') projectId: string,
    @Body() body: ProjectClaimBodyDTO,
  ) {
    return this.projects.respond(userId, projectId, body.accept, body.role);
  }

  // ── Trang nhân sự trên web Khoa ───────────────────────────────────────────
  /** Đọc nội dung trang nhân sự của CHÍNH người gọi. */
  @Get('me/staff-page')
  @ZodSerializerDto(StaffPageResDTO)
  readStaffPage(@ActiveUser('userId') userId: string) {
    return this.staffPage.read(userId);
  }

  /** Sửa nội dung trang đó. Trang công khai được dựng lại ngay sau khi ghi. */
  @Patch('me/staff-page')
  @ZodSerializerDto(StaffPageResDTO)
  updateStaffPage(
    @ActiveUser('userId') userId: string,
    @Body() body: UpdateStaffPageBodyDTO,
  ) {
    return this.staffPage.update(userId, body);
  }

  /** Sinh lại danh sách công bố (và đề tài) trên trang từ CSDL. */
  @Post('me/staff-page/sync')
  @ZodSerializerDto(StaffPageResDTO)
  syncStaffPage(
    @ActiveUser('userId') userId: string,
    @Body() body: SyncStaffPageBodyDTO,
  ) {
    return this.staffPage.syncFromDatabase(userId, body);
  }

  /**
   * Đổi ảnh chân dung. Cổng HẸP có chủ ý: module media chỉ mở cho quản trị, và
   * mở nó ra cho giảng viên nghĩa là họ duyệt lẫn xoá được toàn bộ kho ảnh của
   * Khoa. Ở đây chỉ làm đúng một việc — thay ảnh của chính mình.
   */
  @Post('me/staff-page/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) =>
          cb(
            null,
            `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
          ),
      }),
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        file.mimetype.startsWith('image/')
          ? cb(null, true)
          : cb(PhotoRequiredException, false),
    }),
  )
  @ZodSerializerDto(StaffPageResDTO)
  uploadPhoto(
    @ActiveUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw PhotoRequiredException;
    return this.staffPage.setPhoto(userId, `/uploads/${file.filename}`);
  }

  /**
   * Đồng bộ MỘT LƯỢT ảnh cho toàn bộ trang nhân sự — chỉ quản trị. Dùng cho người
   * đã upload ảnh trước khi có auto-sync (ảnh kẹt ở nháp / lưới danh sách còn ảnh
   * cũ). Chỉ đụng ảnh, không publish nội dung nháp khác.
   */
  @Post('staff-pages/backfill-photos')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  backfillStaffPhotos() {
    return this.staffPage.backfillPhotos();
  }

  /**
   * Chuẩn hoá trang cá nhân sang kiểu editorial (Header + StaffProfileEditorial +
   * Footer) cho mọi trang dưới `prefix` còn kiểu cũ — chỉ quản trị. Giữ nội dung,
   * bỏ PageHero. Idempotent.
   */
  @Post('staff-pages/migrate-editorial')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  migrateStaffEditorial(@Body('prefix') prefix?: string) {
    return this.staffPage.migrateStaffToEditorial(
      prefix || 'vat-ly-tin-hoc/nhan-su/',
    );
  }

  /**
   * Tự điền hồ sơ học thuật (ORCID / Scopus / Google Scholar / ResearcherID) từ
   * ScholarProfile vào các khối hồ sơ — chỉ quản trị. Ghép theo email; chỉ ghi đè
   * khi nguồn có giá trị (không xoá ID người dùng đã tự điền).
   */
  @Post('staff-pages/backfill-scholar-links')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  backfillScholarLinks() {
    return this.staffPage.backfillScholarLinks();
  }

  /**
   * Đặt ảnh nền hero (và tắt lọc ảnh nghệ thuật) cho mọi trang nhân sự của MỘT bộ
   * môn — chỉ quản trị. Body: { departmentId, heroBg }.
   */
  @Post('staff-pages/set-hero-bg')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  setHeroBgForDept(
    @Body('departmentId') departmentId: string,
    @Body('heroBg') heroBg: string,
  ) {
    return this.staffPage.setHeroBgForDept(departmentId, heroBg ?? '');
  }

  /**
   * Tạo trang nhân sự editorial cho người CÓ bộ môn + hồ sơ nhưng CHƯA có trang —
   * chỉ quản trị. `dryRun` xem trước slug sẽ tạo (không ghi); `limit`/`emails` để
   * làm mẫu hoặc chọn người. Giảng viên điền nội dung sau qua phys-profile.
   */
  @Post('staff-pages/create-missing')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  createMissingStaffPages(
    @ActiveUser('userId') userId: string,
    @Body('dryRun') dryRun?: boolean,
    @Body('limit') limit?: number,
    @Body('emails') emails?: string[],
    @Body('excludeEmails') excludeEmails?: string[],
  ) {
    return this.staffPage.createMissingStaffPages(userId, {
      dryRun,
      limit,
      emails,
      excludeEmails,
    });
  }

  /**
   * Lắp khối "Đội ngũ bộ môn (auto)" vào trang `{bộ-môn}/nhan-su` — thay lưới
   * ProfileCard dựng tay, GIỮ Navbar/PageHero/Footer của chính bộ môn. `department`
   * cho một bộ môn, `all` cho cả 8; `dryRun` xem trước. Chỉ quản trị.
   */
  @Post('staff-pages/apply-listing')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  applyListing(
    @Body('department') department?: string,
    @Body('all') all?: boolean,
    @Body('dryRun') dryRun?: boolean,
  ) {
    return this.staffPage.applyListingBlock({ department, all, dryRun });
  }

  /**
   * Lắp khối "Đội ngũ toàn Khoa" vào 2 trang cấp Khoa (cơ hữu / thỉnh giảng) —
   * thay HTML cũ. Chỉ quản trị.
   */
  @Post('staff-pages/apply-faculty')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  applyFaculty(@Body('dryRun') dryRun?: boolean) {
    return this.staffPage.applyFacultyPages({ dryRun });
  }

  /**
   * Thay khối `Header` (nav Khoa) bằng Navbar RIÊNG của bộ môn trên trang
   * `{bộ-môn}/nhan-su` và mọi hồ sơ cá nhân dưới đó — để nav trang nhân sự khớp
   * trang giới thiệu của bộ môn. `department` cho một bộ môn, `all` cho cả 8;
   * `dryRun` xem trước. Chỉ quản trị.
   */
  @Post('staff-pages/apply-dept-nav')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  applyDeptNav(
    @Body('department') department?: string,
    @Body('all') all?: boolean,
    @Body('dryRun') dryRun?: boolean,
  ) {
    return this.staffPage.applyDeptNav({ department, all, dryRun });
  }

  /**
   * NẠP LẦN ĐẦU hồ sơ nhân sự từ ACADsoom (Mục 10.7) — chỉ quản trị, chạy MỘT
   * lượt trước khi đổi web Khoa thành gốc. Cần ACADSOOM_BASE_URL + WEBKHOA_PULL_SECRET.
   */
  @Post('staff/initial-load')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  staffInitialLoad() {
    return this.service.staffInitialLoad();
  }

  // ── Thống kê ──────────────────────────────────────────────────────────────
  @Get('stats/me')
  @ZodSerializerDto(StatsResDTO)
  myStats(@ActiveUser('userId') userId: string) {
    return this.service.stats(userId);
  }

  /** Toàn Khoa — chỉ quản trị. */
  @Get('stats/faculty')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(StatsResDTO)
  facultyStats() {
    return this.service.stats();
  }

  /** Dữ liệu thô toàn Khoa (công bố + đề tài) cho trang thống kê — chỉ quản trị. */
  @Get('stats/faculty/detail')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(FacultyDetailResDTO)
  facultyDetail() {
    return this.service.facultyDetail();
  }

  /** Báo cáo chi tiết toàn Khoa (danh sách công bố + đề tài) để xuất Excel — chỉ quản trị. */
  @Get('stats/faculty/report')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(FacultyReportResDTO)
  facultyReport() {
    return this.service.facultyReport();
  }
}
