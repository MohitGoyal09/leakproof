import { readFile } from "node:fs/promises";
import path from "node:path";

// LEAK (vitals): the hero image is served through a slow route.
export async function GET() {
  await new Promise((r) => setTimeout(r, 3000));
  const svg = await readFile(path.join(process.cwd(), "public", "hero.svg"));
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
}
