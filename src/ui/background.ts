/** Lädt Bild oder PDF (erste Seite) als data-URL für den Hintergrund */
export async function loadBackgroundFile(file: File): Promise<{ src: string; w: number; h: number }> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    return { src: canvas.toDataURL('image/jpeg', 0.85), w: canvas.width, h: canvas.height };
  }
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = src;
  await img.decode();
  return { src, w: img.naturalWidth, h: img.naturalHeight };
}

export async function fileToDataUrl(file: File, maxSize = 1024): Promise<string> {
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  if (k >= 1 && file.size < 600_000) return src;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

/** Durchschnitts-/Hauptfarbe eines Bildes (ohne Weiß-/Hintergrundtöne) */
export async function dominantColor(src: string): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    const S = 64;
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, S, S);
    const data = ctx.getImageData(0, 0, S, S).data;
    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 200) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        // Hintergrund (sehr hell, fast unbunt) ignorieren
        if (max > 235 && max - min < 18) continue;
        // Randpixel schwächer gewichten
        const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
        const key = `${r >> 5}_${g >> 5}_${b >> 5}`;
        const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        const w = edge ? 0.3 : 1;
        bk.n += w;
        bk.r += r * w;
        bk.g += g * w;
        bk.b += b * w;
        buckets.set(key, bk);
      }
    let best: { n: number; r: number; g: number; b: number } | null = null;
    for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
    if (!best || best.n < 5) return null;
    const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, '0');
    return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
  } catch {
    return null;
  }
}
