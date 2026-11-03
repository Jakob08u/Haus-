import * as THREE from 'three';
import type { FloorPattern, Material, SurfaceFinish, Project } from '../model/types';

const cache = new Map<string, THREE.Texture>();
const imgCache = new Map<string, HTMLImageElement>();

function loadImage(src: string, onload: () => void): HTMLImageElement | null {
  let img = imgCache.get(src);
  if (img) return img.complete && img.naturalWidth > 0 ? img : null;
  img = new Image();
  img.onload = onload;
  img.src = src;
  imgCache.set(src, img);
  return null;
}

function rand(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function varyColor(hex: string, r: () => number, amount = 0.08) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * (1 + (r() - 0.5) * 2 * amount))));
  return '#' + c.getHexString();
}

export interface PatternSpec {
  /** Elementlänge und -breite inkl. Fuge (mm) */
  L: number;
  W: number;
  joint: number;
  pattern: FloorPattern;
  color: string;
  image?: string;
  jointColor?: string;
}

/** Periode (mm) des Musters in x/y */
export function patternPeriod(p: PatternSpec): [number, number] {
  const L = p.L + p.joint, W = p.W + p.joint;
  switch (p.pattern) {
    case 'straight':
      return [L, W];
    case 'half':
      return [L, 2 * W];
    case 'third':
      return [L, 3 * W];
    case 'random':
    case 'shipdeck':
      return [L, 5 * W];
    case 'herringbone':
      return [2 * L, 2 * L];
  }
}

/** Erzeugt eine kachelbare Canvas-Textur des Verlegemusters */
export function patternTexture(p: PatternSpec, onUpdate?: () => void): THREE.Texture {
  const key = JSON.stringify(p);
  const hit = cache.get(key);
  if (hit) return hit;
  const [PX, PY] = patternPeriod(p);
  const pxPerMM = Math.min(1.2, 1024 / Math.max(PX, PY));
  const cw = Math.max(16, Math.round(PX * pxPerMM)), ch = Math.max(16, Math.round(PY * pxPerMM));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  const img = p.image ? loadImage(p.image, () => {
    cache.delete(key);
    onUpdate?.();
  }) : null;
  ctx.fillStyle = p.jointColor ?? shadeHex(p.color, 0.6);
  ctx.fillRect(0, 0, cw, ch);
  const r = rand(1234);
  const L = p.L + p.joint, W = p.W + p.joint, J = p.joint;
  const drawPlank = (x: number, y: number, w: number, h: number) => {
    // mit Umbruch an den Rändern zeichnen (kachelbar)
    for (const dx of [-PX, 0, PX])
      for (const dy of [-PY, 0, PY]) {
        const X = (x + dx) * pxPerMM, Y = (y + dy) * pxPerMM, ww = w * pxPerMM, hh = h * pxPerMM;
        if (X > cw || Y > ch || X + ww < 0 || Y + hh < 0) continue;
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(X, Y, ww, hh);
          ctx.clip();
          const vertical = hh > ww;
          if (vertical) {
            ctx.translate(X + ww, Y);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(img, 0, 0, hh, ww);
          } else ctx.drawImage(img, X, Y, ww, hh);
          ctx.restore();
        } else {
          ctx.fillStyle = varyColor(p.color, r);
          ctx.fillRect(X, Y, ww, hh);
          // leichte Maserung
          ctx.strokeStyle = 'rgba(0,0,0,0.05)';
          ctx.lineWidth = 1;
          const lines = Math.max(1, Math.round(Math.min(ww, hh) / 6));
          for (let i = 0; i < lines; i++) {
            ctx.beginPath();
            if (ww >= hh) {
              const yy = Y + (hh * (i + r())) / lines;
              ctx.moveTo(X, yy);
              ctx.lineTo(X + ww, yy + (r() - 0.5) * 2);
            } else {
              const xx = X + (ww * (i + r())) / lines;
              ctx.moveTo(xx, Y);
              ctx.lineTo(xx + (r() - 0.5) * 2, Y + hh);
            }
            ctx.stroke();
          }
        }
      }
  };
  const rows = Math.round(PY / W);
  const offsets: Record<string, number[]> = {
    straight: [0],
    half: [0, 0.5],
    third: [0, 1 / 3, 2 / 3],
    random: [0, 0.62, 0.27, 0.81, 0.44],
    shipdeck: [0, 0.6, 0.2, 0.8, 0.4],
  };
  if (p.pattern === 'herringbone') {
    const k = Math.round(L / W);
    for (let n = -2 * k - 4; n <= 2 * k + 4; n++)
      for (let i = -2; i <= 2; i++) {
        const ox = n * W + i * 2 * L;
        drawPlank(ox, n * W, L - J, W - J);
        drawPlank(ox + L, n * W - L + W, W - J, L - J);
      }
  } else {
    const offs = offsets[p.pattern] ?? [0];
    for (let row = 0; row < rows; row++) {
      const off = offs[row % offs.length] * L;
      for (let x = -L; x < PX + L; x += L) drawPlank(x + off, row * W, L - J, W - J);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1000 / PX, 1000 / PY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

function shadeHex(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

/** Tapetentextur: Bild auf Bahnbreite × Rapport gekachelt */
export function wallpaperTexture(m: Material, onUpdate?: () => void): THREE.Texture | null {
  const bw = m.rollWidth ?? 530;
  const rep = m.repeat && m.repeat > 0 ? m.repeat : bw;
  const key = `wp:${m.id}:${bw}:${rep}:${m.repeatOffset}:${m.image?.length ?? 0}:${m.color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  const k = 512 / Math.max(bw, rep);
  canvas.width = Math.round(bw * k * (m.repeatOffset ? 2 : 1));
  canvas.height = Math.round(rep * k * (m.repeatOffset ? 2 : 1));
  const ctx = canvas.getContext('2d')!;
  const img = m.image ? loadImage(m.image, () => {
    cache.delete(key);
    onUpdate?.();
  }) : null;
  const tw = bw * k, th = rep * k;
  const draw = (x: number, y: number) => {
    if (img) ctx.drawImage(img, x, y, tw, th);
    else {
      ctx.fillStyle = m.color;
      ctx.fillRect(x, y, tw, th);
      ctx.strokeStyle = shadeHex(m.color, 0.85);
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        const cx = x + tw * (0.25 + 0.5 * (i % 2)), cy = y + th * (0.25 + 0.5 * Math.floor(i / 2));
        ctx.arc(cx, cy, Math.min(tw, th) * 0.12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(x + tw - 1, y, 1, th);
  };
  if (m.repeatOffset) {
    draw(0, 0);
    draw(0, th);
    draw(tw, -th / 2);
    draw(tw, th / 2);
    draw(tw, (3 * th) / 2);
  } else draw(0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const perX = bw * (m.repeatOffset ? 2 : 1), perY = rep * (m.repeatOffset ? 2 : 1);
  tex.repeat.set(1000 / perX, 1000 / perY);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export interface SurfaceLook {
  color: string;
  map?: THREE.Texture;
  roughness: number;
}

export function finishLook(f: SurfaceFinish | undefined, project: Project, fallback: string, onUpdate?: () => void): SurfaceLook {
  if (!f || f.kind === 'none') return { color: fallback, roughness: 0.9 };
  if (f.kind === 'paint') return { color: f.color ?? fallback, roughness: 0.92 };
  const m = project.materials.find((x) => x.id === f.materialId);
  if (!m) return { color: fallback, roughness: 0.9 };
  if (f.kind === 'wallpaper') return { color: '#ffffff', map: wallpaperTexture(m, onUpdate) ?? undefined, roughness: 0.85 };
  // Fliese
  const map = patternTexture({ L: m.tileLength ?? 300, W: m.tileWidth ?? 300, joint: m.joint ?? 3, pattern: 'straight', color: m.color, image: m.image, jointColor: '#bdb9b0' }, onUpdate);
  return { color: '#ffffff', map, roughness: 0.35 };
}

export function floorLook(materialId: string | undefined, pattern: FloorPattern, project: Project, color: string | undefined, onUpdate?: () => void): SurfaceLook {
  const m = project.materials.find((x) => x.id === materialId);
  if (!m) return { color: color ?? '#d8d2c6', roughness: 0.8 };
  const isTile = m.kind === 'tile';
  const map = patternTexture(
    {
      L: m.tileLength ?? 1200,
      W: m.tileWidth ?? 200,
      joint: m.joint ?? (isTile ? 3 : 0.6),
      pattern,
      color: m.color,
      image: m.image,
      jointColor: isTile ? '#cfcac0' : undefined,
    },
    onUpdate,
  );
  return { color: '#ffffff', map, roughness: isTile ? 0.4 : 0.7 };
}
