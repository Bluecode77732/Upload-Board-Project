// Purpose: the board post row — authored text plus an optional 1:1 reference to one uploaded file.
// Usage: managed by PostService; read by UserService's account cascade through PostService only.
// Rationale: ADR 0023's schema gate settled this shape; no existing entity can hold post text without conflating file metadata with board content.

import { UserEntity } from 'backend/user/entity/user.entity';
import { FileEntity } from 'backend/file/entity/file.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class PostEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // Deliberately NOT unique, unlike FileEntity.title: a board where one title can be
  // used once across all authors is a defect (ADR 0023). Length is bounded at the DTO.
  @Column()
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  // Unidirectional: UserEntity gains no inverse collection. The one inverse that exists
  // today (UserEntity.creator) is read by zero queries, so a second one is dead weight.
  @ManyToOne(() => UserEntity, { nullable: false })
  creator!: UserEntity;

  // Unique + nullable: a post carries at most one video, a video belongs to at most one
  // post. The unique constraint is also POST /post's idempotency key, and the FK is what
  // turns deleting an attached file into a typed 409 instead of a 500 (ADR 0023 D1/D4).
  @OneToOne(() => FileEntity, { nullable: true })
  @JoinColumn()
  file!: FileEntity | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
