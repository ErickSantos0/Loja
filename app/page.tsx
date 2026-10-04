import { requireChatGPTUser } from "./chatgpt-auth";
import PosApp from "./pos-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <PosApp operator={user.displayName} userKey={user.userId} />;
}
