import assert from 'node:assert/strict';
import test from 'node:test';
import {
    EXTERNAL_USER_GROUP_NAME,
    RegistrationProfileError,
    isExternalRegistrationEnabled,
    resolveRegistrationProfile,
} from '../app/lib/account-registration.ts';

test('external registration creates an external billing identity without an internal group', () => {
    assert.deepEqual(resolveRegistrationProfile({
        kind: 'external',
        nickname: '  海外客户 A  ',
    }), {
        nickname: '海外客户 A',
        groupName: EXTERNAL_USER_GROUP_NAME,
        billingAudience: 'external',
    });
});

test('internal registration only accepts a member and group from the fixed directory', () => {
    assert.throws(
        () => resolveRegistrationProfile({
            kind: 'internal',
            nickname: '外部客户',
            groupName: '技术组',
        }, {
            includesMember: () => false,
            includesGroup: () => true,
        }),
        (error) => error instanceof RegistrationProfileError && error.code === 'PROFILE_NAME_INVALID',
    );
});

test('external registration can be disabled with an explicit environment switch', () => {
    assert.equal(isExternalRegistrationEnabled(undefined), true);
    assert.equal(isExternalRegistrationEnabled('true'), true);
    assert.equal(isExternalRegistrationEnabled('false'), false);
    assert.equal(isExternalRegistrationEnabled('OFF'), false);
});
