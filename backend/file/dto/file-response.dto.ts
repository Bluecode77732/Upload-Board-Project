import { FileVisibility } from '../entity/file-visibility.enum';
import { FileMediaType } from '../entity/file-media-type.enum';

export class FileResponseDto {
  id: number;
  title: string;
  fileUrl: string;
  visibility: FileVisibility;
  // Which playback tag the content is — server-derived from the upload's extension,
  // never client-supplied (ADR 0040).
  mediaType: FileMediaType;
  // Present only when the caller can manage the file and it is currently unlisted
  // (ADR 0025 D3) — never shown to a non-owner/non-admin viewer.
  shareUrl?: string;
  creator?: {
    id: number;
    email: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}
