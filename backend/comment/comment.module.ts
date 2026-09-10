// 목적: 게시판 댓글 도메인 — 엔티티 리포지토리, 두 개의 컨트롤러, 서비스를 연결한다.
// 사용처: 라우팅을 위해 AppModule이 임포트하고, 계정 삭제가 댓글 행까지 캐스케이드할 수 있도록 UserModule도 임포트한다.
// 근거: ADR 0023이 comment에 자체 모듈을 부여했다; 비순환 그래프(User → {File, Post, Comment}, Post → File, Comment → Post)는 이 모듈이 PostModule을 임포트하고 그 반대는 절대 없어야 성립한다.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentEntity } from './entity/comment.entity';
import { CommentService } from './comment.service';
import { CommentController } from './comment.controller';
import { PostCommentController } from './post-comment.controller';
import { PostModule } from 'backend/post/post.module';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';

@Module({
  // PostModule이 게시글 존재 여부를 판단하고, 이 모듈을 절대 임포트하지 않는다 —
  // 그래야 게시글 삭제가 서비스 왕복이 아니라 DB 캐스케이드로 남는다.
  imports: [
    TypeOrmModule.forFeature([CommentEntity]),
    PostModule,
    AuditLogModule,
  ],
  // 두 프리픽스에 컨트롤러 두 개: 스레드는 게시글에 매달려 있고(/post/:postId/comment),
  // 기존 댓글은 자기 id로 지칭한다(/comment/:id) — ADR 0023.
  controllers: [PostCommentController, CommentController],
  providers: [CommentService],
  // UserModule을 위해 export: 계정 삭제는 그 계정이 어디에 썼든 댓글을 제거하는데,
  // 그 행들은 여전히 CommentModule의 책임이다(ADR 0023 D5).
  exports: [CommentService],
})
export class CommentModule {}
