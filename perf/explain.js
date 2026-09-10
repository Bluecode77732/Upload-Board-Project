// Purpose: runs EXPLAIN (ANALYZE, BUFFERS) for the exact query shapes FileService/PostService build,
// before and after ADR 0021's three deferred candidate indexes, so index adoption is evidence-based.
// Usage: `node perf/explain.js` (baseline) — `node perf/explain.js --with-indexes` (creates the three
// candidates, re-runs the same queries, leaves them in place for inspection) — `node perf/explain.js
// --drop-indexes` (removes them again). Requires perf/seed.js to have run first.
// Rationale: ADR 0021 named "row count ~10^4+" as the only precondition for revisiting its deferred
// indexes; this is that measurement, run against the query shapes as FileService.getFiles /
// PostService.getPosts actually build them (SORT_COLUMN + ILIKE + creatorId), not a proxy query.

const { connectPerfDb } = require('./perf-db');

// Mirrors FileService.getFiles's default-sort query for a non-admin requester (creator.id = X OR
// visibility = 'public') — the shape the (createdAt DESC, id DESC) candidate targets.
const FILE_DEFAULT_SORT = {
  label: 'file_entity: default sort (createdAt DESC, id tiebreaker), non-admin visibility filter',
  sql: `
    SELECT "file"."id" FROM "file_entity" "file"
    LEFT JOIN "user_entity" "creator" ON "creator"."id" = "file"."creatorId"
    WHERE ("file"."visibility" = 'public' OR "creator"."id" = $1)
    ORDER BY "file"."createdAt" DESC, "file"."id" DESC
    LIMIT 20 OFFSET 0`,
  params: [1],
};

// Mirrors the ILIKE branch — the shape the pg_trgm GIN candidate targets.
const FILE_SEARCH = {
  label: "file_entity: search ILIKE '%holiday%'",
  sql: `
    SELECT "file"."id" FROM "file_entity" "file"
    LEFT JOIN "user_entity" "creator" ON "creator"."id" = "file"."creatorId"
    WHERE "file"."title" ILIKE '%holiday%' ESCAPE '\\'
      AND ("file"."visibility" = 'public' OR "creator"."id" = $1)
    ORDER BY "file"."createdAt" DESC, "file"."id" DESC
    LIMIT 20 OFFSET 0`,
  params: [1],
};

// Mirrors the creatorId filter — the shape the (creatorId) candidate targets.
const FILE_CREATOR_FILTER = {
  label: 'file_entity: creatorId filter',
  sql: `
    SELECT "file"."id" FROM "file_entity" "file"
    LEFT JOIN "user_entity" "creator" ON "creator"."id" = "file"."creatorId"
    WHERE "creator"."id" = $1
      AND ("file"."visibility" = 'public' OR "creator"."id" = $1)
    ORDER BY "file"."createdAt" DESC, "file"."id" DESC
    LIMIT 20 OFFSET 0`,
  params: [2],
};

const POST_DEFAULT_SORT = {
  label: 'post_entity: default sort (createdAt DESC, id tiebreaker)',
  sql: `
    SELECT "post"."id" FROM "post_entity" "post"
    ORDER BY "post"."createdAt" DESC, "post"."id" DESC
    LIMIT 20 OFFSET 0`,
  params: [],
};

const POST_SEARCH = {
  label: "post_entity: search ILIKE '%holiday%'",
  sql: `
    SELECT "post"."id" FROM "post_entity" "post"
    WHERE "post"."title" ILIKE '%holiday%' ESCAPE '\\'
    ORDER BY "post"."createdAt" DESC, "post"."id" DESC
    LIMIT 20 OFFSET 0`,
  params: [],
};

const POST_CREATOR_FILTER = {
  label: 'post_entity: creatorId filter',
  sql: `
    SELECT "post"."id" FROM "post_entity" "post"
    LEFT JOIN "user_entity" "creator" ON "creator"."id" = "post"."creatorId"
    WHERE "creator"."id" = $1
    ORDER BY "post"."createdAt" DESC, "post"."id" DESC
    LIMIT 20 OFFSET 0`,
  params: [2],
};

const QUERIES = [
  FILE_DEFAULT_SORT,
  FILE_SEARCH,
  FILE_CREATOR_FILTER,
  POST_DEFAULT_SORT,
  POST_SEARCH,
  POST_CREATOR_FILTER,
];

// Mirrors backend/migrations/1788180660994-AddPerformanceIndexes.ts exactly. The trgm indexes
// are built on the raw "title" column, not lower("title") — measured directly (2026-08-31): a
// lower(title) expression index is never picked by the planner here because the real query
// (FileService.getFiles / PostService.getPosts) applies ILIKE to the raw column, not to
// lower(title), so the expression never appears in the WHERE clause for Postgres to match.
const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS "IDX_file_entity_createdAt_id" ON "file_entity" ("createdAt", "id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_post_entity_createdAt_id" ON "post_entity" ("createdAt", "id")`,
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE INDEX IF NOT EXISTS "IDX_file_entity_title_trgm" ON "file_entity" USING GIN ("title" gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS "IDX_post_entity_title_trgm" ON "post_entity" USING GIN ("title" gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS "IDX_file_entity_creatorId" ON "file_entity" ("creatorId")`,
  `CREATE INDEX IF NOT EXISTS "IDX_post_entity_creatorId" ON "post_entity" ("creatorId")`,
];

const DROP_STATEMENTS = [
  `DROP INDEX IF EXISTS "IDX_file_entity_createdAt_id"`,
  `DROP INDEX IF EXISTS "IDX_post_entity_createdAt_id"`,
  `DROP INDEX IF EXISTS "IDX_file_entity_title_trgm"`,
  `DROP INDEX IF EXISTS "IDX_post_entity_title_trgm"`,
  `DROP INDEX IF EXISTS "IDX_file_entity_creatorId"`,
  `DROP INDEX IF EXISTS "IDX_post_entity_creatorId"`,
];

// 목적: 대표 목록 쿼리 6개에 대해 EXPLAIN (ANALYZE, BUFFERS)를 실행하고 계획 요약을 출력한다.
// 이유: "빨라졌다"는 수치 없이 주장하면 안 된다는 이 작업의 핵심 제약 — 실행계획과 실측 시간을 남긴다.
// 방법: 각 쿼리를 EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)로 감싸 그대로 실행하고 텍스트 계획을 출력한다.
async function runExplains(client) {
  for (const q of QUERIES) {
    console.log('\n=== ' + q.label + ' ===');
    const res = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q.sql}`,
      q.params,
    );
    console.log(res.rows.map((r) => r['QUERY PLAN']).join('\n'));
  }
}

async function main() {
  const mode = process.argv[2];
  const client = await connectPerfDb();
  try {
    if (mode === '--drop-indexes') {
      for (const stmt of DROP_STATEMENTS) await client.query(stmt);
      console.log('Dropped candidate indexes.');
      return;
    }
    if (mode === '--with-indexes') {
      console.log('Creating candidate indexes...');
      for (const stmt of INDEX_STATEMENTS) await client.query(stmt);
      console.log('Analyzing tables so the planner sees fresh stats...');
      await client.query('ANALYZE "file_entity"');
      await client.query('ANALYZE "post_entity"');
    }
    await runExplains(client);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
