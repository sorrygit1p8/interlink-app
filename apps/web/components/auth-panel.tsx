'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/browser-client';
import { readBrowserSession, type SessionInfo } from '../lib/browser-session';
import { Brand, Icon } from './brand';

export function AuthPanel({ children, requireAdmin = true, allowDeletionStatus = false }: { children: React.ReactNode; requireAdmin?: boolean; allowDeletionStatus?: boolean }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [factor, setFactor] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<{ qrCode: string; secret: string } | null>(null);
  const [statusOnly, setStatusOnly] = useState(false);
  const [sessionFailed, setSessionFailed] = useState(false);

  async function loadSession() {
    setChecking(true); setError(''); setStatusOnly(false); setSessionFailed(false);
    try {
      const result = await readBrowserSession(allowDeletionStatus);
      setSession(result.kind === 'authenticated' ? result.session : null);
      setStatusOnly(result.kind === 'deletion-status');
    }
    catch (err) {
      setSession(null); setSessionFailed(true);
      setError(err instanceof Error ? err.message : '인증 상태를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    }
    finally { setChecking(false); }
  }
  useEffect(() => { void loadSession(); }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await task(); } catch (err) { setError(err instanceof Error ? err.message : '인증을 완료하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  async function startChallenge(factorId: string) {
    const result = await api<{ challengeId: string }>('/api/auth', { action: 'mfaChallenge', factorId });
    setFactor(factorId); setChallenge(result.challengeId); setCode('');
  }
  async function signOut() {
    const result = await api<{ message?: string }>('/api/auth', { action: 'signout' });
    setSession(null); setStatusOnly(false); setSessionFailed(false);
    setSent(false); setEmail(''); setToken(''); setFactor(''); setChallenge(''); setCode(''); setEnrollment(null);
    setNotice(result.message ?? '이 브라우저에서 로그아웃했습니다.');
  }

  if (checking) return <div className="center-screen"><div className="loading-line" /><p role="status">인증 세션을 확인하고 있어요.</p></div>;
  if (statusOnly || session?.authenticated && (!requireAdmin || session.admin)) return <>{children}<button className="session-signout" onClick={() => run(signOut)} disabled={busy}>로그아웃</button>{error && <div className="floating-error" role="alert">{error}</div>}</>;

  return <main id="main" className="auth-page"><Brand /><section className="auth-card"><span className="eyebrow"><Icon name="shield" /> VERIFIED ACCESS</span><h1>{requireAdmin ? '안전한 연결을 위한\n운영자 로그인' : '내 계정을\n안전하게 확인해요'}</h1><p className="muted">{requireAdmin ? '운영 권한이 부여된 계정과 인증 앱의 추가 인증이 필요합니다.' : '앱에서 사용한 이메일로 본인 확인 후 삭제 요청을 진행할 수 있습니다.'}</p>
    {error && <div className="message error" role="alert">{error}</div>}{notice && <div className="message success" role="status">{notice}</div>}
    {sessionFailed ? <div className="stack"><p className="muted">인증 상태를 아직 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.</p><button className="button primary full" disabled={busy} onClick={() => run(loadSession)}>인증 상태 다시 확인</button><button className="text-button" disabled={busy} onClick={() => run(signOut)}>이 브라우저에서 로그아웃</button></div> : !session ? <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
      if (!sent) { const result = await api<{ message: string }>('/api/auth', { action: 'send', email }); setSent(true); setNotice(result.message); }
      else { await api('/api/auth', { action: 'verify', email, token }); await loadSession(); }
    }); }}>
      <label>이메일<input type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required readOnly={sent} placeholder="앱에 등록한 이메일" /></label>
      {sent && <label>이메일 인증 코드<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={token} onChange={(event) => setToken(event.target.value)} required placeholder="이메일에 도착한 코드" /></label>}
      <button className="button primary full" disabled={busy}>{busy ? '확인 중…' : sent ? '본인 확인' : '인증 코드 요청'}<Icon name="arrow" /></button>
      {sent && <button type="button" className="text-button" disabled={busy} onClick={() => { setSent(false); setToken(''); setNotice(''); }}>이메일 변경 / 코드 다시 요청</button>}
    </form> : !session.mfa ? <div className="stack">
      <div className="message">이메일 인증 완료. 인증 앱으로 추가 인증해 주세요.</div>
      {!challenge && session.factors.filter((item) => item.status === 'verified').map((item) => <button className="button secondary" key={item.id} disabled={busy} onClick={() => run(() => startChallenge(item.id))}>{item.name}으로 인증하기<Icon name="arrow" /></button>)}
      {!challenge && !session.factors.some((item) => item.status === 'verified') && <button className="button secondary" disabled={busy} onClick={() => run(async () => { const result = await api<{ factorId: string; qrCode: string; secret: string }>('/api/auth', { action: 'mfaEnroll' }); setEnrollment({ qrCode: result.qrCode, secret: result.secret }); await startChallenge(result.factorId); })}>새 인증 앱 등록</button>}
      {enrollment && <div className="mfa-enrollment"><p>개인 인증 앱에서 QR을 스캔해 주세요.</p><img src={enrollment.qrCode} width="200" height="200" alt="인증 앱 등록용 QR 코드" /><details><summary>수동으로 등록하기</summary><code>{enrollment.secret}</code></details></div>}
      {challenge && <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await api('/api/auth', { action: 'mfaVerify', factorId: factor, challengeId: challenge, code }); setEnrollment(null); await loadSession(); }); }}><label>인증 앱의 6자리 코드<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required /></label><button className="button primary full" disabled={busy}>추가 인증 완료</button><button type="button" className="text-button" disabled={busy} onClick={() => run(() => startChallenge(factor))}>인증 요청 갱신</button></form>}
    </div> : <div className="message error">본인 확인은 완료됐지만 이 계정에 운영 권한이 없습니다. 운영 책임자가 서버에서 권한을 부여해야 합니다.</div>}
    {session && <button className="text-button" disabled={busy} onClick={() => run(signOut)}>다른 계정으로 로그인</button>}
    <p className="fine-print">실제 연결 경로입니다. 데모 계정 선택으로 인증을 건너뛸 수 없습니다.</p>
  </section><a className="subtle-link" href="/policies/privacy">개인정보처리방침 초안</a></main>;
}
