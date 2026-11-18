import { cookies } from "next/headers";

const USER = process.env.SHOP_USER ?? "demo";
const PASS = process.env.SHOP_PASS ?? "demo123";

function fakeJwt(username: string): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: username, iat: Date.now() })}.demo-signature`;
}

export async function POST(req: Request) {
  const { username, password } = await req.json();
  if (username !== USER || password !== PASS) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }
  const token = fakeJwt(username);
  (await cookies()).set("session", token, { httpOnly: false, sameSite: "lax", path: "/" });
  return Response.json({ token });
}
