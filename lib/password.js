import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  if (!password || typeof password !== 'string') throw new Error('Invalid password');
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derived = scryptSync(password, salt, 64);
    return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
  } catch (e) {
    return false;
  }
}
