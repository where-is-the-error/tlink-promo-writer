'use client';

import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import type {Card as CardT} from '@/lib/types';

/** 차별점 카드: 주장 · 근거(쪽·인용 원문) · 이익 · 조건 */
export function DiffCard({card, footer}: {card: CardT; footer?: React.ReactNode}) {
  return (
    <Card elevation="low">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Badge variant="neutral" label={card.code} />
          {card.condition ? <Badge variant="warning" label="조건부" /> : null}
        </HStack>
        <Text weight="bold">{card.claim}</Text>
        <MetadataList label={{position: 'top'}}>
          <MetadataListItem label="근거">
            <VStack gap={1}>
              {card.citations.map((c, i) => (
                <Text key={i} type="supporting" color="accent">
                  {c.materialName} {c.pageNo}쪽 · “{c.citedText}”
                </Text>
              ))}
            </VStack>
          </MetadataListItem>
          <MetadataListItem label="고객 이익">
            <Text>{card.benefit}</Text>
          </MetadataListItem>
          <MetadataListItem label="조건">
            <Text color={card.condition ? 'primary' : 'secondary'}>{card.condition ?? '없음'}</Text>
          </MetadataListItem>
        </MetadataList>
        {footer}
      </VStack>
    </Card>
  );
}
