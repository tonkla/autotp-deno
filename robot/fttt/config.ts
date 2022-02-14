import { parse } from 'https://deno.land/std@0.125.0/encoding/toml.ts'

export interface Config {
  apiKey: string
  secretKey: string
  leverage: number
  dbUri: string
  exchange: string
  botId: string
  quoteQty: number
  sizeTopVol: number
  sizeTopChg: number
  sizeCandle: number
  maPeriod: number
  orderGapAtr: number
  slAtr: number
  tpAtr: number
  timeSecCancel: number
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
    secretKey: c.secretKey as string,
    leverage: c.leverage as number,
    dbUri: c.dbUri as string,
    exchange: c.exchange as string,
    botId: c.botId as string,
    quoteQty: c.quoteQty as number,
    sizeTopVol: c.sizeTopVol as number,
    sizeTopChg: c.sizeTopChg as number,
    sizeCandle: c.sizeCandle as number,
    maPeriod: c.maPeriod as number,
    orderGapAtr: c.orderGapAtr as number,
    slAtr: c.slAtr as number,
    tpAtr: c.tpAtr as number,
    timeSecCancel: c.timeSecCancel as number,
    slStop: c.slStop as number,
    slLimit: c.slLimit as number,
    tpStop: c.tpStop as number,
    tpLimit: c.tpLimit as number,
    openLimit: c.openLimit as number,
  }
  return config
}
