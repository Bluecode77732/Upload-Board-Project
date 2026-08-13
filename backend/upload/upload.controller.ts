import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { ErrorCode } from 'backend/common/error-code';
import { UploadService } from './upload.service';

// One class allowlist per type-specific field (ADR 0025 D4/D5). A Map (not a plain
// object) keeps file.fieldname -> allowlist lookup honestly typed as possibly-undefined
// without a type cast, since fieldname is client-supplied.
const UPLOAD_FIELD_NAMES = ['image', 'audio', 'video'] as const;
type UploadField = (typeof UPLOAD_FIELD_NAMES)[number];

const UPLOAD_ALLOWLIST = new Map<
  string,
  { extensions: string[]; mimeTypes: string[] }
>([
  [
    'image',
    {
      extensions: ['jpg', 'jpeg', 'png', 'webp'],
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
  ],
  ['audio', { extensions: ['mp3'], mimeTypes: ['audio/mpeg'] }],
  [
    'video',
    {
      extensions: ['mp4', 'mov', 'webm'],
      mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    },
  ],
]);

@Controller('upload')
@ApiTags('Upload API')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('attach')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      description: 'Attach exactly one of image, audio, or video.',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'jpg, jpeg, png, or webp',
        },
        audio: {
          type: 'string',
          format: 'binary',
          description: 'mp3',
        },
        video: {
          type: 'string',
          format: 'binary',
          description: 'mp4, mov, or webm',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Uploaded File Successfully.',
    example: {
      filename: 'temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4',
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request. No file attached, more than one of image/audio/video attached, ' +
      'the file is larger than 100MB, or the file is not an allowed type for its field ' +
      '(image: jpg/jpeg/png/webp; audio: mp3; video: mp4/mov/webm).',
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      UPLOAD_FIELD_NAMES.map((name) => ({ name, maxCount: 1 })),
      {
        limits: {
          fileSize: 100000000, // 100MB in bytes
        },
        fileFilter: (req, file, cb) => {
          // Both mimetype and extension are client-supplied, so this is an
          // allowlist against accidental/blatant misuse, not a content guarantee.
          const allowlist = UPLOAD_ALLOWLIST.get(file.fieldname);
          const extension =
            file.originalname.split('.').pop()?.toLowerCase() ?? '';

          if (
            allowlist &&
            allowlist.mimeTypes.includes(file.mimetype) &&
            allowlist.extensions.includes(extension)
          ) {
            cb(null, true);
          } else {
            cb(
              new BadRequestException({
                code: ErrorCode.UPLOAD_INVALID_TYPE,
                message: `Only ${file.fieldname} files are allowed (${allowlist?.extensions.join('/') ?? 'none'}).`,
              }),
              false,
            );
          }
        },
      },
    ),
  )
  // 목적: image/audio/video 세 필드 중 정확히 하나로 첨부된 파일을 임시 저장소에 받는다.
  // 이유: 단일 video 필드가 이미지·오디오를 거부해 창립 목표 4(이미지/비디오/mp3/mp4)를
  //       충족하지 못했다(ADR 0025 D4/D5). Multer가 memoryStorage로 바뀌어(ADR 0029 D4)
  //       파일이 더 이상 스스로 디스크에 쓰이지 않으므로, 물리 저장은 UploadService에 위임한다.
  // 방법: FileFieldsInterceptor로 세 필드를 등록하고 fieldname별 허용목록을 fileFilter에서
  //       분기 적용, 컨트롤러에서는 정확히 하나의 필드만 채워졌는지 확인한 뒤
  //       UploadService.stageTemp로 버퍼를 포트에 저장하고 그 파일명을 반환한다.
  async uploadMedia(
    @UploadedFiles()
    files: Partial<Record<UploadField, Express.Multer.File[]>> = {},
  ): Promise<{ filename: string }> {
    const attached = UPLOAD_FIELD_NAMES.flatMap((name) => files[name] ?? []);
    const [file] = attached;

    if (!file) {
      throw new BadRequestException({
        code: ErrorCode.UPLOAD_FILE_REQUIRED,
        message: 'Attach File.',
      });
    }

    if (attached.length > 1) {
      throw new BadRequestException({
        code: ErrorCode.UPLOAD_MULTIPLE_FIELDS,
        message: 'Attach exactly one of image, audio, or video.',
      });
    }

    return this.uploadService.stageTemp(file);
  }
}
