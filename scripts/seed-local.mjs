/*
 * Fill the LOCAL database with plausible-looking scores.
 *
 * Local only, and deliberately so: invented names on the live board are
 * exactly what the whole verification effort exists to prevent, and a
 * leaderboard with fake people on it is not a leaderboard. This exists so the
 * board can be designed against a full screen instead of an empty one.
 *
 *   node scripts/seed-local.mjs
 *   npx wrangler d1 execute arcade --local --file=./scripts/seed-local.sql
 */
import { writeFileSync } from "node:fs";

const NAMES = [
  "Ada", "Marcus", "Priya", "Tomasz", "Yuki", "Noor", "Elena", "Kwame",
  "Sofia", "Idris", "Mei", "Ravi", "Freja", "Ollie", "Lili", "Bea",
];

const BEATS = ["color", "sound", "time", "fever", "phantom", "offgrid"];
const LEVELS = ["easy", "hard", "brutal"];
const CUBE = ["beginner", "medium", "ninja"];
const DAYS = ["2026-09-02", "2026-09-01", "2026-08-31", "2026-08-30"];

const rows = [];
const players = NAMES.map((name, i) => `('mock-${i}','mock-sub-${i}','${name}',1,1)`);

let at = 1000;
const add = (board, i, score, won = 0, rolls = 5) =>
  rows.push(`('${board}','mock-${i}',${score},${won},${rolls},1,'[]',${at++})`);

/* Beats: tenths, out of 500. */
for (const game of BEATS) {
  for (const level of LEVELS) {
    for (const day of DAYS) {
      const cast = NAMES.map((_, i) => i).filter((i) => (i + day.length + level.length) % 3 !== 0);
      for (const i of cast.slice(0, 11)) {
        /* Each game is out of a different number, so the mock scores have to
           respect their own scale or the board lies about what it measures. */
        const max = game === "fever" ? 800 : game === "phantom" ? 300 : 500;
        const base = Math.round(max * (0.5 + ((i * 37 + day.charCodeAt(9) * 13 + level.length * 29) % 45) / 100));
        add(`beats:${game}-${level}:${day}`, i, Math.min(max, base));
      }
    }
  }
}

/* Shut The Cube: whole points, out of 45 or 405. */
for (const mode of CUBE) {
  const max = mode === "beginner" ? 45 : 405;
  for (const day of DAYS) {
    const cast = NAMES.map((_, i) => i).filter((i) => (i + day.length) % 4 !== 0);
    for (const i of cast.slice(0, 9)) {
      const score = Math.round(max * (0.55 + ((i * 17 + day.charCodeAt(9) * 7) % 40) / 100));
      add(`shutthecube:${mode}:${day}`, i, Math.min(max, score), score === max ? 1 : 0, 18 + (i % 12));
    }
  }
}

const sql = [
  "DELETE FROM scores WHERE player_id LIKE 'mock-%';",
  "DELETE FROM players WHERE id LIKE 'mock-%';",
  `INSERT INTO players (id,sub,name,created_at,updated_at) VALUES ${players.join(",")};`,
  `INSERT INTO scores (board,player_id,score,won,rolls,seed,proof,created_at) VALUES ${rows.join(",")};`,
].join("\n");

writeFileSync(new URL("./seed-local.sql", import.meta.url), `${sql}\n`);
console.log(`${players.length} players, ${rows.length} scores, ${new Set(rows.map((r) => r.split("'")[1])).size} boards`);
