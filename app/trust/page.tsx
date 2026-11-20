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
import {api} from '@/lib/client/api';
import type {EvalCaseResult} from '@/lib/client/types';
import {ErrorBanner, Loading, Page, PageTitle, useData} from '@/components/common';

const LAYERS = [
  ['1. 등록 검사', '보이지 않는 글자·지시문·숨긴 슬라이드 격리'],
  ['2. 데이터 분리', '자료는 문서 블록·태그 안, 자료 속 지시 무시'],
  ['3. 권한 최소화', '도구 없음, 정해진 JSON 출력만'],
  ['4. 이중 검증', '원문 대조 AI + 인용 실재 확인 + 코드 검사'],
  ['5. 사람 승인', '확인 필요가 남으면 승인·복사 불가'],
];

function Metric({label, value, note, ok}: {label: string; value: string; note: string; ok: boolean | null}) {
  return (
    <Card>
      <VStack gap={1}>
        <Text type="supporting">{label}</Text>
        <Heading level={2}>{value}</Heading>
        <HStack gap={2} vAlign="center">
          {ok == null ? null : <Badge variant={ok ? 'success' : 'error'} label={ok ? '기준 통과' : '기준 미달'} />}
          <Text type="supporting">{note}</Text>
        </HStack>
      </VStack>
    </Card>
  );
}

export default function TrustPage() {
  const {data, setData, error} = useData(() => api.getTrust());

  return (
    <Page>
      <PageTitle
        title="신뢰도 리포트"
        description="평가 사례 9개로 근거 정확도와 공격 방어를 매번 확인합니다."
        actions={<Button variant="primary" label="평가 다시 돌리기" clickAction={async () => setData(await api.runEval())} />}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {!data ? (
        <Loading />
      ) : (
        <>
          <Text type="supporting">마지막 실행: {data.runAt ? new Date(data.runAt).toLocaleString('ko-KR') : '아직 없음'}</Text>
          <Grid columns={4} gap={4}>
            <Metric
              label="근거 쪽수 정확도"
              value={data.pageAccuracy == null ? '—' : `${Math.round(data.pageAccuracy * 100)}%`}
              note="기준 95% 이상"
              ok={data.pageAccuracy == null ? null : data.pageAccuracy >= 0.95}
            />
            <Metric label="틀린 주장 탐지" value={`${data.trapDetected} / ${data.trapTotal}`} note="고객 이탈 위험 · 특허 번호 · 아이폰" ok={data.trapDetected === data.trapTotal} />
            <Metric label="숨은 지시 탐지" value={`${data.injectionDetected} / ${data.injectionTotal}`} note="최종 글 반영 0건" ok={data.injectionDetected === data.injectionTotal} />
            <Metric
              label="글 1건 비용"
              value={data.avgCostUsd == null ? '—' : `$${data.avgCostUsd.toFixed(2)}`}
              note="상한 $1.00"
              ok={data.avgCostUsd == null ? null : data.avgCostUsd < 1}
            />
          </Grid>
          <VStack gap={3}>
            <Heading level={3}>평가 사례별 결과</Heading>
            <Card padding={0}>
              <Table<EvalCaseResult>
                data={data.cases}
                idKey="caseId"
                columns={[
                  {key: 'caseId', header: '사례', width: pixel(80)},
                  {key: 'title', header: '입력', width: proportional(2)},
                  {key: 'photoKind', header: '사진 종류', width: pixel(110)},
                  {key: 'trap', header: '심어 둔 함정', width: proportional(2)},
                  {key: 'pageAccuracy', header: '쪽수 정확도', width: pixel(110)},
                  {
                    key: 'trapResult',
                    header: '함정 탐지',
                    width: pixel(110),
                    renderCell: (c) => (c.trapResult === 'none' ? <Text color="secondary">—</Text> : <Badge variant={c.trapResult === 'caught' ? 'success' : 'error'} label={c.trapResult === 'caught' ? '탐지' : '놓침'} />),
                  },
                  {
                    key: 'passed',
                    header: '결과',
                    width: pixel(150),
                    renderCell: (c) => <Badge variant={c.passed ? 'success' : 'warning'} label={c.passed ? '통과' : c.note ?? '확인 필요'} />,
                  },
                ]}
              />
            </Card>
          </VStack>
          <Card>
            <VStack gap={3}>
              <Heading level={3}>프롬프트 인젝션 방어 5겹</Heading>
              <Grid columns={5} gap={3}>
                {LAYERS.map(([t, d]) => (
                  <Card key={t} variant="muted">
                    <VStack gap={1}>
                      <Text weight="bold">{t}</Text>
                      <Text type="supporting">{d}</Text>
                    </VStack>
                  </Card>
                ))}
              </Grid>
            </VStack>
          </Card>
        </>
      )}
    </Page>
  );
}
