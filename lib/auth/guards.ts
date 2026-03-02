import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth/current-user";

export async function requireAuthenticatedUser() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    redirect("/login");
  }

  return user;
}
