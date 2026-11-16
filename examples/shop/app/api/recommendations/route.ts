// LEAK (network): this endpoint is broken, but the page hides it.
export async function GET() {
  return Response.json({ error: "recommendation service unavailable" }, { status: 500 });
}
