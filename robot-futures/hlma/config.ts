import { toml } from '../../deps.ts'

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
  maTimeframe: string
  orderGapAtr: number
  mosAtr: number
  slMinAtr: number
  tpMinAtr: number
  timeMinutesCancel: number
  timeMinutesStop: number
  slStop: number
  slLimit: number
  tpStop: number
  tpLimit: number
  openLimit: number
  maxOrders: number
  openOrder: boolean
}

export async function getConfig(): Promise<Config> {
  if (Deno.args.length === 0) {
    console.info('Please specify a TOML configuration file.')
    Deno.exit()
  }

  const file = await Deno.readTextFile(Deno.args[0])
  const c = toml.parse(file)
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
    maTimeframe: c.maTimeframe as string,
    orderGapAtr: c.orderGapAtr as number,
    mosAtr: c.mosAtr as number,
    slMinAtr: c.slMinAtr as number,
    tpMinAtr: c.tpMinAtr as number,
    timeMinutesCancel: c.timeMinutesCancel as number,
    timeMinutesStop: c.timeMinutesStop as number,
    slStop: c.slStop as number,
    slLimit: c.slLimit as number,
    tpStop: c.tpStop as number,
    tpLimit: c.tpLimit as number,
    openLimit: c.openLimit as number,
    maxOrders: c.maxOrders as number,
    openOrder: c.openOrder as boolean,
  }
  return config
}
