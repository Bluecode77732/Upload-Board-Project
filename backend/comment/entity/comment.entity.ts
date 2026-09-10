// 목적: 게시판 댓글 행 — 정확히 하나의 게시글에 매달린 작성 텍스트.
// 사용처: CommentService가 관리하고, UserService의 계정 캐스케이드는 CommentService를 통해서만 읽는다.
// 근거: ADR 0023의 스키마 게이트가 이 형태를 확정했다; PostEntity에 담으면 게시글 자체의 본문과 그 아래 스레드가 뒤섞인다.

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

// "한 게시글의 댓글을 오래된 순으로"가 이 테이블의 유일한 조회 형태이며, 앞쪽 컬럼은
// FK 역할도 겸한다 — AuditLogEntity와 같은 복합 인덱스 논리다(ADR 0023).
@Index('IDX_comment_entity_postId_createdAt', ['post', 'createdAt'])
@Entity()
export class CommentEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  body!: string;

  // PostEntity의 관계와 마찬가지로 단방향이다: UserEntity는 역방향 컬렉션을 갖지
  // 않는다 — 어떤 쿼리도 그걸 읽지 않기 때문이다(ADR 0023).
  @ManyToOne(() => UserEntity, { nullable: false })
  creator!: UserEntity;

  // 이 스키마의 유일한 DB 레벨 캐스케이드이며, 그냥 가정한 게 아니라 논거가 있다
  // (ADR 0023 D3): 댓글은 URL도 파일도 없고 게시글을 벗어난 독립적 존재도 아니라서,
  // 행이 사라지기 전에 미리 읽어야 할 게 없다. ADR 0020의 금지 규정은 여전히
  // FileEntity.creator에만 적용된다 — 거기는 unlink할 경로를 먼저 읽어야 하기 때문이다.
  @ManyToOne(() => PostEntity, { nullable: false, onDelete: 'CASCADE' })
  post!: PostEntity;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
