import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readBodyWithLimit } from "@/lib/security/body";

function request(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  // duplex нужен Node fetch для потокового тела; в типах RequestInit его нет.
  const init = { method: "POST", headers, body, duplex: "half" } as RequestInit;
  return new Request("http://localhost/api/v1/ingest/DU-01", init);
}
describe("readBodyWithLimit", () => {
  it("читает тело в пределах лимита", async () => {
    expect(await readBodyWithLimit(request('[{"a":1}]'), 1024)).toBe('[{"a":1}]');
  });
  it("обрывает чтение, когда поток превышает лимит (без Content-Length)", async () => {
    const chunk = new TextEncoder().encode("x".repeat(600));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    await expect(readBodyWithLimit(request(stream), 1000)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });
  it("отклоняет по Content-Length до чтения", async () => {
    await expect(
      readBodyWithLimit(request("abc", { "content-length": "5000" }), 1000),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });
  it("UTF-8 на границе чанков декодируется целиком", async () => {
    const bytes = new TextEncoder().encode("Душанбе");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    });
    expect(await readBodyWithLimit(request(stream), 1000)).toBe("Душанбе");
  });
});
