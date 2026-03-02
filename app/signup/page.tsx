import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth/current-user";

export default async function SignupPage() {
  const user = await getCurrentUserFromCookies();
  redirect(user ? "/chat" : "/login");
}
