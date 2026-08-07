import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { FileModule } from './file/file.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filter/all-exceptions.filter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import * as Joi from 'joi';
import { ENTITIES } from './entities';
import { AuditLogModule } from './audit-log/audit-log.module';
import { UploadModule } from './upload/upload.module';
import { PostModule } from './post/post.module';
import { CommentModule } from './comment/comment.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { TempCleanupModule } from './temp-cleanup/temp-cleanup.module';
import { HealthModule } from './health/health.module';
import { join } from 'node:path';

@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: Joi.object({
        ENV: Joi.string().valid('dev', 'prod').required(),
        DB_TYPE: Joi.string().valid('postgres').required(),
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().required(),
        DB_USERNAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_DATABASE: Joi.string().required(),
        HASH_ROUNDS: Joi.number().required(),
        REFRESH_TOKEN_SECRET: Joi.string().required(),
        ACCESS_TOKEN_SECRET: Joi.string().required(),
        REFRESH_TOKEN_SECRET_EXPIRES_IN: Joi.number().required(),
        ACCESS_TOKEN_SECRET_EXPIRES_IN: Joi.number().required(),
        BASE_URL: Joi.string().default('http://localhost:3000'),
        CORS_ORIGIN: Joi.string(),
        // Optional: email of the account auto-promoted to superadmin on boot (ADR 0013).
        SUPERADMIN_EMAIL: Joi.string().email(),
        // Orphan temp-file sweep (ADR 0018): deletes unclaimed temp_ uploads past a TTL.
        TEMP_SWEEP_ENABLED: Joi.boolean().default(true),
        TEMP_SWEEP_CRON: Joi.string().default('0 * * * *'),
        TEMP_SWEEP_TTL_HOURS: Joi.number().default(24),
        TEMP_SWEEP_DRY_RUN: Joi.boolean().default(false),
        // Storage port-adapter (ADR 0029): selects the FileStorage implementation.
        // AWS credentials are deliberately not here — the SDK's own default provider
        // chain resolves them, since our code never reads them itself.
        STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
        S3_BUCKET: Joi.string().when('STORAGE_DRIVER', {
          is: 's3',
          then: Joi.required(),
        }),
        AWS_REGION: Joi.string().when('STORAGE_DRIVER', {
          is: 's3',
          then: Joi.required(),
        }),
      }),
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: configService.get<string>('DB_TYPE') as 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        // One list, shared with backend/data-source.ts — see backend/entities.ts.
        entities: ENTITIES,
        synchronize: false,
        autoLoadEntities: true,
      }),
      inject: [ConfigService],
    }),
    // file/upload is deliberately NOT served here — every granted read now goes
    // through the access-controlled GET /file/:id/content (ADR 0025 D2). file/temp
    // stays statically exposed; its lifecycle is the orphan-sweep's concern (ADR 0018),
    // unaffected by visibility.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'file', 'temp'),
      serveRoot: 'file/temp',
    }),
    ScheduleModule.forRoot(),
    FileModule,
    UserModule,
    PostModule,
    CommentModule,
    AuthModule,
    UploadModule,
    AuditLogModule,
    TempCleanupModule,
    HealthModule,
  ],
  providers: [
    // Global error-contract filter (ADR 0011) — APP_FILTER keeps it DI-managed
    // so ConfigService can drive the dev-only stack field.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
