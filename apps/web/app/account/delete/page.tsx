import { AuthPanel } from '../../../components/auth-panel';
import { DeleteAccount } from '../../../components/delete-account';
import { Brand } from '../../../components/brand';
import { serverSupabaseConfig, webConfig } from '../../../lib/config';

export const dynamic = 'force-dynamic';
export default function DeletePage() {
  try {
    const { mode } = webConfig();
    if (mode === 'supabase') serverSupabaseConfig();
    return mode === 'demo' ? <DeleteAccount mode="demo" /> : <AuthPanel requireAdmin={false} allowDeletionStatus><DeleteAccount mode="supabase" /></AuthPanel>;
  } catch (error) {
    return <main id="main" className="auth-page"><Brand /><section className="auth-card"><h1>본인 확인 설정이 필요해요.</h1><div className="message error">{error instanceof Error ? error.message.replace('CONFIGURATION: ', '') : '연결 설정을 확인해 주세요.'}</div><a href="/policies/support">지원 안내</a></section></main>;
  }
}
