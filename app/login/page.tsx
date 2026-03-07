import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth/current-user";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = {
  title: "Login",
};

export default async function LoginPage() {
  const user = await getCurrentUserFromCookies();
  if (user) {
    redirect("/chat");
  }

  return <LoginForm />;
}
