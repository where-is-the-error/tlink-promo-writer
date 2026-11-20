'use client';

import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Switch} from '@astryxdesign/core/Switch';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Table, pixel, proportional} from '@astryxdesign/core/Table';
import {List, ListItem} from '@astryxdesign/core/List';
import {StackItem} from '@astryxdesign/core/Stack';
import {api} from '@/lib/api';
import type {ReactionRow} from '@/lib/types';
import {ErrorBanner, Loading, Page, PageTitle, useData} from '@/components/common';

type Draft = Record<string, {views: number; likes: number; comments: number; inquiries: number}>;
const FIELDS = [
  ['views', '조회수'],
  ['likes', '공감'],
  ['comments', '댓글'],
  ['inquiries', '문의 전화'],
] as const;

export default function LearningPage() {
  const {data, setData, error} = useData(() => api.getLearning());
  const [draft, setDraft] = useState<Draft>({});

  const valueOf = (r: ReactionRow, k: (typeof FIELDS)[number][0]) => draft[r.postId]?.[k] ?? r[k] ?? 0;
  const setField = (r: ReactionRow, k: (typeof FIELDS)[number][0], v: number) =>
    setDraft((d) => {
      const base = d[r.postId] ?? {views: r.views ?? 0, likes: r.likes ?? 0, comments: r.comments ?? 0, inquiries: r.inquiries ?? 0};
      return {...d, [r.postId]: {...base, [k]: v}};
    });

  return (
    <Page>
      <PageTitle title="쓸수록 맞춰지는 글" description="게시 반응과 담당자 수정 내역을 모아 다음 글에 반영합니다." />
      {error ? <ErrorBanner message={error} /> : null}
      {!data ? (
        <Loading />
      ) : (
        <HStack gap={6} vAlign="start">
          <StackItem size="fill">
            <VStack gap={3}>
              <Heading level={3}>게시 반응 입력</Heading>
              <Card padding={0}>
                <Table<ReactionRow>
                  data={data.rows}
                  idKey="postId"
                  verticalAlign="middle"
                  columns={[
                    {key: 'title', header: '게시한 글', width: proportional(3)},
                    {key: 'publishedAt', header: '게시일', width: pixel(110), renderCell: (r) => <Text>{r.publishedAt ?? '—'}</Text>},
                    ...FIELDS.map(([k, label]) => ({
                      key: k,
                      header: label,
                      width: pixel(110),
                      renderCell: (r: ReactionRow) => (
                        <NumberInput label={label} isLabelHidden size="sm" value={valueOf(r, k)} onChange={(v: number | null) => setField(r, k, v ?? 0)} />
                      ),
                    })),
                    {key: 'leadCardCode', header: '앞세운 카드', width: pixel(110), renderCell: (r) => <Text>{r.leadCardCode ?? '—'}</Text>},
                  ]}
                />
              </Card>
              <HStack hAlign="end">
                <Button
                  label={`입력한 반응 저장 (${Object.keys(draft).length}건)`}
                  isDisabled={!Object.keys(draft).length}
                  clickAction={async () => {
                    for (const [postId, r] of Object.entries(draft)) await api.saveReactions(postId, r);
                    setDraft({});
                    setData(await api.getLearning());
                  }}
                />
              </HStack>
            </VStack>
          </StackItem>

          <VStack gap={4} width={420}>
            <Card>
              <VStack gap={3}>
                <Heading level={3}>다음 글에 반영될 것</Heading>
                <List>
                  {data.rules.map((r) => (
                    <ListItem
                      key={r.id}
                      align="start"
                      label={
                        <HStack gap={2} vAlign="center">
                          <Badge variant="info" label={r.title} />
                          {r.strength === 'weak' ? <Badge variant="warning" label="약한 근거" /> : null}
                        </HStack>
                      }
                      description={<Text>{r.description}</Text>}
                      endContent={
                        <Switch
                          label={r.active ? '켜짐' : '꺼짐'}
                          value={r.active}
                          onChange={async (next: boolean) => setData(await api.toggleRule(r.id, next))}
                        />
                      }
                    />
                  ))}
                </List>
                <Text type="supporting">반응이 입력된 글이 5건 미만이면 카드 순서 규칙은 “약한 근거”로 표시합니다.</Text>
                <Button variant="primary" label="반영하기" clickAction={async () => setData(await api.recomputeLearning())} />
              </VStack>
            </Card>
          </VStack>
        </HStack>
      )}
    </Page>
  );
}
