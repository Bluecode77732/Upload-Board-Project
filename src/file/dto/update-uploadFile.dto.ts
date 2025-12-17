import { PartialType } from '@nestjs/swagger';
import { UploadFileDto } from './create-uploadFile.dto';

export class UpdateFileDto extends PartialType(UploadFileDto) { }
