import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";

// Server Component/Server Action only — usa o client do Supabase que lê
// os cookies via next/headers (lib/supabase/server.ts, já existia).
export async function getServerAccessToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  return session.access_token;
}
