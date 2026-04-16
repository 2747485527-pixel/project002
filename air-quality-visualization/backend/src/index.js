import 'dotenv/config'
import cron from 'node-cron'
import { createPoolFromEnv } from './db.js'
import { runSyncOnce } from './syncJob.js'

const pool = createPoolFromEnv()

async function main() {
  const once = process.argv.includes('--once')

  if (once) {
    const r = await runSyncOnce(pool)
    // eslint-disable-next-line no-console
    console.log(`[once] ok=${r.ok} rows=${r.count} ts=${r.ts}`)
    await pool.end()
    return
  }

  // 每 5 分钟整点执行（00 秒）
  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await runSyncOnce(pool)
      // eslint-disable-next-line no-console
      console.log(`[cron] ok=${r.ok} rows=${r.count} ts=${r.ts}`)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[cron] sync failed', e?.code ? `code=${e.code}` : '', e?.message || e)
    }
  })

  // eslint-disable-next-line no-console
  console.log('sync job started: every 5 minutes')
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('fatal', e)
  process.exit(1)
})

