const mode = process.env.EXPO_PUBLIC_APP_ENV;
const api = process.env.EXPO_PUBLIC_API_URL;
const realtime = process.env.EXPO_PUBLIC_REALTIME_URL;

export function mobileEnvironmentKey(key: string): string {
  if (mode !== 'development' && mode !== 'staging' && mode !== 'production') throw new Error('EXPO_PUBLIC_APP_ENV is required');
  return mode === 'production' ? key : `${key}.${mode}`;
}

export function validateMobileEnvironment(): void {
  mobileEnvironmentKey('validate');
  if (!api || !realtime) throw new Error('Both mobile API and realtime URLs are required');
  const a = new URL(api), r = new URL(realtime);
  if (a.username || r.username || a.password || r.password) throw new Error('Invalid mobile endpoint');
  if (mode === 'production') return;
  const hosts = [a.hostname, r.hostname].map(h => h.toLowerCase().replace(/\.$/, ''));
  if (![a,r].every(u => ['http:','https:','ws:','wss:'].includes(u.protocol) && !u.hash)) throw new Error('Invalid mobile endpoint protocol');
  if (hosts.some(h => h === 'eauupthwlnarkauwifmw.supabase.co' || h === 'uxcommunity.in' || h.endsWith('.uxcommunity.in') || h.startsWith('uxcommunity-web.') || h.startsWith('uxcommunity-realtime.'))) {
    throw new Error('Production mobile destination refused');
  }
  if (mode === 'development' && hosts.some(h => !['localhost','127.0.0.1','[::1]'].includes(h))) {
    throw new Error('Development builds require local endpoints');
  }
  if (mode === 'staging' && (a.protocol !== 'https:' || a.origin !== process.env.EXPO_PUBLIC_STAGING_ORIGIN || r.origin !== a.origin)) {
    throw new Error('Staging API and realtime must use the configured staging origin');
  }
}

export const mobilePushEnabled = mode === 'production';
