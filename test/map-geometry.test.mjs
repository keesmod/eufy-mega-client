import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeMowerMapFile,
  decodeMowerPathFile,
  decodeMowerPoseFile,
  decodeMowerMapSnapshot,
} from '../dist/index.js';
import {
  MAX_MAP_DEPTH,
  MapWireError,
  mapWireBudget,
  readMapRecords,
} from '../dist/mowers/maps/protobuf.js';
import {
  w,
  msg,
  point,
  pose,
  polygon,
  region,
  mapMessage,
  channelMessage,
  pathMessage,
  poseFile,
  snapshot,
  LAWN,
  SQUARE,
  STATION,
} from './fixtures/map-geometry.mjs';

function decodedMap(bytes = mapMessage()) {
  const result = decodeMowerMapFile(new Uint8Array(channelMessage(bytes)));
  assert.equal(result.shape, 'decoded', JSON.stringify(result));
  return result.value.realtimeMap.map;
}

test('map identity, grid, bounds and station pose decode from the realtime channel message', () => {
  const file = new Uint8Array(channelMessage(mapMessage()));
  const before = Buffer.from(file);
  const result = decodeMowerMapFile(file);
  assert.equal(result.shape, 'decoded');
  assert.equal(result.byteLength, file.length);
  assert.deepEqual(Buffer.from(file), before);
  const { value } = result;
  assert.equal(value.kind, 'realtime_map');
  assert.deepEqual(value.undecodedFields, []);
  assert.equal(value.multiMap, undefined);
  const map = value.realtimeMap.map;
  assert.equal(map.id, 1);
  assert.equal(map.name, 'synthetic lawn');
  assert.equal(map.kind, 'normal');
  assert.equal(map.state, 'complete');
  assert.equal(map.stateCode, 2);
  assert.deepEqual([map.width, map.height, map.resolution], [350, 250, 20]);
  assert.deepEqual(map.origin, { x: -3000, y: -2000 });
  assert.deepEqual(map.bounds, { minX: -3000, minY: -2000, maxX: 4000, maxY: 3000 });
  assert.equal(map.hasStation, true);
  assert.deepEqual(map.stationPose, { x: 0, y: -300, theta: -1571 });
  assert.equal(map.totalArea, 123);
  assert.deepEqual(map.lastSavedTime, { seconds: 1700000000, nanos: 5 });
  assert.equal(map.mainDirectionAngle, 90);
  assert.equal(map.mapViewRotateAngle, 90);
  assert.equal(map.isBoundaryLocked, true);
  assert.equal(map.hasBirdView, true);
  assert.equal(map.birdViewIndex, 7);
  assert.equal(map.hasBackup, true);
  assert.equal(map.compressedDataBytes, 0);
  assert.deepEqual(map.undecodedFields, [24, 99]);
  assert.deepEqual(map.issues, []);
});

test('boundary, exclusion and pathway fields decode with their nested geometry', () => {
  const map = decodedMap();
  assert.equal(map.regions.length, 1);
  const [region1] = map.regions;
  assert.equal(region1.name, 'lawn');
  assert.deepEqual(
    region1.boundary.points,
    LAWN.map(([x, y]) => ({ x, y })),
  );
  assert.equal(region1.boundary.degenerate, false);
  assert.equal(region1.obstacles.length, 1);
  assert.deepEqual(region1.obstacles[0].points[2], { x: 600, y: 600 });
  const [sub] = region1.subRegions;
  assert.equal(sub.name, 'front');
  assert.equal(sub.isSelectedForMow, true);
  assert.deepEqual(sub.adjacentSubRegionIds, [2, 3]);
  assert.equal(sub.selectedForMowOrder, 1);
  assert.deepEqual(sub.center, { x: 500, y: 500 });
  assert.equal(sub.innerBoundaries.length, 1);
  assert.deepEqual(
    map.obstacles[0].points,
    SQUARE.map(([x, y]) => ({ x, y })),
  );
  assert.deepEqual(
    map.forbiddenZones.map((z) => [
      z.id,
      z.shape,
      z.isPolygon,
      Boolean(z.boundary),
      Boolean(z.ellipse),
    ]),
    [
      [1, 'rectangle', false, true, false],
      [2, 'polygon', true, true, false],
      [3, 'ellipse', false, false, true],
    ],
  );
  assert.deepEqual(map.forbiddenZones[2].ellipse.center, { x: 1000, y: 1000 });
  assert.equal(map.forbiddenZones[2].ellipse.semiMajorAxis, 300);
  assert.ok(Math.abs(map.forbiddenZones[2].ellipse.rotationAngle - 0.5) < 1e-6);
  assert.deepEqual(
    map.physicalForbiddenZones.map((z) => [z.id, z.isClosed, z.polygon.points.length]),
    [[5, true, 4]],
  );
  assert.deepEqual(map.virtualWalls[0], {
    id: 4,
    line: { p0: { x: 0, y: 0 }, p1: { x: 1000, y: 0 }, degenerate: false },
  });
  assert.deepEqual(map.crossBoundaryMarkers[0], { id: 6, pose: { x: 10, y: 20, theta: 30 } });
  assert.deepEqual(map.crossBoundaryTunnels, [
    {
      id: 65537,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 250 },
      ],
    },
  ]);
  assert.deepEqual(map.virtualCrossBoundaryTunnels, [
    {
      id: 9,
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    },
  ]);
  assert.deepEqual(
    map.passThroughZones.map((z) => [z.id, z.shape]),
    [[10, 'rectangle']],
  );
  assert.deepEqual(
    map.requiredZones.map((z) => [z.id, z.shape, z.obstacleAvoidance]),
    [[8, 'polygon', { hasConfig: true, height: 5 }]],
  );
  assert.deepEqual(map.trappedPoints, [{ id: 7, point: { x: -5, y: -6 } }]);
  assert.deepEqual(map.maintenancePoints, [{ id: 11, position: { x: 7, y: 8 }, name: 'tap' }]);
});

test('paths decode point kinds, end pose, legacy points and opaque compressed data', () => {
  const result = decodeMowerPathFile(
    new Uint8Array(pathMessage({ compressed: Buffer.from([1, 2, 3]) })),
  );
  assert.equal(result.shape, 'decoded');
  const path = result.value;
  assert.equal(path.mapId, 1);
  assert.equal(path.kind, 'history');
  assert.deepEqual(path.endPose, { x: 3, y: -347, theta: 0 });
  assert.deepEqual(
    path.points.map((p) => [p.position.x, p.position.y, p.kind, p.kindCode]),
    [
      [0, -300, 'cleaning', 0],
      [100, -200, 'resume', 2],
      [200, -100, 'cross_boundary', 3],
      [300, 0, 'move', 4],
      [400, 100, 'unknown', 9],
    ],
  );
  assert.deepEqual(path.legacyPoints, [{ x: -1, y: -1 }]);
  assert.equal(path.compressedDataBytes, 3);
  assert.deepEqual(path.undecodedFields, []);
  const empty = decodeMowerPathFile(new Uint8Array(msg(w.varint(2, 1))));
  assert.equal(empty.shape, 'decoded');
  assert.deepEqual(
    [empty.value.kind, empty.value.points, empty.value.endPose],
    ['realtime', [], undefined],
  );
});

test('snapshot decoding keeps the three files independent and the pose display only', () => {
  const geometry = decodeMowerMapSnapshot(snapshot());
  assert.deepEqual([geometry.revision, geometry.receivedAt], [3, 1700000000000]);
  assert.equal(geometry.map.name, 'synthetic lawn');
  assert.equal(geometry.channel.realtimeMap.map, geometry.map);
  assert.equal(geometry.cleaningPath.kind, 'history');
  assert.deepEqual(geometry.navigationPose, { x: 0, y: -300, theta: 1571 });
  assert.deepEqual(geometry.faults, []);
  const broken = decodeMowerMapSnapshot(
    snapshot({
      map: Buffer.from([0x12, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    }),
  );
  assert.equal(broken.map, undefined);
  assert.equal(broken.channel, undefined);
  assert.equal(broken.cleaningPath.kind, 'history');
  assert.deepEqual(broken.navigationPose, { x: 0, y: -300, theta: 1571 });
  assert.deepEqual(broken.faults, [
    { file: 'map.bin.stream', reason: 'varint', offset: 1, path: 'MapChannelMsg' },
  ]);
});

test('navPath accepts only the three pose fields and reports other content', () => {
  const asPath = decodeMowerPoseFile(new Uint8Array(pathMessage()));
  assert.equal(asPath.shape, 'malformed');
  assert.equal(asPath.reason, 'field_type');
  const extra = decodeMowerPoseFile(new Uint8Array(msg(pose(1, 2, 3), w.varint(4, 1))));
  assert.equal(extra.shape, 'malformed');
  const geometry = decodeMowerMapSnapshot(snapshot({ nav: pathMessage() }));
  assert.equal(geometry.navigationPose, undefined);
  assert.deepEqual(
    geometry.faults.map((f) => [f.file, f.reason]),
    [['navPath.bin.stream', 'field_type']],
  );
  const empty = decodeMowerPoseFile(new Uint8Array(0));
  assert.deepEqual(empty, { shape: 'decoded', byteLength: 0, value: { x: 0, y: 0, theta: 0 } });
});

test('malformed protobuf never throws and names the fault, offset and message path', () => {
  const cases = [
    [Buffer.from([0x08]), 'truncated', 1, 'MapChannelMsg'],
    [
      Buffer.from([0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      'varint',
      1,
      'MapChannelMsg',
    ],
    [Buffer.from([0x00, 0x00]), 'field_number', 0, 'MapChannelMsg'],
    [Buffer.from([0x0b]), 'group', 0, 'MapChannelMsg'],
    [Buffer.from([0x0c]), 'group', 0, 'MapChannelMsg'],
    [Buffer.from([0x0e, 0x00]), 'wire_type', 0, 'MapChannelMsg'],
    [Buffer.from([0x0f, 0x00]), 'wire_type', 0, 'MapChannelMsg'],
    [Buffer.from([0x12, 0x05, 0x01]), 'length', 0, 'MapChannelMsg'],
    [Buffer.from([0x15, 0x01, 0x02]), 'length', 0, 'MapChannelMsg'],
    [Buffer.from([0x11, 0x01]), 'length', 0, 'MapChannelMsg'],
    [Buffer.concat([w.varint(2, 7)]), 'field_type', 0, 'MapChannelMsg.realtimeMap'],
    [
      channelMessage(msg(w.bytes(1, Buffer.from('x')))),
      'field_type',
      4,
      'MapChannelMsg.realtimeMap.map',
    ],
    [
      channelMessage(msg(w.bytes(6, msg(w.bytes(1, Buffer.from('x')))))),
      'field_type',
      6,
      'MapChannelMsg.realtimeMap.map.origin',
    ],
    [
      channelMessage(mapMessage({}, [w.varint(29, 1)])),
      'field_type',
      undefined,
      'MapChannelMsg.realtimeMap.map.lastSavedTime',
    ],
    [
      channelMessage(mapMessage({}, [w.bytes(12, msg(w.bytes(5, msg(w.varint(4, 1)))))])),
      'field_type',
      undefined,
      'MapChannelMsg.realtimeMap.map.forbiddenZones.ellipse',
    ],
  ];
  for (const [bytes, reason, offset, path] of cases) {
    const result = decodeMowerMapFile(new Uint8Array(bytes));
    assert.equal(result.shape, 'malformed', `${reason}: ${bytes.toString('hex')}`);
    assert.equal(result.reason, reason);
    if (offset !== undefined) assert.equal(result.offset, offset);
    assert.equal(result.path, path);
    assert.equal(result.byteLength, bytes.length);
  }
  const budget = mapWireBudget();
  assert.throws(
    () => readMapRecords(new Uint8Array(point(1, 1)), 0, MAX_MAP_DEPTH + 1, budget, 'Point'),
    (error) => error instanceof MapWireError && error.reason === 'too_deep',
  );
  assert.throws(
    () => readMapRecords(new Uint8Array(point(1, 1)), 0, 0, { records: 1 }, 'Point'),
    (error) =>
      error instanceof MapWireError && error.reason === 'too_many_records' && error.offset === 2,
  );
  const big = decodeMowerPathFile(new Uint8Array(msg(w.varint(1, 2n ** 64n - 1n))));
  assert.equal(big.shape, 'decoded');
  assert.equal(big.value.id, -1);
});

test('omitted axes and empty records decode as protocol defaults', () => {
  const map = decodedMap(
    mapMessage({ origin: null, station: null }, [
      w.bytes(6, msg(w.sint(1, -7))),
      w.bool(7, true),
      w.bytes(8, msg()),
      w.bytes(11, msg(w.bytes(1, msg()), w.bytes(1, msg(w.sint(2, 4))))),
    ]),
  );
  assert.deepEqual(map.origin, { x: -7, y: 0 });
  assert.deepEqual(map.stationPose, { x: 0, y: 0, theta: 0 });
  assert.deepEqual(map.obstacles[1].points, [
    { x: 0, y: 0 },
    { x: 0, y: 4 },
  ]);
  assert.equal(map.obstacles[1].degenerate, true);
  const path = decodeMowerPathFile(new Uint8Array(msg(w.bytes(7, msg(w.varint(2, 1))))));
  assert.deepEqual(path.value.points, [{ position: { x: 0, y: 0 }, kind: 'return', kindCode: 1 }]);
});

test('invalid geometry is flagged, never repaired and never turned into a zone', () => {
  const twoPoints = polygon([
    [0, 0],
    [1, 1],
  ]);
  const collapsed = polygon([
    [5, 5],
    [5, 5],
    [5, 5],
  ]);
  const map = decodedMap(
    mapMessage(
      {
        width: 0,
        resolution: 0,
        station: [9000, 9000, 0],
        regions: [
          region({
            boundary: [
              [0, 0],
              [1, 1],
            ],
          }),
        ],
      },
      [
        w.bytes(11, twoPoints),
        w.bytes(11, collapsed),
        w.bytes(
          13,
          msg(w.varint(1, 1), w.bytes(2, msg(w.bytes(1, point(3, 3)), w.bytes(2, point(3, 3))))),
        ),
        w.bytes(
          12,
          msg(w.varint(1, 1), w.varint(4, 2), w.bytes(5, msg(w.varint(2, 0), w.varint(3, 10)))),
        ),
      ],
    ),
  );
  assert.deepEqual(map.issues, ['empty_grid', 'zero_resolution', 'degenerate_region_boundary']);
  assert.equal(map.bounds, undefined);
  assert.equal(map.regions[0].boundary.degenerate, true);
  assert.deepEqual(
    map.obstacles.slice(-2).map((p) => p.degenerate),
    [true, true],
  );
  assert.equal(map.virtualWalls.at(-1).line.degenerate, true);
  assert.equal(map.forbiddenZones.at(-1).ellipse.degenerate, true);
  const outside = decodedMap(mapMessage({ station: [9000, 9000, 0] }));
  assert.deepEqual(outside.issues, ['station_pose_outside_bounds']);
  const missing = decodedMap(mapMessage({ station: null }, [w.bool(7, true)]));
  assert.deepEqual(missing.issues, ['station_pose_missing']);
  assert.equal(Object.keys(outside).includes('zones'), false);
  assert.equal(Object.keys(outside.regions[0].subRegions[0]).includes('select'), false);
});

test('unknown enumeration values, unknown fields and packed or unpacked lists are preserved', () => {
  const map = decodedMap(
    mapMessage({ state: 9, kind: 5 }, [
      w.bytes(12, msg(w.varint(1, 12), w.varint(4, 7))),
      w.bytes(
        10,
        msg(w.varint(1, 2), w.bytes(4, msg(w.varint(1, 3), w.varint(5, 4), w.varint(5, 6)))),
      ),
    ]),
  );
  assert.deepEqual(
    [map.state, map.stateCode, map.kind, map.kindCode],
    ['unknown', 9, 'unknown', 5],
  );
  assert.deepEqual(
    [map.forbiddenZones.at(-1).shape, map.forbiddenZones.at(-1).shapeCode],
    ['unknown', 7],
  );
  assert.deepEqual(map.regions[1].subRegions[0].adjacentSubRegionIds, [4, 6]);
  assert.deepEqual(map.undecodedFields, [24, 99]);
  const multi = decodeMowerMapFile(
    new Uint8Array(
      msg(
        w.varint(1, 1),
        w.bytes(
          3,
          msg(
            w.varint(1, 2),
            w.bytes(3, msg(w.bytes(1, mapMessage({ id: 5 })))),
            w.bytes(4, Buffer.from([1, 2])),
          ),
        ),
      ),
    ),
  );
  assert.equal(multi.shape, 'decoded');
  assert.equal(multi.value.kind, 'multi_map');
  assert.equal(multi.value.multiMap.kind, 'all_maps');
  assert.deepEqual(
    multi.value.multiMap.allMaps.map((m) => m.id),
    [5],
  );
  assert.deepEqual(multi.value.multiMap.undecodedFields, [4]);
  assert.equal(multi.value.realtimeMap, undefined);
});

test('the acquisition snapshot contract is the decoder input and the result is plain data', () => {
  const snap = snapshot();
  const geometry = decodeMowerMapSnapshot(snap);
  const copy = structuredClone(geometry);
  assert.deepEqual(copy, geometry);
  assert.deepEqual(Object.keys(snap.files), [
    'map.bin.stream',
    'cleanPath.bin.stream',
    'navPath.bin.stream',
  ]);
  assert.equal(typeof geometry.map.stationPose.theta, 'number');
  assert.deepEqual(geometry.map.stationPose, { x: STATION[0], y: STATION[1], theta: STATION[2] });
});
