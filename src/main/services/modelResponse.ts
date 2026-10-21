/** Normalize known gateway envelopes, never treat HTTP 200 as business success. */
export function unwrapResponse(input: any): any {
  let value = input;
  for (let n = 0; n < 4; n++) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new Error('模型返回了无效JSON'); } }
    if (!value || typeof value !== 'object') throw new Error('模型响应格式无效');
    if (value.success === false || value.error) throw new Error(value.error?.message || value.message || String(value.error || '中转业务失败'));
    if ('data' in value && !Array.isArray(value.data) && !value.choices && value.text === undefined) { value = value.data; continue; }
    return value;
  }
  throw new Error('中转响应嵌套过深');
}
export function responseText(value: any): string {
  const json = unwrapResponse(value);
  const choice = json.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('模型输出预算耗尽，内容不完整。请增加预算或拆分题目后重试。');
  const content = choice?.message?.content ?? json.text;
  const text = typeof content === 'string' ? content.trim() : Array.isArray(content) ? content.map((p: any) => p.text || '').join('').trim() : '';
  if (!text) throw new Error('模型返回空正文，请检查模型能力、思考设置和输出预算');
  return text;
}
export async function readChatResponse(res: Response, onToken: (token: string) => void): Promise<string> {
  if (!res.ok) throw new Error(`模型请求失败 (${res.status}): ${(await res.text()).slice(0, 180)}`);
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    const answer = responseText(await res.json()); onToken(answer); return answer;
  }
  if (!res.body) throw new Error('未接收到响应正文');
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = '', answer = '', finish = '', ended = false;
  const event = (block: string) => {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { ended = true; return; }
    const json = unwrapResponse(JSON.parse(data));
    const choice = json.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    const token = choice?.delta?.content ?? choice?.message?.content ?? '';
    if (typeof token === 'string' && token) { answer += token; onToken(token); }
  };
  try {
    while (!ended) {
      const {done, value} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
      buffer = buffer.replace(/\r\n/g, '\n');
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, split); buffer = buffer.slice(split + 2); event(block); }
      if (done) { if (buffer.trim()) event(buffer); break; }
    }
    if (finish === 'length') throw new Error('模型输出被截断，回答不完整。请重试或拆分题目。');
    if (!answer.trim()) throw new Error('模型返回空正文，请检查图片能力、思考设置及输出预算');
    if (!ended && !finish) throw new Error('生成连接提前中断，回答不完整，请重试');
    return answer;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
