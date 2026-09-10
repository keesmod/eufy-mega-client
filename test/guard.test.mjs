import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { changeGuardMode, readGuardMode } from '../dist/guard.js';
function fixture() {
  let queries = 0,
    commands = 0;
  const station = Object.assign(new EventEmitter(), {
    getCameraInfo() {
      queries++;
    },
    setGuardMode() {
      commands++;
    },
  });
  const observe = (mode, source = 'p2p') =>
    station.emit('parameter observed', station, 1224, String(mode), source);
  const ack = (code = 0) =>
    station.emit('command result', station, {
      command_type: 1224,
      return_code: code,
      customData: { property: { name: 'guardMode', value: 1 } },
    });
  return { station, observe, ack, queries: () => queries, commands: () => commands };
}
test('guard mode needs both acceptance and fresh P2P state; cloud echoes cannot confirm it', async () => {
  const f = fixture(),
    p = changeGuardMode(f.station, 1, new AbortController().signal);
  f.observe(1);
  f.ack();
  assert.equal(f.queries(), 1);
  f.observe(1, 'http');
  assert.equal(await Promise.race([p, delay(10, 'pending')]), 'pending');
  f.observe(0);
  assert.equal(await Promise.race([p, delay(10, 'pending')]), 'pending');
  f.observe(1);
  await p;
  assert.equal(f.commands(), 1);
  assert.equal(f.station.listenerCount('command result'), 0);
});
test('rejected and unconfirmed guard commands never retry', async () => {
  let f = fixture(),
    p = changeGuardMode(f.station, 1, new AbortController().signal);
  f.ack(-104);
  await assert.rejects(p, { code: 'guard_mode_rejected' });
  assert.equal(f.commands(), 1);
  f = fixture();
  p = changeGuardMode(f.station, 1, new AbortController().signal, 20);
  f.ack();
  await assert.rejects(p, { code: 'guard_mode_unconfirmed' });
  assert.equal(f.commands(), 1);
});
test('explicit state refresh accepts a repeated value from the device', async () => {
  const f = fixture(),
    p = readGuardMode(f.station, new AbortController().signal);
  f.observe(1);
  assert.equal(await p, 1);
  assert.equal(f.queries(), 1);
});
