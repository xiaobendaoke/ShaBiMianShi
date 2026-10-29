import assert from 'node:assert/strict';
import { TurnNavigation } from '../src/renderer/src/turnNavigation';
const navigation = new TurnNavigation();
const old = {id:'old', createdAt:1}, latest = {id:'latest', createdAt:2};
const next = {id:'next', createdAt:3}, queued = {id:'queued', createdAt:4};
assert.equal(navigation.shouldDisplay(old, latest), true);
navigation.pause([old, latest]);
assert.equal(navigation.shouldDisplay(old, next), false);
assert.equal(navigation.shouldDisplay(old, queued), false);
assert.equal(navigation.unread([old, latest, next, queued]), 2);
// Starting a queued turn must not count it twice.
assert.equal(navigation.unread([old, latest, {...next}, {...queued}]), 2);
navigation.pause([old, latest, next, queued]);
assert.equal(navigation.unread([old, latest, next, queued]), 0);
navigation.reset();
assert.equal(navigation.unread([old, latest, next, queued]), 0);
assert.equal(navigation.shouldDisplay(old, queued), true);
// Explicitly submitted queued questions must not be replaced by an older start.
assert.equal(navigation.shouldDisplay(queued, next), false);
assert.equal(navigation.shouldDisplay(queued, queued), true);
assert.equal(navigation.shouldDisplay(null, old), true);
console.log('PASS follow latest, history pause, unread deduplication, resume and queued ordering');
