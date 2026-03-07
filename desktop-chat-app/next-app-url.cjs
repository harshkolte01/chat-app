/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv/config");

const NEXT_APP_URL =
  process.env.NEXT_APP_URL ?? "https://sec-chat-application.vercel.app";

module.exports = {
  NEXT_APP_URL,
};
