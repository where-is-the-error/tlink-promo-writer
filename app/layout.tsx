import type {Metadata} from 'next';
import './globals.css';
import {Providers} from './providers';
import {AppFrame} from '@/components/AppFrame';

export const metadata: Metadata = {
  title: 'T-LINK 홍보글 메이커',
  description: '사진과 메모로 근거 쪽수가 붙은 블로그 후기형 홍보글을 씁니다.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="ko">
      <body>
        <Providers>
          <AppFrame>{children}</AppFrame>
        </Providers>
      </body>
    </html>
  );
}
