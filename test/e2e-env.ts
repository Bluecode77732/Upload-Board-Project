// Purpose: redirects the app to the throwaway test database BEFORE any spec imports AppModule.
// Usage: wired as jest `setupFiles` in test/jest-e2e.json; runs once per worker before the test module graph loads.
// Rationale: ConfigModule.forRoot() captures DB_DATABASE at AppModule import time — setting it in beforeAll is too late, so the app would connect to the real DB (e.g. `postgres`) while migrations populate the throwaway one, and every query hits missing tables.

try {
  // Local runs: load .env for DB host/port/secrets. In CI there is no .env and the
  // workflow supplies these directly, so the throw is expected and ignored.
  process.loadEnvFile();
} catch {
  // No .env present — env comes from the real process environment.
}

// The suite owns a throwaway database (dropped/recreated per run). This must run
// before AppModule is imported; e2e-utils reads this same value back for TEST_DB_NAME.
process.env.DB_DATABASE = 'upload_board_e2e';
