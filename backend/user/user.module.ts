import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';
import { SuperadminSeedService } from './superadmin-seed.service';
import { FileModule } from 'backend/file/file.module';
import { PostModule } from 'backend/post/post.module';
import { CommentModule } from 'backend/comment/comment.module';

@Module({
  // File/Post/CommentModule supply the services that own file, post and comment rows, so
  // account deletion can cascade into all three without UserService owning any
  // (ADR 0020, ADR 0023 D5).
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    AuditLogModule,
    FileModule,
    PostModule,
    CommentModule,
  ],
  controllers: [UserController],
  providers: [UserService, SuperadminSeedService],
  exports: [UserService],
})
export class UserModule {}
