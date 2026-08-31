// Purpose: the board post row — authored text plus an optional 1:1 reference to one uploaded file.
// Usage: managed by PostService; read by UserService's account cascade through PostService only.
// Rationale: ADR 0023's schema gate settled this shape; no existing entity can hold post text without conflating file metadata with board content.

import { UserEntity } from 'backend/user/entity/user.entity';
import { FileEntity } from 'backend/file/entity/file.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 목적: 게시글 목록을 최신순으로 보여줄 때(GET /post) 매번 전체를 다시 정렬하지 않게 한다.
// 이유: FileEntity의 같은 인덱스와 함께 ADR 0021이 유예해 둔 후보였고, 1만 개 데이터로
//       재보니 최대 100배까지 빨라졌다(docs/ADR/0049-performance-capacity-criteria.md).
@Index('IDX_post_entity_createdAt_id', ['createdAt', 'id'])
// 목적: 작성자로 필터링할 때(?creatorId=)와 계정 삭제 시 이 사용자 글을 찾을 때 빠르게 찾게 한다.
// 이유: creatorId는 user_entity를 가리키는 컬럼인데, Postgres는 이런 컬럼을 자동으로
//       인덱싱해주지 않는다.
@Index('IDX_post_entity_creatorId', ['creator'])
// 제목 검색(?search=)용 인덱스(IDX_post_entity_title_trgm)도 FileEntity와 같은 이유로
// 여기 @Index로 선언하지 않는다 — pg_trgm GIN 인덱스는 연산자 클래스가 필요해 @Index
// 데코레이터로 표현이 안 되고, 실제 생성은 마이그레이션 파일의 SQL이 한다.
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
