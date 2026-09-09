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

  // 콘텐츠가 어떤 재생 태그인지(image/audio/video); 업로드 시점 filePath 확장자로부터
  // 서버가 판정하며, 클라이언트가 넘긴 값이 아니다(ADR 0040 D2).
  @Column({ type: 'varchar' })
  mediaType!: FileMediaType;

  // GET /file/:id/content를 통한 저장 바이트 접근을 통제한다(ADR 0025 D1/D2).
  // 기본값은 private: 소유자가 명시적으로 바꾸기 전까지 새 업로드는 아무도 접근할 수 없다.
  @Column({ type: 'varchar', default: FileVisibility.private })
  visibility!: FileVisibility;

  // 서버가 생성한 랜덤 opaque 토큰(추측 가능한 id가 아니다); visibility가 'unlisted'일 때만
  // 값이 있고, 그 외엔 비운다. 회전이 곧 유출된 링크의 무효화 수단이다(ADR 0025 D3).
  @Column({ type: 'varchar', nullable: true })
  shareToken!: string | null;

  // 현재 공유 토큰의 선택적 TTL; null이면 만료 없음(ADR 0025 D3).
  @Column({ type: 'timestamptz', nullable: true })
  shareExpiresAt!: Date | null;

  // 현재 이 파일이 이전 제안된 대상 한 명, 또는 대기중인 이전이 없으면 null
  // (ADR 0050 D1/D2). 일반 업데이트로는 직접 설정되지 않는다 — FileService의
  // propose/accept/reject/cancel 흐름만이 이 컬럼을 쓴다. ON DELETE SET NULL: 응답하기
  // 전에 대기 대상의 계정이 삭제되면 대기 상태만 사라진다 — 이 파일(A의 것)은 그대로다,
  // B가 소유자가 된 적이 없으므로.
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pendingTransferToUserId' })
  pendingTransferTo!: UserEntity | null;

  @CreateDateColumn()
  createdAt?: Date;

  @UpdateDateColumn()
  updatedAt?: Date;
}
