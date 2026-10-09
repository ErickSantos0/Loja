"use client";

import { useRef, useState, type FormEvent } from "react";
import { LoaderCircle, ArrowRight, CircleAlert } from "lucide-react";

export default function LoginForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    if (!username || !password) {
      setError("Informe seu usuário e sua senha.");
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setError("");
    let navigating = false;
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username, password }),
      });
      let data: { ok?: boolean; error?: string } | null = null;
      try {
        data = await response.json();
      } catch {
        // Handle an unavailable service without showing a parsing error.
      }
      if (!response.ok || data?.ok !== true) {
        setError(typeof data?.error === "string" && data.error
          ? data.error
          : "Não foi possível entrar agora. Tente novamente.");
        return;
      }
      window.location.assign("/");
      navigating = true;
    } catch {
      setError("Não foi possível conectar. Verifique a internet e tente novamente.");
    } finally {
      if (!navigating) {
        inFlight.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <form onSubmit={submit} className="fio-login-form" aria-describedby={error ? "fio-login-error" : undefined}>
      <fieldset disabled={submitting}>
        <label className="fio-login-field" htmlFor="fio-login-username">
          <span>Usuário</span>
          <input id="fio-login-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={200} required autoFocus />
        </label>
        <label className="fio-login-field" htmlFor="fio-login-password">
          <span>Senha</span>
          <input id="fio-login-password" name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <div id="fio-login-error" className="fio-login-error" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <button type="submit" className="fio-login-submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? <><LoaderCircle size={18} className="fio-login-spinner" aria-hidden="true" /> Entrando…</> : <>Entrar <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
      </fieldset>
      <span className="fio-login-status" role="status">{submitting ? "Verificando acesso à loja." : ""}</span>
    </form>
  );
}
