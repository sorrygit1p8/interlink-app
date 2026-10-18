import { AuthPanel } from '../components/auth-panel';
import { Brand } from '../components/brand';
import { Operations } from '../components/operations';
import { serverSupabaseConfig, webConfig } from '../lib/config';

export const dynamic = 'force-dynamic';
export default function Home() {
  try {
    const { mode } = webConfig();
    if (mode === 'supabase') serverSupabaseConfig();
    return mode === 'demo' ? <Operations mode="demo" /> : <AuthPanel><Operations mode="supabase" /></AuthPanel>;
  } catch (error) {
    return <main id="main" className="auth-page"><Brand /><section className="auth-card"><span className="eyebrow">CONFIGURATION REQUIRED</span><h1>연결 설정을<br />확인해 주세요.</h1><div className="message error" role="alert">{error instanceof Error ? error.message.replace('CONFIGURATION: ', '') : '실행 설정이 올바르지 않습니다.'}</div><p className="muted">실제 연결 모드에서 설정이 누락되어 실행을 중단했습니다. 환경 설정을 적용한 뒤 서버를 다시 시작해 주세요.</p><a href="/policies/support" className="button secondary">지원 안내</a></section></main>;
  }
}
