'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createDemoClient } from '@interlink/data';
import type { AccountStatus } from '@interlink/shared';
import { api } from '../lib/browser-client';
import { Brand, Icon } from './brand';

export function DeleteAccount({ mode }: { mode: 'demo' | 'supabase' }) {
  const [demo] = useState(() => mode === 'demo' ? createDemoClient({ actor: 'B' }) : null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [requestKey, setRequestKey] = useState('');
  async function refresh() { setStatus(demo ? await demo.query('account.status', {}) : (await api<{ result: AccountStatus }>('/api/account')).result); }
  async function run(task: () => Promise<void>) {
    setBusy(true); setError('');
    try { await task(); } catch (err) { setError(err instanceof Error ? err.message : '요청을 처리하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { setRequestKey(crypto.randomUUID()); void run(refresh); }, []);
  const labels: Record<string, string> = { requested: '삭제 요청됨', processing: '삭제 처리 중', completed: '삭제 완료', failed: '삭제 처리 실패' };
  const deletion = status?.deletionStatus;
  const canRequest = status && !deletion && status.status !== 'deleted' && status.status !== 'deleting';
  return <div className="document-page narrow"><header className="document-header"><Brand /><Link href="/policies/privacy" className="subtle-link">개인정보 안내 ↗</Link></header><main id="main"><div className="mode-banner"><span><strong>{mode === 'demo' ? 'DEMO' : 'ACCOUNT'}</strong>{mode === 'demo' ? '가상 사용자 B의 삭제 시나리오 · 실제 계정은 삭제되지 않음' : '등록 이메일로 확인한 본인 계정만 처리합니다.'}</span></div><div className="document-title"><span className="eyebrow">YOUR ACCOUNT, YOUR CHOICE</span><h1>계정 삭제 요청</h1><p>마지막까지, 내 정보를 직접 선택할 수 있도록.</p></div>{error && <div className="message error" role="alert">{error}<button className="text-button" disabled={busy} onClick={() => run(refresh)}>상태 다시 확인</button></div>}<section className="panel"><div className="panel-heading"><h2>삭제 전 확인해 주세요</h2><Icon name="shield" /></div><div className="detail-body"><ol className="deletion-list"><li><strong>내 팀부터 정리해요.</strong><p>앱에서 소유권을 다른 팀원에게 이전할 수 있습니다. 이 페이지에서 요청하면 내가 소유한 팀은 종료·보관 처리됩니다.</p></li><li><strong>새 활동을 중단하고 정보를 처리해요.</strong><p>신규 신청·초대·메시지·알림이 제한되고 프로필·경험·기기 토큰·파일·인증 계정의 삭제 작업이 진행됩니다.</p></li><li><strong>요청과 완료는 달라요.</strong><p>일부 처리에 실패하면 재시도합니다. 법적 보존 범위·기간·근거는 정책 검토 항목으로 아직 확정되지 않았습니다.</p></li></ol>{status ? <div className={`deletion-status ${deletion === 'failed' ? 'error' : ''}`} role="status"><span className="status-dot" /><strong>{deletion ? labels[deletion] : status.status === 'deleted' ? '삭제 완료' : status.status === 'deleting' ? '삭제 처리 중' : '삭제 요청 전'}</strong>{status.deletionRequestId && <small>요청 번호: {status.deletionRequestId}</small>}{deletion === 'failed' && <p>처리기가 재시도할 수 있도록 실패 상태가 기록되었습니다. 운영자가 작업 모니터에서 상태를 확인할 수 있습니다.</p>}{mode === 'demo' && deletion && <p>가상 데이터의 상태 변화입니다. 실제 파일·계정·원격 데이터 삭제 검증은 수행되지 않았습니다.</p>}</div> : <p role="status">{busy ? '계정 상태를 확인하는 중입니다.' : '계정 상태를 확인하지 못했습니다. 상태 다시 확인을 눌러 주세요.'}</p>}{canRequest && <form onSubmit={(event) => { event.preventDefault(); void run(async () => { const body = { confirmation: 'DELETE' as const, ownedTeams: 'archive' as const }; const result = demo ? await demo.command('account.delete', body, requestKey) : (await api<{ result: { id: string; status?: string } }>('/api/account', { ...body, idempotencyKey: requestKey })).result; const acceptedStatus = result.status === 'completed' || result.status === 'processing' || result.status === 'failed' ? result.status : 'requested'; setStatus({ status: acceptedStatus === 'completed' ? 'deleted' : 'deleting', deletionRequestId: result.id, deletionStatus: acceptedStatus }); setConfirmation(''); setAgreed(false); try { await refresh(); } catch { throw new Error('삭제 요청이 접수되었습니다. 최신 처리 상태를 불러오지 못했으니 상태 다시 확인을 눌러 주세요.'); } }); }}><label className="checkbox-label"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} required /><span>소유한 팀의 종료와 계정 삭제 처리 내용을 확인했습니다.</span></label><label>확인을 위해 DELETE를 입력해 주세요.<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} required pattern="DELETE" placeholder="DELETE" /></label><button className="button danger full" disabled={busy || !agreed || confirmation !== 'DELETE'}>{busy ? '요청 중…' : mode === 'demo' ? '가상 계정 삭제 시나리오 실행' : '내 계정 삭제 요청'}</button></form>}{status && !canRequest && <button className="button secondary full" disabled={busy} onClick={() => run(refresh)}><Icon name="refresh" />처리 상태 다시 확인</button>}{mode === 'demo' && <button className="text-button" disabled={busy} onClick={() => run(async () => { await demo!.reset(); setRequestKey(crypto.randomUUID()); setAgreed(false); setConfirmation(''); await refresh(); })}>가상 사용자 초기화</button>}</div></section><p className="fine-print">{mode === 'demo' ? '이 화면은 앱·운영 웹과 분리된 메모리 데모입니다. 새로고침하면 초기화됩니다.' : '삭제 요청 상태를 서버에서 확인합니다. 인증 계정 삭제가 완료된 후에는 다시 로그인할 수 없습니다.'}</p><nav className="policy-nav"><Link href="/policies/privacy">개인정보처리방침 초안</Link><Link href="/policies/support">고객지원 안내</Link></nav></main></div>;
}
