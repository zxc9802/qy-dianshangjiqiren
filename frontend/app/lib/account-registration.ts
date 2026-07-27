export const EXTERNAL_USER_GROUP_NAME = '外部用户';

export type RegistrationKind = 'internal' | 'external';
export type RegistrationProfileErrorCode =
    | 'PROFILE_NAME_REQUIRED'
    | 'PROFILE_NAME_INVALID'
    | 'PROFILE_GROUP_REQUIRED'
    | 'PROFILE_GROUP_INVALID';

export class RegistrationProfileError extends Error {
    code: RegistrationProfileErrorCode;

    constructor(code: RegistrationProfileErrorCode, message: string) {
        super(message);
        this.name = 'RegistrationProfileError';
        this.code = code;
    }
}

export function resolveRegistrationProfile(input: {
    kind: RegistrationKind;
    nickname: string;
    groupName?: string;
}, internalDirectory?: {
    includesMember: (nickname: string) => boolean;
    includesGroup: (groupName: string) => boolean;
}) {
    const nickname = input.nickname.trim();
    if (!nickname) {
        throw new RegistrationProfileError('PROFILE_NAME_REQUIRED', 'Name is required.');
    }

    if (input.kind === 'external') {
        return {
            nickname,
            groupName: EXTERNAL_USER_GROUP_NAME,
            billingAudience: 'external' as const,
        };
    }

    const groupName = input.groupName?.trim() || '';
    if (!internalDirectory?.includesMember(nickname)) {
        throw new RegistrationProfileError(
            'PROFILE_NAME_INVALID',
            'Please select a valid name from the internal member list.',
        );
    }
    if (!groupName) {
        throw new RegistrationProfileError('PROFILE_GROUP_REQUIRED', 'Group is required.');
    }
    if (!internalDirectory.includesGroup(groupName)) {
        throw new RegistrationProfileError(
            'PROFILE_GROUP_INVALID',
            'Please select a valid group from the internal group list.',
        );
    }

    return {
        nickname,
        groupName,
        billingAudience: 'internal' as const,
    };
}

export function isExternalRegistrationEnabled(value: string | undefined): boolean {
    if (!value?.trim()) return true;
    return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}
