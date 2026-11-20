'use client';

import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Table, pixel, proportional} from '@astryxdesign/core/Table';
import {List, ListItem} from '@astryxdesign/core/List';
import {Link} from '@astryxdesign/core/Link';
import {StackItem} from '@astryxdesign/core/Stack';
import {api} from '@/lib/client/api';
import {POST_STATUS_BADGE} from '@/lib/client/labels';
import type {PostSummary} from '@/lib/client/types';
import {ErrorBanner, Loading, Page, PageTitle, useData} from '@/components/common';

function Stat({label, value, note, badge}: {label: string; value: string; note: string; badge?: React.ReactNode}) {
  return (
    <Card>
      <VStack gap={1}>
        <Text type="supporting">{label}</Text>
        <Heading level={2}>{value}</Heading>
        <HStack gap={2} vAlign="center">
          {badge}
          <Text type="supporting">{note}</Text>
        </HStack>
      </VStack>
    </Card>
  );
}

const postHref = (p: PostSummary) => (p.status === 'draft' ? `/posts/${p.id}/review` : `/posts/${p.id}/done`);

export default function HomePage() {
  const {data, error} = useData(() => api.getDashboard());

  return (
    <Page>
      <PageTitle
        title="안녕하세요, 홍보 담당자님"
        description="주 1~2회 꾸준히 올리는 것이 하루에 몰아 올리는 것보다 노출에 유리합니다."
        actions={<Button variant="primary" label="새 글 쓰기" href="/posts/new" />}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {!data ? (
        <Loading />
      ) : (
        <>
          <Grid columns={4} gap={4}>
            <Stat label="이번 달 발행" value={`${data.monthPublished}건`} note={`지난달 ${data.lastMonthPublished}건`} />
            <Stat
              label="평균 작성 시간"
              value={data.avgWriteMinutes == null ? '—' : `${data.avgWriteMinutes}분`}
              note={`기존 실측 ${data.baselineWriteMinutes}분`}
              badge={data.avgWriteMinutes != null && data.avgWriteMinutes <= 15 ? <Badge variant="success" label="목표 달성" /> : undefined}
            />
            <Stat label="확인 필요로 잡은 문장" value={`${data.caughtSentences}개`} note="승인 전에 모두 수정" />
            <Stat
              label="마지막 게시"
              value={data.daysSinceLastPost == null ? '—' : `${data.daysSinceLastPost}일 전`}
              note="주 1~2회 권장"
              badge={data.daysSinceLastPost != null && data.daysSinceLastPost >= 7 ? <Badge variant="warning" label="발행 필요" /> : undefined}
            />
          </Grid>

          <HStack gap={6} vAlign="start">
            <StackItem size="fill">
              <VStack gap={3}>
                <Heading level={3}>최근 글</Heading>
                <Card padding={0}>
                  <Table<PostSummary>
                    data={data.recentPosts}
                    idKey="id"
                    hasHover
                    columns={[
                      {key: 'title', header: '제목', width: proportional(4), renderCell: (p) => <Link href={postHref(p)}>{p.title}</Link>},
                      {key: 'status', header: '상태', width: pixel(110), renderCell: (p) => <Badge {...POST_STATUS_BADGE[p.status]} />},
                      {
                        key: 'unresolvedCount',
                        header: '확인 필요',
                        width: pixel(100),
                        renderCell: (p) => (p.unresolvedCount ? <Badge variant="error" label={`${p.unresolvedCount}건`} /> : <Text color="secondary">0</Text>),
                      },
                      {key: 'views', header: '조회수', width: pixel(90), align: 'end', renderCell: (p) => <Text hasTabularNumbers>{p.views ?? '—'}</Text>},
                      {key: 'updatedAt', header: '수정일', width: pixel(110)},
                    ]}
                  />
                </Card>
              </VStack>
            </StackItem>

            <VStack gap={4} width={380}>
              <Card>
                <VStack gap={3}>
                  <Heading level={3}>지식 베이스</Heading>
                  <List>
                    <ListItem
                      label={`자료 ${data.knowledgeBase.materials}종 · ${data.knowledgeBase.totalPages}쪽`}
                      description={`지식 베이스 색인 ${data.knowledgeBase.indexedPages}쪽`}
                    />
                    <ListItem label={`차별점 카드 ${data.knowledgeBase.cards}장`} />
                    {data.knowledgeBase.quarantined ? (
                      <ListItem startContent={<Badge variant="error" label="격리" />} label={`숨은 지시 ${data.knowledgeBase.quarantined}건`} />
                    ) : null}
                    {data.knowledgeBase.guidelineGaps.map((g) => (
                      <ListItem key={g} startContent={<Badge variant="warning" label="근거 없음" />} label={g} />
                    ))}
                  </List>
                  <Button label="자료·카드 관리" href="/materials" />
                </VStack>
              </Card>
              <Card>
                <VStack gap={3}>
                  <Heading level={3}>최근 반영된 규칙</Heading>
                  <List>
                    {data.recentRules.map((r) => (
                      <ListItem key={r.id} label={r.title} description={<Text type="supporting">{r.description}</Text>} />
                    ))}
                  </List>
                </VStack>
              </Card>
            </VStack>
          </HStack>
        </>
      )}
    </Page>
  );
}
