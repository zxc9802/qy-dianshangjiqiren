import { randomBytes } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUP_COUNT = 4;
const CODE_GROUP_LENGTH = 4;

export function normalizeRechargeCode(value: string): string {
    return value.trim().toUpperCase();
}

export function generateRechargeCode(): string {
    const bytes = randomBytes(CODE_GROUP_COUNT * CODE_GROUP_LENGTH);
    const body = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
    const groups = Array.from(
        { length: CODE_GROUP_COUNT },
        (_, index) => body.slice(index * CODE_GROUP_LENGTH, (index + 1) * CODE_GROUP_LENGTH).join(''),
    );

    return `JF-${groups.join('-')}`;
}
