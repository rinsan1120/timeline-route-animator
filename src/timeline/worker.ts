/// <reference lib="webworker" />
import { extractTimelineRange, getAvailableDates, parseTimelineText, type TimelineIndex } from './parser';
import type { WorkerResponse } from './types';

let index: TimelineIndex | null = null;
const send = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as { type: string; file?: File; fileName?: string; date?: string; from?: string; to?: string };
  try {
    if (message.type === 'load') {
      if (!message.file) throw new Error('JSONファイルが指定されていません。');
      index = parseTimelineText(await message.file.text());
      const dates = getAvailableDates(index);
      if (!dates.length) throw new Error('日時付きのtimelinePathまたはrawSignalsが見つかりません。');
      send({ type: 'loaded', dates, fileName: message.fileName ?? '' });
    } else if (message.type === 'extract') {
      if (!index) throw new Error('先にTimeline JSONを読み込んでください。');
      const result = extractTimelineRange(index, message.date ?? '', message.from ?? '', message.to ?? '');
      send({ type: 'extracted', ...result });
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'JSON処理中にエラーが発生しました。' });
  }
};

export {};
