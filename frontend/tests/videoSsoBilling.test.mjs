import assert from 'node:assert/strict';
import test from 'node:test';

import {
    calculateExternalVideoPoints,
    executeVideoBillingAction,
} from '../app/lib/video-credit-service.ts';

test('external Seedance pricing matches the confirmed 30-second 720p packages', () => {
    assert.equal(calculateExternalVideoPoints({
        model: 'doubao-seedance-2-0-fast-260128',
        resolution: '720p',
        duration: 30,
    }), 2500);
    assert.equal(calculateExternalVideoPoints({
        model: 'doubao-seedance-2-0-260128',
        resolution: '720p',
        duration: 30,
    }), 5000);
    assert.equal(calculateExternalVideoPoints({
        model: 'seedance2.5',
        resolution: '720p',
        duration: 30,
    }), 7500);
});

test('external Seedance pricing applies resolution multipliers and rounds the whole task up', () => {
    assert.equal(calculateExternalVideoPoints({
        model: 'doubao-seedance-2-0-260128',
        resolution: '480p',
        duration: 30,
    }), 2500);
    assert.equal(calculateExternalVideoPoints({
        model: 'doubao-seedance-2-0-260128',
        resolution: '1080p',
        duration: 30,
    }), 10000);
    assert.equal(calculateExternalVideoPoints({
        model: 'doubao-seedance-2-0-fast-260128',
        resolution: '720p',
        duration: 5,
    }), 417);
    assert.equal(calculateExternalVideoPoints({
        model: 'seedance2.5',
        resolution: '720p',
        duration: 5,
    }), 1250);
});

test('external video billing reserves main-account points while internal users remain free', async () => {
    const reservations = [];
    const ledger = {
        async reserve(input) {
            reservations.push(input);
            return { pointsBalance: 3200 };
        },
        async settle() {
            throw new Error('not used');
        },
        async release() {
            throw new Error('not used');
        },
    };

    const external = await executeVideoBillingAction({
        action: 'reserve',
        requestId: '11111111-1111-4111-8111-111111111111',
        model: 'doubao-seedance-2-0-260128',
        resolution: '720p',
        duration: 30,
    }, {
        id: 'external-user',
        groupName: '外部用户',
        pointsBalance: 8200,
    }, ledger);

    assert.deepEqual(external, {
        action: 'reserve',
        requestId: '11111111-1111-4111-8111-111111111111',
        requiredPoints: 5000,
        pointsBalance: 3200,
        chargeRequired: true,
    });
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].amount, 5000);

    const internal = await executeVideoBillingAction({
        action: 'reserve',
        requestId: '22222222-2222-4222-8222-222222222222',
        model: 'seedance2.5',
        resolution: '1080p',
        duration: 30,
    }, {
        id: 'internal-user',
        billingAudience: 'internal',
        pointsBalance: 0,
    }, ledger);

    assert.equal(internal.requiredPoints, 0);
    assert.equal(internal.pointsBalance, 0);
    assert.equal(internal.chargeRequired, false);
    assert.equal(reservations.length, 1);
});

test('external video billing settles once or releases the reserved main-account points', async () => {
    const ledger = {
        async reserve() {
            throw new Error('not used');
        },
        async settle() {
            return { pointsBalance: 3200, chargedPoints: 5000 };
        },
        async release() {
            return { pointsBalance: 8200, releasedPoints: 5000 };
        },
    };
    const user = {
        id: 'external-user',
        billingAudience: 'external',
        pointsBalance: 3200,
    };
    const requestId = '11111111-1111-4111-8111-111111111111';

    assert.deepEqual(
        await executeVideoBillingAction({ action: 'settle', requestId }, user, ledger),
        {
            action: 'settle',
            requestId,
            chargedPoints: 5000,
            pointsBalance: 3200,
            chargeRequired: true,
        },
    );
    assert.deepEqual(
        await executeVideoBillingAction({ action: 'release', requestId }, user, ledger),
        {
            action: 'release',
            requestId,
            releasedPoints: 5000,
            pointsBalance: 8200,
            chargeRequired: true,
        },
    );
});
