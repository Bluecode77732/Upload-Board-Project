// Purpose: the outward shape of a post — its text, its author, and the attached file as a public URL.
// Usage: returned by every PostService method; composed in PostService.toResponse().
// Rationale: entities stay pure DB models (Boundary Validation & Response Shaping), and the file half is delegated to FileService's existing FileResponseDto rather than recomposed here.

import { FileResponseDto } from 'backend/file/dto/file-response.dto';

export class PostResponseDto {
  id!: number;
  title!: string;
  body!: string;
  creator?: {
    id: number;
    email: string;
  };
  // Absent for a text-only post. Built by FileService so the BASE_URL composition
  // has exactly one home (ADR 0023).
  file?: FileResponseDto;
  createdAt!: Date;
  updatedAt!: Date;
}
