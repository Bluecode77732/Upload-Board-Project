# Upload Board Project
- An application that validated users to upload video files.


## Overview
A file upload demonstrating project to handle the mp4 format data.
- Authentication: JWT-based auth with Passport strategies
- File Management: MP4 video upload with transaction safety
- API Documentation: Full Swagger integration
- Testing: Unit tests with 70%+ coverage on core logic

- Timeline : 6 weeks
- Skills : TypeORM, PostgreSQL, Transaction, DTO, Validation-Exception, Relations, Passport, Guard, Jest, Swagger


## Project Motivation
- To understand uploading files using `Multer` package.
- Understanding of user authentication and authorization using basic, bearer and JWT.
- Adoption of Monolithic Architecture over and NestJs framework.
- To expand technical knowledge of handling on transferring large files over the network.


## Quick Start

- Prerequisites
  - Node.js >= 18.x
  - PostgreSQL >= 14.x
  - pnpm (recommended) or npm

```powershell
  # Install dependencies
  pnpm install
  
  # Setup environment
  # **Edit with your DB credentials**
  cp .env
 
  # 3. Create database manually (no migrations in package.json)
  Set 'synchronize: true' in 'app.module.ts' for development
  
  # 4. Run development
  pnpm run start:dev

  # 4. Run all tests
  pnpm test

  # 4. Run test coverage
  pnpm run test:cov
  
  # 5. Access Swagger UI
  http://localhost:3000/doc
```


## API Documentation
### Swagger UI
***To try all of'em, you must register first to get started.***

### Key Endpoints
**Authentication**
- `POST /auth/register` - Register with Basic Auth
- `POST /auth/signin` - Get JWT tokens
- `POST /auth/token/refreshaccess` - Refresh access token

**User**
- `GET /user` - Get all users
- `GET /user/:id` - Get a user 
- `POST /user` - Create a user
- `PATCH /user/:id` - Update a user
- `PATCH /user/:id` - Delete a user

**File Upload**
- `POST /upload/upload` - Upload video to temp storage
- `POST /file` - Move file to permanent storage
- `PATCH /file/:id` - Update file metadata
- `DELETE /file/:id` - Delete file


## Stacks
- `Monolithic Architecture`, a principle for casual-fitting project and easy to couple and decouple unit of components.
- `Multer`, as written Nestjs official documentation, this middleware package provides method how to handle format as multipart/form-data, through HTTP request by Post method, which make the application easy to handle.
- `Node.Js`, this javascript runtime built with chrome V8 engine, provides ecosystem where the applications run smoothly.
- `Nest.Js`, a scalable framework for Typescript project, and a powerful framework that is keep rising.
- `Typescript`, a type-safe and a solid object oriented language, superset of Javascript.


## API Test
- Postman : An API testing tool that sends user's request, inspect Response, automate tests, and APIs collaborations through collections and workspaces.
- Jest : A javascript testing framework that provides a complete testing solution with built-in assertions, mocking, and code coverage.


## Total Installation

Manually Installed Packages

Dependencies (12)
- @nestjs/config
- @nestjs/passport
- @nestjs/serve-static
- @nestjs/swagger
- @nestjs/typeorm
- bcrypt
- class-transformer
- class-validator
- joi
- passport
- passport-jwt
- passport-local
- pg
- typeorm
- uuid

DevDependencies (6)
- @nestjs/jwt
- @types/bcrypt
- @types/multer
- @types/passport-jwt
- @types/passport-local

Excluded NestJS CLI defaults like common, core, platform-express, testing, jest, eslint, prettier, ts-node, typescript, etc.


## Build
Create the project with following command.
- Command `nest new app`


### Configuration
Once installation is finished, go to `app.module`, and set up configuration of the package.

Package
- joi
  - This package is a built-in validator that enforce validation to an object schema and JavaScript objects.
  - To validate configuration files when they aren't automatically validated with `validationSchema` alone.

Methods
- join
  - Using from 'node:path' not 'path': to avoid conflict between external packages with same name.
  - It ensures OS cross-platform compatibility by using path separators.

```ts
  import * as Joi from 'joi';

  @Module({
    imports: [
      // FYI : A static method `forRoot`
      ConfigModule.forRoot({
        validationSchema: Joi.object({
          ENV: Joi.string().valid('dev', 'prod').required(),
          // To prevent wrong connection by DB type
          DB_TYPE: Joi.string().valid('postgres').required(),
          DB_HOST: Joi.string().required(),
          DB_PORT: Joi.number().required(),
          DB_USERNAME: Joi.string().required(),
          DB_PASSWORD: Joi.string().required(),
          DB_DATABASE: Joi.string().required(),
        }),
        // Configuration global adoption
        isGlobal: true,
      }),
    ]
  })
```


### Environment Configuration

Create a `.env` file in the root directory and paste variables below :
```env.example
  # Development Environment
  ENV=dev
  
  # DB configuration
  DB_TYPE=yourDatabase
  DB_HOST=yourDatabase
  DB_PORT=yourPort
  DB_USERNAME=yourDBport
  DB_PASSWORD=yourDBpassword
  DB_DATABASE=yourDBtype
  
  # Hash 
  HASH_ROUNDS=hashRounds
  
  # Secret Token
  REFRESH_TOKEN_SECRET=yourEncodedSecretKey
  ACCESS_TOKEN_SECRET=yourEncodedSecretKey
  
  # Expiry
  REFRESH_TOKEN_SECRET_EXPIRES_IN=expiryTime
  ACCESS_TOKEN_SECRET_EXPIRES_IN=expiryTime
```


### File Storage Structure
Create three of folders to store the videos separately. 
- Structrue of the storage folders

file/
├── temp/     # Temporary storage
└── upload/   # Permanent storage


**Why split into three of folders?**
- Verification Purpose : Basically, it is a conventional way to separate files to manage file before it gets publicly released, it can take times to verify which ones to upload or not.

Names in the below are created in root directory to store user uploaded files.
- `file`: a folder for 
- `temp`: a file for temporal storage.
- `upload`: a file for permanently storage.


### Complete Application Structure

upload-board-project/
├── assets/
│   └── files/
│       └── sample-vid.mp4
├── dist/
├── file/
│   ├── temp/
│   └── upload/
├── node_modules/
├── src/
│   ├── auth/
│   │   ├── dto/
│   │   │   └── token-types.auth.dto.ts
│   │   ├── guard/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── local-auth.guard.ts
│   │   ├── interface/
│   │   │   └── payload-interface.ts
│   │   ├── strategy/
│   │   │   ├── jwt.strategy.ts
│   │   │   └── local.strategy.ts
│   │   ├── auth.controller.spec.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.module.ts
│   │   ├── auth.service.spec.ts
│   │   └── auth.service.ts
│   ├── file/
│   │   ├── dto/
│   │   │   ├── create-uploadFile.dto.ts
│   │   │   └── update-uploadFile.dto.ts
│   │   ├── entity/
│   │   │   └── file.entity.ts
│   │   ├── file.controller.spec.ts
│   │   ├── file.controller.ts
│   │   ├── file.module.ts
│   │   ├── file.service.spec.ts
│   │   └── file.service.ts
│   ├── upload/
│   │   ├── upload.controller.spec.ts
│   │   ├── upload.controller.ts
│   │   └── upload.module.ts
│   ├── user/
│   │   ├── decorator/
│   │   │   └── userId.decorator.ts
│   │   ├── dto/
│   │   │   ├── create-user.dto.ts
│   │   │   └── update-user.dto.ts
│   │   ├── entity/
│   │   │   └── user.entity.ts
│   │   ├── user.controller.spec.ts
│   │   ├── user.controller.ts
│   │   ├── user.module.ts
│   │   ├── user.service.spec.ts
│   │   └── user.service.ts
│   ├── app.module.ts
│   └── main.ts
├── test/
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
├── .env
├── .gitignore
├── .prettierrc
├── eslint.config.mjs
├── nest-cli.json
├── package.json
├── pnpm-lock.yaml
├── README.md
├── tsconfig.json
└── tsconfig.build.json

## Complete Implementaion
### APP
Packages
- @nestjs/core
- @nestjs/common
- @nestjs/config
- @nestjs/typeorm
- @nestjs/serve-static
- @nestjs/swagger
- Joi

#### Main
```ts
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
```


#### Module
```ts
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
```


### Upload
Packages
- @nestjs/common
- multer
- uuid


Methods
- `join` from 'node:path' : To ensure OS cross-platform compatibility by using path separators, as well as to avoid conflict between external packages with same name.


#### Module
```ts
import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'node:path';
import { diskStorage } from 'multer';
import { v4 } from 'uuid';

@Module({
    imports: [
        MulterModule.register({
            storage: diskStorage({
                // `join()` is an utility function that disinguishes OS file path between `/` or `\`.
                destination: join(process.cwd(), 'file', 'temp'),
                // To make this function callable, require those parameters: req, file
                filename: (req, file, cb) => {
                    const split = file.originalname.split('.');

                    let tempLabel = 'temp';
                    let fileType = 'mp4';

                    if (split.length > 1) {
                        fileType = split[split.length - 1];
                    }

                    cb(null, `${tempLabel}_${v4()}_${Date.now()}.${fileType}`);
                }
            }),
        }),
    ],
    controllers: [UploadController],
})
export class UploadModule { }
```


#### Controller
```ts
  import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
  import { FileInterceptor } from '@nestjs/platform-express';
  import { ApiBody, ApiConsumes, ApiResponse, ApiTags } from '@nestjs/swagger';

  @Controller('upload')
  export class UploadController {

    @Post('upload')
    @UseInterceptors(FileInterceptor('video', {
        limits: {
            fileSize: 100000000,     //300MB in bytes
        }
    }))
    uploadVideo(
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException("Upload Video.");
        };

        // Terminal log
        console.log(file);

        // Client log
        return {
            filename: file.filename,
        };
    }
  }
```


### File
Packages
- @nestjs/common
- @nestjs/typeorm
- typeorm
- class-transformer
- class-validator


#### Module
```ts
  import { Module } from '@nestjs/common';
  import { FileService } from './file.service';
  import { FileController } from './file.controller';
  import { UserEntity } from 'src/user/entity/user.entity';
  import { TypeOrmModule } from '@nestjs/typeorm';
  import { FileEntity } from './entity/file.entity';

  @Module({
  imports: [
    TypeOrmModule.forFeature([
      FileEntity,
      UserEntity,
    ]),
  ],
  controllers: [FileController],
  providers: [FileService],
  })
  export class FileModule {};
```


#### Entity
```ts
  import { Expose, Transform } from "class-transformer";
  import { UserEntity } from "src/user/entity/user.entity";
  import { Column, CreateDateColumn, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
  
  @Entity()
  export class FileEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        unique: true,
    })
    title: string;

    @ManyToOne(
        () => UserEntity,
        (user) => user.creator,
        {
          // Block null value in related table
          nullable: false,
          // Automatically allow to insert or update data into related entities
          cascade: true,
        }
    )
    creator: UserEntity;

    @ManyToOne(
        () => UserEntity,
        user => user.id
    )
    user: UserEntity;

    // Create a column in the table
    @Column()
    // Argument to be able to show up as result
    @Expose()
    // Automatically processes when requested data during conversion as DTO
    @Transform(({value}) => `http://localhost:3000/${value}`)
    filePath: string;

    @CreateDateColumn()
    createdAt?: Date;

    @UpdateDateColumn()
    updatedAt?: Date;
  }
```


#### Controller
```ts
  @Controller('file')
  export class FileController {
    constructor(
      private readonly fileService: FileService,
    ) { }

    @Get()
    getFiles() {
      return this.fileService.getFiles();
    };

    @Get(':id')
    getFileById(
      @Param('id', ParseIntPipe) id: number,
    ) {
      return this.fileService.getFileById(id);
    };

    @Patch(':id')
    update(
      @Param('id', ParseIntPipe) id: number,
      @Body() updateFileDto: UploadFileDto,
    ) {
      return this.fileService.updateFile(id, updateFileDto);
    }

    @Delete(':id')
    delete(
      @Param('id', ParseIntPipe) id: number,
    ) {
      return this.fileService.deleteFile(id);
    }
  }
```


#### Service
```ts
import { BadRequestException, ClassSerializerInterceptor, Injectable, InternalServerErrorException, NotFoundException, UseInterceptors } from '@nestjs/common';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from 'src/user/entity/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';
import { rename } from 'fs/promises';
import path, { join } from 'path';
import { UpdateFileDto } from './dto/update-uploadFile.dto';

@Injectable()
@UseInterceptors(ClassSerializerInterceptor)
export class FileService {

  constructor(
    // Declaring TypeORM dependency injection pattern
    private readonly dataSource: DataSource,

    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) { };


  async getFiles() {
    return await this.fileRepository.createQueryBuilder('file')
      .getManyAndCount();
  };


  async getFileById(id: number) {
    const file = await this.fileRepository.createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator')
      .where('file.id = :id', { id })
      .getOne();

    if (!file) {
      throw new NotFoundException("Where's your file?! There ain't file!");
    }

    return file;
  };


  async uploadVideo(uploadFileDto: UploadFileDto, userId: number) {

    // Create QueryRunner, for transactional consistency to build and execute PostgreSQL queries
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Creates two relative file paths, to store file before processing.
      const temporaryFolder = join('file', 'temp');
      const uploadFolder = join('file', 'upload');

      // Creates a QueryBuilder, which allows to build and execute PostgeSQL queries.
      const upload = await queryRunner.manager.createQueryBuilder()
        .insert()
        .into(FileEntity)
        .values({
          title: uploadFileDto.title,
          creator: {
            id: userId,
          },
          // `path.normalize` is a Node.Js built-in function in 'path' module that standardize file path string to avoid path conflict when joining or comparing.
          // `join()` is also a Node.Js built-in utility function in 'path' module that uses correct OS file path separator, `/`(POSIX) or `\`(Windows), then concatenates path string and normalize string path.
          filePath: path.normalize(join(uploadFolder, uploadFileDto.filePath))
            .replace('temp_', 'granted_')
            .replace(/\\/g, '/'),
        })
        .execute();


      // Create file Id
      const fileId = upload.identifiers[0].id;

      // Verify upload file existence
      if (!upload) {
        throw new NotFoundException(`No Uploads Found.`);
      };

      // Relocate file from 'temp' folder to 'upload' folder.
      await rename(
        join(process.cwd(), temporaryFolder, uploadFileDto.filePath),
        join(process.cwd(), uploadFolder, uploadFileDto.filePath),
      );

      // Commit Transaction
      await queryRunner.commitTransaction();

      return this.fileRepository.findOne({
        where: {
          id: fileId,
        },
      });

    } catch (error) {
      console.log(error);

      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException("Transcation Abort");

    } finally {
      await queryRunner.release();
    };
  }


  async updateFile(id: number, updateFileDto: UpdateFileDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find File
      const file = await queryRunner.manager.findOne(FileEntity, {
        where: {
          id,
        },
      });

      // Verify File
      if (!file) {
        throw new NotFoundException("No File Found.");
      };

      // Extract Specific Arguments
      const { title, userId, filePath } = updateFileDto;

      // Create Update Object
      const updateFields: Partial<FileEntity> = {};

      // Title Update
      if (title)
        updateFields.title = title;

      // File path label validation
      if (filePath) {
        if (filePath.startsWith('temp_')) {
          // Throw error if the file doesn't exist in 'temp' folder
          throw new BadRequestException("The file must be in upload folder.");
        } 
        if(filePath.startsWith(`granted_`)) {
          // Proceed upload if file exist in 'upload' folder
          updateFields.filePath = filePath;
        } 
        else {
          throw new BadRequestException("Attach file again.");
        }
      };

      // userId Update
      if (userId) {
        const creator = await this.userRepository.findOne({
          where: { id: userId },
        });

        if (!creator) {
          throw new NotFoundException("No User Found.");
        };

        updateFields.creator = creator;
      };

      // Total Update
      await queryRunner.manager.createQueryBuilder()
        .update(FileEntity)
        .set(updateFields)
        .where('id = :id', { id })
        .execute();

      // Commit Transaction 
      await queryRunner.commitTransaction();

      // Return Update Result
      return await this.fileRepository.findOne({
        where: {
          id,
        },
        relations: ['creator'],
      });

    } catch (error) {
      // ? It rollbacks the changes were made to start all over again.
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      //? It releases manually occupied DB connections by queryRunner.
      await queryRunner.release();
    };
  }


  async deleteFile(id: number) {
    const file = await this.fileRepository.findOne({
      where: {
        id,
      },
    });

    if (!file) {
      throw new NotFoundException("No File Found.");
    }

    await this.fileRepository.delete(id);

    return `The file ${id} is deleted`;
  };
}
```


### User
Packages
- @nestjs/common
- @nestjs/typeorm
- typeorm
- bcrypt
- class-transformer
- class-validator


#### Entity
```ts
  import { Exclude } from "class-transformer";
  import { IsEmail, IsNotEmpty, IsString } from "class-validator";
  import { FileEntity } from "src/file/entity/file.entity";
  import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

  @Entity()
  export class UserEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        unique: true,
    })
    @IsEmail()
    @IsString()
    @IsNotEmpty()
    email: string;
    
    @Column()
    @IsString()
    @IsNotEmpty()
    @Exclude({
        toPlainOnly: true,
    })
    password: string;

    @OneToMany(
        () => FileEntity,
        (file) => file.creator,
    )
    creator: FileEntity[];

    @OneToMany(
        () => FileEntity,
        file => file.user,
    )
    files: FileEntity[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
  }
```


#### Module
```ts
import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';

@Module({
imports: [
  TypeOrmModule.forFeature([
    UserEntity,
  ]),
],
controllers: [UserController],
providers: [UserService],
})
export class UserModule {}
```


#### Controller
```ts
import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('user')
@ApiTags("User API")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class UserController {

  constructor(
    private readonly userService: UserService,
  ) { };


  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }


  @Get()
  findAll() {
    return this.userService.findAll();
  }


  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }


  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.userService.remove(id);
  }
}

```


#### Service
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly configService: ConfigService,
  ) { };


  async create(createUserDto: CreateUserDto) {

    const { email, password } = createUserDto;

    const user = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    if (user) {
      throw new BadRequestException('Registration failed');
    };


    // Hashing user password
    const hash = await bcrypt.hash(password, this.configService.getOrThrow<number>("HASH_ROUNDS"));


    await this.userRepository.save({
      email,
      password: hash,
    });

    return await this.userRepository.findOne({
      where: {
        email,
      },
    });
  };


  async findAll() {
    return await this.userRepository.findAndCount();
  };


  async findOne(id: number) {
    const user = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    if (!user) {
      throw new NotFoundException(`User Cannot Found`);
    };

    return user;
  }


  async update(id: number, updateUserDto: UpdateUserDto) {

    // Bring password from DTO
    const { password } = updateUserDto;

    // Find the user by id
    const user = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    // Checking the user 
    if (!user) {
      throw new NotFoundException('No User Found.');
    };
    
    // Password verify
    if (password) {
      // Generate salt rounds
      const genSalt = await bcrypt.genSalt(10);
      
      // Password
      const hash = await bcrypt.hash(password, genSalt);

      // Apply hash to password
      updateUserDto.password = hash;
    };

    // Update
    await this.userRepository.update(
      { id },
      {
        email: updateUserDto.email,
        password: updateUserDto.password,
      },
    );

    // Returning result to client
    return await this.userRepository.findOne({
      where: {
        id,
      },
    });
  }


  async remove(id: number) {
    const user = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    if (!user) {
      throw new NotFoundException(`User Not Found.`);
    }

    await this.userRepository.delete(id);

    return `The user ${id} is deleted`;
  };
}
```


### Auth
Implemention of two ways of sign-in endpoints.
- Basic Authentication
- Token-based Authentication

Packages
- @nestjs/common
- @nestjs/config
- typeorm
- @nestjs/typeorm
- class-transformer
- class-validator
- bcrypt
- @types/bcrypt
- @nestjs/jwt
- passport-jwt
- @types/passport-jwt
- @nestjs/swagger


#### Authentication Flow
Controller -> Guard -> Strategy -> AuthService

Authentication Flow
1. Register
- `POST /auth/register`: Basic authentication
2. Sign In
- `POST /auth/signin`: Receive both access and refresh tokens
3. Access Token
- `Bearer <token>`: Use when to requests
4. Refresh Token
- `POST /auth/token/refreshaccess`: Use when access expires


#### Module
```ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from 'src/user/user.module';
import { JwtModule } from '@nestjs/jwt';
import { UserEntity } from 'src/user/entity/user.entity';
import { LocalStrategy } from './strategy/local.strategy';
import { JwtStrategy } from './strategy/jwt.strategy';
import { UserService } from 'src/user/user.service';
import { PassportModule } from '@nestjs/passport';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
    ]),
    PassportModule.register({ 
      session: false, 
      defaultStrategy: "jwt",
    }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, UserService, LocalStrategy, JwtStrategy],
  exports: [],
})
export class AuthModule { }
```


#### Controller
```ts
import { Controller, Post, Headers, Request, UseGuards, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guard/local-auth.guard';
import { JwtAuthGuard } from './guard/jwt-auth.guard';
import { ApiBasicAuth, ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { UserEntity } from 'src/user/entity/user.entity';
import { bearerTokenType, tokenType } from './dto/token-types.auth.dto';

@Controller('auth')
@ApiTags("Authentication API")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) { }

  // A Rroute handler decorator, Routes (Get, Post, Patch, Put, Delete) HTTP request to the specific path.
  @Post('register')
  @ApiBasicAuth()
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 201,
    description: "Created User.",
    type: UserEntity,
  })
  @ApiOperation({
    description: "Register User with Basic Token",
  })
  // A route handler parameter decorator, extracts the headers property from the `req` object and populates the decorated parameter with the value of headers.
  register(@Headers('authorization') rawToken: string) {
    return this.authService.register(rawToken);
  };

  
  // Sign in route
  @Post('signin')
  @ApiBasicAuth()
  @ApiResponse({
    status: 201,
    description: "Sign In Successed.",
    type: tokenType,
    schema: {
      example: {
        refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      }
    },
  })
  @ApiResponse({
    status: 400,
    description: "Bad Request.",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid Credentials. Wrong email or password.",
  })
  signIn(@Headers('authorization') rawToken: string) {
    return this.authService.signIn(rawToken);
  };


  // Issueing a refresh access token to let not users redo login
  @Post('token/refreshaccess')
  @ApiBearerAuth()
  @ApiResponse({
    status: 201,
    description: "Issued Token Successfully.",
    type: bearerTokenType,
    example: {
      accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    },
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized. Insert the refresh token from the 'signin' API to get the access token.",
  })
  async refreshAccessToken(@Headers("authorization") rawToken: string) {
    const payload = await this.authService.parseBearerToken(rawToken, true);

    return {
      accessToken: await this.authService.issueToken(payload, false)
    };
  };


  // Using an `AuthGuard` that `@nestjs/passport` automatically provisioned when extend the 'passport-local' strategy.
  // `LocalAuthGuard` used literal string for avoiding conflict between duplicated strings.
  @UseGuards(LocalAuthGuard)
  @Post('signin/local')
  @ApiOperation({
    description: "Sign in using alternative Passport local strategy."
  })
  @ApiResponse({
    status: 201,
    description: "Issued Token Successfully.",
    type: tokenType,
  })
  @ApiResponse({
    status: 401,
    description: "Invalid Credentaials.",
  })
  @ApiBody({
    type: CreateUserDto,
    required: true,
  })
  async userLocalLoginPassport(@Request() req) {
    return {
      refreshToken: await this.authService.issueToken(req.user, true),
      accessToken: await this.authService.issueToken(req.user, false),
    };
  };


  // Set role what a user can do.
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiResponse({
    status: 201,
    description: "Issued Token Successfully.",
    type: UserEntity,
  })
  async managerSignIn(@Request() req) {
    return req.user;
  };
}
```


#### Service
```ts
import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { UserEntity } from 'src/user/entity/user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Payload } from './interface/payload-interface';

@Injectable()
export class AuthService {
  constructor(
    // Inject the TypeORM repository for User Entity to use in DB.
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) { };


  async parseBasicToken(rawToken: string) {

    // 1. Splits token by basic and token. Regex(/\s+/) inserted for clearer space.
    // ['Basic', token]
    const basicToken = rawToken.split(" ");

    // 2. If the token length `[Basic token]` isn't 2, throw `BadRequestException` since it's wrong approach for parsing token.
    if (basicToken.length !== 2) {
      throw new BadRequestException('Bad Token Format.');
    };

    // 3. Extracts and sort out by basic and token from the splitted rawToken once again.
    const [basic, token] = basicToken;

    // 4. Verifies the token.
    if (basic.toLowerCase() !== 'basic') {
      throw new BadRequestException('Bad Token Format.');
    };

    // 5. Decodes extracted raw token from HTTP headers, then convert into readable code.
    const decoded = Buffer.from(token, 'base64').toString('utf-8');

    // 6. Split the decoded token by email and password.
    const tokenSplit = decoded.split(":");

    // 7. Verifies if the token includes basic.
    if (!(tokenSplit.length == 2)) {
      throw new BadRequestException('Bad Token Format.');
    };

    // 8. Extract email and password for returning to client.
    const [email, password] = tokenSplit;

    // 9. Return result.
    return {
      email,
      password,
    };
  }


  async register(rawToken: string) {

    // Extracts email and password from basic token
    const { email, password } = await this.parseBasicToken(rawToken);

    // Finds user by email
    const user = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    // Verifies if user exist or not
    if (user) {
      throw new BadRequestException("User Aleady Exist.");
    };

    // Hashing the password by bcrypt in secret hashig rounds
    const hash = await bcrypt.hash(password, this.configService.getOrThrow<number>('HASH_ROUNDS'));

    // Stores user email and hashed password by TypeORM method
    await this.userRepository.save({
      email,
      password: hash,
    });

    // Finds user's email returning to client by TypeORM method
    return await this.userRepository.findOne({
      where: {
        email,
      },
    });
  };


  async validateUser(email: string, password: string) {
    const user = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    if (!user) {
      throw new BadRequestException("Invalid User.");
    };

    const verification = await bcrypt.compare(password, user.password);

    if (!verification) {
      throw new BadRequestException("Invalid User.");
    };

    return user;
  };


  async issueToken(user: UserEntity, isRefreshToken: boolean) {

    // Bring refreshToken and accessToken to issue token for creating user accessing validation.
    const refreshToken = this.configService.getOrThrow<string>('REFRESH_TOKEN_SECRET');
    const accessToken = this.configService.getOrThrow<string>('ACCESS_TOKEN_SECRET');

    const payload: Payload = {
      sub: user.id,
      type: isRefreshToken ? 'refresh' : 'access',
    };

    // Since Nodejs single thread feature cannot process another request synchronously as the event loop gets blocked, creating JWT token asynchronously enhances the throughput getting other requests.
    return await this.jwtService.signAsync(
      payload,
      // `JwtSignOptions` Can also be set in `auth.module.ts` file, since it requires separated tokens, the options should be set manually.
      {
        secret: isRefreshToken ? refreshToken : accessToken,
        expiresIn: isRefreshToken ? this.configService.getOrThrow<number>("REFRESH_TOKEN_SECRET_EXPIRES_IN") : this.configService.getOrThrow<number>("ACCESS_TOKEN_SECRET_EXPIRES_IN"),
      },
    );
  };


  async parseBearerToken(rawToken: string, isRefreshToken: boolean) {
    try {
      const bearerToken = rawToken.split(' ');

      if (!(bearerToken.length == 2)) {
        throw new BadRequestException("Bad Token Format.");
      };

      const [bearer, token] = bearerToken;

      if (bearer.toLowerCase() !== "bearer") {
        throw new BadRequestException("Bad Token Format.");
      };

      const payload = await this.jwtService.verifyAsync(
        token,
        {
          secret: this.configService.getOrThrow<string>(
            isRefreshToken ? "REFRESH_TOKEN_SECRET" : "ACCESS_TOKEN_SECRET"
          ),
        },
      );

      if (isRefreshToken) {
        if (payload.type !== "refresh") {
          throw new BadRequestException("Insert Refresh Token.");
        };
      } else {
        if (payload.type !== "access") {
          throw new BadRequestException("Insert Access Token.");
        }
      };

      return payload;

    } catch (err) {

      throw new UnauthorizedException("Token Expired");
    }
  }


  async signIn(rawToken: string) {

    // Extracts email and password
    const { email, password } = await this.parseBasicToken(rawToken);

    // Authenticates email and password
    const user = await this.validateUser(email, password);

    return {
      refreshToken: await this.issueToken(user, true),
      accessToken: await this.issueToken(user, false),
    };
  };
}
```


#### DTO
```ts
import { ApiProperty } from "@nestjs/swagger";

export class bearerTokenType {
    @ApiProperty({
        description: "JWT access token",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    })
    accessToken: string;
};

export class tokenType {
    @ApiProperty({
        description: "JWT refresh token",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    })
    refreshToken: string;

    @ApiProperty({
        description: "JWT access token",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    })
    accessToken: string;
};
```


#### Passport
Passport is a way of authenticating system easy and various signing way such as Local strategy, Google, Facebook, etc.

In this project, the Local strategy will handle user authentication as well as authorizaion through JWT strategy.

Packages
- @passport
- @nestjs/passport
- @passport-local
- @types/passport-local

- @passport-jwt
- @nestjs/jwt
- @types/passport-jwt      


##### Strategy
Create a folder `strategy` in `src`, and create two of files called `local.strategy.ts` and `jwt.strategy.ts`. 

- `local.strategy.ts`
```ts
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-local";
import { AuthService } from "../auth.service";
import { UserEntity } from "src/user/entity/user.entity";


@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, "local-auth-guard") {
    constructor(private readonly authService: AuthService) {
        super({
            // Change request variable names
            usernameField: "email",
            passwordField: "password",
        });
    };

    async validate(email: string, password: string): Promise<UserEntity> {

        const user = await this.authService.validateUser(email, password);

        if (!user) {
            throw new UnauthorizedException("User Validation Failed");
        }

        return user;
    };
}
```

- `jwt.strategy.ts`
```ts
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Payload } from "../interface/payload-interface";
import { UserEntity } from "src/user/entity/user.entity";
import { UserService } from "src/user/user.service";


@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt-auth-guard") {
    constructor(
        private readonly configService: ConfigService,
        private readonly userService: UserService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow("ACCESS_TOKEN_SECRET"),
        });
    };


    // Exclue `password` via `Omit<>` generic type.
    async validate(payload: Payload): Promise<Omit<UserEntity, 'password'>> {
        const user = await this.userService.findOne(payload.sub);

        if (!user) {
            throw new UnauthorizedException("User Not Found.");
        };

        const { password, ...rest } = user;

        return rest;
    };
}
```


##### Guard
- `local-auth.guard.ts`
```ts
import { AuthGuard } from "@nestjs/passport";

export class LocalAuthGuard extends AuthGuard("local-auth-guard") { };
```

- `jwt-auth.guard.ts`
```ts
import { AuthGuard } from "@nestjs/passport";

export class JwtAuthGuard extends AuthGuard("jwt-auth-guard") { };
```


### Swagger
Swagger is a set of tools that provides documentation via Swagger UI, testing through Swagger-editor, based on the OAS(OpenAPI Specifictaion), using an OpenAPI document to describes APIs.


Packages
- @nestjs/swagger


#### nest-cli.json
Implement swagger as plugins in `nest-cli.json` compiler options to generate automatically APIs in swagger.
```
  "compilerOptions": {
    "plugins": ["@nestjs/swagger"]
  }
```
Able to see all of endpoints in this Swagger UI: `http://localhost:3000/doc`


#### Main
```ts
async function bootstrap() {

  // Swagger Set Up
  const config = new DocumentBuilder()
    .setTitle("File Upload Main")
    .setDescription("File Uplaod API Description")
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
```


##### Decorators
Each of decorators used to describe with front-end what they should return and how they are working.

- @ApiTags()
- @ApiBasicAuth()
- @ApiBearerAuth()
- @ApiOperation()
- @ApiProperty()
- @ApiBody()
- @ApiResponse()


### Test
- Unit Testing

The tests codes are defined and can run in `spec.ts`.

Relocate testing directory from the relative path `src` to the separate root `["src"]` in `Package.json`.

The directories wrapped in an array gives flexibility to add more test locations later such as e2e testing.

**Single base directory**
```json
"jest": {
  "rootDir": "src",
}
```

**Multi-base directories**
```json
"jest": {
  "roots": ["src"],
}
```


- In `coveragePathIgnorePatterns`, it creates and passes in what not to test in `Package.json`.
```json
"coveragePathIgnorePatterns": [
  "main.ts",
  "module.ts",
  "dto.ts",
  "entity.ts",
  "decorator.ts",
  "strategy.ts",
  "guard.ts",
  "controller.ts"
],
```


- It sets output directory for coverage reports in parents directory, one level above the config file  in `Package.json`.
```json
  "coverageDirectory": "../coverage",
```

```json
  "coverageDirectory": "./coverage",
```


- It maps module import paths using Regex to change `src/utils` into `<rootDir>/src/utils` in `Package.json`.
```json
"moduleNameMapper": {
  "src/(.*)": "<rootDir>/src/$1"
}
```


#### File
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { FileService } from './file.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository, QueryRunner } from 'typeorm';
import { FileEntity } from './entity/file.entity';
import { UserEntity } from 'src/user/entity/user.entity';
import { NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises');

describe('FileService', () => {
  // Using let will inherit mock instances when the mock gets cleared.
  let fileService: FileService;
  let fileRepository: Repository<FileEntity>;
  let userRepository: Repository<UserEntity>;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  // Mock data
  const mockFileEntity: FileEntity = {
    id: 1,
    title: 'Test File',
    filePath: 'file/upload/granted_test.mp4',
    creator: { id: 1, username: 'testuser' } as any as UserEntity,  // `as any as UserEntity` for type safety
    createdAt: new Date(),
    updatedAt: new Date(),
  } as FileEntity;

  const mockUser: UserEntity = {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
  } as any as UserEntity;

  beforeEach(async () => {
    // Mock QueryRunner
    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(),
        findOne: jest.fn(),
      },
    };

    // Mock DataSource
    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    // Mock Repository methods
    const mockFileRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const mockUserRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(FileEntity),
          useValue: mockFileRepository,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    fileService = module.get<FileService>(FileService);
    fileRepository = module.get<Repository<FileEntity>>(getRepositoryToken(FileEntity));
    userRepository = module.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    dataSource = module.get<DataSource>(DataSource);
    queryRunner = dataSource.createQueryRunner();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });


  describe('uploadFile', () => {
    const uploadFileDto = {
      title: 'New Video',
      userId: 1,
      filePath: 'temp_video.mp4',
    };

    it('should successfully upload a file', async () => {
      const mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      };

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockInsertQueryBuilder);
      (fs.rename as jest.Mock) = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      const result = await fileService.uploadFile(uploadFileDto, 1);

      expect(result).toEqual(mockFileEntity);
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      const mockInsertQueryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('DB Error')),
      };

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockInsertQueryBuilder);

      await expect(fileService.uploadFile(uploadFileDto, 1)).rejects.toThrow(InternalServerErrorException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });


  describe('updateFile', () => {
    it('should update file title successfully', async () => {
      const updateFileDto = { title: 'Updated Title' };

      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockUpdateQueryBuilder);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue({ ...mockFileEntity, title: 'Updated Title' });

      const result = await fileService.updateFile(1, updateFileDto);

      expect(result).toBe('Updated Title');
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it("should throw 'NotFoundException' when file is not found", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(null);

      await expect(fileService.updateFile(1, { title: 'Test' })).rejects.toThrow(NotFoundException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it("should throw 'BadRequestException' for 'temp_' file path", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      await expect(
        fileService.updateFile(1, { filePath: 'temp_video.mp4' })
      ).rejects.toThrow(BadRequestException);
    });

    it("should update file path with 'granted_' prefix", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);

      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockUpdateQueryBuilder);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await fileService.updateFile(1, { filePath: 'granted_video.mp4' });

      expect(mockUpdateQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'granted_video.mp4' })
      );
    });

    it("should update creator when 'userId' provided", async () => {
      queryRunner.manager.findOne = jest.fn().mockResolvedValue(mockFileEntity);
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

      const mockUpdateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      queryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockUpdateQueryBuilder);
      jest.spyOn(fileRepository, 'findOne').mockResolvedValue(mockFileEntity);

      await fileService.updateFile(
        1,
        { userId: 1 }
      );

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });
});
```


#### User
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';


describe('UserService', () => {
  let userService: UserService;
  let configService: ConfigService;

  const mockUserRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
    configService = module.get<ConfigService>(ConfigService);
  });

  // Clears the mock.calls and mock.instances properties of all mocks.
  afterEach(() => {
    jest.clearAllMocks();
  });


  describe("create", () => {
    it('should create a new user.', async () => {
      const createUserDto: CreateUserDto = {
        email: "email@gamil.com",
        password: "PrivatePassword",
      };

      const genSalt = 10;
      const userId = 1;
      const email = "email@gamil.com";
      const hashed = genSalt;

      const result = {
        id: userId,
        email: email,
        password: hashed,
      };

      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue(genSalt);
      jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve(hashed));
      // Inserting `null` does explicitly include the 'failed search'.
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValueOnce(null).mockResolvedValueOnce(result);

      const newUser = await userService.create(createUserDto);

      expect(newUser).toEqual(result);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { email: createUserDto.email } });
      expect(bcrypt.hash).toHaveBeenCalledWith(createUserDto.password, genSalt);
      expect(mockUserRepository.save).toHaveBeenCalledWith({ email: createUserDto.email, password: hashed, });
    });

    it('should throw a BadRequestException when the user already exist.', async () => {
      const createUserDto: CreateUserDto = {
        email: "email@gamil.com",
        password: "PrivatePassword",
      };

      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue({ id: 1, email: createUserDto.email, });

      expect(userService.create(createUserDto)).rejects.toThrow(BadRequestException);
      expect(mockUserRepository.save).not.toHaveBeenCalledWith();
    });
  });


  describe("update", () => {
    it('should update a new user.', async () => {
      const updateUserDto: UpdateUserDto = {
        email: "email@gamil.com",
        password: "PrivatePassword",
      };

      const genSalt = 10;
      const userId = 1;
      const email = "email@gamil.com";
      const hashed = genSalt;

      const user = {
        id: userId,
        email: email,
        password: hashed,
      };

      jest.spyOn(mockUserRepository, 'findOne')
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ ...user, password: hashed });
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue(genSalt);
      jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve(hashed));
      jest.spyOn(mockUserRepository, 'update').mockImplementation(() => Promise.resolve(user));

      const updatedUser = await userService.update(userId, updateUserDto);

      expect(updatedUser).toEqual({ ...user, password: hashed });
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 }, });
      expect(bcrypt.hash).toHaveBeenCalledWith(updateUserDto.password, genSalt);
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        {
          email: updateUserDto.email,
          password: hashed,
        },
      );
    });

    it("should throw a NotFoundException when the user doesn't exist.", async () => {
      const updateUserDto: UpdateUserDto = {
        email: "email@gamil.com",
        password: "PrivatePassword",
      };

      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      expect(userService.update(1, updateUserDto)).rejects.toThrow(NotFoundException);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });
});
```


#### Auth
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { Repository } from 'typeorm';
import { UserEntity } from 'src/user/entity/user.entity';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';


describe('AuthService', () => {
  let authService: AuthService;
  let userRepository: Repository<UserEntity>;
  let configService: ConfigService;
  let jwtService: JwtService;

  // Mocking 
  const mockUserEntity: UserEntity = {
    id: 1,
    email: "test@gmail.com",
    password: "Test123Password",
    creator: [],
    files: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };


  beforeEach(async () => {
    // Testing basic mocks
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    userRepository = module.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    configService = module.get<ConfigService>(ConfigService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  })


  describe("parseBasicToken", () => {
    it("should parse valid basic token", async () => {
      // Create base64 encoded token => email:password
      const token = Buffer.from("test@gmail.com:Test123Password").toString('base64');
      const rawToken = `Basic ${token}`;

      const result = await authService.parseBasicToken(rawToken);

      expect(result.email).toBe("test@gmail.com");
      expect(result.password).toBe("Test123Password");
    });

    it("should throw `BadReqeustException` for invalid token format", () => {
      const InvalidRawToken = "InvalidTokenFormat";
      expect(authService.parseBasicToken(InvalidRawToken)).rejects.toThrow(BadRequestException);
    });

    it("should throw an error for invalid basic token format", () => {
      const InvalidRawToken = "Basic token";
      expect(authService.parseBasicToken(InvalidRawToken)).rejects.toThrow(BadRequestException);
    });

    it("should throw an error for invalid refresh access token format", () => {
      const InvalidBearerToken = "Bearer token";
      expect(authService.parseBasicToken(InvalidBearerToken)).rejects.toThrow(BadRequestException);
    });
  });


  describe("parseBearerToken", () => {
    it("should parse a bearer token", async () => {
      const rawToken = "BearerToken";
      const payload = { type: "access" };

      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(payload);
      jest.spyOn(mockConfigService, 'getOrThrow').mockResolvedValue('secret');

      const result = await authService.parseBearerToken(rawToken, false);

      expect(result).toEqual(payload);
    });

    it("should throw BadRequestException for invalid token format", async () => {
      const token = "InvalidTokenFormat";
      expect(authService.parseBearerToken(token, false)).rejects.toThrow(new BadRequestException("Bad Token Format"));
    });

    it("should throw BadRequestException for not a bearer token", async () => {
      const token = "bEaReR token";
      expect(authService.parseBearerToken(token, false)).rejects.toThrow(new BadRequestException("Bad Token Format"));
    });

    it("should throw UnauthorizedException for not a refresh token", async () => {
      const token = "token";
      expect(authService.parseBearerToken(token, false)).rejects.toThrow(new UnauthorizedException("Token Expired"));
    });
  });


  describe("register", () => {
    // Base64 authentication decoded format => email:password => convert into utf-8 readable string
    const token = Buffer.from("test@gmail.com:Test123Password").toString('utf-8');
    const BasicToken = `Basic ${token}`;
    const hashRounds = 10;
    const email = "test@gmail.com";
    const password = "Test123Password";
    const hashedPassword = "HashedPassword";

    it("should register a new user", async () => {
      // Mocking user's findOne to resolve value
      mockUserRepository.findOne
        .mockResolvedValue(null)
        .mockResolvedValueOnce({ email: "test@gmail.com", password: hashedPassword });
      // Mocking user's save to resolve value
      mockUserRepository.save.mockResolvedValueOnce({ email: "test@gmail.com", password: "Test123Password" });
      // Mocking ConfigService's getOrThrow to resolve value
      mockConfigService.getOrThrow.mockResolvedValue(hashRounds);

      // `bcrypt.compare` is async, thus it returns a `Promise`.
      jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve(hashedPassword));

      const result = await authService.register(BasicToken);

      expect(bcrypt.hash).toHaveBeenCalledWith(password, hashRounds);
      expect(mockUserRepository.save).toHaveBeenCalled();
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ email: "test@gmail.com" });
      expect(result).toEqual({ email, password: "Test123Password" });
    });

    it("should throw `BadRequestException` when user already Exist", async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUserEntity);

      await expect(authService.register(BasicToken)).rejects.toThrow(new BadRequestException("User Aleady Exist."));

      // Testing that save wasn't called
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });
  });


  describe("validateUser", () => {
    const email = "test@gmail.com";
    const password = "#Test@123$Password!";
    const user = {
      email,
      password: "Hashed@123!Password",
    };

      it("should validate user", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(user);
      // `bcrypt.compare` is async, thus it returns a `Promise`.
      jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

      const result = await authService.validateUser(email, password);

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { email } });
      expect(bcrypt.compare).toHaveBeenCalledWith(password, "Hashed@123!Password");
      expect(result).toEqual(user);
    });

    it("should throw a BadRequestException for invalid user", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(authService.validateUser(email, password)).rejects.toThrow(new BadRequestException("Invalid User."));
    });

    it("should throw a BadRequestException when user password is incorrect", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(user);
      jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));
      // jest.spyOn(bcrypt, 'compare').mockImplementation((a, b) => false);

      await expect(authService.validateUser(email, password)).rejects.toThrow(new BadRequestException("Invalid User."));
    });
  })


  describe("issueToken", () => {
    const user = { id: 1 };
    const token = "token";

    beforeEach(() => {
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue('secret');
      jest.spyOn(jwtService, 'signAsync').mockResolvedValue(token);
    })

    it("should issue an refresh token", async () => {
      const result = await authService.issueToken(user as UserEntity, true);

      // Jwt decoded payload
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: user.id, type: 'refresh' },
        { secret: 'refresh', expiresIn: 180 },
      );
      expect(result).toBe(token);
    });

    it("should issue an access token", async () => {
      const result = await authService.issueToken(user as UserEntity, false);

      // Jwt decoded payloads
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: user.id, type: 'access' },
        { secret: 'access', expiresIn: 180 },
      );
      expect(result).toBe(token);
    });
  });


  describe("signIn", () => {
    const rawToken = "Basic token";
    const email = "test@gmail.com";
    const password = "#Test@123$Password!";
    const user = {
      id: 1,
    };

    it("should sign in a user", async () => {
      jest.spyOn(authService, 'parseBasicToken').mockResolvedValue({ email, password });
      jest.spyOn(authService, 'validateUser').mockResolvedValue(user as UserEntity);
      jest.spyOn(authService, 'issueToken').mockResolvedValue("token");

      const result = await authService.signIn(rawToken);

      expect(authService.parseBasicToken).toHaveBeenCalledWith(rawToken);
      expect(authService.validateUser).toHaveBeenCalledWith(email, password);
      expect(authService.issueToken).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        refreshToken: 'token',
        accessToken: 'token',
      });
    });
  })
});
```


## Running Application
Below commands are list of ways to run the application

### Compile In Development
It compiles in real-time, a general way to run application in development by following command.
- Command : `pnpm run start:dev`


### Compile In Production
It converts TypeScript into JavaScript, store file in 'dist/' folder without running the application.
- Command : `pnpm run build`


### Running In Production
The Nodejs runs the compiled file from 'dist/' folder by following command.
- Command : `pnpm run start:prod`


## Result
### Request Configuration
Using `Postman` or `Swagger` helpful to send a request to inspect the result.

#### Attach File
- Attach File: POST => `http://localhost:3000/upload/attach/`
- Method: POST method
- Body type: form-data
- Key: video (type: File)
- Value: sample.mp4 (MP4 File)
  
- Attach File Result: 
```
{
  "filename": "temp_ded337b9-d85c-452f-bb8e-2ee71174500d_1763704838759.mp4"
}
```

- Response in Terminal
```
{
  "fieldname": "video",
  "originalname": "sample_file.mp4",
  "encoding": "7bit",
  "mimetype": "video/mp4",
  "destination": "Documents\\VScode\\Upload Board\\public\\video",
  "filename": "nameOfSampleFile",
  "path": "Documents\\VScode\\Upload Board\\public\\video\\nameOfSampleFile",
  "size": 3133226
}
```


#### Upload File 
- Upload File: POST => `http://localhost:3000/file/uploadFile/`
- Method: POST method
- Body type: form-data
- Key: video (type: File)
- Value: sample.mp4 (MP4 File)

- Upload File Result:
```
{
  "id": 1,
  "title": "1",
  "filePath": "http://localhost:3000/file/upload/granted_uuid_sample_video.mp4",
  "createdAt": "2025-11-21T06:00:51.485Z",
  "updatedAt": "2025-11-21T06:00:51.485Z"
}
```


## Scale Up In The Future
- Multi-file upload
- File type validation
- Video compression/processing
- Progress tracking for large uploads
- User-specific storage paths
- Deploy on AWS


License
MIT

Author
BLUECODE77732 - https://github.com/Bluecode77732