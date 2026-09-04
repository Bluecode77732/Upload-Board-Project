import { IsNotEmpty, IsString } from 'class-validator';
import { UserEntity } from 'backend/user/entity/user.entity';
import { FileVisibility } from './file-visibility.enum';
import { FileMediaType } from './file-media-type.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 목적: 파일 목록을 최신순으로 보여줄 때(GET /file) 매번 전체를 다시 정렬하지 않게 한다.
// 이유: 예전엔 "나중에 데이터 많아지면 달아보자"고 미뤄뒀던 인덱스인데, 실제로 1만 개
//       데이터를 넣고 재봤더니 최대 27배까지 빨라졌다(docs/ADR/0049-performance-capacity-criteria.md).
@Index('IDX_file_entity_createdAt_id', ['createdAt', 'id'])
// 목적: 작성자로 필터링할 때(?creatorId=)와 계정 삭제 시 이 사용자 파일을 찾을 때 빠르게 찾게 한다.
// 이유: creatorId는 다른 테이블(user_entity)을 가리키는 컬럼인데, Postgres는 이런 컬럼을
//       자동으로 인덱싱해주지 않는다 — 실제로 재보니 3.6배 빨라졌다.
@Index('IDX_file_entity_creatorId', ['creator'])
// 제목 검색(?search=)용 인덱스(IDX_file_entity_title_trgm)는 여기 @Index로 선언하지 않는다.
// pg_trgm이라는 Postgres 확장 기능으로 만드는 특수한 인덱스라 TypeORM의 @Index 데코레이터로는
// 표현할 방법이 없고(연산자 클래스 지정 불가), 실제 생성은 마이그레이션 파일에서 직접 SQL로
// 한다. 이 때문에 앞으로 누군가 migration:generate를 돌리면 "이 인덱스를 지워라"는 엉뚱한
// diff가 나올 수 있다 — 베이스라인 마이그레이션 헤더가 이미 적어둔 것과 같은 종류의 노이즈이니
// 그때도 그냥 지우고 무시하면 된다.
@Entity()
export class FileEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ManyToOne(() => UserEntity, (user) => user.creator, {
    nullable: false,
    cascade: true,
  })
  creator!: UserEntity;

  @Column()
  @IsNotEmpty()
  @IsString()
  filePath!: string;

  // Which playback tag the content is (image/audio/video); server-derived from the
  // filePath extension at upload time, never client-supplied (ADR 0040 D2).
  @Column({ type: 'varchar' })
  mediaType!: FileMediaType;

  // Gates access to the stored bytes via GET /file/:id/content (ADR 0025 D1/D2).
  // Default private: a fresh upload is unreachable until the owner opts in.
  @Column({ type: 'varchar', default: FileVisibility.private })
  visibility!: FileVisibility;

  // Server-generated random opaque token (never a guessable id); set only while
  // visibility is 'unlisted', cleared otherwise. Rotation is the revocation mechanism
  // for a leaked link (ADR 0025 D3).
  @Column({ type: 'varchar', nullable: true })
  shareToken!: string | null;

  // Optional TTL on the current share token; null = no expiry (ADR 0025 D3).
  @Column({ type: 'timestamptz', nullable: true })
  shareExpiresAt!: Date | null;

  // The one user this file is currently proposed to, or null when no transfer is pending
  // (ADR 0050 D1/D2). Never set directly by an update — only the propose/accept/reject/
  // cancel flow in FileService writes this column. ON DELETE SET NULL: if the pending
  // target's own account is deleted before responding, only the pending state disappears —
  // this file (A's) is untouched, since B never became its owner.
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pendingTransferToUserId' })
  pendingTransferTo!: UserEntity | null;

  @CreateDateColumn()
  createdAt?: Date;

  @UpdateDateColumn()
  updatedAt?: Date;
}
