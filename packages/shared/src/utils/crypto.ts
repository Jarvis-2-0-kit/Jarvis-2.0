import { randomBytes, createHash } from 'node:crypto';

/** Generate a secure random token */
export function generateToken(length = 32): string {
  return randomBytes(length).toString('hex');
}

/** Hash a string with SHA-256 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Generate a short ID for tasks, messages etc. */
export function shortId(): string {
  return randomBytes(8).toString('hex');
}
