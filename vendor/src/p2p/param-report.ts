/**
 * Client addition, 0.31.0 (ha-eufy-cam#275). One parameter that a HomeBase
 * reports inside a CMD_HUB_NOTIFY_UPDATE (1829) notification. `channel` is the
 * entry's `dev_type`, which names the reporting device's channel on that
 * HomeBase. The value is kept as received text and is not interpreted here.
 */
export interface ParamReport {
  channel: number;
  type: number;
  value: string;
}

/** A notification carries few parameters. More are dropped, never parsed. */
export const MAX_PARAM_REPORTS = 32;

const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 65535;

/**
 * The parameters of one 1829 payload, an object or its JSON text. Only entries
 * with an integer `dev_type` and `param_type` and a string or finite number
 * `param_value` of at most 64 characters are kept, at most MAX_PARAM_REPORTS.
 * Anything else yields an empty list, never an error.
 */
export function parseParamReports(payload: unknown): ParamReport[] {
  let body = payload;
  if (typeof body === "string") {
    if (body.length > 16384) return [];
    try {
      body = JSON.parse(body);
    } catch {
      return [];
    }
  }
  return reportsOf((body as { params?: unknown } | null | undefined)?.params, MAX_PARAM_REPORTS);
}

/** A CMD_CAMERA_INFO reply lists every channel's parameters. More are dropped. */
export const MAX_CAMERA_INFO_REPORTS = 2048;

/** Base64 text longer than this decodes to more than 64 characters, so it is never decoded. */
const MAX_ENCODED_LENGTH = 88;

/**
 * Client addition, 0.31.1 (ha-eufy-cam#275). The `params` of a CMD_CAMERA_INFO
 * reply in the same shape and with the same checks. Since 0.31.3
 * (ha-eufy-cam#306) the reply's encoded entries (`db_bypass_str`) follow, each
 * `channel`, `param_type` and base64 `param_value` decoded as the vendored
 * Station decodes them, so an encoded entry comes after a plain one of the same
 * type. At most MAX_CAMERA_INFO_REPORTS in all. Anything else yields an empty
 * list, never an error.
 */
export function cameraInfoReports(params: unknown, encoded?: unknown): ParamReport[] {
  const reports = reportsOf(params, MAX_CAMERA_INFO_REPORTS);
  if (!Array.isArray(encoded)) return reports;
  const room = MAX_CAMERA_INFO_REPORTS - reports.length;
  const decoded = encoded.slice(0, room).map((entry) => {
    if (!entry || typeof entry !== "object") return undefined;
    const { channel, param_type, param_value } = entry as Record<string, unknown>;
    if (typeof param_value !== "string" || param_value.length > MAX_ENCODED_LENGTH) return undefined;
    return { dev_type: channel, param_type, param_value: Buffer.from(param_value, "base64").toString() };
  });
  return reports.concat(reportsOf(decoded, room));
}

function reportsOf(params: unknown, limit: number): ParamReport[] {
  if (!Array.isArray(params)) return [];
  const reports: ParamReport[] = [];
  for (const entry of params.slice(0, limit)) {
    if (!entry || typeof entry !== "object") continue;
    const { dev_type: channel, param_type: type, param_value: raw } = entry as Record<string, unknown>;
    if (!integer(channel) || !integer(type)) continue;
    const value =
      typeof raw === "string" ? raw : typeof raw === "number" && Number.isFinite(raw) ? String(raw) : undefined;
    if (value === undefined || value.length > 64) continue;
    reports.push({ channel, type, value });
  }
  return reports;
}
