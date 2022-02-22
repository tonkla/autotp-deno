export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
  markdown?: boolean
) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  const body: { chat_id: string; text: string; parse_mode?: string } = { chat_id: chatId, text }
  if (markdown) body.parse_mode = 'MarkdownV2'
  await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export default {
  sendMessage,
}
