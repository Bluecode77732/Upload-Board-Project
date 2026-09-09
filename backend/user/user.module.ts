import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';
import { FileModule } from 'backend/file/file.module';
import { PostModule } from 'backend/post/post.module';
import { CommentModule } from 'backend/comment/comment.module';
import { StorageModule } from 'backend/storage/storage.module';

@Module({
  // File/Post/CommentModule이 각각 파일, 게시글, 댓글 행을 소유한 서비스를 제공하므로,
  // UserService가 어느 것도 직접 소유하지 않고도 계정 삭제를 셋 모두에 cascade할 수 있다
  // (ADR 0020, ADR 0023 D5). StorageModule은 계정이 소유한 저장 파일의 커밋 후 unlink를
  // 뒷받침한다 (ADR 0029).
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    AuditLogModule,
    FileModule,
    PostModule,
    CommentModule,
    StorageModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
