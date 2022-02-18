import telegram from '../service/telegram.ts'
import { Order } from '../types/index.ts'

type Message = Order | string

export enum Events {
  Log = 'LOG',
  Create = 'CREATE',
  Update = 'UPDATE',
  Cancel = 'CANCEL',
  Close = 'CLOSE',
  StopLoss = 'STOP_LOSS',
  TakeProfit = 'TAKE_PROFIT',
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

  async info(event: Events, message: Message) {
    const time = new Date().toISOString()
    let msg: { [key: string]: string }
    if (typeof message === 'string') {
      msg = { time, message }
    } else {
      msg = { time, level: 'INFO', event }
      for (const [k, v] of Object.entries(message)) {
        if (!['', 0, null, undefined].includes(v)) {
          msg[k] = v
        }
      }
    }
    for (const t of this.transports) {
      if (t === Transports.Console) {
        console.info(JSON.stringify(msg))
      } else if (t === Transports.Telegram) {
        const { telegramBotToken, telegramChatId } = this.options
        if (!(telegramBotToken && telegramChatId)) continue
        await telegram.sendMessage(telegramBotToken, telegramChatId, msg)
      }
    }
  }

  async error(event: Events, message: Message) {
    const time = new Date().toISOString()
    let msg: { [key: string]: string }
    if (typeof message === 'string') {
      msg = { time, message }
    } else {
      msg = { time, level: 'ERROR', event }
      for (const [k, v] of Object.entries(message)) {
        if (!['', 0, null, undefined].includes(v)) {
          msg[k] = v
        }
      }
    }
    for (const t of this.transports) {
      if (t === Transports.Console) {
        console.error(msg)
      } else if (t === Transports.Telegram) {
        const { telegramBotToken, telegramChatId } = this.options
        if (!(telegramBotToken && telegramChatId)) continue
        await telegram.sendMessage(telegramBotToken, telegramChatId, msg)
      }
    }
  }
}
