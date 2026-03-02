import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth/current-user";
import { LoginForm } from "@/app/login/login-form";

export default async function LoginPage() {
  const user = await getCurrentUserFromCookies();
  if (user) {
    redirect("/chat");
  }

  return <LoginForm />;
}
