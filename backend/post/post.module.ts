// 목적: 게시판 도메인 — 엔티티 리포지토리, 컨트롤러, 서비스를 하나로 엮는다.
// 사용처: 라우팅을 위해 AppModule이 임포트하고, 계정 삭제가 게시글 행까지 cascade할 수 있도록 UserModule도 임포트한다.
// 근거: ADR 0023이 게시판 도메인에 자기 모듈을 부여한다 — 비순환 그래프(User → {File, Post}, Post → File)는 이 모듈이 FileModule을 임포트하고 그 역은 절대 없어야 성립한다.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostEntity } from './entity/post.entity';
import { PostService } from './post.service';
import { PostController } from './post.controller';
import { FileModule } from 'backend/file/file.module';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';

@Module({
  // FileModule은 파일을 첨부할 수 있는지 판단하고 공개 URL을 조립해준다;
  // FileModule은 이 모듈을 절대 임포트하지 않는다 (ADR 0023 D4가 그래프를 비순환으로 유지).
  imports: [TypeOrmModule.forFeature([PostEntity]), FileModule, AuditLogModule],
  controllers: [PostController],
  providers: [PostService],
  // UserModule을 위해 export한다: 계정 삭제는 게시글 행까지 cascade하지만, 그 행은
  // 여전히 PostModule의 책임이다 (모듈 경계, ADR 0023 D5).
  exports: [PostService],
})
export class PostModule {}
