import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { getCurrentUserFromRequest, serializePublicUser } from "@/lib/auth/current-user";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  return ok({
    user: serializePublicUser(user),
  });
}
