import type { NextApiRequest, NextApiResponse } from "next";

export default function socketHandler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(410).json({
    error: {
      code: "SOCKET_ENDPOINT_DEPRECATED",
      message: "Realtime sockets now run on the standalone realtime server.",
    },
  });
}
