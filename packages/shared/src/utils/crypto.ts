import { randomBytes, createHash } from 'node:crypto';

/** Minimum token length in bytes */
const MIN_TOKEN_LENGTH = 16;
/** Maximum token length in bytes */
const MAX_TOKEN_LENGTH = 256;

/** Generate a secure random token */
export function generateToken(length = 32): string {
  if (!Number.isInteger(length) || length < MIN_TOKEN_LENGTH || length > MAX_TOKEN_LENGTH) {
    throw new RangeError(
      `Token length must be an integer between ${MIN_TOKEN_LENGTH} and ${MAX_TOKEN_LENGTH}, got ${length}`,
    );
  }
  return randomBytes(length).toString('hex');
}

/** Hash a string with SHA-256 */
export function sha256(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('sha256 input must be a string');
  }
  return createHash('sha256').update(input).digest('hex');
}

/** Generate a short ID for tasks, messages etc. */
export function shortId(): string {
  return randomBytes(16).toString('hex');
}
