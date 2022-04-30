import { parse } from 'https://deno.land/std@0.135.0/encoding/toml.ts'

export interface Config {
  apiKey: string
  secretKey: string
  leverage: number
  dbUri: string
  exchange: string
  botId: string
  quoteQty: number
  included: string[]
  excluded: string[]
  sizeActive: number
  sizeTopVol: number
  sizeTopChg: number
  sizeCandle: number
  timeframes: string[]
  maTimeframe: string
  maPeriod: number
  orderGapAtr: number
  slMinAtr: number
  slMaxAtr: number
  tpMinAtr: number
  tpMaxAtr: number
  singleLossUSD: number
  singleProfitUSD: number
  totalLossUSD: number
  totalProfitUSD: number
  timeSecCancel: number
  slStop: number
  slLimit: number
  tpStop: number
  tpLimit: number
  openLimit: number
  telegramBotToken: string
  telegramChatId: string
  maxOrders: number
  openOrder: boolean
  closeOrphan: boolean
  closeAll: boolean
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
    included: c.included as string[],
    excluded: c.excluded as string[],
    sizeActive: c.sizeActive as number,
    sizeTopVol: c.sizeTopVol as number,
    sizeTopChg: c.sizeTopChg as number,
    sizeCandle: c.sizeCandle as number,
    timeframes: c.timeframes as string[],
    maTimeframe: c.maTimeframe as string,
    maPeriod: c.maPeriod as number,
    orderGapAtr: c.orderGapAtr as number,
    slMinAtr: c.slMinAtr as number,
    slMaxAtr: c.slMaxAtr as number,
    tpMinAtr: c.tpMinAtr as number,
    tpMaxAtr: c.tpMaxAtr as number,
    singleLossUSD: c.singleLossUSD as number,
    singleProfitUSD: c.singleProfitUSD as number,
    totalLossUSD: c.totalLossUSD as number,
    totalProfitUSD: c.totalProfitUSD as number,
    timeSecCancel: c.timeSecCancel as number,
    slStop: c.slStop as number,
    slLimit: c.slLimit as number,
    tpStop: c.tpStop as number,
    tpLimit: c.tpLimit as number,
    openLimit: c.openLimit as number,
    telegramBotToken: c.telegramBotToken as string,
    telegramChatId: c.telegramChatId as string,
    maxOrders: c.maxOrders as number,
    openOrder: c.openOrder as boolean,
    closeOrphan: c.closeOrphan as boolean,
    closeAll: c.closeAll as boolean,
  }
  return config
}
