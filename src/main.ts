import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // `useGlobalPipes`: To use both class-validator, and class-transformer.
  app.useGlobalPipes(new ValidationPipe({
    transform: true,    // Enable data type match as DTO from class-transformer to auto-transformer.
    whitelist: true,    // Prevents User from getting unexpected properties in the application.
    forbidNonWhitelisted: true,   // Throws error for unexpected properties.
    transformOptions: {
      enableImplicitConversion: true,
    },
  }));

  // Swagger Set Up
  const config = new DocumentBuilder()
    .setTitle("File Upload Board")
    .setDescription("To test File Uplaod Board, pop up the lock and register a user with any of email and password you want in Authentication API, and then type in the same credentials in the register API. Then repeat the same process you just did in each endpoints when you find Basic Authorization. If you want to receive Bearer Token, you can go to 'POST /auth/signin' or 'POST /auth/signin/local' in Authentication API and fill in the Bearer Autorization blank.")
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
bootstrap();
