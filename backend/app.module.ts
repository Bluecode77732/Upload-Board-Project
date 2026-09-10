import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
        // 시크릿/해시 강도 (2026-09-09 보안 점검, 2026-09-11 문자 종류 강제 추가): 값의
        // 존재만이 아니라 최소 강도까지 검증한다 — 짧거나 문자 종류가 단순한 JWT 시크릿은
        // 브루트포스로 알아내면 완전한 토큰 위조로 이어지고, 낮은 bcrypt 라운드는 비밀번호
        // 해시를 브루트포스에 취약하게 만든다(Never Do Group 3). 길이(32자 이상)뿐 아니라
        // 대문자·소문자·숫자·기호를 모두 포함하도록 강제해 같은 길이에서도 엔트로피를 높인다.
        HASH_ROUNDS: Joi.number().min(10).required(),
        REFRESH_TOKEN_SECRET: Joi.string()
          .min(32)
          .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/)
          .required(),
        ACCESS_TOKEN_SECRET: Joi.string()
          .min(32)
          .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/)
          .required(),
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
        // 전역 요청 횟수 제한(ADR 0053). false면 제한을 사실상 무제한으로 우회한다 —
        // e2e 스위트가 같은 인스턴스에 순차로 수백 건을 보내 429로 깨지는 것을 막기 위한
        // 테스트 전용 탈출구이며(test/e2e-env.ts에서만 false로 override), dev/prod는
        // 항상 true다.
        THROTTLE_ENABLED: Joi.boolean().default(true),
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
    // 목적: 요청 횟수 제한의 기본 한도를 구성한다(ADR 0053, 라우트별 차등은 ADR 0054).
    // 이유: backend 전체에 rate limiting이 전혀 없어 로그인/회원가입 등이 무차별 대입
    //       공격에 노출돼 있었다 — 우선 관례적인 보수적 기본값(분당 100회)을 전역으로
    //       걸고, auth/upload처럼 더 강한 제한이 필요한 라우트는 각 컨트롤러의
    //       @Throttle({ default: {...} })로 이 'default' 쓰로틀러 값을 오버라이드한다
    //       (ADR 0054).
    // 방법: THROTTLE_ENABLED=false면 skipIf로 가드 자체를 건너뛴다 — 가드 프로바이더를
    //       조건부로 등록할 수는 없으므로(NestJS 모듈 그래프는 정적이다), e2e 스위트만
    //       이 값을 꺼서 같은 IP로 잡히는 수백 건의 순차 요청이 429로 스위트를 깨뜨리지
    //       않게 한다(test/e2e-env.ts). skipIf는 라우트별 @Throttle() 오버라이드보다도
    //       먼저 평가되므로(ThrottlerGuard.canActivate), limit 값 자체를 부풀리던 이전
    //       방식과 달리 default든 라우트별 오버라이드든 모두 한 곳에서 우회된다.
    ThrottlerModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        throttlers: [{ ttl: 60000, limit: 100 }],
        skipIf: () => !configService.get<boolean>('THROTTLE_ENABLED'),
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
    // 목적: 모든 라우트에 요청 횟수 제한을 강제한다(이 저장소 최초의 전역 APP_GUARD, ADR 0053).
    // 이유: 컨트롤러별 @UseGuards로 하면 새 컨트롤러가 생길 때마다 빠뜨리기 쉽고, 빠뜨려도
    //       인증 가드처럼 401로 시끄럽게 드러나지 않아 조용히 무제한으로 남는다.
    // 방법: HealthController/MetricsController는 kubelet/Prometheus의 초 단위 반복 호출을
    //       위해 @SkipThrottle()로 개별 예외 처리한다.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
