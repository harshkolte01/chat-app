import type { Metadata } from "next";
import { serializePublicUser } from "@/lib/auth/current-user";
import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { ChatAccessGate } from "@/app/chat/chat-access-gate";

export const metadata: Metadata = {
  title: "Chat",
};

export default async function ChatPage() {
  const user = await requireAuthenticatedUser();

  return (
    <ChatAccessGate
      currentUser={serializePublicUser(user)}
      pinConfigured={Boolean(user.pinHash)}
    />
  );
}
