import { ApiProperty } from "@nestjs/swagger";

export class bearerTokenType {
    @ApiProperty({
        description: "JWT access token",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    })
    accessToken: string;
};

export class tokenType {
    @ApiProperty({
        description: "JWT refresh token",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    })
    refreshToken: string;

    @ApiProperty({
        description: "JWT access token",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    })
    accessToken: string;
};
