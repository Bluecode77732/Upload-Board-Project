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
import { MetricsModule } from './metrics/metrics.module';
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
        // DB로의 TLS (ADR 0039): 대상 인스턴스가 암호화 연결을 강제할 때 필요하다
        // (예: RDS PostgreSQL 기본값인 rds.force_ssl=1) — 평문 연결은 인증 단계에
        // 도달하기도 전에 거부된다. DB_SSL_CA에는 그 DB 인증서에 서명한 CA의 PEM
        // 내용을 담는다(AWS는 RDS 리전마다 하나씩 공개한다) — DB_SSL이 켜져 있으면
        // ADR 0039의 결정("실제 CA 인증서를 넘긴다... rejectUnauthorized: false는 안 된다")에
        // 따라 항상 필요하다.
        DB_SSL: Joi.boolean().default(false),
        DB_SSL_CA: Joi.string().when('DB_SSL', {
          is: true,
          then: Joi.required(),
        }),
        HASH_ROUNDS: Joi.number().required(),
        REFRESH_TOKEN_SECRET: Joi.string().required(),
        ACCESS_TOKEN_SECRET: Joi.string().required(),
        REFRESH_TOKEN_SECRET_EXPIRES_IN: Joi.number().required(),
        ACCESS_TOKEN_SECRET_EXPIRES_IN: Joi.number().required(),
        BASE_URL: Joi.string().default('http://localhost:3000'),
        PORT: Joi.number().default(3000),
        CORS_ORIGIN: Joi.string(),
        // 선택 사항: 부팅 시 superadmin으로 자동 승격될 계정의 이메일 (ADR 0013).
        SUPERADMIN_EMAIL: Joi.string().email(),
        // 고아 temp 파일 스윕 (ADR 0018): TTL이 지난, claim되지 않은 temp_ 업로드를 삭제한다.
        TEMP_SWEEP_ENABLED: Joi.boolean().default(true),
        TEMP_SWEEP_CRON: Joi.string().default('0 * * * *'),
        TEMP_SWEEP_TTL_HOURS: Joi.number().default(24),
        TEMP_SWEEP_DRY_RUN: Joi.boolean().default(false),
        // 고아 granted 파일 회수(ADR 0051): file_entity 행이 없는 file/upload 바이트를 찾으려고
        // DB와 대조해 훑는다. DRY_RUN 기본값은 true(리포트만) — 위 temp 파일을 훑는 것과 다르게,
        // 여기서의 오탐은 실제 소유된 파일을 파괴한다.
        GRANTED_SWEEP_ENABLED: Joi.boolean().default(true),
        GRANTED_SWEEP_CRON: Joi.string().default('0 0 * * *'),
        GRANTED_SWEEP_DRY_RUN: Joi.boolean().default(true),
        // Storage port-adapter (ADR 0029): FileStorage 구현체를 선택한다.
        // AWS 자격 증명은 의도적으로 여기 없다 — 이 코드가 직접 읽는 일이 없으므로
        // SDK 자체의 기본 provider chain이 알아서 해결한다.
        STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
        S3_BUCKET: Joi.string().when('STORAGE_DRIVER', {
          is: 's3',
          then: Joi.required(),
        }),
        AWS_REGION: Joi.string().when('STORAGE_DRIVER', {
          is: 's3',
          then: Joi.required(),
        }),
        // GET /file/:id/content의 presigned-redirect TTL (ADR 0036). S3Storage만
        // 읽는다 — STORAGE_DRIVER=local에서는 쓰이지 않는 무해한 기본값일 뿐이다.
        CONTENT_SIGNED_URL_TTL_SECONDS: Joi.number().default(300),
      }),
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // 목적: 앱 부팅 시 TypeORM DB 연결을 구성한다.
    // 이유: RDS PostgreSQL 등 TLS를 강제하는 인스턴스에 평문으로 접속하면
    //       인증 단계 전에 거부당한다(pg_hba.conf 에러) — DB_SSL로 스위치.
    // 방법: DB_SSL=true면 DB_SSL_CA(그 DB의 CA 인증서 PEM)로 실제 인증서 검증을
    //       켠다(ADR 0039) — rejectUnauthorized: false로 검증 자체를 끄지 않는다.
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: configService.get<string>('DB_TYPE') as 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        ssl: configService.get<boolean>('DB_SSL')
          ? { ca: configService.get<string>('DB_SSL_CA') }
          : false,
        // 목록은 하나뿐이며 backend/data-source.ts와 공유한다 — backend/entities.ts 참고.
        entities: ENTITIES,
        synchronize: false,
        autoLoadEntities: true,
      }),
      inject: [ConfigService],
    }),
    // file/upload는 의도적으로 여기서 서빙하지 않는다 — granted 파일의 모든 읽기는 이제
    // 접근 통제가 걸린 GET /file/:id/content를 거친다 (ADR 0025 D2). file/temp는
    // 계속 정적으로 노출되며, 그 생명주기는 orphan-sweep의 관심사다 (ADR 0018) —
    // visibility와는 무관하다.
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
    MetricsModule,
  ],
  providers: [
    // 전역 에러-계약 필터 (ADR 0011) — APP_FILTER로 등록해 DI가 관리하게 함으로써
    // ConfigService가 dev 전용 stack 필드를 제어할 수 있게 한다.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
