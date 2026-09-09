// 목적: 댓글의 외부 응답 형태 — 본문, 작성자, 그리고 매달린 게시글을 표현한다.
// 사용처: CommentService의 모든 메서드가 반환하며, CommentService.toResponse()에서 구성된다.
// 근거: 엔티티는 순수 DB 모델로 유지한다(Boundary Validation & Response Shaping); PostResponseDto는 여기서 쓸 수 없다 — 댓글은 스레드의 모든 행마다 게시글 본문과 파일을 딸려오면 안 되기 때문이다.

export class CommentResponseDto {
  id!: number;
  body!: string;
  creator?: {
    id: number;
    email: string;
  };
  // 게시글을 임베드하지 않고 id만 둔다: 그러지 않으면 댓글 20개짜리 스레드에서
  // 같은 게시글 본문과 파일 URL이 20번 반복된다.
  postId!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
