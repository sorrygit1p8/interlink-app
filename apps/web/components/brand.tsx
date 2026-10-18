import Link from 'next/link';

export function Brand({ small = false }: { small?: boolean }) {
  return <Link className={`brand ${small ? 'brand-small' : ''}`} href="/" aria-label="인터링크 운영 홈"><svg className="brand-mark" viewBox="0 0 56 36" fill="none" aria-hidden="true"><g stroke="#B7FF32" strokeWidth="3.2"><rect x="3" y="8" width="29" height="20" rx="10" transform="rotate(-37 17.5 18)"/><rect x="24" y="8" width="29" height="20" rx="10" transform="rotate(-37 38.5 18)"/></g><path d="M29.481 9.846 A10 10 0 0 1 30.997 13.900 M25.003 22.100 A10 10 0 0 0 26.519 26.154" stroke="#070807" strokeWidth="6.4"/><path d="M28.754 8.864 A10 10 0 0 1 31.094 15.292 M24.906 20.708 A10 10 0 0 0 27.246 27.136" stroke="#B7FF32" strokeWidth="3.2"/></svg><span>인터링크<small>운영 콘솔</small></span></Link>;
}

export function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    flag: <><path d="M5 21V4m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m3 9v-2a6 6 0 0 0-2-4" /></>,
    jobs: <><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" /></>,
    audit: <><path d="M8 4H5v17h14V4h-3M8 12h8m-8 4h6" /><rect x="8" y="2" width="8" height="5" rx="2" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    shield: <><path d="m12 2 8 4v7c0 5-8 9-8 9s-8-4-8-9V6l8-4Z" /><path d="m8 12 3 3 5-6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1" /></>,
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.grid}</svg>;
}
