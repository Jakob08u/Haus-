import { Component, Suspense, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { Furniture } from '../model/types';

const S = 0.001;

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * k)));
  return '#' + c.getHexString();
}

/** Quader: Mitte (x, z) lokal, Unterkante y0, Maße in mm */
function Box({ x = 0, y0 = 0, z = 0, w, h, d, color, rough = 0.75, metal = 0, opacity = 1, emissive }: { x?: number; y0?: number; z?: number; w: number; h: number; d: number; color: string; rough?: number; metal?: number; opacity?: number; emissive?: string }) {
  if (w <= 0 || h <= 0 || d <= 0) return null;
  return (
    <mesh position={[x * S, (y0 + h / 2) * S, z * S]} castShadow={opacity === 1} receiveShadow>
      <boxGeometry args={[w * S, h * S, d * S]} />
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} transparent={opacity < 1} opacity={opacity} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 0.8 : 0} />
    </mesh>
  );
}

function Cyl({ x = 0, y0 = 0, z = 0, r, r2, h, color, sx = 1, sz = 1, emissive, rough = 0.6 }: { x?: number; y0?: number; z?: number; r: number; r2?: number; h: number; color: string; sx?: number; sz?: number; emissive?: string; rough?: number }) {
  return (
    <mesh position={[x * S, (y0 + h / 2) * S, z * S]} scale={[sx, 1, sz]} castShadow receiveShadow>
      <cylinderGeometry args={[(r2 ?? r) * S, r * S, h * S, 28]} />
      <meshStandardMaterial color={color} roughness={rough} emissive={emissive ?? '#000'} emissiveIntensity={emissive ? 1 : 0} />
    </mesh>
  );
}

/** Parametrisches Grobmodell aus Grundkörpern in den echten Maßen */
export function ParametricFurniture({ f, lampsOn }: { f: Furniture; lampsOn?: boolean }) {
  const W = f.width, D = f.depth, H = f.height, c = f.color;
  const dark = shade(c, 0.7), light = shade(c, 1.15);
  const back = -D / 2, front = D / 2;
  switch (f.category) {
    case 'bett': {
      const mattH = Math.min(220, H * 0.45);
      const frameH = Math.max(80, H - mattH);
      const headH = Math.max(H + 350, 850);
      return (
        <group>
          <Box w={W} d={D} h={frameH} color={c} />
          <Box y0={frameH} w={W - 40} d={D - 40} h={mattH} color="#f4f2ee" rough={0.95} />
          <Box z={back + 40} w={W} d={80} h={headH} color={dark} />
          {(W > 1200 ? [-W / 4, W / 4] : [0]).map((px, i) => (
            <Box key={i} x={px} z={back + 300} y0={frameH + mattH} w={Math.min(W / 2 - 80, 650)} d={380} h={120} color="#ffffff" rough={1} />
          ))}
          <Box z={D * 0.15} y0={frameH + mattH} w={W - 30} d={D * 0.55} h={40} color={light} rough={1} />
        </group>
      );
    }
    case 'sofa':
    case 'sessel': {
      const seatH = H * 0.48, armW = Math.min(220, W * 0.14), backD = Math.min(250, D * 0.28);
      return (
        <group>
          <Box w={W} d={D} h={seatH * 0.6} color={dark} />
          <Box z={backD / 2} y0={seatH * 0.6} w={W - 2 * armW} d={D - backD} h={seatH * 0.4} color={c} rough={0.95} />
          <Box z={back + backD / 2} w={W} d={backD} h={H} color={c} rough={0.95} />
          <Box x={-W / 2 + armW / 2} w={armW} d={D} h={H * 0.68} color={c} rough={0.95} />
          <Box x={W / 2 - armW / 2} w={armW} d={D} h={H * 0.68} color={c} rough={0.95} />
        </group>
      );
    }
    case 'schrank':
    case 'kommode': {
      const n = f.doors ?? Math.max(1, Math.round(W / 500));
      const drawers = f.category === 'kommode' ? Math.max(2, Math.round(H / 250)) : 0;
      return (
        <group>
          <Box y0={20} w={W} d={D} h={H - 20} color={c} rough={0.6} />
          <Box z={0} w={W - 20} d={D - 20} h={20} color={dark} />
          {drawers === 0 &&
            Array.from({ length: n - 1 }, (_, i) => <Box key={i} x={-W / 2 + (W * (i + 1)) / n} z={front} y0={30} w={4} d={4} h={H - 40} color={dark} />)}
          {drawers === 0 &&
            Array.from({ length: n }, (_, i) => {
              const cx = -W / 2 + (W * (i + 0.5)) / n + (i % 2 === 0 ? W / n / 2 - 40 : -(W / n / 2 - 40));
              return <Box key={'h' + i} x={cx} z={front + 10} y0={H * 0.45} w={15} d={20} h={Math.min(300, H * 0.15)} color="#9aa0a6" metal={0.7} rough={0.3} />;
            })}
          {drawers > 0 &&
            Array.from({ length: drawers }, (_, i) => (
              <group key={i}>
                <Box z={front} y0={20 + ((H - 20) * (i + 1)) / drawers - 2} w={W - 10} d={4} h={4} color={dark} />
                <Box z={front + 10} y0={20 + ((H - 20) * (i + 0.5)) / drawers} w={Math.min(200, W * 0.3)} d={20} h={15} color="#9aa0a6" metal={0.7} rough={0.3} />
              </group>
            ))}
        </group>
      );
    }
    case 'regal': {
      const n = Math.max(2, Math.round(H / 350));
      const t = 20;
      return (
        <group>
          <Box x={-W / 2 + t / 2} w={t} d={D} h={H} color={c} />
          <Box x={W / 2 - t / 2} w={t} d={D} h={H} color={c} />
          <Box z={back + 4} w={W} d={8} h={H} color={dark} />
          {Array.from({ length: n + 1 }, (_, i) => (
            <Box key={i} y0={Math.min(H - t, (i * (H - t)) / n)} w={W - 2 * t} d={D - 8} z={4} h={t} color={c} />
          ))}
          {Array.from({ length: n }, (_, i) => (
            <Box key={'b' + i} x={-W / 4} y0={(i * (H - t)) / n + t} z={4} w={W * 0.35} d={D * 0.7} h={Math.min(260, (H - t) / n - 40)} color={['#8b5e3c', '#3f6e8c', '#a33', '#e0c070'][i % 4]} />
          ))}
        </group>
      );
    }
    case 'tisch':
    case 'schreibtisch': {
      const top = 35, leg = 50;
      return (
        <group>
          <Box y0={H - top} w={W} d={D} h={top} color={c} rough={0.5} />
          {[
            [-W / 2 + leg, -D / 2 + leg],
            [W / 2 - leg, -D / 2 + leg],
            [-W / 2 + leg, D / 2 - leg],
            [W / 2 - leg, D / 2 - leg],
          ].map(([x, z], i) => (
            <Box key={i} x={x} z={z} w={leg} d={leg} h={H - top} color={f.category === 'schreibtisch' ? '#444' : dark} />
          ))}
          {f.category === 'schreibtisch' && <Box x={W / 2 - 250} z={0} y0={H - top - 400} w={420} d={D - 100} h={400} color={light} />}
        </group>
      );
    }
    case 'stuhl': {
      const seat = Math.min(470, H * 0.45);
      return (
        <group>
          <Box y0={seat - 50} w={W * 0.9} d={D * 0.85} h={50} color={c} />
          <Box z={back + 30} y0={seat} w={W * 0.85} d={40} h={H - seat} color={c} />
          {[
            [-W * 0.38, -D * 0.35],
            [W * 0.38, -D * 0.35],
            [-W * 0.38, D * 0.35],
            [W * 0.38, D * 0.35],
          ].map(([x, z], i) => (
            <Box key={i} x={x} z={z} w={30} d={30} h={seat - 50} color={dark} />
          ))}
        </group>
      );
    }
    case 'lampe': {
      const r = Math.min(W, D) / 2;
      return (
        <group>
          <Cyl r={r * 0.6} h={30} color="#333" />
          <Cyl y0={30} r={15} h={H - 330} color="#555" />
          <Cyl y0={H - 300} r={r} r2={r * 0.6} h={300} color={c} emissive={lampsOn ? '#ffe9b0' : undefined} />
          {lampsOn && <pointLight position={[0, (H - 150) * S, 0]} intensity={2.5} distance={6} decay={2} color="#ffdcae" />}
        </group>
      );
    }
    case 'tv':
      return (
        <group>
          <Box w={W} d={D} h={H} color={c} />
          <Box y0={H} z={-D / 4} w={Math.min(W * 0.9, 1450)} d={50} h={Math.min(W * 0.9, 1450) * 0.58} color="#111" rough={0.2} />
        </group>
      );
    case 'teppich':
      return <Box w={W} d={D} h={Math.max(5, H)} color={c} rough={1} />;
    case 'spiegel':
      return <Box w={W} d={D} h={H} y0={f.elevation ? 0 : 900} color="#cfd8dc" metal={0.9} rough={0.05} />;
    case 'pflanze':
      return (
        <group>
          <Cyl r={Math.min(W, D) * 0.3} r2={Math.min(W, D) * 0.35} h={H * 0.3} color="#b5651d" />
          <mesh position={[0, H * 0.65 * S, 0]} castShadow>
            <sphereGeometry args={[Math.min(W, D) * 0.5 * S, 16, 12]} />
            <meshStandardMaterial color={c} roughness={0.9} />
          </mesh>
        </group>
      );
    case 'wc':
      return (
        <group>
          <Cyl z={D * 0.12} r={W * 0.38} r2={W * 0.45} h={H} color="#ffffff" sz={1.25} rough={0.2} />
          <Box z={back + 90} w={W * 0.95} d={180} h={Math.max(H + 400, 800)} color="#f4f4f4" rough={0.3} />
        </group>
      );
    case 'waschbecken':
      return (
        <group>
          <Box y0={H - 160} w={W} d={D} h={160} color="#ffffff" rough={0.2} />
          <Box y0={H - 10} z={30} w={W * 0.7} d={D * 0.6} h={12} color="#dde3e6" rough={0.1} />
          <Box y0={H} z={back + 60} w={40} d={40} h={160} color="#c0c6ca" metal={0.8} rough={0.25} />
          <Box y0={H - 450} z={back + 120} w={W * 0.85} d={D - 140} h={300} color={c === '#ffffff' ? '#d9c7a7' : c} />
        </group>
      );
    case 'dusche':
      return (
        <group>
          <Box w={W} d={D} h={50} color="#ffffff" rough={0.3} />
          <Box y0={50} z={front - 5} w={W} d={10} h={H - 50} color="#cfe8f3" opacity={0.25} rough={0.05} />
          <Box y0={50} x={W / 2 - 5} w={10} d={D} h={H - 50} color="#cfe8f3" opacity={0.25} rough={0.05} />
          <Box y0={H - 100} z={back + 100} w={30} d={200} h={30} color="#c0c6ca" metal={0.8} rough={0.25} />
          <Cyl y0={H - 130} z={back + 200} r={100} h={20} color="#c0c6ca" />
        </group>
      );
    case 'wanne':
      return (
        <group>
          <Box w={W} d={D} h={H - 20} color="#ffffff" rough={0.3} />
          <Box y0={H - 20} w={W} d={D} h={20} color="#f6f6f6" rough={0.2} />
          <Box y0={H - 18} w={W - 140} d={D - 140} h={20} color="#d6eef8" rough={0.05} />
        </group>
      );
    case 'waschmaschine':
      return (
        <group>
          <Box w={W} d={D} h={H} color={c} rough={0.4} />
          <Cyl z={front} y0={H * 0.45} r={W * 0.28} h={10} color="#90a4ae" />
        </group>
      );
    case 'heizkoerper':
      return <Box y0={f.elevation ? 0 : 150} w={W} d={D} h={H} color={c} rough={0.4} />;
    default:
      return <Box w={W} d={D} h={H} color={c} />;
  }
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  render() {
    return this.state.err ? this.props.fallback : this.props.children;
  }
}

function GlbModel({ f }: { f: Furniture }) {
  const url = f.modelUrl!.startsWith('data:') ? f.modelUrl! : `/api/proxy?url=${encodeURIComponent(f.modelUrl!)}`;
  const gltf = useGLTF(url, '/draco/');
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const sx = (f.width * S) / (size.x || 1), sy = (f.height * S) / (size.y || 1), sz = (f.depth * S) / (size.z || 1);
    o.scale.set(sx, sy, sz);
    const c = box.getCenter(new THREE.Vector3());
    o.position.set(-c.x * sx, -box.min.y * sy, -c.z * sz);
    o.traverse((ch) => {
      if ((ch as THREE.Mesh).isMesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
      }
    });
    return o;
  }, [gltf, f.width, f.height, f.depth]);
  return <primitive object={obj} />;
}

export function FurnitureModel({ f, lampsOn }: { f: Furniture; lampsOn?: boolean }) {
  const fallback = <ParametricFurniture f={f} lampsOn={lampsOn} />;
  if (!f.modelUrl) return fallback;
  return (
    <Boundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <GlbModel f={f} />
      </Suspense>
    </Boundary>
  );
}
