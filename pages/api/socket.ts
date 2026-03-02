import type { Server as HttpServer } from "node:http";
import type { NextApiRequest, NextApiResponse } from "next";
import { getOrCreateSocketServer } from "@/lib/socket/server";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: NextApiResponse["socket"] & {
    server: HttpServer;
  };
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function socketHandler(_req: NextApiRequest, res: NextApiResponseWithSocket) {
  getOrCreateSocketServer(res.socket.server);
  res.status(200).json({ ok: true });
}
