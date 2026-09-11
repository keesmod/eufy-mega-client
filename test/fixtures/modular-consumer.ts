import {
  EufyClient,
  EufyMegaClient,
  EufyError,
  FileSessionStore,
  type AuthState,
  type ClientOptions,
  type Device,
  type DiscoveryResult,
  type MowerAdapter,
  type MowerModule,
  type MowerSession,
  type MowerSessionStore,
  type SecurityModule,
  type Session,
} from '@keesmod/eufy-mega-client';

const credentials = { email: 'fixture@example.invalid', password: 'fixture', country: 'NL' };
const options: ClientOptions = { credentials, sessionStore: new FileSessionStore('camera.json') };
const legacy = new EufyMegaClient(options);
const devices: Promise<Device[]> = legacy.listDevices();
const discovery: Promise<DiscoveryResult> = legacy.discoverDevices();
const camera = new EufyClient({ security: options });
const security: SecurityModule | undefined = camera.security;
const store: MowerSessionStore = { load: async () => undefined, save: async () => {} };
const adapter: MowerAdapter = {
  connected: false,
  connect: async () => ({ state: 'disconnected' }),
  shutdown: async () => {},
};
const mower = new EufyClient({
  mowers: { credentials, sessionStore: store, adapter: () => adapter },
});
const module: MowerModule | undefined = mower.mowers;
const state: AuthState | undefined = module?.authState;
const opaque: MowerSession = { version: 1, data: 'opaque-fixture' };
// @ts-expect-error Opaque mower persistence cannot be used as a security session.
const securitySession: Session = opaque;
// @ts-expect-error The public security interface does not expose its cloud owner.
security?.cloud;
// @ts-expect-error The public mower interface does not expose its adapter or session.
module?.adapter;
// @ts-expect-error Physical mower operations are outside this API story.
module?.start();
// @ts-expect-error Camera configuration cannot use the mower session format.
new EufyClient({ security: { credentials, sessionStore: store } });
void [devices, state, securitySession, new EufyError('fixture')];

void discovery;
