import { parse } from 'https://deno.land/std@0.122.0/encoding/toml.ts'

export interface Config {
  apiKey: string
  secretKey: string
  exchange: string
  botId: number
  quoteQty: number
  maPeriod: number
}

export async function getConfig(): Promise<Config> {
  if (Deno.args.length === 0) {
    console.info('Please specify a TOML configuration file.')
    Deno.exit()
  }

  const toml = await Deno.readTextFile(Deno.args[0])
  const c = parse(toml)
  const config: Config = {
    apiKey: c.apiKey as string,
    secretKey: c.secret as string,
    exchange: c.exchange as string,
    botId: c.botId as number,
    quoteQty: c.quoteQty as number,
    maPeriod: c.maPeriod as number,
  }
  return config
}
