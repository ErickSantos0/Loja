import { getUser } from "@/lib/server-auth";
import { loadState, mutateState, ValidationError } from "@/db/postgres-store";
import { isSameOrigin } from "@/lib/request-origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await getUser()))
    return Response.json(
      { error: "Entre na sua conta para acessar a loja." },
      { status: 401 },
    );
  try {
    return Response.json(await loadState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("POS load failed");
    return Response.json(
      { error: "Não foi possível carregar os dados. Tente novamente." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const user = await getUser();
  if (!user)
    return Response.json(
      { error: "Entre na sua conta para acessar a loja." },
      { status: 401 },
    );
  if (!isSameOrigin(request))
    return Response.json({ error: "Origem inválida." }, { status: 403 });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 100000)
      return Response.json({ error: "Envio muito grande." }, { status: 413 });
    const body = JSON.parse(raw);
    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.action !== "string" ||
      !body.input ||
      typeof body.input !== "object" || Array.isArray(body.input) ||
      typeof body.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{20,80}$/.test(body.requestId)
    )
      throw new ValidationError("Dados de operação inválidos.");
    return Response.json(
      await mutateState(
        body.action,
        body.input,
        user.displayName,
        body.requestId,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (!(e instanceof ValidationError) && !(e instanceof SyntaxError)) {
      console.error("POS save failed");
      return Response.json(
        {
          error:
            "Não foi possível salvar no banco. Seus dados na tela foram preservados; tente novamente.",
        },
        { status: 503 },
      );
    }
    return Response.json({ error: e instanceof ValidationError ? e.message : "Dados de operação inválidos." }, { status: 400 });
  }
}
