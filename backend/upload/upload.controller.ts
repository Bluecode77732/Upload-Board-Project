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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { ErrorCode } from 'backend/common/error-code';
import { UploadService } from './upload.service';

// 타입별 필드마다 클래스 허용목록 하나씩(ADR 0025 D4/D5). 일반 객체가 아니라 Map을 쓰면
// file.fieldname -> 허용목록 조회가 타입 캐스팅 없이도 정직하게 possibly-undefined로
// 잡힌다 — fieldname은 클라이언트가 넘긴 값이므로.
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
  @Throttle({ default: { limit: 15, ttl: 60000 } })
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
          fileSize: 100000000, // 100MB (바이트 단위)
        },
        fileFilter: (req, file, cb) => {
          // mimetype과 extension 둘 다 클라이언트가 넘긴 값이므로, 이건 콘텐츠를
          // 보장하는 게 아니라 실수·명백한 오남용을 막는 허용목록일 뿐이다.
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
  //       반복 업로드로 저장 공간을 소모시키는 스팸 경로이기도 해 전역 기본값(분당
  //       100회)보다 강한 분당 15회로 좁힌다(ADR 0054).
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
