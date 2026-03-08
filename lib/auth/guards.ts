import { redirect } from "next/navigation";
import { getCurrentAuthenticatedUserFromCookies } from "@/lib/auth/current-user";

export async function requireAuthenticatedUser() {
  const user = await getCurrentAuthenticatedUserFromCookies();
  if (!user) {
    redirect("/login");
  }

  return user;
}
