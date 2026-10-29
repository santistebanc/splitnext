import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/);

const device = { device: id };

const empty = z.object({});

export const operations = {
  shutdown: empty,
  timeline: empty,
  status: empty,
  discover: empty,
  addDevice: z.object({
    device: id,
    kind: z.enum(["browser", "inpage"]).default("browser"),
  }),
  removeDevice: z.object(device),
  inspectDevice: z.object(device),
  reloadDevice: z.object(device),
  deviceNetwork: z.object({
    ...device,
    online: z.boolean(),
    latencyMs: z.number().int().min(0).max(30000).optional(),
  }),
  deviceScreen: z.object({
    ...device,
    width: z.number().int().min(240).max(1600),
    height: z.number().int().min(320).max(1600),
  }),
  deviceForeground: z.object(device),
  deviceNavigate: z.object({
    ...device,
    direction: z.enum(["back", "forward"]),
  }),
  deviceCapabilities: z.object({
    ...device,
    clipboard: z.boolean().optional(),
    share: z.boolean().optional(),
    clipboardText: z.string().max(100000).optional(),
  }),
  reloadHost: empty,
  action: z.object({
    ...device,
    name: z.string(),
    input: z.json().default({}),
    confirmed: z.boolean().default(false),
  }),
  input: z.object({
    ...device,
    kind: z.enum(["click", "type", "key", "wheel"]),
    x: z.number().optional(),
    y: z.number().optional(),
    pointerX: z.number().optional(),
    pointerY: z.number().optional(),
    text: z.string().optional(),
  }),
  serverNetwork: z.object({ available: z.boolean() }),
  serverProcess: z.object({ running: z.boolean() }),
  inspectServer: empty,
  inspectStores: empty,
  replaceRows: z.object({
    store: z.string(),
    table: z.string(),
    rows: z.array(z.record(z.string(), z.json())),
  }),
  checkpoint: z.object({ name: id }),
  restore: z.object({ name: id }),
  freshStart: empty,
  wait: z.object({
    until: z.enum(["convergence", "outbox", "recovery"]),
    devices: z.array(id).min(1),
    timeoutMs: z.number().int().min(1).max(120000).default(15000),
  }),
  export: empty,
  replay: z.object({
    steps: z
      .array(z.object({ operation: z.string(), input: z.json() }))
      .max(1000),
  }),
};

export const discovery = () =>
  Object.fromEntries(
    Object.entries(operations).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema),
    ]),
  );
