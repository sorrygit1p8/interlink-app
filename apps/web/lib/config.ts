export type WebMode = 'demo' | 'supabase';
export function webConfig() {
  const mode = process.env.INTERLINK_DATA_MODE ?? 'demo';
  const appEnv = process.env.INTERLINK_APP_ENV ?? 'development';
  if (!['demo', 'supabase'].includes(mode) || !['development', 'staging', 'production'].includes(appEnv)) {
    throw new Error('CONFIGURATION: 실행 모드 설정이 올바르지 않습니다.');
  }
  if (appEnv === 'production' && mode === 'demo') throw new Error('CONFIGURATION: 운영 환경에서는 데모를 실행할 수 없습니다.');
  return { mode: mode as WebMode, appEnv };
}

export function serverSupabaseConfig() {
  const { mode, appEnv } = webConfig();
  if (mode !== 'supabase') throw new Error('CONFIGURATION: 실제 연결 API는 Supabase 모드에서만 사용할 수 있습니다.');
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('CONFIGURATION: SUPABASE_URL / SUPABASE_ANON_KEY 설정이 필요합니다.');
  if (anonKey !== anonKey.trim()) throw new Error('CONFIGURATION: 공개 키 앞뒤의 공백을 제거해 주세요.');
  const parsed = new URL(url);
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback && appEnv !== 'production')) {
    throw new Error('CONFIGURATION: HTTPS Supabase 주소가 필요합니다.');
  }
  if (appEnv === 'production' && isLoopback) throw new Error('CONFIGURATION: 운영 환경에는 외부에서 접근 가능한 서버 주소가 필요합니다.');
  if (anonKey.startsWith('sb_secret_')) throw new Error('CONFIGURATION: 공개 클라이언트 키만 허용합니다.');
  if (anonKey.split('.').length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(anonKey.split('.')[1]!, 'base64url').toString('utf8')) as { role?: string };
      if (claims.role === 'service_role') throw new Error('CONFIGURATION: 서비스 역할 키를 웹 인증에 사용할 수 없습니다.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFIGURATION:')) throw error;
      throw new Error('CONFIGURATION: 공개 키 형식을 확인해 주세요.', { cause: error });
    }
  }
  return { url, anonKey };
}
