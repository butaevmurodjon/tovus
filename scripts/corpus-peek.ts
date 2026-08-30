#!/usr/bin/env -S npx tsx
// Phase 1 read/verification tool for the moderation training corpus (plan:
// .claude/plans/delightful-petting-peacock.md). Reads the capped Redis ring
// buffer that lib/db/corpus.ts fills and prints a breakdown — enough to
// confirm CORPUS_ENABLED is actually collecting, and what mix of
// languages / verdicts / gold labels has landed. Read-only.
//
// Usage:
//   npx tsx scripts/corpus-peek.ts                 # summary of the last 200 rows
//   LIMIT=2000 npx tsx scripts/corpus-peek.ts
//   FORMAT=json npx tsx scripts/corpus-peek.ts      # raw rows, for a labelling tool
//   SHOW=rows npx tsx scripts/corpus-peek.ts        # summary + one line per row (text elided)

import { corpusBufferSize, readCorpusBuffer, type CorpusRow } from "../lib/db/corpus";

const LIMIT = Number(process.env.LIMIT ?? 200);
const FORMAT = process.env.FORMAT === "json" ? "json" : "text";
const SHOW_ROWS = process.env.SHOW === "rows";

function tally<T extends string | number | boolean | null>(rows: CorpusRow[], pick: (r: CorpusRow) => T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(pick(r));
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function fmt(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${k}=${v}`).join("  ") || "(none)";
}

async function main() {
  const [size, rows] = await Promise.all([corpusBufferSize(), readCorpusBuffer(LIMIT)]);

  if (FORMAT === "json") {
    console.log(JSON.stringify({ bufferSize: size, returned: rows.length, rows }));
    return;
  }

  console.log(`corpus ring buffer: ${size} rows total, showing last ${rows.length}\n`);
  if (rows.length === 0) {
    console.log("empty — is CORPUS_ENABLED set, and has any traffic gone through a moderated group since?");
    return;
  }

  const oldest = new Date(Math.min(...rows.map((r) => r.createdAt)));
  const newest = new Date(Math.max(...rows.map((r) => r.createdAt)));
  console.log(`window: ${oldest.toISOString()} .. ${newest.toISOString()}`);
  console.log(`lang:        ${fmt(tally(rows, (r) => r.langGuess))}`);
  console.log(`det verdict: ${fmt(tally(rows, (r) => r.detVerdict))}`);
  console.log(`det source:  ${fmt(tally(rows, (r) => r.detSource))}`);
  console.log(`scorer zone: ${fmt(tally(rows, (r) => r.scorerZone))}`);
  console.log(`ai label:    ${fmt(tally(rows, (r) => r.aiLabel))}  (sampled: ${rows.filter((r) => r.aiSampled).length})`);
  console.log(`gold label:  ${fmt(tally(rows, (r) => r.goldLabel))}`);
  console.log(`gold source: ${fmt(tally(rows.filter((r) => r.goldSource), (r) => r.goldSource))}`);

  if (SHOW_ROWS) {
    console.log(`\nrows (text length only, no content):`);
    for (const r of rows) {
      console.log(
        `  ${new Date(r.createdAt).toISOString()}  chat=${r.chatId}  lang=${r.langGuess}  ` +
          `det=${r.detVerdict ?? "-"}/${r.detSource ?? "-"}  zone=${r.scorerZone}  ` +
          `ai=${r.aiLabel ?? "-"}${r.aiSampled ? "(s)" : ""}  gold=${r.goldLabel ?? "-"}/${r.goldSource ?? "-"}  ` +
          `len=${r.text.length}  signals=[${r.detSignals.map((s) => s.name).join(",")}]`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
