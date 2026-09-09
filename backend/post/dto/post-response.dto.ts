// 목적: 게시글을 외부에 내보내는 형태 — 본문, 작성자, 그리고 첨부 파일을 공개 URL로 담는다.
// 사용처: PostService의 모든 메서드가 이 형태로 반환하며, PostService.toResponse()에서 조립된다.
// 근거: 엔티티는 순수 DB 모델로 남겨야 하고(Boundary Validation & Response Shaping), 파일 부분은 여기서 다시 조립하지 않고 FileService의 기존 FileResponseDto에 위임한다.

import { FileResponseDto } from 'backend/file/dto/file-response.dto';

export class PostResponseDto {
  id!: number;
  title!: string;
  body!: string;
  creator?: {
    id: number;
    email: string;
  };
  // 텍스트만 있는 게시글에는 없다. BASE_URL 조립이 한 곳에서만 이뤄지도록
  // FileService가 만들어 넣는다 (ADR 0023).
  file?: FileResponseDto;
  createdAt!: Date;
  updatedAt!: Date;
}
