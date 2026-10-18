'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createDemoClient } from '@interlink/data';
import type { AuditEntry, CommandMap, CommandName, Community, DataClient, Job, Page, QueryMap, Report } from '@interlink/shared';
import { createOperationsClient } from '../lib/browser-client';
import { applyAndRefresh, createInviteIntent } from '../lib/operations-actions';
import { Brand, Icon } from './brand';

type Tab = 'overview' | 'reports' | 'communities' | 'jobs' | 'audit';
type Client = Pick<DataClient, 'mode' | 'query' | 'command'>;
type Overview = QueryMap['admin.overview']['output'];
const tabs: { id: Tab; label: string; icon: string }[] = [{ id: 'overview', label: '운영 개요', icon: 'grid' }, { id: 'reports', label: '신고 관리', icon: 'flag' }, { id: 'communities', label: '커뮤니티', icon: 'people' }, { id: 'jobs', label: '작업 모니터', icon: 'jobs' }, { id: 'audit', label: '감사 기록', icon: 'audit' }];
const reportLabels: Record<Report['status'], string> = { open: '검토 대기', reviewing: '검토 중', resolved: '처리 완료', dismissed: '기각' };
const targetLabels = { profile: '프로필', project: '프로젝트', message: '팀 메시지', report: '신고' };
const actionLabels: Record<CommandMap['admin.action']['input']['action'], string> = { hide: '콘텐츠 숨김', restore: '콘텐츠 복구', suspend: '계정 제한', reactivate: '계정 제한 해제', resolve: '처리 완료', dismiss: '신고 기각' };
const date = (value: string | null | undefined) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value)) : '—';
const shortId = (id: string) => id.slice(0, 8).toUpperCase();

async function reloadVisiblePages<T>(read: (cursor?: string) => Promise<Page<T>>, minimum: number): Promise<Page<T>> {
  const first = await read();
  const items = [...first.items];
  let nextCursor = first.nextCursor;
  // Keep loaded rows visible after mutations and refresh, including jobs past page one.
  while (nextCursor && items.length < minimum) {
    const next = await read(nextCursor);
    items.push(...next.items);
    nextCursor = next.nextCursor;
  }
  return { items, nextCursor };
}

export function Operations({ mode }: { mode: 'demo' | 'supabase' }) {
  const [client] = useState<Client>(() => mode === 'demo' ? createDemoClient({ actor: 'admin' }) : createOperationsClient());
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reports, setReports] = useState<Page<Report>>({ items: [], nextCursor: null });
  const [audit, setAudit] = useState<Page<AuditEntry>>({ items: [], nextCursor: null });
  const [jobs, setJobs] = useState<Page<Job>>({ items: [], nextCursor: null });
  const [communities, setCommunities] = useState<Page<Community>>({ items: [], nextCursor: null });
  const [selected, setSelected] = useState<Report | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | Report['status']>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [showReset, setShowReset] = useState(false);

  async function load() {
    const [counts, reportPage, auditPage, jobPage, communityPage] = await Promise.all([
      client.query('admin.overview', {}),
      reloadVisiblePages((cursor) => client.query('admin.reports', { status: statusFilter || undefined, cursor, limit: 20 }), reports.items.length),
      reloadVisiblePages((cursor) => client.query('admin.audit', { cursor, limit: 20 }), audit.items.length),
      reloadVisiblePages((cursor) => client.query('admin.jobs', { cursor, limit: 20 }), jobs.items.length),
      reloadVisiblePages((cursor) => client.query('admin.communities', { cursor, limit: 20 }), communities.items.length),
    ]);
    setOverview(counts); setReports(reportPage); setAudit(auditPage); setJobs(jobPage); setCommunities(communityPage); setUpdatedAt(new Date().toISOString());
  }
  async function run(task: () => Promise<void>, message?: string) {
    setBusy(true); setError(''); setNotice('');
    try { await task(); if (message) setNotice(message); }
    catch (err) { setError(err instanceof Error ? err.message : '작업을 처리하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); setLoading(false); }
  }
  useEffect(() => { void run(load); }, [statusFilter]);
  async function command<K extends CommandName>(name: K, input: CommandMap[K]['input'], message: string, onApplied?: () => void) {
    await run(async () => {
      const result = await applyAndRefresh(() => client.command(name, input, crypto.randomUUID()), async () => {
        await load();
        if (selected) setSelected(await client.query('admin.report', { id: selected.id }));
      }, onApplied);
      if ('refreshError' in result) setError('작업은 반영되었지만 최신 상태를 불러오지 못했습니다. 다시 불러오기로 상태를 확인해 주세요.');
    }, message);
  }
  function selectReport(id: string) { void run(async () => { setSelected(await client.query('admin.report', { id })); setAudit(await client.query('admin.audit', { limit: 20 })); setTab('reports'); }); }
  const pending = reports.items.filter((item) => ['open', 'reviewing'].includes(item.status));

  return <div className="app-shell"><aside className="sidebar"><Brand /><div className="workspace-label"><span className="status-dot" /> OPERATIONS WORKSPACE</div><nav aria-label="운영 메뉴">{tabs.map((item) => <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'reports' && !!overview?.reports && <span className="nav-count">{overview.reports}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><Icon name="shield" /><strong>신뢰할 수 있는<br />연결을 만듭니다.</strong><p>필요한 정보만 확인하고,<br />모든 조치에 이유를 남겨 주세요.</p></div><Link href="/policies/community">운영 정책 <span>↗</span></Link><Link href="/account/delete">계정 삭제 요청 <span>↗</span></Link><div className="operator"><span className="operator-avatar">IL</span><span>{mode === 'demo' ? '운영자' : '인증된 운영자'}<small>{mode === 'demo' ? 'OPERATIONS' : 'MFA VERIFIED'}</small></span><span className="status-dot" /></div></div></aside>
    <div className="main-shell"><header className="topbar"><span>워크스페이스 <span className="crumb">/</span> <strong>{tabs.find((item) => item.id === tab)?.label}</strong></span><div className="topbar-right"><span className="connection-pill" title={mode === 'demo' ? '실제 계정 및 서버에 연결되지 않은 로컬 체험 환경입니다.' : '서버에서 운영 권한과 추가 인증을 확인했습니다.'}><span className="status-dot" />{mode === 'demo' ? 'DEMO · 서버 미연결' : '서버 인증 완료'}</span>{mode === 'demo' && <button className="text-button" aria-label="가상 운영 기록 초기화" title="운영 기록 초기화" disabled={busy} onClick={() => setShowReset(true)}>↺</button>}<span className="top-avatar">IL</span></div></header>
      <main id="main" className="main-content">

      <div className="page-heading"><div><span className="eyebrow">INTER-LINK OPERATIONS</span><h1>{tab === 'overview' ? <>좋은 연결을 <span>지키는 곳.</span></> : tabs.find((item) => item.id === tab)?.label}</h1><p>{tab === 'overview' ? '팀을 향한 첫걸음이 안전하게 이어지도록.' : tab === 'reports' ? '신고된 콘텐츠만 확인하고, 근거 있는 조치를 남겨 주세요.' : tab === 'communities' ? '참여할 공간과 기한이 있는 초대 코드를 관리합니다.' : tab === 'jobs' ? '발송과 삭제 작업의 실패를 확인하고 다시 처리합니다.' : '민감한 조회와 운영 조치의 이유를 확인합니다.'}</p></div><button className="button secondary" disabled={busy} onClick={() => run(load)}><Icon name="refresh" />새로고침</button></div>
      {error && <div className="message error" role="alert">{error}<button className="text-button" disabled={busy} onClick={() => run(load)}>다시 불러오기</button></div>}{notice && <div className="message success" role="status">{notice}</div>}
      {loading ? <div className="loading-panel" role="status"><div className="loading-line" />운영 현황을 불러오고 있어요.</div> : !overview ? <Empty>운영 현황을 확인하지 못했습니다. 다시 불러오기를 눌러 연결을 확인해 주세요.</Empty> : <>
      {tab === 'overview' && <><section className="metric-grid" aria-label={mode === 'demo' ? '가상 운영 통계' : '운영 통계'}>{[
        { label: '검토가 필요한 신고', value: overview?.reports ?? 0, icon: 'flag', meta: '현재 대기 / 검토 중', accent: true },
        { label: '커뮤니티 구성원', value: overview?.users ?? 0, icon: 'people', meta: '참여 구성원' },
        { label: '연결된 프로젝트', value: overview?.projects ?? 0, icon: 'grid', meta: '전체 프로젝트' },
        { label: '실패한 작업', value: overview?.failedJobs ?? 0, icon: 'jobs', meta: '재시도 필요' },
      ].map((item) => <article key={item.label} className={`metric-card ${item.accent ? 'accent' : ''}`}><div className="metric-label">{item.label}<Icon name={item.icon} /></div><strong>{String(item.value).padStart(2, '0')}</strong><small>{item.meta}</small></article>)}</section>
      <div className="overview-grid"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">REVIEW QUEUE</span><h2>지금 확인할 신고 <span className="count-label">{pending.length}</span></h2></div><button className="text-button" onClick={() => setTab('reports')}>전체 보기 <Icon name="arrow" /></button></div><ReportList reports={pending.slice(0, 5)} onSelect={selectReport} disabled={busy} /><div className="panel-footer"><span className="status-dot" /> 신고 대상 이외의 개인 대화는 열람할 수 없습니다.</div></section><section className="principle-card"><div className="orbital" aria-hidden="true"><i /><i /></div><span className="eyebrow">CARE BEFORE ACTION</span><h2>작은 판단에도,<br />명확한 이유를.</h2><p>최소한의 정보로 검토하고<br />처리 메모를 남겨 주세요.<br />더 안전한 팀 경험의 시작입니다.</p><Link className="button light" href="/policies/community">커뮤니티 기준 확인<Icon name="arrow" /></Link></section></div>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ACTIVITY LOG</span><h2>최근 운영 기록</h2></div><button className="text-button" onClick={() => setTab('audit')}>전체 기록 <Icon name="arrow" /></button></div><AuditList entries={audit.items.slice(0, 4)} compact /></section></>}
      {tab === 'reports' && <div className={`reports-layout ${selected ? 'with-detail' : ''}`}><section className="panel"><div className="panel-heading"><h2>신고 목록</h2><label className="inline-label"><span className="sr-only">처리 상태</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} disabled={busy}><option value="">전체 상태</option>{Object.entries(reportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><ReportList reports={reports.items} onSelect={selectReport} selectedId={selected?.id} disabled={busy} />{reports.nextCursor && <button className="button secondary more-button" disabled={busy} onClick={() => run(async () => { const next = await client.query('admin.reports', { status: statusFilter || undefined, cursor: reports.nextCursor!, limit: 20 }); setReports({ items: [...reports.items, ...next.items], nextCursor: next.nextCursor }); })}>신고 더 보기</button>}</section>{selected && <ReportDetail report={selected} busy={busy} onClose={() => setSelected(null)} onAction={(input) => command('admin.action', input, mode === 'demo' ? '가상 신고에 조치가 반영되었습니다. 감사 기록을 확인할 수 있어요.' : '조치가 반영되었습니다.')} />}</div>}
      {tab === 'communities' && <CommunityPanel communities={communities.items} client={client} busy={busy} run={run} reload={load} command={command} onLoadMore={communities.nextCursor ? () => run(async () => { const next = await client.query('admin.communities', { cursor: communities.nextCursor!, limit: 20 }); setCommunities({ items: [...communities.items, ...next.items], nextCursor: next.nextCursor }); }) : undefined} />}
      {tab === 'jobs' && <JobPanel jobs={jobs.items} busy={busy} onRetry={(id, note) => command('admin.job.retry', { id, note }, mode === 'demo' ? '가상 작업이 재시도 대기 상태로 변경되었습니다. 실제 발송·삭제는 수행되지 않습니다.' : '재시도 대기열에 등록했습니다. 완료 여부는 작업 상태를 확인해 주세요.')} onLoadMore={jobs.nextCursor ? () => run(async () => { const next = await client.query('admin.jobs', { cursor: jobs.nextCursor!, limit: 20 }); setJobs({ items: [...jobs.items, ...next.items], nextCursor: next.nextCursor }); }) : undefined} />}
      {tab === 'audit' && <section className="panel"><div className="panel-heading"><h2>운영 감사 기록</h2><span className="muted">한국시간 · 최신순</span></div><AuditList entries={audit.items} />{audit.nextCursor && <button className="button secondary more-button" disabled={busy} onClick={() => run(async () => { const next = await client.query('admin.audit', { cursor: audit.nextCursor!, limit: 20 }); setAudit({ items: [...audit.items, ...next.items], nextCursor: next.nextCursor }); })}>기록 더 보기</button>}</section>}
      </>}
      <footer className="workspace-footer"><span>INTER-LINK <span className="footer-dot">·</span> 더 나은 팀의 시작</span><span>{updatedAt ? `마지막 조회 ${date(updatedAt)} KST` : '연결 준비 버전'}</span></footer>
      </main></div>
      {showReset && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="reset-title" className="confirm-dialog"><h2 id="reset-title">가상 운영 기록을 초기화할까요?</h2><p>이 환경은 실제 계정 및 서버에 연결되지 않습니다. 기록은 이 탭에만 유지되며 앱과 공유되지 않습니다. 초기화하면 신고 처리·커뮤니티·작업 상태가 처음의 가상 데이터로 돌아갑니다.</p><div className="button-row"><button className="button secondary" autoFocus onClick={() => setShowReset(false)}>취소</button><button className="button primary" disabled={busy} onClick={() => run(async () => { await (client as ReturnType<typeof createDemoClient>).reset(); setSelected(null); await load(); setShowReset(false); }, '데모가 초기화되었습니다.')}>초기화</button></div></section></div>}
    </div>;
}

function Empty({ children }: { children: React.ReactNode }) { return <div className="empty-state"><Icon name="shield" /><p>{children}</p></div>; }
function ReportList({ reports, onSelect, disabled, selectedId }: { reports: Report[]; onSelect: (id: string) => void; disabled: boolean; selectedId?: string }) {
  if (!reports.length) return <Empty>이 조건에 해당하는 신고가 없습니다.</Empty>;
  return <div className="report-list">{reports.map((report) => <button key={report.id} disabled={disabled} className={`report-row ${selectedId === report.id ? 'selected' : ''}`} onClick={() => onSelect(report.id)}><span className={`report-icon ${report.targetType}`}><Icon name={report.targetType === 'profile' ? 'people' : report.targetType === 'project' ? 'grid' : 'flag'} /></span><span className="report-info"><span className="report-title">{report.reason}</span><span className="report-meta">{targetLabels[report.targetType]}<span>·</span>#{shortId(report.id)}<span>·</span>{date(report.createdAt)}</span></span><span className={`badge ${report.status}`}>{reportLabels[report.status]}</span><span className="row-chevron">↗</span></button>)}</div>;
}

function ReportDetail({ report, busy, onAction, onClose }: { report: Report; busy: boolean; onAction: (input: CommandMap['admin.action']['input']) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [action, setAction] = useState<CommandMap['admin.action']['input']['action']>('resolve');
  useEffect(() => { setNote(''); setAction('resolve'); }, [report.id]);
  const available: CommandMap['admin.action']['input']['action'][] = report.targetType === 'profile' ? ['hide', 'restore', 'suspend', 'reactivate', 'resolve', 'dismiss'] : ['hide', 'restore', 'resolve', 'dismiss'];
  return <section className="panel report-detail" aria-label="신고 상세"><div className="panel-heading"><span className="eyebrow">CASE #{shortId(report.id)}</span><button aria-label="신고 상세 닫기" className="close-button" onClick={onClose}>×</button></div><div className="detail-body"><span className={`badge ${report.status}`}>{reportLabels[report.status]}</span><h2>{report.reason}</h2><dl className="detail-meta"><div><dt>신고 대상</dt><dd>{targetLabels[report.targetType]}</dd></div><div><dt>접수 시각</dt><dd>{date(report.createdAt)} KST</dd></div><div><dt>대상 식별자</dt><dd><code>{shortId(report.targetId)}</code></dd></div></dl><h3>신고 사유</h3><p className="evidence">{report.detail || '추가 설명이 없습니다.'}</p><h3>신고 대상 콘텐츠</h3><blockquote className="evidence content-evidence">{report.content || '조회할 수 있는 대상 콘텐츠가 없습니다. 이미 삭제되었거나 접근이 제한된 상태일 수 있습니다.'}</blockquote><p className="fine-print">신고된 항목에 한해 조회합니다. 이 상세 조회는 감사 기록에 남습니다.</p><form onSubmit={(event) => { event.preventDefault(); const resolving = action === 'resolve' || action === 'dismiss'; void onAction({ reportId: report.id, targetType: resolving ? 'report' : report.targetType, targetId: resolving ? report.id : report.targetId, action, note: note.trim() }); }}><label>운영 조치<select value={action} onChange={(event) => setAction(event.target.value as typeof action)}>{available.map((value) => <option key={value} value={value}>{actionLabels[value]}</option>)}</select></label><label>처리 메모 <span className="required">필수</span><textarea required minLength={5} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="확인한 근거와 조치 이유를 5자 이상 남겨 주세요." rows={4} /></label><p className="fine-print">콘텐츠 조치와 신고 종료는 별개의 작업입니다. 확인 후 처리 완료 또는 기각으로 마무리해 주세요.</p><button className={`button full ${action === 'suspend' ? 'danger' : 'primary'}`} disabled={busy || note.trim().length < 5}>{busy ? '처리 중…' : `${actionLabels[action]} 적용`}<Icon name="arrow" /></button></form></div></section>;
}

function AuditList({ entries, compact = false }: { entries: AuditEntry[]; compact?: boolean }) {
  if (!entries.length) return <Empty>아직 남겨진 운영 기록이 없습니다.</Empty>;
  return <div className="table-scroll"><table><thead><tr><th>작업</th><th>처리 메모</th><th>대상</th>{!compact && <th>운영자</th>}<th>시각 (KST)</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><span className="audit-action"><span className="status-dot" />{entry.action}</span></td><td className="audit-note">{entry.note || '—'}</td><td><code>{shortId(entry.targetId)}</code></td>{!compact && <td><code>{shortId(entry.actorId)}</code></td>}<td className="nowrap muted">{date(entry.createdAt)}</td></tr>)}</tbody></table></div>;
}

function CommunityPanel({ communities, client, busy, run, reload, command, onLoadMore }: { communities: Community[]; client: Client; busy: boolean; run: (task: () => Promise<void>, message?: string) => Promise<void>; reload: () => Promise<void>; command: <K extends CommandName>(name: K, input: CommandMap[K]['input'], message: string, onApplied?: () => void) => Promise<void>; onLoadMore?: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Community | null>(null);
  const [status, setStatus] = useState<'active' | 'closed'>('active');
  const [communityId, setCommunityId] = useState('');
  const [uses, setUses] = useState(10);
  const [days, setDays] = useState(7);
  const [invite, setInvite] = useState('');
  const [inviteIntent] = useState(createInviteIntent);
  return <div className="two-column"><section className="panel"><div className="panel-heading"><h2>커뮤니티</h2><span className="count-label">{communities.length}</span></div>{!communities.length ? <Empty>첫 커뮤니티를 만들어 주세요.</Empty> : <div className="community-list">{communities.map((community) => <button key={community.id} className="community-row" onClick={() => { setEditing(community); setName(community.name); setStatus(community.status); }}><span className="community-avatar"><Icon name="people" /></span><span><strong>{community.name}</strong><small>구성원 {community.memberCount}명</small></span><span className={`badge ${community.status === 'active' ? 'resolved' : 'dismissed'}`}>{community.status === 'active' ? '운영 중' : '종료'}</span><span>↗</span></button>)}</div>}{onLoadMore && <button className="button secondary more-button" disabled={busy} onClick={onLoadMore}>커뮤니티 더 보기</button>}<div className="detail-body"><h3>{editing ? '커뮤니티 수정' : '새 커뮤니티'}</h3><form onSubmit={(event) => { event.preventDefault(); void command('admin.community', { ...(editing ? { id: editing.id } : {}), name: name.trim(), status }, '커뮤니티 설정을 저장했습니다.', () => { if (!editing) setName((current) => current === name ? '' : current); }); }}><label>커뮤니티 이름<input value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={80} placeholder="예: 새로운 연결 프로젝트" /></label><label>운영 상태<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">운영 중</option><option value="closed">종료</option></select></label><div className="button-row"><button className="button primary" disabled={busy || !name.trim()}>{editing ? '변경 저장' : '커뮤니티 만들기'}</button>{editing && <button type="button" className="button secondary" onClick={() => { setEditing(null); setName(''); setStatus('active'); }}>새로 만들기</button>}</div></form></div></section><section className="panel fit-panel"><div className="panel-heading"><div><span className="eyebrow">INVITE ONLY</span><h2>커뮤니티 초대</h2></div><Icon name="shield" /></div><div className="detail-body"><p className="muted">참여 범위를 제한할 수 있는 초대 코드를 만듭니다. 만료 시각과 사용 횟수가 서버에서 검증됩니다.</p><form onSubmit={(event) => { event.preventDefault(); void run(async () => { const intent = inviteIntent.prepare(communityId, uses, days); const result = await applyAndRefresh(() => client.command('admin.invite', intent.input, intent.key), reload, (created) => { setInvite(created.id); inviteIntent.complete(); }); if ('refreshError' in result) throw new Error('초대 코드는 생성되었습니다. 아래 코드를 보관하고 새로고침으로 목록을 다시 확인해 주세요.'); }, client.mode === 'demo' ? '가상 초대 코드가 생성되었습니다. 외부 계정에는 사용할 수 없습니다.' : '초대 코드가 생성되었습니다. 안전한 경로로 전달해 주세요.'); }}><label>커뮤니티<select value={communityId} onChange={(event) => { setCommunityId(event.target.value); setInvite(''); }} required><option value="">운영 중인 커뮤니티 선택</option>{communities.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="form-grid"><label>최대 사용 횟수<input type="number" min={1} max={100} value={uses} onChange={(event) => setUses(Number(event.target.value))} required /></label><label>유효 기간 (일)<input type="number" min={1} max={30} value={days} onChange={(event) => setDays(Number(event.target.value))} required /></label></div><button className="button primary full" disabled={busy || !communityId}>초대 코드 생성<Icon name="arrow" /></button></form>{invite && <div className="invite-result"><span className="eyebrow">생성된 초대 코드</span><code>{invite}</code><button className="button secondary full" onClick={() => run(async () => { await navigator.clipboard.writeText(invite); }, '초대 코드를 복사했습니다.')}>코드 복사</button><p className="fine-print">이 코드는 이 화면에서만 확인할 수 있습니다. 새로고침 전에 안전하게 보관해 주세요.</p></div>}</div></section></div>;
}

function JobPanel({ jobs, busy, onRetry, onLoadMore }: { jobs: Job[]; busy: boolean; onRetry: (id: string, note: string) => Promise<void>; onLoadMore?: () => Promise<void> }) {
  const [retryId, setRetryId] = useState('');
  const [note, setNote] = useState('');
  const statusLabel: Record<string, string> = { failed: '실패', pending: '대기', queued: '대기', retry: '재시도 대기', processing: '처리 중', completed: '완료', succeeded: '완료', done: '완료', cancelled: '취소' };
  return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">DURABLE JOBS</span><h2>발송 · 삭제 작업</h2></div><span className="muted">최신 상태는 새로고침으로 확인</span></div>{!jobs.length ? <Empty>아직 등록된 작업이 없습니다.</Empty> : <div className="table-scroll"><table><thead><tr><th>작업 종류 / 식별자</th><th>상태</th><th>시도 횟수</th><th>다음 시도 (KST)</th><th>오류 코드</th><th>조치</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.kind}</strong><small className="cell-subtitle">#{shortId(job.id)}</small></td><td><span className={`badge ${job.status === 'failed' ? 'failed' : job.status === 'completed' ? 'resolved' : 'reviewing'}`}>{statusLabel[job.status] ?? job.status}</span></td><td>{job.attempts}</td><td className="nowrap muted">{date(job.nextAttemptAt)}</td><td><code>{job.lastError || '—'}</code></td><td>{job.status === 'failed' ? <button className="button secondary small" disabled={busy} onClick={() => { setRetryId(job.id); setNote(''); }}>재시도</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div>}{onLoadMore && <button className="button secondary more-button" disabled={busy} onClick={onLoadMore}>작업 더 보기</button>}{retryId && <div className="detail-body retry-form"><h3>작업 재시도 · #{shortId(retryId)}</h3><form onSubmit={(event) => { event.preventDefault(); void onRetry(retryId, note.trim()); }}><label>재시도 사유<textarea required minLength={5} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="원인을 확인한 내용과 재시도 이유를 남겨 주세요." /></label><div className="button-row"><button className="button primary" disabled={busy || note.trim().length < 5}>재시도 대기열에 등록</button><button type="button" className="button secondary" onClick={() => setRetryId('')}>닫기</button></div></form></div>}<div className="panel-footer">재시도 요청은 완료를 뜻하지 않습니다. 실제 작업 처리기와 스케줄 연결이 필요합니다.</div></section>;
}
