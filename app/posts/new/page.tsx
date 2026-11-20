'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
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
import {TextArea} from '@astryxdesign/core/TextArea';
import {SelectableCard} from '@astryxdesign/core/SelectableCard';
import {StackItem} from '@astryxdesign/core/Stack';
import {api} from '@/lib/client/api';
import {exportMasked, findPhoneBoxes, loadImage} from '@/lib/client/mask';
import {ErrorBanner, Page, PageTitle, PostSteps} from '@/components/common';
import {MaskEditor, type MaskItem} from '@/components/MaskEditor';

export default function NewPostPage() {
  const router = useRouter();
  const [items, setItems] = useState<MaskItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const update = (next: MaskItem) => setItems((xs) => xs.map((x) => (x.id === next.id ? next : x)));

  async function addFiles(files: File[]) {
    for (const file of files) {
      const id = crypto.randomUUID();
      const img = await loadImage(file);
      const item: MaskItem = {id, fileName: file.name, img, boxes: [], status: 'scanning'};
      setItems((xs) => [...xs, item]);
      setSelectedId((cur) => cur ?? id);
      // OCR은 순서대로 (브라우저 부담 줄이기)
      try {
        const boxes = await findPhoneBoxes(img);
        setItems((xs) => xs.map((x) => (x.id === id ? {...x, boxes: [...boxes, ...x.boxes], status: 'review'} : x)));
      } catch {
        setItems((xs) => xs.map((x) => (x.id === id ? {...x, status: 'review'} : x)));
        setError('글자 인식에 실패했습니다. 전화번호를 직접 상자로 가려 주세요.');
      }
    }
  }

  const allMasked = items.length > 0 && items.every((x) => x.status === 'done');
  const canNext = allMasked && memo.trim().length >= 5 && !progress;
  const selected = items.find((x) => x.id === selectedId) ?? null;
  const remaining = items.filter((x) => x.status !== 'done').length;

  async function submit() {
    setError(null);
    try {
      setProgress('글을 만드는 중');
      const {postId} = await api.createPost(memo.trim());
      for (const [i, item] of items.entries()) {
        setProgress(`가린 사진 올리는 중 (${i + 1}/${items.length})`);
        await api.uploadPhoto(postId, {blob: await exportMasked(item.img, item.boxes), fileName: item.fileName});
      }
      setProgress('사진 종류를 알아보고 카드를 추천하는 중');
      await api.classifyPost(postId);
      router.push(`/posts/${postId}/cards`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  }

  return (
    <Page>
      <PostSteps active={0} />
      <PageTitle
        title="사진과 메모 올리기"
        description="사진 종류는 자동으로 알아봅니다. 화면 캡처 속 민감정보는 브라우저에서 가린 뒤에만 서버로 보냅니다."
      />
      {error ? <ErrorBanner message={error} /> : null}

      <HStack gap={6} vAlign="start">
        <StackItem size="fill">
          <Card>
            <VStack gap={4}>
              <HStack gap={2} vAlign="center">
                <Heading level={3}>올린 사진 {items.length}장</Heading>
                {remaining ? <Badge variant="error" label={`가리기 확인 ${remaining}장 남음`} /> : null}
              </HStack>
              <FileInput
                mode="dropzone"
                label="사진 추가"
                description="설치 현장 · 제품 화면 캡처 · 사용 장면. 가이드라인 순서: 휴대폰 통화 → 인터넷전화 녹취 목록 → AI 통화요약 → 직원별 통계 → 종합 리포트"
                accept="image/*"
                isMultiple
                value={null}
                onChange={(files) => {
                  const list = files == null ? [] : Array.isArray(files) ? files : [files];
                  void addFiles(list);
                }}
              />
              {items.length ? (
                <Grid columns={{minWidth: 180}} gap={3}>
                  {items.map((it) => (
                    <SelectableCard
                      key={it.id}
                      label={it.fileName}
                      isSelected={it.id === selectedId}
                      onChange={() => setSelectedId(it.id)}
                      padding={2}>
                      <VStack gap={2}>
                        <img
                          src={it.img.src}
                          alt=""
                          style={{width: '100%', height: 110, objectFit: 'cover', borderRadius: 'var(--radius-inner)', display: 'block'}}
                        />
                        <Text type="supporting" maxLines={1}>
                          {it.fileName}
                        </Text>
                        {it.status === 'done' ? (
                          <Badge variant="success" label="가림 완료" />
                        ) : it.status === 'scanning' ? (
                          <Badge variant="neutral" label="찾는 중" />
                        ) : (
                          <Badge variant="error" label={`확인 필요 · 자동 ${it.boxes.filter((b) => b.source === 'auto').length}개`} />
                        )}
                      </VStack>
                    </SelectableCard>
                  ))}
                </Grid>
              ) : null}
            </VStack>
          </Card>
        </StackItem>

        <VStack gap={4} width={460}>
          {selected ? <MaskEditor item={selected} onChange={update} /> : null}
          <Card>
            <VStack gap={2}>
              <TextArea
                label="현장 메모 (한두 줄)"
                description="사용 장면은 사진과 메모에서만 가져옵니다. 기능·수치는 차별점 카드에서만 씁니다."
                placeholder="예: OO물류 영업팀 8명. 외근 통화가 CRM에 안 남아서 도입."
                value={memo}
                onChange={setMemo}
                rows={3}
                maxLength={300}
              />
            </VStack>
          </Card>
          {progress ? <Banner status="info" title={progress} description="잠시만 기다려 주세요." /> : null}
          <HStack hAlign="end">
            <Button
              variant="primary"
              label="다음: 카드 고르기"
              isDisabled={!canNext}
              isLoading={!!progress}
              tooltip={!allMasked ? '모든 사진의 가리기를 완료해 주세요' : memo.trim().length < 5 ? '현장 메모를 적어 주세요' : undefined}
              onClick={() => void submit()}
            />
          </HStack>
        </VStack>
      </HStack>
    </Page>
  );
}
