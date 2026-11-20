'use client';

import {useCallback, useEffect, useState} from 'react';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/HStack';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Banner} from '@astryxdesign/core/Banner';
import {Card} from '@astryxdesign/core/Card';
import {Stepper, Step} from '@astryxdesign/core/Stepper';
import {StackItem} from '@astryxdesign/core/Stack';

/** 데이터 불러오기 + 다시 불러오기 */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await load());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return {data, setData, error, setError, reload};
}

export function Page({children}: {children: React.ReactNode}) {
  return (
    <VStack gap={6} padding={8} maxWidth={1440}>
      {children}
    </VStack>
  );
}

export function PageTitle({title, description, actions}: {title: string; description?: string; actions?: React.ReactNode}) {
  return (
    <HStack gap={4} vAlign="center">
      <StackItem size="fill">
        <VStack gap={1}>
          <Heading level={1}>{title}</Heading>
          {description ? <Text color="secondary">{description}</Text> : null}
        </VStack>
      </StackItem>
      {actions}
    </HStack>
  );
}

export function Loading({label = '불러오는 중'}: {label?: string}) {
  return (
    <Card>
      <HStack gap={2} vAlign="center">
        <Spinner size="md" />
        <Text color="secondary">{label}</Text>
      </HStack>
    </Card>
  );
}

export function ErrorBanner({message}: {message: string}) {
  return <Banner status="error" title="문제가 생겼습니다" description={message} />;
}

const STEPS = ['사진·메모', '카드 고르기', '초안 검토', '승인·복사'];

/** 글 쓰기 흐름 단계 표시 (0부터) */
export function PostSteps({active}: {active: number}) {
  return (
    <Stepper activeStep={active} label="글 쓰기 단계" density="compact">
      {STEPS.map((s, i) => (
        <Step key={s} step={i} label={s} />
      ))}
    </Stepper>
  );
}

/** 사진 자리 (이미지가 없을 때는 이름만) */
export function PhotoBox({url, name, height = 140}: {url: string; name: string; height?: number}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={{width: '100%', height, objectFit: 'cover', borderRadius: 'var(--radius-inner)', display: 'block'}}
      />
    );
  }
  return (
    <Card variant="muted" height={height} padding={3}>
      <VStack height="100%" vAlign="end">
        <Text type="supporting">{name}</Text>
      </VStack>
    </Card>
  );
}
