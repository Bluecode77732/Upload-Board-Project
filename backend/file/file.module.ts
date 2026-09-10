import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { GrantedCleanupService } from './granted-cleanup.service';
import { FileController } from './file.controller';
import { FileContentController } from './file-content.controller';
import { UserEntity } from 'backend/user/entity/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';
import { StorageModule } from 'backend/storage/storage.module';
import { MetricsModule } from 'backend/metrics/metrics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity, UserEntity]),
    AuditLogModule,
    StorageModule,
    MetricsModule,
  ],
  controllers: [FileController, FileContentController],
  // GrantedCleanupService는 export하지 않는다: DB 조인 회수 스윕(ADR 0051)은
  // FileModule 자신의 내부 유지보수 관심사일 뿐, 다른 모듈에 대한 공개 계약이 아니다
  // — TempCleanupModule과 달리 별도 모듈일 필요가 없다, 필요한 것(FileEntity
  // 리포지토리, StorageModule, MetricsModule)이 이미 여기 다 배선돼 있기 때문이다.
  providers: [FileService, GrantedCleanupService],
  // UserModule을 위해 export한다: 계정 삭제가 파일 행까지 연쇄되는데, 그 행들은
  // 여전히 FileModule의 책임으로 남는다(모듈 경계, ADR 0020).
  exports: [FileService],
})
export class FileModule {}
