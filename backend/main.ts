import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

// 목적: Nest 앱을 부트스트랩하고 CORS/쿠키/검증/Swagger를 구성한 뒤 리슨을 시작한다.
// 이유: PORT를 process.env에서 직접 읽으면 Joi 검증을 우회해 Config 정책(ConfigService만 사용)을 깨뜨린다.
// 방법: ConfigService 인스턴스를 한 번만 얻어 CORS_ORIGIN과 PORT 조회에 재사용한다.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

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

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

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

  await app.listen(configService.get<number>('PORT', 3000));
}
bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
