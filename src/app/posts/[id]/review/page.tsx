'use client';

import {use, useEffect, useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Divider} from '@astryxdesign/core/Divider';
import {TextArea} from '@astryxdesign/core/TextArea';
import {SelectableCard} from '@astryxdesign/core/SelectableCard';
import {List, ListItem} from '@astryxdesign/core/List';
import {StackItem} from '@astryxdesign/core/Stack';
import {api, ApiError} from '@/lib/api';
import {CHECK_BADGE, SECTION_TITLE, VERDICT_BADGE, isUnresolved} from '@/lib/labels';
import type {PostDetail, Sentence} from '@/lib/types';
import {ErrorBanner, Loading, Page, PhotoBox, PostSteps, useData} from '@/components/common';

function sourceLabel(s: Sentence, d: PostDetail) {
  if (s.sourceType === 'memo') return '현장 메모';
  if (s.sourceType === 'photo') return `사진 · ${d.photos.find((p) => p.id === s.sourceRef)?.fileName ?? ''}`;
  const card = d.cards.find((c) => c.code === s.sourceRef);
  const cite = card?.citations[0];
  return `카드 ${s.sourceRef}${cite ? ` · ${cite.materialName} ${cite.pageNo}쪽` : ''}`;
}

function EvidencePanel({
  sentence,
  detail,
  onChange,
}: {
  sentence: Sentence;
  detail: PostDetail;
  onChange: (change: {text: string} | {deleted: true} | {acceptSuggestion: true}) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sentence.text);
  useEffect(() => {
    setEditing(false);
    setDraft(sentence.text);
  }, [sentence.id, sentence.text]);
  const vb = VERDICT_BADGE[sentence.verdict];
  const bad = isUnresolved(sentence.verdict);

  return (
    <Card variant={bad ? 'red' : 'default'}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Heading level={3}>원문 대조 결과</Heading>
          <Badge variant={vb.variant} label={vb.label} />
        </HStack>
        <Text weight="medium">“{sentence.text}”</Text>
        <VStack gap={1}>
          <Text type="supporting">출처 꼬리표</Text>
          <Text>{sourceLabel(sentence, detail)}</Text>
        </VStack>
        {sentence.verdictReason ? (
          <VStack gap={1}>
            <Text type="supporting">판정</Text>
            <Text>{sentence.verdictReason}</Text>
          </VStack>
        ) : null}
        {sentence.evidence.length ? (
          <VStack gap={1}>
            <Text type="supporting">{bad ? '가장 가까운 근거' : '근거 원문'}</Text>
            <List>
              {sentence.evidence.map((e, i) => (
                <ListItem
                  key={i}
                  label={<Text color="accent">{e.pageNo ? `${e.materialName} ${e.pageNo}쪽` : e.materialName}</Text>}
                  description={<Text type="supporting">“{e.quote}”</Text>}
                />
              ))}
            </List>
          </VStack>
        ) : null}
        {sentence.suggestion ? (
          <Banner status="info" title="근거 범위 안으로 고친 문장" description={sentence.suggestion} />
        ) : null}
        {editing ? (
          <VStack gap={2}>
            <TextArea label="문장 직접 고치기" value={draft} onChange={setDraft} rows={3} />
            <HStack gap={2}>
              <Button
                variant="primary"
                label="저장하고 다시 검증"
                isDisabled={!draft.trim() || draft === sentence.text}
                clickAction={async () => {
                  await onChange({text: draft.trim()});
                  setEditing(false);
                }}
              />
              <Button variant="ghost" label="취소" onClick={() => setEditing(false)} />
            </HStack>
          </VStack>
        ) : (
          <HStack gap={2} wrap="wrap">
            {sentence.suggestion ? (
              <Button variant="primary" label="제안 문장으로 바꾸기" clickAction={() => onChange({acceptSuggestion: true})} />
            ) : null}
            <Button label="직접 고치기" onClick={() => setEditing(true)} />
            <Button variant="destructive" label="문장 지우기" clickAction={() => onChange({deleted: true})} />
          </HStack>
        )}
      </VStack>
    </Card>
  );
}

export default function ReviewPage({params}: {params: Promise<{id: string}>}) {
  const {id} = use(params);
  const router = useRouter();
  const {data, setData, error, setError} = useData(() => api.getPost(id), [id]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const unresolved = useMemo(() => data?.sentences.filter((s) => isUnresolved(s.verdict)) ?? [], [data]);
  const codeFail = data?.checklist.some((c) => c.checkedBy === 'code' && c.status === 'fail') ?? false;
  const canApprove = !!data && unresolved.length === 0 && !codeFail && data.sentences.length > 0;

  // 처음 열면 첫 번째 확인 필요 문장을 보여 줌
  useEffect(() => {
    if (data && !selectedId) setSelectedId(unresolved[0]?.id ?? data.sentences[0]?.id ?? null);
  }, [data, selectedId, unresolved]);

  const selected = data?.sentences.find((s) => s.id === selectedId) ?? null;

  return (
    <Page>
      <PostSteps active={2} />
      {error ? <ErrorBanner message={error} /> : null}
      {!data ? (
        <Loading label="초안을 불러오는 중" />
      ) : (
        <>
          {data.post.injectionNotes.length ? (
            <Banner
              status="warning"
              title="입력 데이터에서 지시문을 발견했습니다"
              description={`AI는 이 지시를 따르지 않았습니다: ${data.post.injectionNotes.join(' / ')}`}
            />
          ) : null}
          <HStack gap={6} vAlign="start">
            <StackItem size="fill">
              <Card>
                <VStack gap={5}>
                  <VStack gap={1}>
                    <Text type="supporting">제목</Text>
                    <Heading level={2}>{data.post.title ?? '(제목 없음)'}</Heading>
                  </VStack>
                  <HStack gap={2} wrap="wrap">
                    {data.photos.map((ph, i) => (
                      <VStack key={ph.id} gap={1} width={150}>
                        <PhotoBox url={ph.url} name={`${i + 1}. ${ph.fileName}`} height={90} />
                      </VStack>
                    ))}
                  </HStack>
                  {[1, 2, 3, 4, 5].map((n) => {
                    const list = data.sentences.filter((s) => s.sectionNo === n);
                    if (!list.length) return null;
                    return (
                      <VStack key={n} gap={2}>
                        <Heading level={4}>{SECTION_TITLE[n]}</Heading>
                        {list.map((s) => {
                          const vb = VERDICT_BADGE[s.verdict];
                          return (
                            <SelectableCard
                              key={s.id}
                              label={s.text}
                              isSelected={s.id === selectedId}
                              onChange={() => setSelectedId(s.id)}
                              variant={isUnresolved(s.verdict) ? 'red' : 'default'}
                              padding={3}>
                              <VStack gap={2}>
                                <Text>{s.text}</Text>
                                <HStack gap={2} vAlign="center">
                                  <Badge variant={vb.variant} label={vb.label} />
                                  <Text type="supporting">{sourceLabel(s, data)}</Text>
                                </HStack>
                              </VStack>
                            </SelectableCard>
                          );
                        })}
                      </VStack>
                    );
                  })}
                  <Divider />
                  <VStack gap={1}>
                    {data.post.footerLines.map((l) => (
                      <Text key={l} type="supporting">
                        {l}
                      </Text>
                    ))}
                    <HStack gap={2}>
                      <Badge variant="info" label="하단 필수 정보 자동 삽입" />
                    </HStack>
                  </VStack>
                </VStack>
              </Card>
            </StackItem>

            <VStack gap={4} width={420}>
              {selected ? (
                <EvidencePanel
                  sentence={selected}
                  detail={data}
                  onChange={async (change) => {
                    try {
                      const next = await api.updateSentence(id, selected.id, change);
                      setData(next);
                      if ('deleted' in change) setSelectedId(next.sentences.find((s) => isUnresolved(s.verdict))?.id ?? null);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
              ) : null}
              <Card>
                <VStack gap={3}>
                  <Heading level={3}>점검표</Heading>
                  <List>
                    {data.checklist.map((c) => {
                      const b = CHECK_BADGE[c.status];
                      return (
                        <ListItem
                          key={c.itemKey}
                          startContent={<Badge variant={b.variant} label={b.label} />}
                          label={<Text>{c.label}</Text>}
                          endContent={<Text type="supporting">{c.checkedBy === 'code' ? '코드' : 'AI'}</Text>}
                        />
                      );
                    })}
                  </List>
                </VStack>
              </Card>
            </VStack>
          </HStack>

          <Card elevation="med">
            <HStack gap={3} vAlign="center">
              <StackItem size="fill">
                <HStack gap={2} vAlign="center">
                  {unresolved.length ? (
                    <Badge variant="error" label={`확인 필요 ${unresolved.length}건 남음`} />
                  ) : (
                    <Badge variant="success" label="확인 필요 0건" />
                  )}
                  <Text type="supporting">모두 고치거나 지워야 승인할 수 있습니다. 근거 표시는 복사되지 않습니다.</Text>
                </HStack>
              </StackItem>
              <Button
                label="다시 쓰기"
                clickAction={async () => {
                  await api.writePost(id, true);
                  setData(await api.verifyPost(id));
                  setSelectedId(null);
                }}
              />
              <Button
                variant="primary"
                label="승인하기"
                isDisabled={!canApprove}
                tooltip={!canApprove ? '확인 필요 문장과 점검표 실패 항목을 먼저 해결해 주세요' : undefined}
                clickAction={async () => {
                  try {
                    await api.approvePost(id);
                    router.push(`/posts/${id}/done`);
                  } catch (e) {
                    setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            </HStack>
          </Card>
        </>
      )}
    </Page>
  );
}
