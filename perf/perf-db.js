// Purpose: shared connection settings + isolation helpers for the perf/ measurement scripts.
// Usage: required by perf/seed.js, perf/explain.js, perf/load-test.js — never by backend/ or test/.
// Rationale: mirrors test/e2e-utils.ts's dedicated-throwaway-database pattern (never the dev DB) so
// measurement runs are reproducible and cannot corrupt real data; kept out of backend/data-source.ts
// because that file is documented as the one sanctioned CLI-context process.env reader (CLAUDE.md >
// Config) and this is a second, unrelated tooling context, not a second exception to that rule.

const { Client } = require('pg');

try {
  process.loadEnvFile();
} catch {
  // .env is optional — CI or an already-exported shell environment may supply these instead.
}

// Never the dev database ('postgres' per .env) — a dedicated name, always recreated.
const PERF_DB_NAME = process.env.PERF_DB_DATABASE || 'sharenpo_perf';

function connectionBase() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  };
}

// 목적: 측정용 전용 DB에 대한 pg Client를 만든다.
// 이유: seed/explain 스크립트 모두 같은 접속 정보로 sharenpo_perf에 붙어야 한다.
// 방법: connectionBase()에 database만 얹어 연결하고 초기화까지 마친 Client를 반환한다.
async function connectPerfDb() {
  const client = new Client({ ...connectionBase(), database: PERF_DB_NAME });
  await client.connect();
  return client;
}

module.exports = { PERF_DB_NAME, connectionBase, connectPerfDb };
