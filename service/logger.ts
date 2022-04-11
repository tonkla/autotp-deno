import telegram from '../service/telegram.ts'
import { Order } from '../types/index.ts'

export enum Events {
  Log = 'LOG',
  Create = 'CREATE',
  Update = 'UPDATE',
  Cancel = 'CANCEL',
  Close = 'CLOSE',
  StopLoss = 'LOSS',
  TakeProfit = 'PROFIT',
}

export enum Transports {
  Console = 'CONSOLE',
  Telegram = 'TELEGRAM',
}

type Options = Partial<{
  telegramBotToken: string
  telegramChatId: string
}>

export class Logger {
  private transports: Transports[]
  private options: Options = {}

  constructor(transports: Transports[], options?: Options) {
    this.transports = transports
    if (options) this.options = options
  }

  async log(message: string) {
    for (const t of this.transports) {
      if (t === Transports.Console) {
        console.info('\n', message)
      } else if (t === Transports.Telegram) {
        const { telegramBotToken, telegramChatId } = this.options
        if (!(telegramBotToken && telegramChatId)) return
        await telegram.sendMessage(telegramBotToken, telegramChatId, message)
      }
    }
  }

  async info(event: Events, message: string | Order) {
    const time = new Date().toISOString()
    let msg: { [key: string]: string | number | Date }
    if (typeof message === 'string') {
      msg = { time, message }
    } else {
      msg = { time, event }
      for (const [k, v] of Object.entries(message)) {
        if (!['', 0, null, undefined].includes(v)) {
          msg[k] = v
        }
      }
    }
    for (const t of this.transports) {
      if (t === Transports.Console) {
        console.info('\n', JSON.stringify(msg))
      } else if (t === Transports.Telegram) {
        const { telegramBotToken, telegramChatId } = this.options
        if (!(telegramBotToken && telegramChatId)) continue
        if (typeof message === 'string') {
          await telegram.sendMessage(telegramBotToken, telegramChatId, message)
        } else if (event === Events.Close) {
          await telegram.sendMessage(telegramBotToken, telegramChatId, prettify(msg), true)
        }
      }
    }
  }
}

function prettify(m: { [key: string]: string | number | Date }): string {
  const status = m['type'] === 'LIMIT' && m['pl'] ? (m['pl'] > 0 ? 'TP' : 'SL') : m['status']
  return `__*${m['symbol']}*__: ${status} ${m['positionSide']} \`${m['pl']}\`
*PRICE:* \`${m['openPrice']} -> ${m['closePrice']}\`
*ID:* ${m['id']} *BOT:* ${m['botId']}`
}
