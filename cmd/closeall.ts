import { Client } from 'https://deno.land/x/postgres@v0.15.0/mod.ts'

async function main() {
  const uri = Deno.env.get('DB_URI')
  if (!uri) return
  const client = new Client(uri)
  await client.connect()
  await client.queryObject(`UPDATE bforders SET close_time = NOW() WHERE close_time IS NULL`)
  await client.end()
}
main()
