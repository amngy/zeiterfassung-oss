import { hash, verify } from "@node-rs/argon2";

// Argon2id parameters (OWASP-recommended baseline: 19 MiB, 2 iterations).
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS);
  } catch {
    // Malformed hash or mismatch — never throw to the caller.
    return false;
  }
}
