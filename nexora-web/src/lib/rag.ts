import { promises as fs } from "node:fs";
import path from "node:path";

export const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
export const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "llama3.1:8b";
export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const KB_DIR = path.resolve(process.env.KB_DIR ?? "./knowledge");

export type Chunk = { id: string; source: string; text: string; vec: number[] };
type Index = { sig: string; chunks: Chunk[] };
const g = globalThis as unknown as { __nexoraIndex?: Index };

async function embed(input: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < input.length; i += 16) {
    const r = await fetch(`${OLLAMA}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: input.slice(i, i + 16) }),
    });
    if (!r.ok) throw new Error(`Ollama embed failed (${r.status}). Have you run: ollama pull ${EMBED_MODEL} ?`);
    out.push(...((await r.json()).embeddings as number[][]));
  }
  return out;
}

function chunkText(text: string, size = 900): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && (cur + "\n\n" + p).length > size) {
      out.push(cur);
      cur = p;
    } else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

async function listFiles(dir: string): Promise<string[]> {
  const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await listFiles(p)));
    else if (/\.(md|txt)$/i.test(e.name)) files.push(p);
  }
  return files;
}

/** Builds (or reuses) the embedded knowledge base; rebuilds automatically when files change. */
export async function getIndex(): Promise<Index> {
  const files = await listFiles(KB_DIR);
  const stats = await Promise.all(files.map((f) => fs.stat(f)));
  const sig = EMBED_MODEL + files.map((f, i) => `${f}:${stats[i].mtimeMs}:${stats[i].size}`).join("|");
  if (g.__nexoraIndex?.sig === sig) return g.__nexoraIndex;

  const items: Omit<Chunk, "vec">[] = [];
  for (const f of files) {
    const text = await fs.readFile(f, "utf8");
    const source = path.relative(KB_DIR, f).replace(/\\/g, "/");
    chunkText(text).forEach((t, i) => items.push({ id: `${source}#${i}`, source, text: t }));
  }
  const vecs = items.length ? await embed(items.map((i) => i.text)) : [];
  g.__nexoraIndex = { sig, chunks: items.map((c, i) => ({ ...c, vec: vecs[i] })) };
  return g.__nexoraIndex;
}

const cos = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / (Math.sqrt(x * y) || 1);
};

export async function retrieve(query: string, k = 4, min = 0.3) {
  const idx = await getIndex();
  if (!idx.chunks.length) return [];
  const [qv] = await embed([query]);
  return idx.chunks
    .map((c) => ({ c, score: cos(qv, c.vec) }))
    .filter((r) => r.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
