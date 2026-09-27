interface SaveOptions {
  suggestedName: string;
  mimeType: string;
  extension: '.json' | '.mp4' | '.png';
}

interface SaveHandle {
  name: string;
  createWritable(options: { keepExistingData: boolean }): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { accept: Record<string, string[]> }[];
  }) => Promise<SaveHandle>;
};

type SaveStage = 'showSaveFilePicker' | 'prepareBlob' | 'createWritable' | 'write' | 'close' | 'abort' | 'download';

function errorDetails(reason: unknown): { name: string; message: string } {
  if (reason instanceof Error) return { name: reason.name, message: reason.message };
  return { name: 'UnknownError', message: '保存処理で不明な例外が発生しました。' };
}

function logSaveError(stage: SaveStage, reason: unknown): void {
  // Local diagnostics only: never include the Blob, file handle, or route data.
  console.error('[File Save]', { stage, ...errorDetails(reason) });
}

export function saveErrorMessage(reason: unknown, fallback: string): string {
  switch (errorDetails(reason).name) {
    case 'NoModificationAllowedError':
      return '選択したファイルを書き込み・上書きできませんでした。他のアプリで開いている場合は閉じてから、もう一度保存してください。解決しない場合は別の保存先を選んでください。';
    case 'NotAllowedError':
      return '選択したファイルへの書き込みが許可されませんでした。別の保存先を選ぶか、保存権限を確認してください。';
    case 'AbortError':
      // Picker cancellation is handled separately. An interrupted write is a failure.
      return 'ファイルの保存処理が中断されました。保存先やセキュリティソフトの設定を確認して、もう一度保存してください。';
    case 'QuotaExceededError':
      return '保存に必要な空き容量が不足しています。空き容量を確認するか、別の保存先を選んでください。';
    case 'NotFoundError':
      return '保存先のファイルまたはフォルダーが見つかりません。保存先を選び直してください。';
    case 'SecurityError':
      return 'ブラウザのセキュリティ制限により保存できませんでした。保存先やブラウザの設定を確認して、保存ボタンからもう一度お試しください。';
    default:
      return fallback;
  }
}

// A factory opens the picker in the click gesture, before JSON serialization or PNG rendering.
export async function saveBlobWithPicker(blob: Blob | (() => Blob | Promise<Blob>), options: SaveOptions): Promise<string | null> {
  const pickerWindow = window as PickerWindow;
  if (typeof pickerWindow.showSaveFilePicker === 'function') {
    let handle: SaveHandle;
    try {
      handle = await pickerWindow.showSaveFilePicker({
        suggestedName: options.suggestedName,
        types: [{ accept: { [options.mimeType]: [options.extension] } }],
      });
    } catch (reason) {
      if (reason instanceof Error && reason.name === 'AbortError') return null;
      logSaveError('showSaveFilePicker', reason);
      throw reason;
    }
    let stage: SaveStage = 'prepareBlob';
    let writable: Awaited<ReturnType<SaveHandle['createWritable']>> | undefined;
    try {
      const data = typeof blob === 'function' ? await blob() : blob;
      stage = 'createWritable';
      // Replace the whole file. Permission checks remain with the browser's API.
      writable = await handle.createWritable({ keepExistingData: false });
      stage = 'write';
      await writable.write(data);
      stage = 'close';
      await writable.close();
    } catch (reason) {
      logSaveError(stage, reason);
      if (writable) {
        try { await writable.abort(); } catch (abortReason) { logSaveError('abort', abortReason); }
      }
      // Preserve the write/close exception even if abort also fails.
      throw reason;
    }
    return handle.name;
  }

  let url: string;
  try {
    url = URL.createObjectURL(typeof blob === 'function' ? await blob() : blob);
  } catch (reason) {
    logSaveError('prepareBlob', reason);
    throw reason;
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = options.suggestedName;
  try {
    document.body.appendChild(link);
    link.click();
  } catch (reason) {
    logSaveError('download', reason);
    throw reason;
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return options.suggestedName;
}
