import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export const AdminNotFoundException = new NotFoundException([
  { field: 'id', error: 'Admin not found' },
]);

export const CannotMutateSuperAdminException = new ForbiddenException([
  { field: 'id', error: 'Cannot modify a super-admin account' },
]);

/** Đổi ngạch mà thiếu lý do hoặc ngày hiệu lực. */
export const RankChangeNeedsReasonException = new BadRequestException([
  {
    field: 'rankReason',
    error: 'Đổi ngạch phải ghi lý do và ngày có hiệu lực',
  },
]);
