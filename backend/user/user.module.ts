import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';
import { SuperadminSeedService } from './superadmin-seed.service';
import { FileModule } from 'backend/file/file.module';
import { PostModule } from 'backend/post/post.module';

@Module({
  // FileModule and PostModule supply the services that own file rows and post rows, so
  // account deletion can cascade into both without UserService owning either
  // (ADR 0020, ADR 0023 D5).
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    AuditLogModule,
    FileModule,
    PostModule,
  ],
  controllers: [UserController],
  providers: [UserService, SuperadminSeedService],
  exports: [UserService],
})
export class UserModule {}
