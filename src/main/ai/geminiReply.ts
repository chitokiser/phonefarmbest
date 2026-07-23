const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const SYSTEM_INSTRUCTION = `너는 카카오톡 오픈채팅방에서 온 메시지에 대한 짧은 답장 초안을 하나 작성하는 도우미다.
규칙:
- 답장은 반드시 "[자동응답] "으로 시작해서 자동 응답임을 밝힌다.
- 1~2문장, 가볍고 자연스러운 구어체 한국어로 쓴다.
- 이모지는 최대 1개까지만 쓰거나 생략한다.
- 답장 문구만 출력하고, 다른 설명이나 따옴표는 붙이지 않는다.`

/**
 * Calls the Gemini API to draft a single disclosed auto-reply for one incoming chat
 * message. Returns plain text only - it's up to the caller whether that goes out
 * immediately or through a human review step first.
 */
export async function generateReplyDraft(incomingMessage: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: `상대방이 보낸 메시지: "${incomingMessage}"` }] }]
    })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${body}`)
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) throw new Error(`Gemini API returned no text: ${JSON.stringify(data)}`)
  return text
}
