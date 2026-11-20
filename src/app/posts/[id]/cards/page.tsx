'use client';

import {use, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack} from '@astryxdesign/core/HStack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Switch} from '@astryxdesign/core/Switch';
import {api} from '@/lib/api';
import {KIND_LABEL, SCREEN_LABEL} from '@/lib/labels';
import {ErrorBanner, Loading, Page, PageTitle, PhotoBox, PostSteps, useData} from '@/components/common';
import {DiffCard} from '@/components/DiffCard';

export default function CardsPage({params}: {params: Promise<{id: string}>}) {
  const {id} = use(params);
  const router = useRouter();
  const {data, setData, error} = useData(() => api.getPost(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const everyPhotoHasCard = data?.photos.every((ph) => data.choices.some((c) => c.photoId === ph.id && c.selected)) ?? false;

  return (
    <Page>
      <PostSteps active={1} />
      <PageTitle
        title="사진마다 차별점 카드 고르기"
        description="사진마다 어울리는 카드 3장을 추천합니다. 고른 카드만 글에 쓰이고, 기능과 수치는 카드에서만 가져옵니다."
      />
      {error ? <ErrorBanner message={error} /> : null}
      {submitError ? <ErrorBanner message={submitError} /> : null}
      {!data ? (
        <Loading />
      ) : (
        <>
          {data.missingScreenTypes.length ? (
            <Banner
              status="warning"
              title="빠진 사진이 있습니다"
              description={`가이드라인 이미지 순서 중 ${data.missingScreenTypes.map((s) => SCREEN_LABEL[s]).join(', ')} 화면 캡처가 없습니다. 없어도 진행할 수 있습니다.`}
            />
          ) : null}
          <VStack gap={4}>
            {data.photos.map((ph) => {
              const opts = data.choices.filter((c) => c.photoId === ph.id).sort((a, b) => a.rank - b.rank);
              return (
                <Card key={ph.id}>
                  <HStack gap={5} vAlign="start">
                    <VStack gap={2} width={240}>
                      <PhotoBox url={ph.url} name={ph.fileName} height={150} />
                      <HStack gap={2} wrap="wrap">
                        {ph.kind ? <Badge variant="info" label={KIND_LABEL[ph.kind]} /> : null}
                        {ph.screenType ? <Badge variant="neutral" label={SCREEN_LABEL[ph.screenType]} /> : null}
                      </HStack>
                      {ph.description ? <Text type="supporting">{ph.description}</Text> : null}
                    </VStack>
                    <Grid columns={3} gap={4}>
                      {opts.map((o) => {
                        const card = data.cards.find((c) => c.id === o.cardId);
                        if (!card) return null;
                        return (
                          <DiffCard
                            key={o.cardId}
                            card={card}
                            footer={
                              <VStack gap={2}>
                                <Text type="supporting">추천 {o.rank}순위 · {o.reason}</Text>
                                <Switch
                                  label={o.selected ? '이 카드 쓰기' : '쓰지 않음'}
                                  value={o.selected}
                                  isDisabled={busy === `${ph.id}:${o.cardId}`}
                                  onChange={async (next: boolean) => {
                                    setBusy(`${ph.id}:${o.cardId}`);
                                    try {
                                      setData(await api.setChoice(id, ph.id, o.cardId, next));
                                    } finally {
                                      setBusy(null);
                                    }
                                  }}
                                />
                              </VStack>
                            }
                          />
                        );
                      })}
                    </Grid>
                  </HStack>
                </Card>
              );
            })}
          </VStack>
          <HStack gap={2} hAlign="end">
            <Button label="사진 다시 올리기" href="/posts/new" />
            <Button
              variant="primary"
              label="초안 쓰기"
              isDisabled={!everyPhotoHasCard}
              tooltip={!everyPhotoHasCard ? '사진마다 카드를 1장 이상 골라 주세요' : undefined}
              clickAction={async () => {
                setSubmitError(null);
                try {
                  await api.writePost(id);
                  await api.verifyPost(id);
                  router.push(`/posts/${id}/review`);
                } catch (e) {
                  setSubmitError(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          </HStack>
        </>
      )}
    </Page>
  );
}
