import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const schemaPath = fileURLToPath(new URL("../../schema/schema.sql", import.meta.url));
const sql = await readFile(schemaPath, "utf8");

const statements = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .split(";")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

for (const statement of statements) {
  await pool.query(statement);
}

console.log(`Migrazione completata: ${statements.length} statement eseguiti.`);
await pool.end();
