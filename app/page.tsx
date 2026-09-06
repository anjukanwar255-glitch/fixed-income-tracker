import { getChatGPTUser } from "@/app/chatgpt-auth";
import { FixedIncomeApp } from "@/features/app/fixed-income-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <FixedIncomeApp authenticated={Boolean(user)} displayName={user?.displayName ?? "Investor"} email={user?.email ?? ""} />;
}
