// store.js — owns the plain-text copy of the database: one <table>.jsonl per table, rows in primary-key order, JSON
// columns kept as text, so export → import → export is byte-identical and the data diffs cleanly in git.
import fs from "node:fs";
import path from "node:path";
import { TABLES, tx } from "./db.js";

const pkOrder = (db, table) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  return cols.map((c) => `"${c.name}"`).join(", ") || "rowid";
};

export function exportJsonl(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const counts = {};
  for (const table of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${pkOrder(db, table)}`).all();
    fs.writeFileSync(path.join(dir, `${table}.jsonl`), rows.map((r) => JSON.stringify(r) + "\n").join(""));
    counts[table] = rows.length;
  }
  return counts;
}

export function importJsonl(db, dir) {
  const counts = {};
  tx(db, () => {
    for (const table of TABLES) {
      const file = path.join(dir, `${table}.jsonl`);
      counts[table] = 0;
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
          .run(...cols.map((c) => row[c]));
        counts[table]++;
      }
    }
  });
  return counts;
}
