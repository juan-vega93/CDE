export async function captureViewerSnapshot(
  canvas: HTMLCanvasElement,
  beforeCapture?: () => void
): Promise<string | null> {
  try {
    beforeCapture?.();

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    beforeCapture?.();

    return canvas.toDataURL("image/png");
  } catch (error) {
    console.error("[snapshot] error:", error);
    return null;
  }
}