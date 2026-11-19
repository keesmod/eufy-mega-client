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

/**
 * Client addition, 0.31.1 (ha-eufy-cam#275). The `params` of a CMD_CAMERA_INFO
 * reply in the same shape and with the same checks, at most
 * MAX_CAMERA_INFO_REPORTS. Anything else yields an empty list, never an error.
 */
export function cameraInfoReports(params: unknown): ParamReport[] {
  return reportsOf(params, MAX_CAMERA_INFO_REPORTS);
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
