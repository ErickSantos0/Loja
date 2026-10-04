import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadState, mutateState } from "@/db/store";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await getChatGPTUser()))
    return Response.json(
      { error: "Entre na sua conta para acessar a loja." },
      { status: 401 },
    );
  try {
    return Response.json(await loadState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("POS load failed", e);
    return Response.json(
      { error: "Não foi possível carregar os dados. Tente novamente." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: "Entre na sua conta para acessar a loja." },
      { status: 401 },
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida." }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 100000)
      return Response.json({ error: "Envio muito grande." }, { status: 413 });
    const body = JSON.parse(raw);
    if (
      typeof body.action !== "string" ||
      !body.input ||
      typeof body.input !== "object" ||
      typeof body.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{20,80}$/.test(body.requestId)
    )
      throw new Error("Dados de operação inválidos.");
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
    const message = e instanceof Error ? e.message : "Não foi possível salvar.";
    if (/D1|SQLITE|database|binding/i.test(message)) {
      console.error("POS save failed", e);
      return Response.json(
        {
          error:
            "Não foi possível salvar no banco. Seus dados na tela foram preservados; tente novamente.",
        },
        { status: 503 },
      );
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
