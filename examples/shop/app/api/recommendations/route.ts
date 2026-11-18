export async function GET() {
  return Response.json({ error: "recommendation service unavailable" }, { status: 500 });
}
