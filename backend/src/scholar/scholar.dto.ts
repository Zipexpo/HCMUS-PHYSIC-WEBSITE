import { createZodDto } from 'nestjs-zod';
import {
  ClaimResponseBodySchema,
  CreatePublicationBodySchema,
  ImportFileBodySchema,
  ImportPreviewResSchema,
  IntegrationPublicationResSchema,
  IntegrationGradStudyResSchema,
  IntegrationStaffResSchema,
  IntegrationQuerySchema,
  ListPublicationsQuerySchema,
  OrcidImportBodySchema,
  PendingClaimListResSchema,
  PublicationListResSchema,
  PublicationResSchema,
  ResolveBodySchema,
  ResolvePreviewResSchema,
  ScholarProfileResSchema,
  SetEducationBodySchema,
  SetNameVariantsBodySchema,
  CreateProjectBodySchema,
  IntegrationProjectResSchema,
  PeopleQuerySchema,
  PeopleResSchema,
  CreateActivityBodySchema,
  UpdateActivityBodySchema,
  ListActivitiesQuerySchema,
  ActivityResSchema,
  ActivityListResSchema,
  ActivityClaimListResSchema,
  RespondActivityClaimBodySchema,
  IntegrationActivityResSchema,
  ListProjectsQuerySchema,
  PendingProjectListResSchema,
  ProjectClaimBodySchema,
  ProjectListResSchema,
  ProjectResSchema,
  StaffPageResSchema,
  SyncStaffPageBodySchema,
  UpdateProjectBodySchema,
  StatsResSchema,
  FacultyDetailResSchema,
  FacultyReportResSchema,
  UpdateStaffPageBodySchema,
  UpdatePublicationBodySchema,
  UpdateScholarProfileBodySchema,
} from './scholar.model';

export class ScholarProfileResDTO extends createZodDto(
  ScholarProfileResSchema,
) {}
export class UpdateScholarProfileBodyDTO extends createZodDto(
  UpdateScholarProfileBodySchema,
) {}
export class SetEducationBodyDTO extends createZodDto(SetEducationBodySchema) {}

export class SetNameVariantsBodyDTO extends createZodDto(
  SetNameVariantsBodySchema,
) {}

export class ResolveBodyDTO extends createZodDto(ResolveBodySchema) {}
export class ResolvePreviewResDTO extends createZodDto(
  ResolvePreviewResSchema,
) {}
export class ImportFileBodyDTO extends createZodDto(ImportFileBodySchema) {}
export class ImportPreviewResDTO extends createZodDto(ImportPreviewResSchema) {}
export class OrcidImportBodyDTO extends createZodDto(OrcidImportBodySchema) {}

export class PublicationResDTO extends createZodDto(PublicationResSchema) {}
export class PublicationListResDTO extends createZodDto(
  PublicationListResSchema,
) {}
export class CreatePublicationBodyDTO extends createZodDto(
  CreatePublicationBodySchema,
) {}
export class UpdatePublicationBodyDTO extends createZodDto(
  UpdatePublicationBodySchema,
) {}
export class ListPublicationsQueryDTO extends createZodDto(
  ListPublicationsQuerySchema,
) {}

export class ClaimResponseBodyDTO extends createZodDto(
  ClaimResponseBodySchema,
) {}
export class PendingClaimListResDTO extends createZodDto(
  PendingClaimListResSchema,
) {}

export class IntegrationQueryDTO extends createZodDto(IntegrationQuerySchema) {}
export class IntegrationPublicationResDTO extends createZodDto(
  IntegrationPublicationResSchema,
) {}
export class IntegrationGradStudyResDTO extends createZodDto(
  IntegrationGradStudyResSchema,
) {}
export class IntegrationStaffResDTO extends createZodDto(
  IntegrationStaffResSchema,
) {}

export class StatsResDTO extends createZodDto(StatsResSchema) {}
export class FacultyDetailResDTO extends createZodDto(FacultyDetailResSchema) {}
export class FacultyReportResDTO extends createZodDto(FacultyReportResSchema) {}

export class StaffPageResDTO extends createZodDto(StaffPageResSchema) {}
export class UpdateStaffPageBodyDTO extends createZodDto(
  UpdateStaffPageBodySchema,
) {}

export class ProjectResDTO extends createZodDto(ProjectResSchema) {}
export class ProjectListResDTO extends createZodDto(ProjectListResSchema) {}
export class CreateProjectBodyDTO extends createZodDto(
  CreateProjectBodySchema,
) {}
export class UpdateProjectBodyDTO extends createZodDto(
  UpdateProjectBodySchema,
) {}
export class ListProjectsQueryDTO extends createZodDto(
  ListProjectsQuerySchema,
) {}
export class PendingProjectListResDTO extends createZodDto(
  PendingProjectListResSchema,
) {}
export class ProjectClaimBodyDTO extends createZodDto(ProjectClaimBodySchema) {}
export class IntegrationProjectResDTO extends createZodDto(
  IntegrationProjectResSchema,
) {}

export class CreateActivityBodyDTO extends createZodDto(
  CreateActivityBodySchema,
) {}
export class UpdateActivityBodyDTO extends createZodDto(
  UpdateActivityBodySchema,
) {}
export class ListActivitiesQueryDTO extends createZodDto(
  ListActivitiesQuerySchema,
) {}
export class ActivityResDTO extends createZodDto(ActivityResSchema) {}
export class ActivityListResDTO extends createZodDto(ActivityListResSchema) {}
export class ActivityClaimListResDTO extends createZodDto(
  ActivityClaimListResSchema,
) {}
export class RespondActivityClaimBodyDTO extends createZodDto(
  RespondActivityClaimBodySchema,
) {}
export class IntegrationActivityResDTO extends createZodDto(
  IntegrationActivityResSchema,
) {}

export class PeopleQueryDTO extends createZodDto(PeopleQuerySchema) {}
export class PeopleResDTO extends createZodDto(PeopleResSchema) {}

export class SyncStaffPageBodyDTO extends createZodDto(
  SyncStaffPageBodySchema,
) {}
