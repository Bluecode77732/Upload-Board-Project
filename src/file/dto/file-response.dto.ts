export class FileResponseDto {
    id: number;
    title: string;
    fileUrl: string;
    creator?: {
        id: number;
        email: string;
    };
    createdAt?: Date;
    updatedAt?: Date;
}
