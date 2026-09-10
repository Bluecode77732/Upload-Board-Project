// 목적: 게시글 행 — 작성한 텍스트와, 업로드된 파일 하나를 가리키는 선택적 1:1 참조.
// 사용처: PostService가 관리하며, UserService의 계정 삭제 cascade는 PostService를 통해서만 읽는다.
// 근거: ADR 0023의 스키마 결정이 이 형태를 확정했다 — 기존 엔티티 중 어느 것도 파일 메타데이터와 게시글 내용을 섞지 않고 글 텍스트를 담을 수 없었다.

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

  // FileEntity.title과 달리 의도적으로 unique가 아니다: 게시판에서 제목을 전체 작성자에
  // 걸쳐 한 번만 쓸 수 있게 하는 건 결함이다 (ADR 0023). 길이 제한은 DTO에서 건다.
  @Column()
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  // 단방향이다: UserEntity 쪽에는 역방향 컬렉션을 추가하지 않는다. 현재 존재하는 유일한
  // 역방향(UserEntity.creator)조차 어떤 쿼리도 읽지 않으니, 하나 더 두는 건 죽은 코드다.
  @ManyToOne(() => UserEntity, { nullable: false })
  creator!: UserEntity;

  // unique + nullable이다: 게시글 하나는 동영상을 최대 하나만 담고, 동영상 하나는
  // 게시글 하나에만 속한다. 이 unique 제약은 POST /post의 멱등성 키이기도 하고, FK는
  // 첨부 파일 삭제를 500이 아니라 타입 있는 409로 바꿔주는 장치다 (ADR 0023 D1/D4).
  @OneToOne(() => FileEntity, { nullable: true })
  @JoinColumn()
  file!: FileEntity | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
