'use client';

import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/HStack';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Divider} from '@astryxdesign/core/Divider';
import {photoMarker, type Block} from '@/lib/exporters';
import {PhotoBox} from './common';

/** 내보낼 글 그대로 보여 주는 미리보기. 사진은 배치 규칙에 따른 자리에 "N번 사진"으로 표시 */
export function BlogPreview({blocks}: {blocks: Block[]}) {
  return (
    <VStack gap={3}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'title':
            return (
              <Heading key={i} level={2}>
                {b.text}
              </Heading>
            );
          case 'heading':
            return (
              <Heading key={i} level={4}>
                {b.text}
              </Heading>
            );
          case 'paragraph':
            return (
              <Text key={i} as="p" wordBreak="break-word">
                {b.text}
              </Text>
            );
          case 'photo':
            return (
              <Card key={i} variant="muted" padding={3}>
                <VStack gap={2}>
                  <HStack gap={2} vAlign="center">
                    <Badge variant="info" label={`${b.no}번 사진`} />
                    <Text type="supporting">{photoMarker(b.no)}</Text>
                  </HStack>
                  <PhotoBox url={b.photo.url} name={`${b.no}번 사진 미리보기 · ${b.photo.fileName}`} height={220} />
                </VStack>
              </Card>
            );
          case 'extraPhotosHeading':
            return (
              <VStack key={i} gap={1}>
                <Heading level={4}>추가 사진</Heading>
                <Text type="supporting">본문 문장과 직접 연결되지 않은 사진입니다. 넣지 않아도 됩니다.</Text>
              </VStack>
            );
          case 'footer':
            return (
              <VStack key={i} gap={1}>
                <Divider />
                {b.lines.map((l) => (
                  <Text key={l} type="supporting">
                    {l}
                  </Text>
                ))}
              </VStack>
            );
          case 'hashtags':
            return (
              <Text key={i} color="accent">
                {b.tags.join(' ')}
              </Text>
            );
        }
      })}
    </VStack>
  );
}
