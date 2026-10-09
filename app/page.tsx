import { requireUser } from "@/lib/server-auth";
import PosApp from "./pos-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireUser();
  return <PosApp operator={user.displayName} userKey={user.userId} />;
}
