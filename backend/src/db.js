import mysql from "mysql2/promise";
import { config } from "./config.js";

export const pool = mysql.createPool({
  uri: config.databaseUrl,
  connectionLimit: 10,
  supportBigNumbers: true,
  decimalNumbers: true,
});

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Per query con un solo valore aggregato (niente alias di colonna: si legge il primo campo).
export async function scalar(sql, params = []) {
  const rows = await query(sql, params);
  if (rows.length === 0) return 0;
  const value = Object.values(rows[0])[0];
  return value === null ? 0 : Number(value);
}

export async function transaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
