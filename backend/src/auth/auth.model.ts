import z from 'zod';
import { VerificationMethod } from '../shared/constants/auth.constants';

export const LoginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginBodyType = z.infer<typeof LoginBodySchema>;

export const LoginResSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type LoginResType = z.infer<typeof LoginResSchema>;

/** Token ngắn hạn do PHYsoom ký, đổi lấy access token của web Khoa. */
export const PhysoomSsoBodySchema = z.object({
  token: z.string().min(20).max(4000),
});
export type PhysoomSsoBodyType = z.infer<typeof PhysoomSsoBodySchema>;

export const RefreshTokenBodySchema = z.object({
  refreshToken: z.string(),
});

export type RefreshTokenBodyType = z.infer<typeof RefreshTokenBodySchema>;
export const RefreshTokenResSchema = LoginResSchema;
export type RefreshTokenResType = z.infer<typeof RefreshTokenResSchema>;

export const CreateAdminBodySchema = z
  .object({
    email: z.email(),
    password: z.string().min(6),
    confirmPassword: z.string().min(6).max(100),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    phone: z.string().max(11).optional(),
    position: z.string().optional(),
    bio: z.string().optional(),
    departmentId: z.string().optional(),
    newDepartmentName: z.string().min(1).max(200).optional(),
    avatarUrl: z.string().optional(),
  })
  .superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
      ctx.addIssue({
        code: 'custom',
        message: 'Password and confirm password must match',
        path: ['confirmPassword'],
      });
    }
  });

export type CreateAdminBodyType = z.infer<typeof CreateAdminBodySchema>;

export const SendOTPBodySchema = z.object({
  email: z.email(),
  type: z.enum(VerificationMethod),
});

export type SendOTPBodyType = z.infer<typeof SendOTPBodySchema>;

export const VerifyOTPBodySchema = z.object({
  email: z.email(),
  code: z.string().length(6),
  type: z.enum(VerificationMethod),
});

export type VerifyOTPBodyType = z.infer<typeof VerifyOTPBodySchema>;

export const LoginOtpBodySchema = z.object({
  email: z.email(),
  code: z.string().length(6),
});

export type LoginOtpBodyType = z.infer<typeof LoginOtpBodySchema>;

export const ForgotPasswordBodySchema = z
  .object({
    email: z.email(),
    code: z.string().length(6),
    newPassword: z.string().min(6).max(100),
    confirmNewPassword: z.string().min(6).max(100),
  })
  .superRefine(({ confirmNewPassword, newPassword }, ctx) => {
    if (confirmNewPassword !== newPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'New password and confirm new password must match',
        path: ['confirmNewPassword'],
      });
    }
  });

export type ForgotPasswordBodyType = z.infer<typeof ForgotPasswordBodySchema>;

export const GetAuthorizationUrlResSchema = z.object({
  url: z.string(),
});

export type GetAuthorizationUrlResType = z.infer<
  typeof GetAuthorizationUrlResSchema
>;

export const GoogleAuthStateSchema = z.object({
  userAgent: z.string(),
  ip: z.string(),
});

export type GoogleAuthStateType = z.infer<typeof GoogleAuthStateSchema>;

export const MessageResSchema = z.object({
  message: z.string(),
});

export type MessageResType = z.infer<typeof MessageResSchema>;

export const UserResSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
  isActive: z.boolean(),
  phone: z.string().nullable(),
  position: z.string().nullable(),
  bio: z.string().nullable(),
  departmentId: z.string().nullable(),
  department: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .optional(),
  tourCompletedAt: z.date().nullable(),
  starredLayoutIds: z.array(z.string()).default([]),
  starredWidgetIds: z.array(z.string()).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserResType = z.infer<typeof UserResSchema>;

export const SetStarredBodySchema = z.object({
  layoutIds: z.array(z.string()).optional(),
  widgetIds: z.array(z.string()).optional(),
});
export type SetStarredBodyType = z.infer<typeof SetStarredBodySchema>;

export const UpdateProfileBodySchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().nullable().optional(),
  position: z.string().max(200).nullable().optional(),
  departmentName: z.string().max(200).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  tourCompletedAt: z.coerce.date().nullable().optional(),
});

export type UpdateProfileBodyType = z.infer<typeof UpdateProfileBodySchema>;

export const ChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6).max(100),
    confirmNewPassword: z.string().min(6).max(100),
  })
  .superRefine(({ newPassword, confirmNewPassword }, ctx) => {
    if (newPassword !== confirmNewPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'New password and confirm password must match',
        path: ['confirmNewPassword'],
      });
    }
  });

export type ChangePasswordBodyType = z.infer<typeof ChangePasswordBodySchema>;
