import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

// 목적: Nest 앱을 부트스트랩하고 프록시 신뢰 범위/보안 헤더/CORS/쿠키/Swagger를 구성한 뒤
//       종료 시그널 훅을 켜고 리슨을 시작한다.
// 이유: PORT를 process.env에서 직접 읽으면 Joi 검증을 우회해 Config 정책(ConfigService만 사용)을
//       깨뜨린다. ALB 뒤에서는 req.ip가 항상 ALB 자신의 주소로 찍혀, 라우트별 rate limit
//       (ADR 0054)이 방문자별이 아닌 전체 공유 버킷이 된다. 컨테이너에서 PID 1인 node는 SIGTERM으로
//       죽지 않고 유예 시간을 다 쓴 뒤 SIGKILL(137)로 끝나, TypeORM의 DB 풀 정리
//       (onApplicationShutdown)도 실행된 적이 없다(ADR 0061).
// 방법: ConfigService 인스턴스를 한 번만 얻어 CORS_ORIGIN과 PORT 조회에 재사용한다. trust proxy는
//       VPC 대역(10.0.0.0/16, ADR 0056과 동일 상수)에서 온 연결일 때만 X-Forwarded-For를
//       신뢰하도록 가장 먼저 설정한다(ADR 0054 addendum). helmet은 다른 미들웨어보다 먼저
//       적용해 모든 응답에 보안 헤더가 빠짐없이 붙게 하되, CSP의 script-src는 /doc(Swagger UI)의
//       인라인 부트스트랩 스크립트가 실행되도록 완화한다(ADR 0055). 전역 ValidationPipe는 여기서
//       등록하지 않는다 — AppModule의 APP_PIPE가 맡아 e2e도 같은 경로를 탄다. enableShutdownHooks()는
//       listen 직전에 호출해 SIGTERM/SIGINT에서 Nest 종료 훅이 돌게 한다.
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // ALB(리버스 프록시) 뒤에서 req.ip가 항상 ALB 자신의 주소로 찍혀 rate limit이 방문자별이
  // 아닌 전체 공유 버킷이 되는 문제를 막는다(ADR 0054 addendum) — VPC 내부(10.0.0.0/16,
  // ADR 0056과 동일 상수)에서 온 연결일 때만 X-Forwarded-For를 신뢰한다. 배포 토폴로지에
  // 고정된 상수라 env var로 빼지 않았다 — ADR 0054 addendum 참고.
  app.set('trust proxy', '10.0.0.0/16');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );

  // CORS_ORIGIN이 설정되지 않으면 CORS는 계속 꺼져 있다 — same-origin/Swagger 사용에는
  // 필요 없다; 다른 origin의 브라우저 프론트엔드는 콤마로 구분된 allowlist를 설정한다.
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  if (corsOrigin) {
    app.enableCors({
      origin: corsOrigin.split(',').map((origin) => origin.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }

  // POST /auth/token/refresh를 위해 httpOnly refresh 쿠키를 파싱한다 (ADR 0012).
  app.use(cookieParser());

  const config = new DocumentBuilder()
    .setTitle('Sharenpo')
    .setDescription(
      "To test Sharenpo, pop up the lock and register a user with any of email and password you want in Authentication API, and then type in the same credentials in the register API. Then repeat the same process you just did in each endpoints when you find Basic Authorization. If you want to receive Bearer Token, you can go to 'POST /auth/signin' in Authentication API and fill in the Bearer Autorization blank.",
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addBasicAuth()
    .addCookieAuth('refreshToken')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('doc', app, documentFactory, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // SIGTERM/SIGINT에서 OnModuleDestroy/OnApplicationShutdown 훅(TypeORM DB 풀 정리, 스케줄러
  // 크론 정지)이 실제로 돌게 한다 — 호출하지 않으면 시그널 리스너가 없어 그 훅들이 실행되지 않는다.
  app.enableShutdownHooks();

  await app.listen(configService.get<number>('PORT', 3000));
}
bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
