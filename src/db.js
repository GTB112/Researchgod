// db.js — the SQLite database (Node's built-in node:sqlite). The schema in schema.sql is the contract every module
// shares; JSON columns are read and written with the helpers below.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const SCHEMA = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export const TABLES = ["projects", "questions", "options", "searches", "works", "work_searches", "screenings",
  "fulltexts", "downloads", "extractions", "excerpts", "usage"];

export function openDb(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

export const now = () => new Date().toISOString();
export const toJson = (v) => JSON.stringify(v ?? null);
export const fromJson = (s, fallback = null) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };

// Run fn inside one transaction; rolls back on throw.
export function tx(db, fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}
