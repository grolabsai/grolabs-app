/**
 * Strong random password generation for admin-provisioned accounts. The user
 * is forced to change it on first login (user_metadata.must_change_password),
 * so this is a one-time secret shown once in the create dialog.
 *
 * Uses the Web Crypto CSPRNG (available in the browser and in Node ≥ 19) with a
 * rejection-sampling pick to avoid modulo bias. Per docs/policy/user-management.md.
 */

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const DIGITS = "23456789"; // no 0/1
const SYMBOLS = "!@#$%&*?";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function randomInt(maxExclusive: number): number {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
    const buf = new Uint32Array(1);
    let v = 0;
    do {
      cryptoObj.getRandomValues(buf);
      v = buf[0];
    } while (v >= limit);
    return v % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

function pick(set: string): string {
  return set[randomInt(set.length)];
}

export function generateStrongPassword(length = 16): string {
  const chars: string[] = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  for (let i = chars.length; i < length; i++) chars.push(pick(ALL));
  // Fisher–Yates shuffle so the guaranteed-class chars aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Minimum acceptable password length for the change-password screen. */
export const MIN_PASSWORD_LENGTH = 10;

export function isStrongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}
