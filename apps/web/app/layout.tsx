import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '인터링크 · 운영 스튜디오',
  description: '인터링크 운영 도구와 정책 초안. 외부 연결 준비 버전.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><a className="skip-link" href="#main">본문으로 이동</a>{children}</body></html>;
}
