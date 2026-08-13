// Purpose: the board comment row — authored text hanging off exactly one post.
// Usage: managed by CommentService; read by UserService's account cascade through CommentService only.
// Rationale: ADR 0023's schema gate settled this shape; PostEntity cannot hold it without conflating a post's own text with the thread under it.

import { UserEntity } from 'backend/user/entity/user.entity';
import { PostEntity } from 'backend/post/entity/post.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// "One post's comments, oldest first" is this table's only query shape, and the leading
// column also serves the FK — the same composite reasoning as AuditLogEntity (ADR 0023).
@Index('IDX_comment_entity_postId_createdAt', ['post', 'createdAt'])
@Entity()
export class CommentEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  body!: string;

  // Unidirectional, as PostEntity's relations are: UserEntity gains no inverse
  // collection, because no query reads one (ADR 0023).
  @ManyToOne(() => UserEntity, { nullable: false })
  creator!: UserEntity;

  // The schema's only database-level cascade, and it is argued rather than assumed
  // (ADR 0023 D3): a comment has no URL, no file, and no existence outside its post, so
  // nothing needs reading before the rows go. ADR 0020's prohibition stays scoped to
  // FileEntity.creator, where the paths to unlink must be read first.
  @ManyToOne(() => PostEntity, { nullable: false, onDelete: 'CASCADE' })
  post!: PostEntity;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
