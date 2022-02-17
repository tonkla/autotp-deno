export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string | { [key: string]: string | number | Date }
) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

export default {
  sendMessage,
}
