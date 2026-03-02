import { prisma } from "@/lib/db";

export async function isConversationMember(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    select: { id: true },
  });

  return Boolean(conversation);
}
