import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth/current-user";
import { SignupForm } from "@/app/signup/signup-form";

export default async function SignupPage() {
  const user = await getCurrentUserFromCookies();
  if (user) {
    redirect("/chat");
  }

  return <SignupForm />;
}
