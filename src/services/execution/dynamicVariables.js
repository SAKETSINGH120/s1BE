import crypto from 'node:crypto';

const FIRST_NAMES = [
  'Ada',
  'Grace',
  'Alan',
  'Linus',
  'Radia',
  'Ken',
  'Barbara',
  'Dennis',
  'Aarav',
  'Diya',
];
const LAST_NAMES = [
  'Lovelace',
  'Hopper',
  'Turing',
  'Torvalds',
  'Perlman',
  'Thompson',
  'Liskov',
  'Ritchie',
  'Sharma',
  'Iyer',
];
const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789';

const pick = (list) => list[crypto.randomInt(list.length)];
const randomString = (length) =>
  Array.from({ length }, () => ALPHANUMERIC[crypto.randomInt(ALPHANUMERIC.length)]).join('');

/**
 * Built-in {{$name}} variables. Each occurrence gets a fresh value, so two {{$uuid}} in one
 * request are different. Environment variables cannot start with "$", so there are no clashes.
 */
export const DYNAMIC_VARIABLES = {
  $uuid: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $timestampMs: () => String(Date.now()),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(crypto.randomInt(0, 1001)),
  $randomString: () => randomString(12),
  $randomBoolean: () => String(crypto.randomInt(2) === 1),
  $randomName: () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
  $randomEmail: () => `${pick(FIRST_NAMES).toLowerCase()}.${randomString(6)}@example.com`,
};

export function resolveDynamicVariable(name) {
  return DYNAMIC_VARIABLES[name]?.();
}
