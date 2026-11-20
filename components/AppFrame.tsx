'use client';

import {usePathname} from 'next/navigation';
import {AppShell} from '@astryxdesign/core/AppShell';
import {TopNav, TopNavHeading, TopNavItem} from '@astryxdesign/core/TopNav';
import {Badge} from '@astryxdesign/core/Badge';
import {isMock} from '@/lib/client/api';

const NAV = [
  {href: '/', label: '홈', match: (p: string) => p === '/'},
  {href: '/materials', label: '자료·카드', match: (p: string) => p.startsWith('/materials')},
  {href: '/posts/new', label: '새 글 쓰기', match: (p: string) => p.startsWith('/posts')},
  {href: '/learning', label: '반응·학습', match: (p: string) => p.startsWith('/learning')},
  {href: '/trust', label: '신뢰도', match: (p: string) => p.startsWith('/trust')},
];

export function AppFrame({children}: {children: React.ReactNode}) {
  const pathname = usePathname() ?? '/';
  return (
    <AppShell
      variant="wash"
      contentPadding={0}
      topNav={
        <TopNav
          heading={<TopNavHeading heading="T-LINK 홍보글 메이커" headingHref="/" />}
          endContent={isMock ? <Badge variant="warning" label="시연 데이터" /> : null}>
          {NAV.map((n) => (
            <TopNavItem key={n.href} href={n.href} label={n.label} isSelected={n.match(pathname)} />
          ))}
        </TopNav>
      }>
      {children}
    </AppShell>
  );
}
