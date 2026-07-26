import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { FileModule } from './file/file.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filter/all-exceptions.filter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import * as Joi from 'joi';
import { FileEntity } from './file/entity/file.entity';
import { UserEntity } from './user/entity/user.entity';
import { AuditLogEntity } from './audit-log/audit-log.entity';
import { AuditLogModule } from './audit-log/audit-log.module';
import { UploadModule } from './upload/upload.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { TempCleanupModule } from './temp-cleanup/temp-cleanup.module';
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
        entities: [FileEntity, UserEntity, AuditLogEntity],
        synchronize: false,
        autoLoadEntities: true,
      }),
      inject: [ConfigService],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'file'),
      serveRoot: 'file',
    }),
    ScheduleModule.forRoot(),
    FileModule,
    UserModule,
    AuthModule,
    UploadModule,
    AuditLogModule,
    TempCleanupModule,
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
