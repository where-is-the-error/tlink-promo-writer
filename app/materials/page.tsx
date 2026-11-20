'use client';

import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {FileInput} from '@astryxdesign/core/FileInput';
import {List, ListItem} from '@astryxdesign/core/List';
import {StackItem} from '@astryxdesign/core/Stack';
import {api} from '@/lib/client/api';
import {ErrorBanner, Loading, Page, PageTitle, useData} from '@/components/common';
import {DiffCard} from '@/components/DiffCard';

const DETECTOR_LABEL = {
  invisible_text: '보이지 않는 글자',
  instruction_like: '지시문처럼 생긴 문장',
  hidden_slide: '숨긴 슬라이드',
} as const;

export default function MaterialsPage() {
  const overview = useData(() => api.getMaterials());
  const cards = useData(() => api.getCards());
  const [busy, setBusy] = useState(false);

  const pendingFindings = overview.data?.findings.filter((f) => f.status === 'pending') ?? [];

  return (
    <Page>
      <PageTitle
        title="제품 자료와 차별점 카드"
        description="자료는 처음 한 번만 올립니다. 쪽 단위로 저장하고, 인용한 원문의 실제 쪽 위치가 붙은 카드를 만듭니다."
        actions={
          <Button
            variant="primary"
            label="카드 다시 만들기"
            isDisabled={pendingFindings.length > 0}
            tooltip={pendingFindings.length ? '격리된 숨은 지시를 먼저 처리해 주세요' : undefined}
            clickAction={async () => {
              cards.setData(await api.generateCards());
            }}
          />
        }
      />
      {overview.error ? <ErrorBanner message={overview.error} /> : null}

      <HStack gap={6} vAlign="start">
        <VStack gap={4} width={400}>
          {!overview.data ? (
            <Loading />
          ) : (
            <>
              {pendingFindings.map((f) => (
                <Banner
                  key={f.id}
                  status="warning"
                  title="숨은 지시 격리됨"
                  description={`${f.materialName} ${f.pageNo}쪽 · ${DETECTOR_LABEL[f.detector]}: “${f.snippet}”. 확인 전까지 지식 베이스에 넣지 않습니다.`}
                  endContent={
                    <HStack gap={2}>
                      <Button
                        size="sm"
                        variant="destructive"
                        label="계속 제외"
                        clickAction={async () => {
                          await api.resolveFinding(f.id, 'excluded');
                          await overview.reload();
                        }}
                      />
                      <Button
                        size="sm"
                        label="허용"
                        clickAction={async () => {
                          await api.resolveFinding(f.id, 'allowed');
                          await overview.reload();
                        }}
                      />
                    </HStack>
                  }
                />
              ))}
              {overview.data.conflicts.length ? (
                <Banner
                  status="info"
                  title="자료끼리 다른 내용 · 카드로 만들지 않음"
                  description={overview.data.conflicts.map((c) => `${c.topic}: ${c.detail}`).join(' / ')}
                />
              ) : null}
              <Card>
                <VStack gap={3}>
                  <Heading level={3}>
                    등록된 자료 {overview.data.materials.length}종 · {overview.data.totalPages}쪽
                  </Heading>
                  <HStack gap={2} wrap="wrap">
                    <Badge variant="info" label={`지식 베이스 ${overview.data.indexedPages}쪽 색인`} />
                    <Badge variant="neutral" label="의미 + 부분 일치 검색" />
                  </HStack>
                  <List>
                    {overview.data.materials.map((m) => (
                      <ListItem
                        key={m.id}
                        label={m.name}
                        description={`${m.sourceFile} · ${m.pageCount}쪽`}
                        endContent={<Badge variant={m.status === 'ready' ? 'success' : 'warning'} label={m.status === 'ready' ? '저장됨' : '검사 중'} />}
                      />
                    ))}
                  </List>
                  <FileInput
                    mode="dropzone"
                    label="PDF 자료 추가"
                    description="PPTX는 등록 스크립트에서 PDF로 바꿔 올립니다 (슬라이드 1장 = 1쪽)"
                    accept="application/pdf"
                    value={null}
                    isLoading={busy}
                    onChange={async (files) => {
                      const file = Array.isArray(files) ? files[0] : files;
                      if (!file) return;
                      setBusy(true);
                      try {
                        await api.uploadMaterial(file);
                        await overview.reload();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </VStack>
              </Card>
            </>
          )}
        </VStack>

        <StackItem size="fill">
          <VStack gap={3}>
            <Heading level={3}>차별점 카드 {cards.data?.length ?? ''}장</Heading>
            {cards.error ? <ErrorBanner message={cards.error} /> : null}
            {!cards.data ? (
              <Loading />
            ) : (
              <Grid columns={{minWidth: 300}} gap={4}>
                {cards.data.map((c) => (
                  <DiffCard key={c.id} card={c} />
                ))}
              </Grid>
            )}
          </VStack>
        </StackItem>
      </HStack>
    </Page>
  );
}
