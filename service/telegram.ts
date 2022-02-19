type Message = string | { [key: string]: string | number | Date }

function prettify(m: Message): string {
  if (typeof m === 'string') {
    return m
  } else {
    const pnl = m['pl'] ? (m['pl'] > 0 ? `*PROFIT:* \`${m['pl']}\`` : `*LOSS:* \`${m['pl']}\``) : ''
    return `__*${m['symbol']}*__
*${m['event']}*: ${m['status']} ${m['positionSide']} ${m['type']}
*ID:* ${m['id']}
*PRICE:* \`${m['openPrice']}\` ${pnl}`
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

export default {
  sendMessage,
}
