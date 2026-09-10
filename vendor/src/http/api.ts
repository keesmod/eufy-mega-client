import type { Cipher, DeviceListResponse } from './models';
import type { Schedule, Voices } from './interfaces';

/** Injected operations. This module intentionally contains no HTTP implementation. */
export interface CloudProvider {
  isConnected(): boolean;
  getDevices(): { [id: string]: DeviceListResponse };
  refreshStationData(): Promise<void>;
  getP2pKey(stationId: string): Promise<{ key: string; expiresAt: number }>;
  getCommandCredentials(stationId: string, cipherId: number, userId: string): Promise<
    { mode: 'lan-derived' } | { mode: 'cipher'; cipher: Cipher }
  >;
  getCipher(cipherId: number, userId: string): Promise<Cipher | undefined>;
  getPublicKey(deviceId: string, type: number): Promise<string>;
  getImage(deviceId: string, url: string): Promise<Buffer>;
  getVoices(deviceId: string): Promise<Voices>;
  setParameters(stationId: string, deviceId: string, parameters: {paramType:number;paramValue:unknown}[]): Promise<boolean>;
  updateUserPassword(deviceId: string, userId: string, password: string, schedule?: Schedule): Promise<boolean>;
}
