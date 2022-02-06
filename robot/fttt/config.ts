import { parse } from 'https://deno.land/std@0.122.0/encoding/toml.ts'

export interface Config {
  apiKey: string
  secretKey: string
  exchange: string
  botId: number
  quoteQty: number
  sizeN1: number
  sizeN2: number
  maPeriod: number
  slStop: number
  slLimit: number
  tpStop: number
  tpLimit: number
  openLimit: number
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
    sizeN1: c.sizeN1 as number,
    sizeN2: c.sizeN2 as number,
    maPeriod: c.maPeriod as number,
    slStop: c.slStop as number,
    slLimit: c.slLimit as number,
    tpStop: c.tpStop as number,
    tpLimit: c.tpLimit as number,
    openLimit: c.openLimit as number,
  }
  return config
}
