import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ZodSerializerDto } from 'nestjs-zod';
import { PostService } from './post.service';
import {
  CloneIntoLayoutBodyDTO,
  PostDraftResDTO,
  PostResDTO,
  UpsertPostBodyDTO,
} from './post.dto';
import { IsPublic } from '../shared/decorators/auth.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RoleName } from '../shared/constants/role.constants';
import { ActiveUser } from '../shared/decorators/active-user.decorator';

const PUBLIC_LIST_TTL_MS = 5 * 60 * 1000;

const parseLimit = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 50);
};

@Controller('posts')
@Roles(RoleName.Admin, RoleName.SuperAdmin)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Get('public/latest')
  @IsPublic()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(PUBLIC_LIST_TTL_MS)
  listLatestPublic(
    @Query('limit') limit?: string,
    @Query('department') department?: string,
  ) {
    return this.postService.listLatestPublic(
      parseLimit(limit, 4),
      department ? { department: { slug: department } } : undefined,
    );
  }

  @Get('public/upcoming-events')
  @IsPublic()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(PUBLIC_LIST_TTL_MS)
  listUpcomingEventsPublic(
    @Query('limit') limit?: string,
    @Query('department') department?: string,
  ) {
    return this.postService.listUpcomingEventsPublic(
      parseLimit(limit, 4),
      department ? { department: { slug: department } } : undefined,
    );
  }

  @Get('public/list')
  @IsPublic()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(PUBLIC_LIST_TTL_MS)
  listPagedPublic(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('category') category?: string,
    @Query('department') department?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, Number(page) || 1);
    const sizeNum = Math.max(1, Math.min(48, Number(pageSize) || 12));
    return this.postService.listPagedPublic({
      page: pageNum,
      pageSize: sizeNum,
      category,
      department,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      search,
    });
  }

  @Post()
  @ZodSerializerDto(PostResDTO)
  create(
    @Body() body: UpsertPostBodyDTO,
    @ActiveUser('userId') userId: string,
    @ActiveUser('departmentId') departmentId: string | null,
    @ActiveUser('roleName') roleName: string,
  ) {
    return this.postService.create(body, userId, departmentId, roleName);
  }

  @Get()
  list(
    @ActiveUser('userId') userId: string,
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('deleted') deleted?: string,
  ) {
    if (page === undefined && pageSize === undefined)
      return this.postService.list(userId, roleName, departmentId);
    const pageNum = Math.max(1, Number(page) || 1);
    const sizeNum = Math.max(1, Math.min(100, Number(pageSize) || 12));
    return this.postService.listAdminPaged({
      page: pageNum,
      pageSize: sizeNum,
      category,
      status,
      search,
      userId,
      roleName,
      departmentId,
      deleted: deleted === 'true' || deleted === '1',
    });
  }

  // ── Kiểm duyệt bài của đơn vị ──────────────────────────────────────────
  // Hàng đợi bài chờ Khoa duyệt. Chỉ admin cấp Khoa gọi được (service tự chặn).
  @Get('pending-review')
  pendingReview(
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.listPendingReview(roleName, departmentId);
  }

  @Get(':id')
  @ZodSerializerDto(PostResDTO)
  findById(
    @Param('id') id: string,
    @ActiveUser('userId') userId: string,
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.findById(id, userId, roleName, departmentId);
  }

  @Patch(':id')
  @ZodSerializerDto(PostResDTO)
  update(
    @Param('id') id: string,
    @Body() body: UpsertPostBodyDTO,
    @ActiveUser('userId') userId: string,
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.update(id, body, userId, roleName, departmentId);
  }

  @Delete(':id')
  delete(
    @Param('id') id: string,
    @ActiveUser('userId') userId: string,
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.delete(id, userId, roleName, departmentId);
  }

  @Delete(':id/purge')
  purge(
    @Param('id') id: string,
    @ActiveUser('userId') userId: string,
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.purge(id, userId, roleName, departmentId);
  }

  @Post(':id/restore')
  restore(
    @Param('id') id: string,
    @ActiveUser('userId') userId: string,
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.restore(id, userId, roleName, departmentId);
  }

  // Trả bài về cho đơn vị sửa, kèm lý do. Duyệt thì dùng thẳng publish-layouts
  // (admin cấp Khoa không vướng cửa duyệt).
  @Post(':id/reject')
  rejectPost(
    @Param('id') id: string,
    @Body() body: { note?: string },
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.rejectPost(
      id,
      body?.note ?? '',
      roleName,
      departmentId,
    );
  }

  // Xuất bản / lên lịch các layout của bài ngay từ trình soạn bài, khỏi phải
  // chuyển sang trình sửa layout chỉ để bấm publish.
  @Post(':id/publish-layouts')
  publishLayouts(
    @Param('id') id: string,
    @Body() body: { scheduledAt?: string | null },
    @ActiveUser('userId') userId: string,
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.publishAttachedLayouts(
      id,
      userId,
      roleName,
      departmentId,
      body?.scheduledAt ? new Date(body.scheduledAt) : null,
    );
  }

  @Post(':id/clone-into-layout')
  @ZodSerializerDto(PostDraftResDTO)
  cloneIntoLayout(
    @Param('id') id: string,
    @Body() body: CloneIntoLayoutBodyDTO,
    @ActiveUser('userId') userId: string,
    @ActiveUser('roleName') roleName: string,
    @ActiveUser('departmentId') departmentId: string | null,
  ) {
    return this.postService.cloneIntoLayout(id, body, userId, roleName, departmentId);
  }
}
