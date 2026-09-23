// Synthetic map geometry authored from the field numbering recorded in docs/MAP_GEOMETRY.md.
// No household bytes. Coordinates are invented and do not describe any real lawn.
export function varint(value) {
  let v = BigInt.asUintN(64, BigInt(value));
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return Buffer.from(out);
}
export function zigzag(value) {
  const v = BigInt(value);
  return varint(BigInt.asUintN(32, (v << 1n) ^ (v >> 31n)));
}
export function tag(number, wireType) {
  return varint(BigInt(number) * 8n + BigInt(wireType));
}
export const w = {
  varint: (number, value) => Buffer.concat([tag(number, 0), varint(value)]),
  sint: (number, value) => Buffer.concat([tag(number, 0), zigzag(value)]),
  bool: (number, value) => Buffer.concat([tag(number, 0), varint(value ? 1 : 0)]),
  bytes: (number, payload) =>
    Buffer.concat([tag(number, 2), varint(payload.length), Buffer.from(payload)]),
  str: (number, value) => w.bytes(number, Buffer.from(value, 'utf8')),
  fixed32: (number, value) => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value);
    return Buffer.concat([tag(number, 5), b]);
  },
  fixed64: (number) => Buffer.concat([tag(number, 1), Buffer.alloc(8)]),
  packed: (number, values) => w.bytes(number, Buffer.concat(values.map((v) => varint(v)))),
};
export const msg = (...parts) => Buffer.concat(parts);
export const point = (x, y) => msg(w.sint(1, x), w.sint(2, y));
export const pose = (x, y, theta) => msg(w.sint(1, x), w.sint(2, y), w.sint(3, theta));
export const polygon = (points) => msg(...points.map(([x, y]) => w.bytes(1, point(x, y))));
export const line = (p0, p1) => msg(w.bytes(1, point(...p0)), w.bytes(2, point(...p1)));
export const ellipse = (center, a, b, angle) =>
  msg(w.bytes(1, point(...center)), w.varint(2, a), w.varint(3, b), w.fixed32(4, angle));
export const timestamp = (seconds, nanos) => msg(w.varint(1, seconds), w.varint(2, nanos));

export const LAWN = [
  [-2000, -1500],
  [3000, -1500],
  [3500, 2000],
  [0, 2500],
  [-2500, 1000],
];
export const SQUARE = [
  [100, 100],
  [600, 100],
  [600, 600],
  [100, 600],
];
export const STATION = [0, -300, -1571];

export function subRegion(overrides = {}) {
  const o = { id: 1, name: 'front', boundary: LAWN, adjacent: [2, 3], order: 1, ...overrides };
  return msg(
    w.varint(1, o.id),
    w.str(2, o.name),
    w.bytes(3, polygon(o.boundary)),
    w.bool(4, true),
    w.packed(5, o.adjacent),
    w.varint(6, o.order),
    w.bytes(7, point(500, 500)),
    w.bytes(9, polygon(SQUARE)),
  );
}
export function region(overrides = {}) {
  const o = { id: 1, name: 'lawn', boundary: LAWN, ...overrides };
  return msg(
    w.varint(1, o.id),
    w.str(2, o.name),
    w.bytes(3, polygon(o.boundary)),
    w.bytes(4, subRegion()),
    w.bytes(6, msg(w.bytes(1, polygon(SQUARE)))),
  );
}
/** One complete synthetic Map message. `extra` appends raw records. */
export function mapMessage(overrides = {}, extra = []) {
  const o = {
    id: 1,
    name: 'synthetic lawn',
    width: 350,
    height: 250,
    resolution: 20,
    origin: [-3000, -2000],
    station: STATION,
    state: 2,
    kind: 0,
    totalArea: 123,
    regions: [region()],
    ...overrides,
  };
  const parts = [
    w.varint(1, o.id),
    w.str(2, o.name),
    w.varint(3, o.width),
    w.varint(4, o.height),
    w.varint(5, o.resolution),
  ];
  if (o.origin) parts.push(w.bytes(6, point(...o.origin)));
  if (o.station) parts.push(w.bool(7, true), w.bytes(8, pose(...o.station)));
  parts.push(
    ...o.regions.map((r) => w.bytes(10, r)),
    w.bytes(11, polygon(SQUARE)),
    w.bytes(12, msg(w.varint(1, 1), w.bytes(2, polygon(SQUARE)), w.bool(3, false), w.varint(4, 0))),
    w.bytes(12, msg(w.varint(1, 2), w.bytes(2, polygon(LAWN)), w.bool(3, true), w.varint(4, 1))),
    w.bytes(
      12,
      msg(w.varint(1, 3), w.varint(4, 2), w.bytes(5, ellipse([1000, 1000], 300, 200, 0.5))),
    ),
    w.bytes(13, msg(w.varint(1, 4), w.bytes(2, line([0, 0], [1000, 0])))),
    w.bytes(14, msg(w.varint(1, 5), w.bytes(2, polygon(SQUARE)), w.bool(3, true))),
    w.bytes(15, msg(w.varint(1, 6), w.bytes(2, pose(10, 20, 30)))),
    w.varint(16, o.totalArea),
    w.varint(17, o.state),
    w.bytes(
      18,
      msg(
        w.bytes(1, point(0, 0)),
        w.bytes(1, point(100, 100)),
        w.bytes(1, point(200, 250)),
        w.varint(2, 65537),
      ),
    ),
    w.bytes(20, msg(w.varint(1, 7), w.bytes(2, point(-5, -6)))),
    w.bool(21, true),
    w.varint(22, 7),
    w.bytes(24, msg(w.varint(3, 1))),
    w.bool(25, true),
    w.bytes(
      26,
      msg(
        w.varint(1, 8),
        w.bytes(2, polygon(SQUARE)),
        w.bytes(3, msg(w.bool(1, true), w.varint(2, 5))),
        w.varint(4, 1),
      ),
    ),
    w.bytes(29, timestamp(1700000000, 5)),
    w.varint(30, 90),
    w.bytes(32, msg(w.bytes(1, point(1, 1)), w.bytes(1, point(2, 2)), w.varint(2, 9))),
    w.varint(34, o.kind),
    w.bytes(35, msg(w.varint(1, 10), w.bytes(2, polygon(SQUARE)), w.varint(3, 0))),
    w.varint(37, 90),
    w.bytes(38, msg(w.varint(1, 11), w.bytes(2, point(7, 8)), w.str(3, 'tap'))),
    w.bool(39, true),
    w.varint(99, 1),
    ...extra,
  );
  return msg(...parts);
}
export const channelMessage = (mapBytes) => msg(w.bytes(2, msg(w.bytes(1, mapBytes))));
export function pathMessage(overrides = {}) {
  const o = {
    mapId: 1,
    kind: 1,
    endPose: [3, -347, 0],
    points: [
      [0, -300, 0],
      [100, -200, 2],
      [200, -100, 3],
      [300, 0, 4],
      [400, 100, 9],
    ],
    ...overrides,
  };
  const parts = [w.varint(2, o.mapId), w.varint(3, o.kind)];
  if (o.id !== undefined) parts.unshift(w.varint(1, o.id));
  if (o.compressed) parts.push(w.bytes(4, o.compressed));
  if (o.endPose) parts.push(w.bytes(5, pose(...o.endPose)));
  parts.push(w.bytes(6, point(-1, -1)));
  for (const [x, y, kind] of o.points)
    parts.push(
      w.bytes(
        7,
        kind ? msg(w.bytes(1, point(x, y)), w.varint(2, kind)) : msg(w.bytes(1, point(x, y))),
      ),
    );
  return msg(...parts);
}
export const poseFile = (x, y, theta) => pose(x, y, theta);
export function snapshot(files = {}) {
  return {
    revision: 3,
    receivedAt: 1700000000000,
    files: {
      'map.bin.stream': new Uint8Array(files.map ?? channelMessage(mapMessage())),
      'cleanPath.bin.stream': new Uint8Array(files.path ?? pathMessage()),
      'navPath.bin.stream': new Uint8Array(files.nav ?? poseFile(0, -300, 1571)),
    },
  };
}
