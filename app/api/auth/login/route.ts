import { NextResponse } from "next/server";
import { createSession, credentialsMatch, readAuthConfig, SESSION_COOKIE, SESSION_SECONDS } from "@/lib/auth-session";
import { consumeLoginAttempt } from "@/lib/login-rate-limit";
import { isSameOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403, headers });
  const config = readAuthConfig();
  if (!config) return NextResponse.json({ error: "Configure o acesso da loja no servidor antes de entrar." }, { status: 503, headers });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 4096) return NextResponse.json({ error: "Envio muito grande." }, { status: 413, headers });
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.username !== "string" || typeof body.password !== "string") return NextResponse.json({ error: "Informe usuário e senha." }, { status: 400, headers });
    const ip = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown" : "local";
    if (!(await consumeLoginAttempt(ip, config.secret))) return NextResponse.json({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, { status: 429, headers: { ...headers, "Retry-After": "900" } });
    if (!credentialsMatch(body.username, body.password, config)) return NextResponse.json({ error: "Usuário ou senha incorretos." }, { status: 401, headers });
    const response = NextResponse.json({ ok: true }, { headers });
    response.cookies.set(SESSION_COOKIE, createSession(config), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
    return response;
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Dados de acesso inválidos." }, { status: 400, headers });
    return NextResponse.json({ error: "Não foi possível entrar. Confira a conexão do banco e tente novamente." }, { status: 503, headers });
  }
}
