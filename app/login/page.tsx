import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/server-auth";
import LoginForm from "./login-form";
import "./login.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar · Fio",
  description: "Entre no caixa e estoque da sua loja de roupas.",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  if (await getUser()) redirect("/");

  return (
    <main className="fio-login-page">
      <section className="fio-login-card" aria-labelledby="fio-login-title">
        <div className="fio-login-brand" aria-label="Fio · Caixa e estoque">
          <span className="fio-login-symbol" aria-hidden="true">f.</span>
          <div>
            <span className="fio-login-name">fio</span>
            <span className="fio-login-caption">CAIXA & ESTOQUE</span>
          </div>
        </div>
        <div className="fio-login-content">
          <h1 id="fio-login-title">Entrar na loja</h1>
          <p className="fio-login-intro">Use seu usuário e sua senha para acessar o caixa e o estoque.</p>
          <LoginForm />
        </div>
      </section>
      <p className="fio-login-footer">fio <span aria-hidden="true">·</span> Sua loja em dia.</p>
    </main>
  );
}
