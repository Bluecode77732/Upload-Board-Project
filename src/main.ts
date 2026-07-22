import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS stays off unless CORS_ORIGIN is set — same-origin/Swagger use needs none;
  // a browser frontend on another origin sets a comma-separated allowlist.
  const corsOrigin = app.get(ConfigService).get<string>('CORS_ORIGIN');
  if (corsOrigin) {
    app.enableCors({
      origin: corsOrigin.split(',').map((origin) => origin.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }

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
    .setTitle('File Upload Board')
    .setDescription(
      "To test File Upload Board, pop up the lock and register a user with any of email and password you want in Authentication API, and then type in the same credentials in the register API. Then repeat the same process you just did in each endpoints when you find Basic Authorization. If you want to receive Bearer Token, you can go to 'POST /auth/signin' or 'POST /auth/signin/local' in Authentication API and fill in the Bearer Autorization blank.",
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addBasicAuth()
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('doc', app, documentFactory, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
