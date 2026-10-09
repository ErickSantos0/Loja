import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readAuthConfig, SESSION_COOKIE, verifySession } from "./auth-session.ts";

export async function getUser() {
  const config = readAuthConfig();
  if (!config) return null;
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, config);
}
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
