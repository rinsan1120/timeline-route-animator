export const FILE_OPEN_ERROR = 'ファイルを開けませんでした。';
export const FILE_READ_ERROR = 'ファイル内容を読み取れませんでした。';
export const EMPTY_FILE_ERROR = '読み取ったファイルが0バイトでした。';

export interface ReadableTimelineFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export async function readTimelineFile(file: ReadableTimelineFile | null): Promise<ArrayBuffer> {
  if (!file) throw new Error(FILE_OPEN_ERROR);
  console.info('[Timeline] file selected', { name: file.name, type: file.type, size: file.size });

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error(FILE_READ_ERROR);
  }

  console.info('[Timeline] arrayBuffer acquired', { byteLength: buffer.byteLength });
  if (buffer.byteLength === 0) throw new Error(EMPTY_FILE_ERROR);
  return buffer;
}
