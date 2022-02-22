type Message = string | { [key: string]: string | number | Date }

function prettify(m: Message): string {
  if (typeof m === 'string') {
    return m
  } else {
    const pnl = m['pl']
      ? m['pl'] > 0
        ? ` *PROFIT:* \`${m['pl']}\``
        : ` *LOSS:* \`${m['pl']}\``
      : ''
    const type = m['type'] === 'LIMIT' ? '' : ` (${m['type'] === 'STOP' ? 'SL' : 'TP'})`
    return `__*${m['symbol']}*__: ${m['status']} ${m['positionSide']}${type}
*ID:* ${m['id']}
*PRICE:* \`${m['openPrice']}\`${pnl}`
  }
}

export async function sendMessage(botToken: string, chatId: string, message: Message) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  const text = prettify(message)
  await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, parse_mode: 'MarkdownV2', text }),
  })
}

export async function sendTextMessage(botToken: string, chatId: string, message: string) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  })
}

export default {
  sendMessage,
  sendTextMessage,
}
