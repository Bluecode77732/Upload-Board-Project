// Purpose: wires the board post domain — its entity repository, controller, and service.
// Usage: imported by AppModule for routing, and by UserModule so account deletion can cascade into post rows.
// Rationale: ADR 0023 gives the board domain its own module; the acyclic graph (User → {File, Post}, Post → File) depends on this module importing FileModule and never the reverse.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostEntity } from './entity/post.entity';
import { PostService } from './post.service';
import { PostController } from './post.controller';
import { FileModule } from 'backend/file/file.module';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';

@Module({
  // FileModule answers whether a file may be attached and composes its public URL;
  // FileModule never imports this one (ADR 0023 D4 keeps the graph acyclic).
  imports: [TypeOrmModule.forFeature([PostEntity]), FileModule, AuditLogModule],
  controllers: [PostController],
  providers: [PostService],
  // Exported for UserModule: account deletion cascades into post rows, and those rows
  // stay PostModule's responsibility (module boundary, ADR 0023 D5).
  exports: [PostService],
})
export class PostModule {}
