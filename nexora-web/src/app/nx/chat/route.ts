import { NextRequest } from "next/server";
import { CHAT_MODEL, OLLAMA, getIndex, retrieve } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Status for the assistant header: is Ollama up, which model, how many documents. */
export async function GET() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { cache: "no-store" });
    const idx = r.ok ? await getIndex().catch(() => null) : null;
    return Response.json({
      online: r.ok,
      model: CHAT_MODEL,
      docs: idx ? new Set(idx.chunks.map((c) => c.source)).size : 0,
    });
  } catch {
    return Response.json({ online: false, model: CHAT_MODEL, docs: 0 });
  }
}

/** RAG chat: retrieve → cite → stream. Emits NDJSON: sources, token…, done. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = String(body.message ?? "").slice(0, 4000);
  const user = String(body.user ?? "there").slice(0, 60).replace(/[^\p{L}\p{N} ._@-]/gu, "");
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m: { role?: string; content?: unknown }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-6);

  const hits = await retrieve(message).catch(() => []);
  const sources = hits.map((h, i) => ({ id: i + 1, title: h.c.source, snippet: h.c.text.slice(0, 280), score: +h.score.toFixed(2) }));
  const context = hits.map((h, i) => `[${i + 1}] (${h.c.source})\n${h.c.text}`).join("\n\n");

  const system =
    `You are Nexora Assistant, speaking with ${user}. Answer using ONLY the numbered sources below. ` +
    `Cite every fact with its source number in square brackets, like [1]. ` +
    `If the sources do not contain the answer, say you could not find it in the knowledge base. Be concise.\n\n` +
    `SOURCES:\n${context || "(none found)"}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        stream: true,
        messages: [{ role: "system", content: system }, ...history, { role: "user", content: message }],
      }),
    });
  } catch {
    return Response.json({ error: "Can't reach Ollama. Is it running?" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: `Ollama returned ${upstream.status}. Is "${CHAT_MODEL}" pulled?` }, { status: 502 });
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      send({ type: "sources", sources });
      const reader = upstream.body!.getReader();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try {
            const j = JSON.parse(l);
            if (j.message?.content) send({ type: "token", text: j.message.content });
          } catch { /* ignore partial line */ }
        }
      }
      send({ type: "done" });
      ctrl.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
