import assert from 'node:assert/strict';
import test from 'node:test';

import {
    legacyVideoCreditReservationReference,
    planVideoCreditTransition,
    videoCreditReservationReference,
} from '../app/lib/video-credit-reservation-state.ts';

test('new video holds stay distinguishable from legacy pre-deducted reservations', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    assert.equal(videoCreditReservationReference(requestId), `video-sso:hold:${requestId}`);
    assert.equal(legacyVideoCreditReservationReference(requestId), `video-sso:reserve:${requestId}`);
});

test('video reservation holds spendable points without reducing the displayed balance', () => {
    assert.deepEqual(planVideoCreditTransition({
        action: 'reserve',
        pointsBalance: 8200,
        heldPoints: 0,
        amount: 5000,
    }), {
        allowed: true,
        pointsBalance: 8200,
        heldPoints: 5000,
    });

    assert.deepEqual(planVideoCreditTransition({
        action: 'reserve',
        pointsBalance: 8200,
        heldPoints: 5000,
        amount: 5000,
    }), {
        allowed: false,
        pointsBalance: 8200,
        heldPoints: 5000,
    });
});

test('video success deducts the held points while failure only releases them', () => {
    assert.deepEqual(planVideoCreditTransition({
        action: 'settle',
        pointsBalance: 8200,
        heldPoints: 5000,
        amount: 5000,
    }), {
        allowed: true,
        pointsBalance: 3200,
        heldPoints: 0,
    });

    assert.deepEqual(planVideoCreditTransition({
        action: 'release',
        pointsBalance: 8200,
        heldPoints: 5000,
        amount: 5000,
    }), {
        allowed: true,
        pointsBalance: 8200,
        heldPoints: 0,
    });
});
