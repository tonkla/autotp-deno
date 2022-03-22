import { parse } from 'https://deno.land/std@0.128.0/encoding/toml.ts'

export interface Config {
  apiKey: string
  secretKey: string
  leverage: number
  dbUri: string
  exchange: string
  botId: string
  quoteQty: number
  excluded: string[]
  sizeActive: number
  sizeTopVol: number
  sizeTopChg: number
  sizeCandle: number
  maTimeframe: string
  maPeriodD1: number
  maPeriodH4: number
  maPeriodH1: number
  orderGapAtr: number
  slMinAtr: number
  tpMinAtr: number
  slMaxAtr: number
  tpMaxAtr: number
  timeSecCancel: number
  slStop: number
  slLimit: number
  tpStop: number
  tpLimit: number
  openLimit: number
  telegramBotToken: string
  telegramChatId: string
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
    excluded: c.excluded as string[],
    sizeActive: c.sizeActive as number,
    sizeTopVol: c.sizeTopVol as number,
    sizeTopChg: c.sizeTopChg as number,
    sizeCandle: c.sizeCandle as number,
    maTimeframe: c.maTimeframe as string,
    maPeriodD1: c.maPeriodD1 as number,
    maPeriodH4: c.maPeriodH4 as number,
    maPeriodH1: c.maPeriodH1 as number,
    orderGapAtr: c.orderGapAtr as number,
    slMinAtr: c.slMinAtr as number,
    tpMinAtr: c.tpMinAtr as number,
    slMaxAtr: c.slMaxAtr as number,
    tpMaxAtr: c.tpMaxAtr as number,
    timeSecCancel: c.timeSecCancel as number,
    slStop: c.slStop as number,
    slLimit: c.slLimit as number,
    tpStop: c.tpStop as number,
    tpLimit: c.tpLimit as number,
    openLimit: c.openLimit as number,
    telegramBotToken: c.telegramBotToken as string,
    telegramChatId: c.telegramChatId as string,
    closeAll: c.closeAll as boolean,
  }
  return config
}
