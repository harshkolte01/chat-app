import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Sign up",
};

export default async function SignupPage() {
  const user = await getCurrentUserFromCookies();
  redirect(user ? "/chat" : "/login");
}
