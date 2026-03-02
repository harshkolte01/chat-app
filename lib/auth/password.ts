import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const PASSWORD_PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hashBuffer = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${PASSWORD_PREFIX}$${salt}$${hashBuffer.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [prefix, salt, savedHashHex] = storedHash.split("$");

  if (prefix !== PASSWORD_PREFIX || !salt || !savedHashHex) {
    return false;
  }

  const derivedHash = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const savedHash = Buffer.from(savedHashHex, "hex");

  if (savedHash.length !== derivedHash.length) {
    return false;
  }

  return timingSafeEqual(savedHash, derivedHash);
}
