import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { UserEntity } from 'backend/user/entity/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([FileEntity, UserEntity]), AuditLogModule],
  controllers: [FileController],
  providers: [FileService],
  // Exported for UserModule: account deletion cascades into file rows, and those
  // rows stay FileModule's responsibility (module boundary, ADR 0020).
  exports: [FileService],
})
export class FileModule {}
