import type { DesktopFailure, DesktopMutation } from "./types";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isFailure(value: unknown): value is DesktopFailure {
  return (
    !!value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as DesktopFailure).error === "string"
  );
}

export async function desktopTransport(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  if (path !== "/api/pos") {
    return json(
      { error: "Este endereço não está disponível no aplicativo." },
      404,
    );
  }
  if (options.signal?.aborted) {
    throw new DOMException("Operação cancelada.", "AbortError");
  }
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return json({ error: "Operação não permitida." }, 405);
  }
  let body: DesktopMutation | undefined;
  if (method === "POST") {
    try {
      if (typeof options.body !== "string" || options.body.length > 100000) {
        throw new Error("Envio inválido ou muito grande.");
      }
      const parsed: unknown = JSON.parse(options.body);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Dados de operação inválidos.");
      }
      const candidate = parsed as DesktopMutation;
      if (
        typeof candidate.action !== "string" ||
        !candidate.input ||
        typeof candidate.input !== "object" ||
        Array.isArray(candidate.input) ||
        typeof candidate.requestId !== "string" ||
        !/^[a-zA-Z0-9-]{20,80}$/.test(candidate.requestId)
      ) {
        throw new Error("Dados de operação inválidos.");
      }
      body = candidate;
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Dados inválidos." },
        400,
      );
    }
  }
  try {
    const result =
      method === "GET"
        ? await window.fioDesktop.loadState()
        : await window.fioDesktop.mutate(body!);
    if (isFailure(result)) {
      const status =
        Number.isInteger(result.status) &&
        result.status >= 400 &&
        result.status <= 599
          ? result.status
          : 500;
      return json({ error: result.error }, status);
    }
    return json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível acessar os dados neste computador.";
    const validation = /(?:^|\b)VALIDATION:/i.test(message);
    return json(
      { error: message.replace(/^.*?(?:VALIDATION|STORAGE):\s*/i, "") },
      validation ? 400 : 500,
    );
  }
}
