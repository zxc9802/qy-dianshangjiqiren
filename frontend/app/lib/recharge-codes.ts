import { createHmac, randomBytes } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUP_COUNT = 4;
const CODE_GROUP_LENGTH = 4;

export function normalizeRechargeCode(value: string): string {
    return value.trim().toUpperCase();
}

export function hashRechargeCode(value: string, pepper: string): string {
    return createHmac('sha256', pepper)
        .update(normalizeRechargeCode(value))
        .digest('hex');
}

export function getRechargeCodeLast4(value: string): string {
    return normalizeRechargeCode(value).replaceAll('-', '').slice(-4);
}

export function maskRechargeCode(last4: string): string {
    return last4 ? `JF-****-****-****-${last4}` : 'JF-****-****-****-****';
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
