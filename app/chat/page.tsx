import { serializePublicUser } from "@/lib/auth/current-user";
import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { ChatClient } from "@/app/chat/chat-client";

export default async function ChatPage() {
  const user = await requireAuthenticatedUser();

  return <ChatClient currentUser={serializePublicUser(user)} />;
}
