// 목적: POST /post 요청 본문을 검증한다 — 게시글 내용과, 첨부할 파일 id(선택).
// 사용처: PostController.create()에서 @Body()로 바인딩되어 PostService.create()에 그대로 전달된다.
// 근거: 전역 파이프는 DTO가 선언한 필드만 남기고, 엔티티에는 길이 제한이 없다 — ADR 0023의 제한(title ≤100, body ≤10,000)은 여기서 강제해야 한다.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    description:
      '게시글 제목. 고유하지 않다 — 두 작성자가 같은 제목을 쓸 수 있다. (Post title. ' +
      'Not unique — two authors may use the same one.)',
    maxLength: 100,
    example: 'My holiday clip',
  })
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  @ApiProperty({
    description: '게시글 본문. (Post body.)',
    maxLength: 10000,
    example: 'Filmed this last weekend.',
  })
  body!: string;

  // 생성 시점에 고정하는 것이 의도된 설계다: PATCH로 첨부를 옮길 수 있게 하면
  // 그럴 필요가 없는 라우트에 claim/replay 표면이 하나 더 생긴다 (ADR 0023 D1).
  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({
    description:
      '첨부할 파일의 id. 요청자가 만든 파일이어야 하고, 아직 다른 게시글이 갖고 있지 ' +
      '않아야 한다. 생략하면 텍스트 전용 게시글이 된다. (Id of a file to attach. Must ' +
      'be a file the requester created, and one no other post already holds. Omit for ' +
      'a text-only post.)',
    minimum: 1,
    example: 12,
  })
  fileId?: number;
}
