import { Injectable, UnauthorizedException } from '@nestjs/common';
import { addMilliseconds } from 'date-fns';
import ms, { type StringValue } from 'ms';
import { HashingService } from '../shared/services/hashing.service';
import { TokenService } from '../shared/services/token.service';
import { AuthRepository } from './auth.repo';
import {
  LoginBodyType,
  RefreshTokenResType,
  CreateAdminBodyType,
  SendOTPBodyType,
  VerifyOTPBodyType,
  ForgotPasswordBodyType,
  UpdateProfileBodyType,
  ChangePasswordBodyType,
  SetStarredBodyType,
} from './auth.model';
import { RoleName } from '../shared/constants/role.constants';
import { VerificationMethod } from '../shared/constants/auth.constants';
import {
  InvalidEmailException,
  InvalidPasswordException,
  InactiveAccountException,
  EmailAlreadyExistsException,
  DepartmentNotFoundException,
  InvalidOTPException,
  ExpiredOTPException,
  CurrentPasswordMismatchException,
  SamePasswordException,
} from './auth.error';
import { CreateAccessTokenPayload } from '../shared/types/jwt.type';
import { DepartmentRepository } from '../department/department.repo';
import { EmailService } from '../shared/email/email.service';
import { generateOTP, toSlug } from '../shared/helpers';
import envConfig from '../shared/config/config';
import { VerificationCodeType } from '../generated/prisma/client';
import {
  SsoTokenError,
  splitVietnameseName,
  laEmailSinhVien,
  verifyPhysoomToken,
} from './physoom-sso';

@Injectable()
export class AuthService {
  constructor(
    private readonly hashingService: HashingService,
    private readonly tokenService: TokenService,
    private readonly authRepository: AuthRepository,
    private readonly departmentRepository: DepartmentRepository,
    private readonly emailService: EmailService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.authRepository.findUniqueUserById(userId);
    if (!user) throw InvalidEmailException;
    this.authRepository.touchLastLogin(userId).catch(() => undefined);
    return {
      ...user,
      starredLayoutIds: user.preference?.starredLayoutIds ?? [],
      starredWidgetIds: user.preference?.starredWidgetIds ?? [],
    };
  }

  async setStarred(userId: string, body: SetStarredBodyType) {
    return this.authRepository.setStarred(userId, {
      starredLayoutIds: body.layoutIds,
      starredWidgetIds: body.widgetIds,
    });
  }

  async login(body: LoginBodyType) {
    const user = await this.authRepository.findUniqueUserByEmail(body.email);
    if (!user) throw InvalidEmailException;
    if (!user.isActive) throw InactiveAccountException;
    if (!user.password) throw InvalidPasswordException;
    const isPasswordMatch = await this.hashingService.compare(
      body.password,
      user.password,
    );
    if (!isPasswordMatch) throw InvalidPasswordException;
    await this.authRepository.touchLastLogin(user.id);
    return this.generateTokens({
      userId: user.id,
      roleName: user.role as RoleName,
      departmentId: user.departmentId,
    });
  }

  async createAdmin(body: CreateAdminBodyType) {
    const existing = await this.authRepository.findUniqueUserByEmail(
      body.email,
    );
    if (existing) throw EmailAlreadyExistsException;

    let departmentId = body.departmentId;
    if (departmentId) {
      const department = await this.departmentRepository.findById(departmentId);
      if (!department) throw DepartmentNotFoundException;
    } else if (body.newDepartmentName) {
      const name = body.newDepartmentName.trim();
      const slug = toSlug(name);
      const created = await this.departmentRepository.create({ name, slug });
      departmentId = created.id;
    }

    const hashedPassword = await this.hashingService.hash(body.password);
    return this.authRepository.createUser({
      email: body.email,
      password: hashedPassword,
      firstName: body.firstName,
      lastName: body.lastName,
      role: RoleName.Admin,
      phone: body.phone,
      position: body.position,
      bio: body.bio,
      departmentId,
      avatarUrl: body.avatarUrl,
    });
  }

  async updateProfile(userId: string, body: UpdateProfileBodyType) {
    const { departmentName, ...rest } = body;
    let departmentId: string | null | undefined;
    if (departmentName !== undefined) {
      const trimmed = departmentName?.trim() ?? '';
      if (!trimmed) {
        departmentId = null;
      } else {
        const slug = toSlug(trimmed);
        const existing = await this.departmentRepository.findBySlug(slug);
        if (existing) {
          departmentId = existing.id;
        } else {
          const created = await this.departmentRepository.create({
            name: trimmed,
            slug,
          });
          departmentId = created.id;
        }
      }
    }
    return this.authRepository.updateProfile(userId, {
      ...rest,
      ...(departmentId !== undefined ? { departmentId } : {}),
    });
  }

  async changePassword(userId: string, body: ChangePasswordBodyType) {
    const user = await this.authRepository.findUserWithPassword(userId);
    if (!user) throw InvalidEmailException;
    if (!user.password) throw InvalidPasswordException;
    const isMatch = await this.hashingService.compare(
      body.currentPassword,
      user.password,
    );
    if (!isMatch) throw CurrentPasswordMismatchException;
    const isSame = await this.hashingService.compare(
      body.newPassword,
      user.password,
    );
    if (isSame) throw SamePasswordException;
    const hashed = await this.hashingService.hash(body.newPassword);
    await this.authRepository.updatePasswordById(userId, hashed);
    return { message: 'Đã đổi mật khẩu' };
  }

  async sendOTP(body: SendOTPBodyType) {
    const user = await this.authRepository.findUniqueUserByEmail(body.email);
    if (!user) throw InvalidEmailException;
    const code = generateOTP();
    await this.authRepository.createVerificationCode({
      email: body.email,
      code,
      type: body.type,
      expiresAt: addMilliseconds(
        new Date(),
        ms(envConfig.OTP_EXPIRES_IN as StringValue),
      ),
    });
    await this.emailService.sendOTP(body.email, code);
    return { message: 'Send OTP successfully' };
  }

  async verifyOTP(body: VerifyOTPBodyType) {
    await this.validateVerificationCode({
      email: body.email,
      code: body.code,
      type: body.type,
    });
    return { message: 'Verification code is valid' };
  }

  async validateVerificationCode({
    email,
    code,
    type,
  }: {
    email: string;
    code: string;
    type: VerificationMethod;
  }) {
    const existing = await this.authRepository.findVerificationCode({
      email,
      code,
      type: type,
    });
    if (!existing || existing.code !== code) throw InvalidOTPException;
    if (new Date(existing.expiresAt) < new Date()) throw ExpiredOTPException;
    return existing;
  }

  async forgotPassword(body: ForgotPasswordBodyType) {
    const user = await this.authRepository.findUniqueUserByEmail(body.email);
    if (!user) throw InvalidEmailException;
    await this.validateVerificationCode({
      email: body.email,
      code: body.code,
      type: VerificationMethod.ForgotPassword,
    });
    const hashedNewPassword = await this.hashingService.hash(body.newPassword);
    await Promise.all([
      this.authRepository.updateUserPassword(body.email, hashedNewPassword),
      this.authRepository.deleteVerificationCode({
        email: body.email,
        type: VerificationCodeType.FORGOT_PASSWORD,
      }),
    ]);
    return { message: 'Change password successfully' };
  }

  /**
   * Đăng nhập bằng SSO của PHYsoom — dành cho giảng viên ở app hồ sơ khoa học.
   *
   * Giảng viên KHÔNG có tài khoản quản trị web Khoa; hồ sơ nhân sự nằm ở PHYsoom.
   * Ở đây web Khoa nhận token PHYsoom đã ký, đổi lấy access token của chính mình,
   * và tạo tài khoản `LECTURER` ở lần đăng nhập đầu.
   *
   * Chuỗi bí mật chỉ nằm ở backend — app không bao giờ thấy nó.
   */
  async loginWithPhysoom(token: string) {
    let payload;
    try {
      payload = verifyPhysoomToken(
        token,
        process.env.PHYSOOM_SSO_SECRET ?? '',
        process.env.PHYSOOM_SSO_AUDIENCE || 'physprofile',
      );
    } catch (err: unknown) {
      if (err instanceof SsoTokenError)
        throw new UnauthorizedException(err.message);
      throw err;
    }

    // Hồ sơ khoa học là của CÁN BỘ. Sinh viên có tài khoản PHYsoom, nhưng cho
    // qua ở đây là tạo ra một LECTURER — người đó vào danh bạ cán bộ, rồi ACADsoom
    // kéo về thành ngạch GV. Chặn trước khi ghi bất cứ gì.
    if (laEmailSinhVien(payload.email)) {
      throw new UnauthorizedException(
        'Tài khoản sinh viên không dùng được hồ sơ khoa học cán bộ.',
      );
    }

    const { firstName, lastName } = splitVietnameseName(
      payload.name || payload.email,
    );
    const user = await this.authRepository.upsertSsoUser({
      email: payload.email,
      firstName,
      lastName,
    });
    // Tài khoản bị khoá thì SSO cũng không mở lại được — quyết định của web Khoa,
    // không phải của PHYsoom.
    if (!user.isActive) throw InactiveAccountException;

    return this.generateTokens({
      userId: user.id,
      roleName: user.role as RoleName,
      departmentId: user.departmentId,
    });
  }

  async generateTokens(payload: CreateAccessTokenPayload) {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.signAccessToken(payload),
      this.tokenService.signRefreshToken({ userId: payload.userId }),
    ]);
    return { accessToken, refreshToken };
  }

  async refreshToken(refreshToken: string): Promise<RefreshTokenResType> {
    const decoded = await this.tokenService.verifyRefreshToken(refreshToken);
    const user = await this.authRepository.findUniqueUserById(decoded.userId);
    if (!user) throw InvalidEmailException;
    if (!user.isActive) throw InactiveAccountException;
    return this.generateTokens({
      userId: user.id,
      roleName: user.role as RoleName,
      departmentId: user.departmentId,
    });
  }

  async logout(refreshToken: string) {
    await this.tokenService.verifyRefreshToken(refreshToken);
    return { message: 'Logout successfully' };
  }
}
