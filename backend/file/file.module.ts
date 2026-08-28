import { Module } from '@nestjs/common';
import { FileService } from './file.service';
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
  providers: [FileService],
  // Exported for UserModule: account deletion cascades into file rows, and those
  // rows stay FileModule's responsibility (module boundary, ADR 0020).
  exports: [FileService],
})
export class FileModule {}
