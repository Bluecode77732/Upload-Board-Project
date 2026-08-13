// Purpose: wires the board comment domain — its entity repository, two controllers, and service.
// Usage: imported by AppModule for routing, and by UserModule so account deletion can cascade into comment rows.
// Rationale: ADR 0023 gives comment its own module; the acyclic graph (User → {File, Post, Comment}, Post → File, Comment → Post) depends on this module importing PostModule and never the reverse.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentEntity } from './entity/comment.entity';
import { CommentService } from './comment.service';
import { CommentController } from './comment.controller';
import { PostCommentController } from './post-comment.controller';
import { PostModule } from 'backend/post/post.module';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';

@Module({
  // PostModule answers whether a post exists; it never imports this one, which is what
  // lets post deletion stay the database's cascade rather than a service round trip.
  imports: [
    TypeOrmModule.forFeature([CommentEntity]),
    PostModule,
    AuditLogModule,
  ],
  // Two controllers for two prefixes: a thread hangs off its post (/post/:postId/comment),
  // while an existing comment is addressed by its own id (/comment/:id) — ADR 0023.
  controllers: [PostCommentController, CommentController],
  providers: [CommentService],
  // Exported for UserModule: account deletion removes the comments the account wrote
  // anywhere, and those rows stay CommentModule's responsibility (ADR 0023 D5).
  exports: [CommentService],
})
export class CommentModule {}
