import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Brand } from '../../../components/brand';
import { policies, type PolicyKey } from '../../../content/policies';

export function generateStaticParams() { return Object.keys(policies).map((slug) => ({ slug })); }
export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(slug in policies)) notFound();
  const policy = policies[slug as PolicyKey];
  return <div className="document-page"><header className="document-header"><Brand /><Link className="button secondary small" href="/">운영 홈 ↗</Link></header><main id="main"><div className="mode-banner"><span><strong>DRAFT</strong>공개 출시 전 검토용 초안 · 확정된 운영 정책이 아닙니다.</span></div><div className="document-title"><span className="eyebrow">{policy.eyebrow}</span><h1>{policy.title}</h1><p>{policy.summary}</p></div><nav className="policy-nav" aria-label="정책 문서">{Object.entries(policies).map(([key, item]) => <Link key={key} href={`/policies/${key}`} aria-current={slug === key ? 'page' : undefined}>{item.title}</Link>)}<Link href="/account/delete">계정 삭제 요청</Link></nav><article className="policy-content">{policy.sections.map(([title, body], index) => <section key={title}><span className="policy-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{title}</h2><p>{body}</p></div></section>)}</article><aside className="policy-editor-note"><strong>운영자 편집 안내</strong><p>이 초안은 <code>apps/web/content/policies.ts</code>에서 수정합니다. [미확정] 표시를 실제 운영 정보로 대체하고 법률·운영 검토 후 배포하세요. 설정 검사에서 미확정 상태를 별도로 확인해야 합니다.</p></aside></main><footer className="workspace-footer">INTER-LINK · 아이디어를 함께 완성할 팀원을 만나보세요.</footer></div>;
}
