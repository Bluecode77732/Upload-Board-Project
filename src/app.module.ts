import { Module } from '@nestjs/common';
import { FileModule } from './file/file.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import * as Joi from 'joi';
import { FileEntity } from './file/entity/file.entity';
import { UserEntity } from './user/entity/user.entity';
import { UploadModule } from './upload/upload.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';

@Module({
  imports: [
    // FYI : A static method `forRoot`
    ConfigModule.forRoot({
      validationSchema: Joi.object({
        ENV: Joi.string().valid('dev', 'prod').required(),
        // It prevents wrong connection by DB type
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
      }),
      // Configuration global adoption
      isGlobal: true,
    }),
    // Reason for asynchronizing `forRoot` to `forRootAsync` : Since `configModule` is being instanced by `Inject of Container`, and to extract data from that instanced data schema to TypeORM.
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: configService.get<string>("DB_TYPE") as "postgres",
        host: configService.get<string>("DB_HOST"),
        port: configService.get<number>("DB_PORT"),
        username: configService.get<string>("DB_USERNAME"),
        password: configService.get<string>("DB_PASSWORD"),
        database: configService.get<string>("DB_DATABASE"),
        entities: [
          FileEntity,
          UserEntity,
        ],
        //! WARNING: Set synchronize: `false` in Production to prevent losing data.
        //! Important: Set it `true` to do migration to create DB during Development.
        synchronize: false,
        autoLoadEntities: true,
      }),
      // It tells IOC container what dependency injection to be injected with.
      inject: [ConfigService],
    }),
    // Preventing domain URL security risk by entrancing via rootPath and serveRoot.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'file'),
      serveRoot: 'file',
    }),
    FileModule,
    UserModule,
    AuthModule,
    UploadModule,
  ],
})
export class AppModule { }
