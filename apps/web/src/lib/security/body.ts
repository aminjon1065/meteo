/**
 * Чтение тела запроса с жёстким пределом размера: поток обрывается, как только прочитано больше
 * `maxBytes`, вместо буферизации всего тела в память с проверкой длины постфактум (Content-Length
 * клиент может не прислать — chunked — или занизить).
 */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Body exceeds ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export async function readBodyWithLimit(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLargeError(maxBytes);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}
