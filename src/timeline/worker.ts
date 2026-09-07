/// <reference lib="webworker" />
import { extractTimelineDateRange, extractTimelineRange, type TimelineIndex } from './parser';
import type { WorkerRequest, WorkerResponse } from './types';
import { processTimelineBuffer } from './workerProcessor';

let index: TimelineIndex | null = null;
const send = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'load') {
      const result = processTimelineBuffer(message.buffer);
      index = result.index;
      send({ type: 'loaded', dates: result.dates, fileName: message.fileName });
    } else if (message.type === 'extract') {
      if (!index) throw new Error('先にTimeline JSONを読み込んでください。');
      const result = extractTimelineRange(index, message.date, message.from, message.to);
      send({ type: 'extracted', ...result });
    } else if (message.type === 'extract-range') {
      if (!index) throw new Error('先にTimeline JSONを読み込んでください。');
      const result = extractTimelineDateRange(index, message.startDate, message.endDate, message.from, message.to);
      send({ type: 'extracted', ...result });
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'JSON処理中にエラーが発生しました。' });
  }
};
