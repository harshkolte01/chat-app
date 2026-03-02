import { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/lib/auth/guards";

type ChatLayoutProps = {
  children: ReactNode;
};

export default async function ChatLayout({ children }: ChatLayoutProps) {
  await requireAuthenticatedUser();
  return children;
}
