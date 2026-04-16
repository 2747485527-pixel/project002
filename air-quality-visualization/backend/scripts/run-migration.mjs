import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] || path.join(__dirname, '..', 'migrations', '20250325_observation_csv_full_columns.sql')

const sql = await readFile(file, 'utf8')
const pool = await mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  multipleStatements: true,
})
try {
  await pool.query(sql)
  console.log('OK:', file)
} finally {
  await pool.end()
}
