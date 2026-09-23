import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMowerMapSnapshot, MowerPathAccumulator, EufyError } from '../dist/index.js';
import { MAX_MAP_RECORDS } from '../dist/mowers/maps/protobuf.js';
import {
  w,
  mapMessage,
  channelMessage,
  pathMessage,
  snapshot,
  timestamp,
} from './fixtures/map-geometry.mjs';

// Synthetic points only. The first five are the fixture's default path.
const TASK = [
  [0, -300, 0],
  [100, -200, 2],
  [200, -100, 3],
  [300, 0, 4],
  [400, 100, 9],
  [500, 200, 0],
  [600, 300, 1],
  [700, 400, 0],
];
const POSE_A = [3, -347, 0];
const POSE_B = [700, 400, 1571];

/** Decode one synthetic snapshot as an accumulator input. */
function input({
  revision,
  receivedAt,
  points,
  kind = 1,
  endPose = POSE_A,
  path = {},
  map,
  extra,
}) {
  const snap = snapshot({
    map: channelMessage(mapMessage(map ?? {}, extra ?? [])),
    path: pathMessage({ points, kind, endPose, ...path }),
  });
  snap.revision = revision;
  snap.receivedAt = receivedAt;
  return decodeMowerMapSnapshot(snap);
}
const history = (revision, receivedAt, count, more = {}) =>
  input({ revision, receivedAt, points: TASK.slice(0, count), ...more });
const realtime = (revision, receivedAt, points, more = {}) =>
  input({ revision, receivedAt, points, kind: 0, endPose: [0, 0, 0], ...more });
const positions = (points) => points.map((p) => [p.position.x, p.position.y, p.kindCode]);
const provenance = (segments) =>
  segments.map((s) => [s.start, s.end, s.revision, s.receivedAt, s.kind]);

test('successive history paths of one map merge into one ordered history with provenance', () => {
  const accumulator = new MowerPathAccumulator();
  assert.equal(accumulator.history, undefined);
  const first = history(1, 1000, 3);
  const started = accumulator.merge(first);
  assert.equal(started.outcome, 'started');
  assert.equal(started.reason, 'first');
  assert.equal(started.previous, undefined);
  assert.equal(started.history, accumulator.history);
  const h1 = started.history;
  assert.deepEqual(h1.points, first.cleaningPath.points);
  assert.deepEqual(provenance(h1.segments), [[0, 3, 1, 1000, 'history']]);
  assert.deepEqual(
    [h1.mapId, h1.pathId, h1.kind, h1.kindCode, h1.confirmed],
    [1, 0, 'history', 1, 3],
  );
  assert.deepEqual(h1.endPose, { x: 3, y: -347, theta: 0 });
  assert.deepEqual(h1.generation, {
    width: 350,
    height: 250,
    resolution: 20,
    origin: { x: -3000, y: -2000 },
    lastSavedTime: { seconds: 1700000000, nanos: 5 },
  });
  assert.deepEqual([h1.revision, h1.receivedAt], [1, 1000]);

  const second = history(2, 2000, 5, { endPose: [400, 100, 7] });
  const extended = accumulator.merge(second);
  assert.equal(extended.outcome, 'extended');
  assert.deepEqual([extended.added, extended.replaced], [2, 0]);
  const h2 = extended.history;
  assert.equal(h2, accumulator.history);
  assert.deepEqual(h2.points, second.cleaningPath.points);
  assert.deepEqual(provenance(h2.segments), [
    [0, 3, 1, 1000, 'history'],
    [3, 5, 2, 2000, 'history'],
  ]);
  assert.deepEqual(h2.endPose, { x: 400, y: 100, theta: 7 });
  assert.deepEqual([h2.confirmed, h2.revision, h2.receivedAt], [5, 2, 2000]);
  // Point kinds and codes are the decoder's, including an unknown code.
  assert.deepEqual(
    h2.points.map((p) => [p.kind, p.kindCode]),
    [
      ['cleaning', 0],
      ['resume', 2],
      ['cross_boundary', 3],
      ['move', 4],
      ['unknown', 9],
    ],
  );
  // A new adapter instance restarts its revision counter. Receipt order decides.
  const third = history(1, 3000, 8, { endPose: POSE_B });
  const again = accumulator.merge(third);
  assert.equal(again.outcome, 'extended');
  assert.deepEqual([again.added, again.replaced], [3, 0]);
  assert.deepEqual(positions(again.history.points), TASK);
  assert.deepEqual(provenance(again.history.segments).at(-1), [5, 8, 1, 3000, 'history']);
  assert.deepEqual(again.history.endPose, { x: 700, y: 400, theta: 1571 });
});

test('a changed map identity or generation starts a new history and returns the previous one', () => {
  const accumulator = new MowerPathAccumulator();
  accumulator.merge(history(1, 1000, 5));
  const cases = [
    ['identity', { map: { id: 2 }, path: { mapId: 2 } }],
    ['identity', { map: { id: 2 }, path: { mapId: 2, id: 7 } }],
    ['generation', { map: { id: 2, width: 351 }, path: { mapId: 2, id: 7 } }],
    [
      'generation',
      { map: { id: 2, width: 351, origin: [-3001, -2000] }, path: { mapId: 2, id: 7 } },
    ],
    [
      'generation',
      {
        map: { id: 2, width: 351, origin: [-3001, -2000] },
        path: { mapId: 2, id: 7 },
        extra: [w.bytes(29, timestamp(1700000001, 5))],
      },
    ],
    [
      'generation',
      {
        map: { id: 2, width: 351, origin: null },
        path: { mapId: 2, id: 7 },
        extra: [w.bytes(29, timestamp(1700000001, 5))],
      },
    ],
  ];
  let revision = 1;
  for (const [reason, more] of cases) {
    revision += 1;
    const before = accumulator.history;
    const snapshotBefore = structuredClone(before);
    const next = input({
      revision,
      receivedAt: revision * 1000,
      points: TASK.slice(0, 2),
      ...more,
    });
    const result = accumulator.merge(next);
    assert.equal(result.outcome, 'started', reason);
    assert.equal(result.reason, reason);
    assert.equal(result.previous, before);
    assert.deepEqual(structuredClone(result.previous), snapshotBefore);
    assert.deepEqual(result.history.points, next.cleaningPath.points);
    assert.deepEqual(provenance(result.history.segments), [
      [0, 2, revision, revision * 1000, 'history'],
    ]);
    assert.equal(result.history.mapId, next.map.id);
    assert.equal(result.history.pathId, next.cleaningPath.id);
    // The same identity and generation again continues the new history.
    const same = accumulator.merge(
      input({
        revision: revision + 100,
        receivedAt: revision * 1000 + 1,
        points: TASK.slice(0, 3),
        ...more,
      }),
    );
    assert.equal(same.outcome, 'extended');
    assert.equal(same.history.mapId, next.map.id);
  }
  assert.equal(accumulator.history.generation.origin, undefined);
  assert.deepEqual(accumulator.history.generation.lastSavedTime, { seconds: 1700000001, nanos: 5 });
});

test('a realtime path extends provisionally and never overwrites points, kind or end pose', () => {
  const accumulator = new MowerPathAccumulator();
  const established = accumulator.merge(history(1, 1000, 5)).history;
  // The empty realtime placeholder that opens a demand carries a zero pose. It changes nothing.
  const placeholder = accumulator.merge(realtime(2, 2000, []));
  assert.deepEqual(placeholder, { outcome: 'empty', history: established });
  assert.equal(accumulator.history, established);
  // A realtime path that repeats the history and continues it adds only the continuation.
  const full = accumulator.merge(realtime(3, 3000, TASK.slice(0, 6), { endPose: [9, 9, 9] }));
  assert.equal(full.outcome, 'extended');
  assert.deepEqual([full.added, full.replaced], [1, 0]);
  assert.deepEqual(provenance(full.history.segments).at(-1), [5, 6, 3, 3000, 'realtime']);
  assert.deepEqual([full.history.kind, full.history.confirmed], ['history', 5]);
  assert.deepEqual(full.history.endPose, { x: 3, y: -347, theta: 0 });
  assert.deepEqual([full.history.revision, full.history.receivedAt], [3, 3000]);
  // A realtime path carrying only new points is appended as one segment.
  const delta = accumulator.merge(realtime(4, 4000, [TASK[6]]));
  assert.equal(delta.outcome, 'extended');
  assert.deepEqual([delta.added, delta.replaced], [1, 0]);
  assert.deepEqual(positions(delta.history.points), TASK.slice(0, 7));
  assert.equal(delta.history.confirmed, 5);
  // The provisional tail delivered again is not appended twice.
  const repeat = accumulator.merge(realtime(5, 5000, TASK.slice(5, 7)));
  assert.equal(repeat.outcome, 'unchanged');
  assert.deepEqual(positions(repeat.history.points), TASK.slice(0, 7));
  assert.deepEqual([repeat.history.revision, repeat.history.receivedAt], [5, 5000]);
  // A realtime path that repeats the provisional tail and continues it adds the continuation.
  const tail = accumulator.merge(realtime(6, 6000, TASK.slice(5, 8)));
  assert.equal(tail.outcome, 'extended');
  assert.deepEqual([tail.added, tail.replaced], [1, 0]);
  assert.deepEqual(positions(tail.history.points), TASK);
  assert.deepEqual(provenance(tail.history.segments), [
    [0, 5, 1, 1000, 'history'],
    [5, 6, 3, 3000, 'realtime'],
    [6, 7, 4, 4000, 'realtime'],
    [7, 8, 6, 6000, 'realtime'],
  ]);
  assert.deepEqual([tail.history.kind, tail.history.confirmed], ['history', 5]);
  assert.deepEqual(tail.history.endPose, { x: 3, y: -347, theta: 0 });
  // The next history file agrees with the confirmed points and replaces the provisional tail.
  const reconciled = accumulator.merge(
    input({
      revision: 7,
      receivedAt: 7000,
      points: [...TASK.slice(0, 6), [650, 300, 1]],
      endPose: POSE_B,
    }),
  );
  assert.equal(reconciled.outcome, 'extended');
  assert.deepEqual([reconciled.added, reconciled.replaced], [1, 2]);
  assert.deepEqual(positions(reconciled.history.points), [...TASK.slice(0, 6), [650, 300, 1]]);
  assert.deepEqual(provenance(reconciled.history.segments), [
    [0, 5, 1, 1000, 'history'],
    [5, 6, 3, 3000, 'realtime'],
    [6, 7, 7, 7000, 'history'],
  ]);
  assert.deepEqual([reconciled.history.kind, reconciled.history.confirmed], ['history', 7]);
  assert.deepEqual(reconciled.history.endPose, { x: 700, y: 400, theta: 1571 });
  // A diverging realtime path is appended after the confirmed points and replaces nothing.
  const stray = accumulator.merge(realtime(8, 8000, [[1, 1, 0]], { endPose: [1, 1, 1] }));
  assert.equal(stray.outcome, 'extended');
  assert.deepEqual([stray.added, stray.replaced], [1, 0]);
  assert.deepEqual(
    positions(stray.history.points).slice(0, 7),
    positions(reconciled.history.points),
  );
  assert.deepEqual([stray.history.kind, stray.history.confirmed], ['history', 7]);
  assert.deepEqual(stray.history.endPose, { x: 700, y: 400, theta: 1571 });
  // A complete path confirms the whole path, including points a realtime input carried first.
  const complete = accumulator.merge(
    input({
      revision: 9,
      receivedAt: 9000,
      kind: 2,
      points: [...TASK.slice(0, 6), [650, 300, 1], [1, 1, 0]],
      endPose: [1, 1, 2],
    }),
  );
  assert.equal(complete.outcome, 'unchanged');
  assert.deepEqual(
    [complete.history.kind, complete.history.kindCode, complete.history.confirmed],
    ['complete', 2, 8],
  );
  assert.deepEqual(complete.history.endPose, { x: 1, y: 1, theta: 2 });
  assert.deepEqual(provenance(complete.history.segments).at(-1), [7, 8, 8, 8000, 'realtime']);
});

test('the empty realtime placeholder of each demand never touches the retained history', () => {
  const accumulator = new MowerPathAccumulator();
  // Demand one: placeholder, then the history file.
  assert.equal(accumulator.merge(realtime(1, 1000, [])).outcome, 'empty');
  assert.equal(accumulator.history, undefined);
  assert.equal(accumulator.merge(history(2, 1900, 5)).outcome, 'started');
  // Demand two ends before its history file arrives.
  const retained = accumulator.history;
  assert.deepEqual(accumulator.merge(realtime(1, 30000, [])), {
    outcome: 'empty',
    history: retained,
  });
  // Demand three repeats the same path, then demand four continues it.
  const same = accumulator.merge(history(2, 60900, 5));
  assert.equal(same.outcome, 'unchanged');
  assert.deepEqual([same.history.revision, same.history.receivedAt], [2, 60900]);
  assert.equal(same.history.points, retained.points);
  assert.equal(accumulator.merge(realtime(1, 90000, [])).outcome, 'empty');
  const grown = accumulator.merge(history(2, 90900, 8));
  assert.equal(grown.outcome, 'extended');
  assert.deepEqual(positions(grown.history.points), TASK);
  // An empty history file is not a shorter history.
  const emptyHistory = accumulator.merge(history(3, 91000, 0));
  assert.deepEqual(emptyHistory, { outcome: 'empty', history: grown.history });
});

test('malformed, duplicate and out-of-order inputs are rejected without touching the history', () => {
  const accumulator = new MowerPathAccumulator();
  accumulator.merge(history(1, 1000, 3));
  const established = accumulator.merge(history(2, 2000, 5));
  const reference = accumulator.history;
  const snapshotBefore = structuredClone(reference);
  const valid = () => history(3, 3000, 8);
  const mutate = (change) => {
    const geometry = valid();
    change(geometry);
    return geometry;
  };
  const malformed = [
    undefined,
    null,
    5,
    'path',
    {},
    { revision: 1 },
    { revision: 1.5, receivedAt: 3000 },
    { revision: 1, receivedAt: Number.NaN },
    mutate((g) => (g.cleaningPath.points = 'none')),
    mutate((g) => (g.cleaningPath.points[0].position.x = 0.5)),
    mutate((g) => (g.cleaningPath.points[1].kind = 'cleaning')),
    mutate((g) => (g.cleaningPath.points[2] = null)),
    mutate((g) => (g.cleaningPath.kind = 'complete')),
    mutate((g) => (g.cleaningPath.endPose = null)),
    mutate((g) => (g.cleaningPath.endPose = { x: 1, y: 2 })),
    mutate((g) => (g.cleaningPath.id = '0')),
    mutate((g) => (g.map.width = -1)),
    mutate((g) => (g.map.origin = { x: 'a', y: 0 })),
    mutate((g) => (g.map.lastSavedTime = { seconds: 1 })),
    mutate((g) => (g.map = 'map')),
    mutate((g) => (g.cleaningPath = [])),
  ];
  for (const geometry of malformed) {
    const result = accumulator.merge(geometry);
    assert.deepEqual(result, { outcome: 'rejected', reason: 'malformed', history: reference });
  }
  const rejected = [
    [
      'path_unavailable',
      decodeMowerMapSnapshot({ ...snapshot({ path: Buffer.from([0x08]) }), receivedAt: 3000 }),
    ],
    ['path_unavailable', mutate((g) => delete g.cleaningPath)],
    [
      'map_unavailable',
      decodeMowerMapSnapshot({ ...snapshot({ map: Buffer.from([0x08]) }), receivedAt: 3000 }),
    ],
    ['map_unavailable', mutate((g) => delete g.map)],
    [
      'map_unavailable',
      decodeMowerMapSnapshot({
        ...snapshot({ map: w.bytes(3, w.bytes(2, mapMessage())) }),
        receivedAt: 3000,
      }),
    ],
    ['unknown_kind', input({ revision: 3, receivedAt: 3000, points: TASK, kind: 7 })],
    [
      'identity_mismatch',
      input({ revision: 3, receivedAt: 3000, points: TASK, path: { mapId: 2 } }),
    ],
    ['out_of_order', history(3, 1999, 8)],
    ['duplicate', history(2, 2000, 8)],
  ];
  for (const [reason, geometry] of rejected) {
    const result = accumulator.merge(geometry);
    assert.deepEqual(result, { outcome: 'rejected', reason, history: reference }, reason);
  }
  assert.equal(accumulator.history, reference);
  assert.equal(established.history, reference);
  assert.deepEqual(structuredClone(reference), snapshotBefore);
  // An earlier, shorter history file confirms nothing new and only refreshes the receipt time.
  const shorter = accumulator.merge(history(9, 2000, 3, { endPose: [9, 9, 9] }));
  assert.equal(shorter.outcome, 'unchanged');
  assert.equal(shorter.history.points, reference.points);
  assert.deepEqual(shorter.history.endPose, { x: 3, y: -347, theta: 0 });
  assert.deepEqual([shorter.history.confirmed, shorter.history.revision], [5, 9]);
  // Rejections on an empty accumulator carry no history.
  const fresh = new MowerPathAccumulator();
  assert.deepEqual(fresh.merge(null), { outcome: 'rejected', reason: 'malformed' });
  assert.deepEqual(fresh.merge(realtime(1, 1, [])), { outcome: 'empty' });
  assert.equal(fresh.history, undefined);
});

test('a diverging history path of the same identity starts a new history without mixing', () => {
  const accumulator = new MowerPathAccumulator();
  accumulator.merge(history(1, 1000, 5));
  accumulator.merge(realtime(2, 2000, [TASK[5]]));
  const previous = accumulator.history;
  const before = structuredClone(previous);
  const nextTask = [
    [10, 10, 5],
    [20, 20, 5],
  ];
  const restarted = accumulator.merge(input({ revision: 3, receivedAt: 3000, points: nextTask }));
  assert.equal(restarted.outcome, 'started');
  assert.equal(restarted.reason, 'diverged');
  assert.equal(restarted.previous, previous);
  assert.deepEqual(structuredClone(previous), before);
  assert.deepEqual(positions(restarted.history.points), nextTask);
  assert.deepEqual(provenance(restarted.history.segments), [[0, 2, 3, 3000, 'history']]);
  assert.equal(restarted.history.confirmed, 2);
  // A history that diverges inside the confirmed points also starts over.
  const divergent = accumulator.merge(
    input({ revision: 4, receivedAt: 4000, points: [nextTask[0], [21, 21, 5], [22, 22, 5]] }),
  );
  assert.equal(divergent.outcome, 'started');
  assert.equal(divergent.reason, 'diverged');
  assert.equal(divergent.previous, restarted.history);
  // Growth of the new task continues normally.
  const grown = accumulator.merge(
    input({
      revision: 5,
      receivedAt: 5000,
      points: [nextTask[0], [21, 21, 5], [22, 22, 5], [23, 23, 5]],
    }),
  );
  assert.equal(grown.outcome, 'extended');
  assert.deepEqual([grown.added, grown.replaced], [1, 0]);
});

test('histories are frozen plain data, independent of the caller and bounded', () => {
  const accumulator = new MowerPathAccumulator({ maxPoints: 6 });
  const geometry = history(1, 1000, 5);
  const { history: frozen } = accumulator.merge(geometry);
  for (const value of [
    frozen,
    frozen.points,
    frozen.points[0],
    frozen.points[0].position,
    frozen.segments,
    frozen.segments[0],
    frozen.generation,
    frozen.generation.origin,
    frozen.generation.lastSavedTime,
    frozen.endPose,
  ])
    assert.equal(Object.isFrozen(value), true);
  assert.throws(() => frozen.points.push(frozen.points[0]), TypeError);
  assert.deepEqual(structuredClone(frozen), frozen);
  assert.deepEqual(JSON.parse(JSON.stringify(frozen)), frozen);
  assert.equal(Object.hasOwn(frozen, 'endPose'), true);
  // Later mutation of the decoded input does not reach the history.
  geometry.cleaningPath.points[0].position.x = 999;
  geometry.cleaningPath.points.push({ position: { x: 1, y: 1 }, kind: 'cleaning', kindCode: 0 });
  geometry.cleaningPath.endPose.theta = 42;
  geometry.map.width = 1;
  assert.deepEqual(positions(frozen.points), TASK.slice(0, 5));
  assert.deepEqual(frozen.endPose, { x: 3, y: -347, theta: 0 });
  assert.equal(frozen.generation.width, 350);
  // A realtime-started history has no established pose and no confirmed points.
  const provisional = new MowerPathAccumulator();
  const started = provisional.merge(realtime(1, 1000, TASK.slice(0, 2), { endPose: [5, 5, 5] }));
  assert.equal(started.outcome, 'started');
  assert.deepEqual([started.history.kind, started.history.confirmed], ['realtime', 0]);
  assert.equal(Object.hasOwn(started.history, 'endPose'), false);
  const confirmed = provisional.merge(history(2, 2000, 2));
  assert.equal(confirmed.outcome, 'unchanged');
  assert.deepEqual([confirmed.history.kind, confirmed.history.confirmed], ['history', 2]);
  assert.deepEqual(confirmed.history.endPose, { x: 3, y: -347, theta: 0 });
  // The point bound rejects growth beyond it and keeps the history.
  const within = accumulator.merge(history(2, 2000, 6));
  assert.equal(within.outcome, 'extended');
  const beyond = accumulator.merge(history(3, 3000, 7));
  assert.deepEqual(beyond, {
    outcome: 'rejected',
    reason: 'too_many_points',
    history: within.history,
  });
  const delta = accumulator.merge(realtime(4, 4000, [TASK[6]]));
  assert.deepEqual(delta, {
    outcome: 'rejected',
    reason: 'too_many_points',
    history: within.history,
  });
  const fresh = accumulator.merge(
    input({ revision: 5, receivedAt: 5000, points: TASK.slice(1, 8) }),
  );
  assert.deepEqual(fresh, {
    outcome: 'rejected',
    reason: 'too_many_points',
    history: within.history,
  });
  assert.equal(accumulator.history, within.history);
  // Options are validated and clear returns the history.
  for (const maxPoints of [0, -1, 1.5, MAX_MAP_RECORDS + 1, '10', Number.NaN])
    assert.throws(
      () => new MowerPathAccumulator({ maxPoints }),
      (error) => error instanceof EufyError && error.code === 'mower_path_invalid_options',
    );
  for (const options of [
    undefined,
    null,
    {},
    { maxPoints: undefined },
    { maxPoints: MAX_MAP_RECORDS },
  ])
    assert.equal(new MowerPathAccumulator(options).history, undefined);
  const cleared = accumulator.clear();
  assert.equal(cleared, within.history);
  assert.equal(accumulator.history, undefined);
  assert.equal(accumulator.clear(), undefined);
  assert.equal(accumulator.merge(history(6, 6000, 3)).reason, 'first');
});
