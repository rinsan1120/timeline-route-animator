interface SaveOptions {
  suggestedName: string;
  mimeType: string;
  extension: '.json' | '.mp4';
}

interface SaveHandle {
  name: string;
  createWritable(): Promise<{
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

// A factory lets the picker open within the click gesture, before serializing JSON.
export async function saveBlobWithPicker(blob: Blob | (() => Blob), options: SaveOptions): Promise<string | null> {
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
      throw reason;
    }
    const data = typeof blob === 'function' ? blob() : blob;
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (reason) {
      try { await writable.abort(); } catch { /* Keep the original write error. */ }
      throw reason;
    }
    return handle.name;
  }

  const url = URL.createObjectURL(typeof blob === 'function' ? blob() : blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = options.suggestedName;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return options.suggestedName;
}
