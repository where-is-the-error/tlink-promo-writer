'use client';

import {useEffect, useRef, useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/HStack';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Spinner} from '@astryxdesign/core/Spinner';
import {type Box, drawMasked} from '@/lib/client/mask';

export interface MaskItem {
  id: string;
  fileName: string;
  img: HTMLImageElement;
  boxes: Box[];
  status: 'scanning' | 'review' | 'done';
}

/** 선택한 사진 위에 가림 상자를 보여 주고, 끌어서 상자를 추가합니다. */
export function MaskEditor({item, onChange}: {item: MaskItem; onChange: (next: MaskItem) => void}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [drag, setDrag] = useState<{x: number; y: number} | null>(null);
  const [preview, setPreview] = useState<Box | null>(null);

  useEffect(() => {
    if (canvasRef.current) drawMasked(canvasRef.current, item.img, item.boxes, preview);
  }, [item, preview]);

  const toImage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return {x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height};
  };
  const boxFrom = (a: {x: number; y: number}, b: {x: number; y: number}): Box => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
    source: 'manual',
  });

  const auto = item.boxes.filter((b) => b.source === 'auto').length;
  const manual = item.boxes.length - auto;

  return (
    <Card>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Heading level={3}>민감정보 가리기</Heading>
          {item.status === 'scanning' ? (
            <Badge variant="neutral" label="전화번호 찾는 중" />
          ) : item.status === 'done' ? (
            <Badge variant="success" label="가림 완료" />
          ) : (
            <Badge variant="error" label="확인 필요" />
          )}
        </HStack>
        <Text type="supporting">{item.fileName}</Text>
        <canvas
          ref={canvasRef}
          aria-label={`${item.fileName} 가리기 미리보기`}
          style={{
            width: '100%',
            height: 'auto',
            borderRadius: 'var(--radius-inner)',
            cursor: drawing ? 'crosshair' : 'default',
            touchAction: 'none',
          }}
          onPointerDown={(e) => {
            if (!drawing) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(toImage(e));
          }}
          onPointerMove={(e) => {
            if (drawing && drag) setPreview(boxFrom(drag, toImage(e)));
          }}
          onPointerUp={(e) => {
            if (!drawing || !drag) return;
            const b = boxFrom(drag, toImage(e));
            setDrag(null);
            setPreview(null);
            if (b.w > 4 && b.h > 4) onChange({...item, boxes: [...item.boxes, b], status: 'review'});
          }}
        />
        {item.status === 'scanning' ? (
          <HStack gap={2} vAlign="center">
            <Spinner size="sm" />
            <Text type="supporting">브라우저 안에서 글자를 읽는 중입니다. 원본은 서버로 보내지 않습니다.</Text>
          </HStack>
        ) : (
          <Text type="supporting">
            전화번호 {auto}개는 자동으로 가렸습니다. 고객 이름 같은 나머지 정보는 “상자 그리기”를 누르고 사진 위를 끌어서 가려 주세요. (직접 그린 상자 {manual}개)
          </Text>
        )}
        <HStack gap={2} wrap="wrap">
          <Button
            label={drawing ? '그리기 끝내기' : '상자 그리기'}
            isDisabled={item.status === 'scanning'}
            onClick={() => setDrawing((d) => !d)}
          />
          <Button
            variant="ghost"
            label="마지막 상자 지우기"
            isDisabled={!manual}
            onClick={() => {
              const idx = item.boxes.map((b) => b.source).lastIndexOf('manual');
              onChange({...item, boxes: item.boxes.filter((_, i) => i !== idx), status: 'review'});
            }}
          />
          <Button
            variant="primary"
            label="가리기 완료"
            isDisabled={item.status !== 'review'}
            onClick={() => {
              setDrawing(false);
              onChange({...item, status: 'done'});
            }}
          />
        </HStack>
      </VStack>
    </Card>
  );
}
