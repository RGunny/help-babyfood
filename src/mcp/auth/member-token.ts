import { createHash, randomBytes } from 'node:crypto';

/** Marks a string as one of ours at a glance, in a config file or a support question. */
const PREFIX = 'hbf_';
/** 256 bits. Guessing one is not a threat model we have to think about again. */
const SECRET_BYTES = 32;

export const DEFAULT_TOKEN_LIFETIME_DAYS = 180;

export interface MintedToken {
  /** Shown to the parent once and never stored. */
  readonly token: string;
  readonly tokenHash: string;
}

export function mintToken(): MintedToken {
  const token = `${PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { token, tokenHash: hashToken(token) };
}

/**
 * The stored form of a token.
 *
 * A plain SHA-256 is enough here, unlike for a password: the token is 256 random bits, so there is
 * no dictionary to run against it and no work factor to buy. What the hash buys is that a dump of
 * the database cannot be replayed as a credential. Lookup is by hash, so the comparison the
 * database makes is between digests and never between secrets.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A string that cannot be one of our tokens, so it is not worth a query. */
export function looksLikeToken(value: string): boolean {
  return value.startsWith(PREFIX) && value.length > PREFIX.length;
}
