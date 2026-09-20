import { Module } from '@nestjs/common';
import { ScholarIntegrationController } from './integration.controller';
import { PhysoomIntegrationController } from './physoom-integration.controller';
import { ResolveService } from './resolve/resolve.service';
import { ScholarController } from './scholar.controller';
import { ScholarService } from './scholar.service';
import { ProjectService } from './project.service';
import { ProjectDocOcrService } from './project-doc.service';
import { ActivityService } from './activity.service';
import { StaffPageService } from './staff-page.service';

@Module({
  controllers: [
    ScholarController,
    ScholarIntegrationController,
    PhysoomIntegrationController,
  ],
  providers: [
    ScholarService,
    ResolveService,
    StaffPageService,
    ProjectService,
    ProjectDocOcrService,
    ActivityService,
  ],
  exports: [ScholarService],
})
export class ScholarModule {}
