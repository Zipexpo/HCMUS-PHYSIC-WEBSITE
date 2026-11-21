import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule } from '@sentry/nestjs/setup';
import { PrismaModule } from './prisma/prisma.module';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';
import { DepartmentModule } from './department/department.module';
import { WidgetModule } from './widget/widget.module';
import { PageLayoutModule } from './page-layout/page-layout.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { VisitorModule } from './visitor/visitor.module';
import { MediaModule } from './media/media.module';
import { PostModule } from './post/post.module';
import { AdminModule } from './admin/admin.module';
import { CategoryModule } from './category/category.module';
import { TagModule } from './tag/tag.module';
import { NotificationModule } from './notification/notification.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { StaticPageModule } from './static-page/static-page.module';
import { ScholarModule } from './scholar/scholar.module';
import { HdgsModule } from './hdgs/hdgs.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';
import KeyvRedis from '@keyv/redis';
import envConfig from './shared/config/config';

@Module({
  imports: [
    // Rate limiting available app-wide; applied selectively (auth routes) via
    // @UseGuards(ThrottlerGuard) — NOT global, to avoid throttling the public
    // site's server-side API calls which all originate from one container IP.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => ({
        stores: [new KeyvRedis(envConfig.REDIS_URL)],
        ttl: 60_000,
        namespace: 'hcmus-physics',
      }),
    }),
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SharedModule,
    AuthModule,
    DepartmentModule,
    WidgetModule,
    PageLayoutModule,
    SubscriptionModule,
    VisitorModule,
    MediaModule,
    PostModule,
    AdminModule,
    CategoryModule,
    TagModule,
    NotificationModule,
    ChatbotModule,
    StaticPageModule,
    ScholarModule,
    HdgsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
