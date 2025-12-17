// Minimal JWT payload.
export interface Payload {
    // User ID for lookup.
    sub: number, 

    // Distinguishes access/refresh tokens.
    type: "refresh" | "access",

    // JWT library handles automatically the `iat/exp`.
};
