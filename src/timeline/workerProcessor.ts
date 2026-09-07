import { getAvailableDates, parseTimelineText, type TimelineIndex } from './parser';

export const JSON_PARSE_ERROR = 'JSONとして解析できませんでした。';
export const TIMELINE_FORMAT_ERROR = 'Timeline形式のデータを確認できませんでした。';
export const EMPTY_BUFFER_ERROR = '読み取ったファイルが0バイトでした。';

interface WorkerLogger {
  info: (...data: unknown[]) => void;
  error: (...data: unknown[]) => void;
}

export function processTimelineBuffer(buffer: ArrayBuffer, logger: WorkerLogger = console): { index: TimelineIndex; dates: string[] } {
  logger.info('[Timeline Worker] buffer received', { byteLength: buffer.byteLength });
  if (buffer.byteLength === 0) throw new Error(EMPTY_BUFFER_ERROR);

  const text = new TextDecoder('utf-8').decode(buffer);
  logger.info('[Timeline Worker] buffer decoded', { characterCount: text.length });
  logger.info('[Timeline Worker] JSON parse started');

  let index: TimelineIndex;
  try {
    index = parseTimelineText(text);
  } catch (reason) {
    const message = reason instanceof SyntaxError ? JSON_PARSE_ERROR : TIMELINE_FORMAT_ERROR;
    logger.error('[Timeline Worker] parse failed', { reason: reason instanceof Error ? reason.message : String(reason) });
    throw new Error(message);
  }

  const dates = getAvailableDates(index);
  if (!dates.length) {
    logger.error('[Timeline Worker] parse failed', { reason: 'No dated timelinePath or rawSignals entries' });
    throw new Error(TIMELINE_FORMAT_ERROR);
  }
  logger.info('[Timeline Worker] parse succeeded', { dateCount: dates.length });
  return { index, dates };
}
