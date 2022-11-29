import { toml } from '../../deps.ts'

export interface Config {
  apiKey: string
  secretKey: string
  dbUri: string
  exchange: string
  telegramBotToken: string
  telegramChatId: string
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
    dbUri: c.dbUri as string,
    exchange: c.exchange as string,
    telegramBotToken: c.telegramBotToken as string,
    telegramChatId: c.telegramChatId as string,
  }
  return config
}
