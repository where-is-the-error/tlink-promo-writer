'use client';

import {use, useMemo, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {List, ListItem} from '@astryxdesign/core/List';
import {StackItem} from '@astryxdesign/core/Stack';
import {api} from '@/lib/api';
import {CHECK_BADGE} from '@/lib/labels';
import {buildBlocks, download, printAsPdf, toHtml, toMarkdown, toMarkdownZip, toText} from '@/lib/exporters';
import {ErrorBanner, Loading, Page, PageTitle, PostSteps, useData} from '@/components/common';
import {BlogPreview} from '@/components/BlogPreview';

export default function DonePage({params}: {params: Promise<{id: string}>}) {
  const {id} = use(params);
  const post = useData(() => api.getPost(id), [id]);
  const [copied, setCopied] = useState<'all' | 'tags' | null>(null);
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);

  const blocks = useMemo(() => (post.data ? buildBlocks(post.data) : []), [post.data]);
  const approved = post.data ? post.data.post.status !== 'draft' : false;
  const base = `tlink-post-${id}`;
  const photoCount = blocks.filter((b) => b.type === 'photo').length;

  const copy = async (text: string, kind: 'all' | 'tags') => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
  };

  return (
    <Page>
      <PostSteps active={3} />
      <PageTitle
        title="승인 완료"
        description="근거 표시는 빠지고 본문만 나갑니다. 사진은 “여기에 N번 사진 넣기” 자리에 넣어 주세요."
      />
      {post.error ? <ErrorBanner message={post.error} /> : null}
      {!post.data ? (
        <Loading />
      ) : (
        <>
          {!approved ? (
            <Banner
              status="warning"
              title="아직 승인되지 않은 글입니다"
              description="초안 검토 화면에서 확인 필요 문장을 모두 해결하고 승인해야 복사·내려받기를 할 수 있습니다."
              endContent={<Button size="sm" label="초안 검토로" href={`/posts/${id}/review`} />}
            />
          ) : null}
          <HStack gap={6} vAlign="start">
            <StackItem size="fill">
              <Card>
                <VStack gap={4}>
                  <HStack gap={2} vAlign="center">
                    <Badge variant="info" label="블로그 미리보기" />
                    <Text type="supporting">사진 {photoCount}장 · 사진 자리는 출처 문장 바로 뒤에 둡니다</Text>
                  </HStack>
                  <BlogPreview blocks={blocks} />
                </VStack>
              </Card>
            </StackItem>

            <VStack gap={4} width={400}>
              <Card>
                <VStack gap={3}>
                  <Heading level={3}>복사·내려받기</Heading>
                  <HStack gap={2} wrap="wrap">
                    <Button
                      variant="primary"
                      label={copied === 'all' ? '복사됨' : '블로그용 복사'}
                      isDisabled={!approved}
                      clickAction={() => copy(toText(blocks), 'all')}
                    />
                    <Button
                      label={copied === 'tags' ? '복사됨' : '해시태그만 복사'}
                      isDisabled={!approved}
                      clickAction={() => copy(post.data!.post.hashtags.join(' '), 'tags')}
                    />
                  </HStack>
                  <List>
                    <ListItem
                      label="텍스트 (.txt)"
                      description="네이버 블로그처럼 사진을 직접 올리는 곳"
                      endContent={<Button size="sm" label="받기" isDisabled={!approved} onClick={() => download(toText(blocks), `${base}.txt`)} />}
                    />
                    <ListItem
                      label="Markdown (.md)"
                      description="사진 자리만 표시"
                      endContent={
                        <Button
                          size="sm"
                          label="받기"
                          isDisabled={!approved}
                          onClick={() => download(toMarkdown(blocks, false), `${base}.md`, 'text/markdown;charset=utf-8')}
                        />
                      }
                    />
                    <ListItem
                      label="Markdown + 사진 (.zip)"
                      description="post.md와 images 폴더. 깃허브·노션·벨로그 등"
                      endContent={
                        <Button size="sm" label="받기" isDisabled={!approved} clickAction={async () => download(await toMarkdownZip(blocks), `${base}.zip`)} />
                      }
                    />
                    <ListItem
                      label="HTML (.html)"
                      description="사진을 파일 안에 포함. HTML 편집기를 쓰는 커뮤니티"
                      endContent={
                        <Button
                          size="sm"
                          label="받기"
                          isDisabled={!approved}
                          clickAction={async () => download(await toHtml(blocks), `${base}.html`, 'text/html;charset=utf-8')}
                        />
                      }
                    />
                    <ListItem
                      label="PDF"
                      description="인쇄 창에서 “PDF로 저장”을 고르세요"
                      endContent={<Button size="sm" label="열기" isDisabled={!approved} clickAction={() => printAsPdf(blocks)} />}
                    />
                  </List>
                  <Text type="supporting">AI 비용 ${post.data.post.costUsd.toFixed(2)} (상한 $1.00)</Text>
                </VStack>
              </Card>

              <Card>
                <VStack gap={3}>
                  <Heading level={3}>검사 결과</Heading>
                  <List>
                    {post.data.checklist.map((c) => (
                      <ListItem key={c.itemKey} startContent={<Badge {...CHECK_BADGE[c.status]} />} label={c.label} />
                    ))}
                  </List>
                </VStack>
              </Card>

              <Card>
                <VStack gap={3}>
                  <Heading level={3}>게시 후 할 일</Heading>
                  <TextInput
                    label="게시한 글 주소"
                    description="저장하면 “게시됨”으로 바뀌고 반응·학습 화면에서 조회수·문의를 입력할 수 있습니다"
                    placeholder="https://blog.naver.com/mobilecrm/..."
                    value={url}
                    onChange={setUrl}
                  />
                  <Banner status="info" title="발행 간격 안내" description="하루에 몰아 올리면 노출에 불리할 수 있어 주 1~2회를 권장합니다." />
                  <Button
                    label={saved ? '저장됨' : '게시 완료로 저장'}
                    isDisabled={!approved || !/^https?:\/\//.test(url)}
                    clickAction={async () => {
                      await api.savePublishedUrl(id, url);
                      setSaved(true);
                    }}
                  />
                  {saved ? <Button variant="ghost" label="반응·학습으로 가기" href="/learning" /> : null}
                </VStack>
              </Card>
            </VStack>
          </HStack>
        </>
      )}
    </Page>
  );
}
