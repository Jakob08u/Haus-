import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PointerLockControls, Html, Line } from '@react-three/drei';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { useStore, useLevel } from '../store/store';
import { derive } from '../store/derived';
import type { Level, Project, Furniture, Vec2 } from '../model/types';
import { buildWallGeometries, ceilingGeometries, floorGeometry, S, V3 } from './buildGeometry';
import { FurnitureModel } from './Furniture3D';
import { finishLook, floorLook } from './textures';
import { openingGeom, doorSwing, roofWindowCorners3D, stairSteps } from '../geometry/openings';
import { stairPolygon } from '../geometry/rooms';
import { add, bbox, dist, mul, norm, perp, pointInPolygon, rotate, sub, uid, fmtCm } from '../geometry/vec';
import { LINE_INFO } from '../model/defaults';
import { checkLevelCached } from '../checks/checks';
import { verticalZones, horizontalZonesAt, isWorktopRoom } from '../checks/zones';

RectAreaLightUniformsLib.init();

const WALL_DEFAULT = '#f2efe9';

export default function View3D() {
  const project = useStore((s) => s.project);
  const level = useLevel();
  const v3 = useStore((s) => s.view3d);
  const tool = useStore((s) => s.tool);
  const measure = useStore((s) => s.measure);
  const [cut, setCut] = useState<number | null>(null);
  const [, force] = useState(0);
  const st = useStore.getState;
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const camRef = useRef<{ cam: THREE.Camera; target: THREE.Vector3 } | null>(null);

  useEffect(() => {
    const h = () => force((x) => x + 1);
    window.addEventListener('tex-update', h);
    return () => window.removeEventListener('tex-update', h);
  }, []);

  const levels = v3.allLevels ? project.levels : [level];

  const saveView = () => {
    const c = camRef.current;
    if (!c) return;
    const name = prompt('Name der Ansicht:', `Ansicht ${project.cameras.length + 1}`);
    if (!name) return;
    st().update((d) =>
      void d.cameras.push({
        id: uid('cam'),
        name,
        position: [c.cam.position.x, c.cam.position.y, c.cam.position.z],
        target: [c.target.x, c.target.y, c.target.z],
        levelId: level.id,
        mode: v3.mode,
      }),
    );
  };

  const snapshot = () => {
    const gl = glRef.current;
    if (!gl) return;
    const a = document.createElement('a');
    a.href = gl.domElement.toDataURL('image/png');
    a.download = `${project.name}-${level.name}-3D.png`;
    a.click();
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#dfe6ee' }}>
      <Canvas
        shadows
        frameloop={v3.mode === 'walk' ? 'always' : 'demand'}
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true, localClippingEnabled: true } as any}
        camera={{ fov: 55, near: 0.05, far: 300, position: [5, 12, 18] }}
        onCreated={({ gl }) => {
          glRef.current = gl;
          gl.localClippingEnabled = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          (window as any).__raumplanerGL = gl;
        }}
        onPointerMissed={() => {
          if (st().tool === 'select') st().select(null);
        }}
      >
        <color attach="background" args={['#dfe6ee']} />
        <Lights level={level} sun={v3.sun} />
        {levels.map((l) => (
          <LevelScene key={l.id} level={l} project={project} active={l.id === level.id} showCeiling={v3.showCeiling && cut == null} cut={cut} lampsOn={v3.lampsOn} closedRoof={v3.showRoof} />
        ))}
        <GroundPlane level={level} />
        <Controls level={level} camRef={camRef} />
        {measure.space === '3d' && measure.points.length > 0 && <Measure3D points={measure.points} />}
      </Canvas>
      <div className="overlay-ctrl">
        <button className={v3.mode === 'orbit' ? 'active' : ''} onClick={() => st().setView3d({ mode: 'orbit' })} title="Umkreisen mit Maus">Orbit</button>
        <button className={v3.mode === 'walk' ? 'active' : ''} onClick={() => st().setView3d({ mode: 'walk' })} title="Durchlaufen: Klick ins Bild, dann WASD + Maus, Esc beendet">Begehen</button>
        <button className={v3.showCeiling ? 'active' : ''} onClick={() => st().setView3d({ showCeiling: !v3.showCeiling })} title="Decken und Schrägen ein-/ausblenden (von oben durchsichtig)">Decke/Schrägen</button>
        <button className={v3.showRoof ? 'active' : ''} onClick={() => st().setView3d({ showRoof: !v3.showRoof, showCeiling: true })} title="Decken auch von außen sichtbar (geschlossener Baukörper)">Geschlossen</button>
        <select value={cut == null ? '' : String(cut)} onChange={(e) => setCut(e.target.value ? Number(e.target.value) : null)} title="Wände kürzen für Draufsicht">
          <option value="">Wände voll</option>
          <option value="1200">Schnitt 1,20 m</option>
          <option value="1600">Schnitt 1,60 m</option>
          <option value="2000">Schnitt 2,00 m</option>
        </select>
        <button className={v3.allLevels ? 'active' : ''} onClick={() => st().setView3d({ allLevels: !v3.allLevels })}>Alle Ebenen</button>
        <button className={v3.lampsOn ? 'active' : ''} onClick={() => st().setView3d({ lampsOn: !v3.lampsOn })}>Lampen</button>
        <label style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 6, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
          ☀ <input type="range" min={0} max={1} step={0.05} value={v3.sun} onChange={(e) => st().setView3d({ sun: Number(e.target.value) })} style={{ width: 70 }} />
        </label>
        <button className={tool === 'measure' ? 'active' : ''} onClick={() => {
          st().setTool(tool === 'measure' ? 'select' : 'measure');
          st().setMeasure({ points: [], space: '3d' });
        }}>📏 Messen</button>
      </div>
      <div className="overlay-ctrl right">
        <button onClick={saveView} title="Kameraposition speichern (für Export)">📷 Ansicht speichern</button>
        <button onClick={snapshot}>⬇ Bild</button>
      </div>
      {project.cameras.filter((c) => c.levelId === level.id).length > 0 && (
        <div style={{ position: 'absolute', top: 40, right: 8, display: 'flex', flexDirection: 'column', gap: 3, zIndex: 5 }}>
          {project.cameras
            .filter((c) => c.levelId === level.id)
            .map((c) => (
              <button key={c.id} onClick={() => st().requestCamera({ position: c.position, target: c.target, mode: c.mode })} style={{ background: 'rgba(255,255,255,0.92)' }}>
                {c.name}
              </button>
            ))}
        </div>
      )}
      <div className="hud">
        {v3.mode === 'walk' ? 'Begehen: ins Bild klicken · W/A/S/D laufen · Maus schauen · Shift schneller · Esc beenden' : 'Linke Maus drehen · Rechte Maus verschieben · Rad zoomen · Möbel anklicken und ziehen'}
        {tool === 'measure' && ` · Messen: Punkte auf Flächen anklicken (${measure.points.length})`}
      </div>
    </div>
  );
}

function Lights({ level, sun }: { level: Level; sun: number }) {
  const D = derive(level);
  const pts = [...D.footprints.values()].flatMap((f) => f.polygon);
  const bb = pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 10000, maxY: 10000, w: 10000, h: 10000 };
  const cx = (bb.minX + bb.w / 2) * S, cz = (bb.minY + bb.h / 2) * S;
  const R = Math.max(bb.w, bb.h) * S * 0.75 + 2;
  const y0 = level.elevation * S;
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    l.target.position.set(cx, y0, cz);
    l.target.updateMatrixWorld();
    const c = l.shadow.camera;
    c.left = -R;
    c.right = R;
    c.top = R;
    c.bottom = -R;
    c.near = 0.5;
    c.far = 80;
    c.updateProjectionMatrix();
  }, [cx, cz, R, y0]);
  return (
    <>
      <hemisphereLight args={['#eef4ff', '#c9bba8', 0.6 + 0.8 * sun]} />
      <ambientLight intensity={0.25 + 0.25 * sun} />
      <directionalLight
        ref={ref}
        position={[cx - 14, y0 + 18, cz + 10]}
        intensity={0.4 + 2.6 * sun}
        color="#fff4e0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0008}
        shadow-normalBias={0.05}
      />
    </>
  );
}

function GroundPlane({ level }: { level: Level }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, level.elevation * S - 0.02, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color="#cfd6cf" roughness={1} />
    </mesh>
  );
}

function useClip(level: Level, cut: number | null) {
  return useMemo(() => (cut == null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), (level.elevation + cut) * S)]), [cut, level.elevation]);
}

function LevelScene({ level, project, active, showCeiling, cut, lampsOn, closedRoof }: { level: Level; project: Project; active: boolean; showCeiling: boolean; cut: number | null; lampsOn: boolean; closedRoof: boolean }) {
  const D = derive(level);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const layers = useStore((s) => s.layers);
  const st = useStore.getState;
  const clip = useClip(level, cut);
  const onTex = useCallback(() => window.dispatchEvent(new Event('tex-update')), []);
  const wallGeoms = useMemo(() => buildWallGeometries(level, D), [level.walls, level.openings, D]);
  const warnings = useMemo(() => checkLevelCached(level, project), [level, project]);
  const warnIds = useMemo(() => new Set(warnings.filter((w) => w.severity === 'error').flatMap((w) => w.refs.map((r) => r.id))), [warnings]);

  const measureClick = (e: ThreeEvent<MouseEvent>) => {
    if (st().tool !== 'measure') return false;
    e.stopPropagation();
    const p = e.point;
    const m = st().measure;
    const pts = m.space === '3d' ? m.points : [];
    st().setMeasure({ points: [...pts, { x: p.x / S, y: p.z / S, z: p.y / S }], space: '3d' });
    return true;
  };

  const roomFloors = useMemo(
    () =>
      D.rooms.map((r) => {
        const fl = r.meta?.floor;
        return { r, geom: floorGeometry(r.net, fl?.rotation ?? 0), look: floorLook(fl?.materialId, fl?.pattern ?? 'third', project, fl?.color, onTex) };
      }),
    [D, project.materials, onTex],
  );
  const ceilings = useMemo(() => D.rooms.map((r) => ({ r, parts: ceilingGeometries(level, D, r.clear) })), [D, level.roofWindows]);

  return (
    <group position={[0, level.elevation * S, 0]}>
      {/* Wände */}
      {wallGeoms.map((wg, i) => {
        const w = level.walls.find((x) => x.id === wg.wallId)!;
        const fin = wg.side === 1 ? w.finishes?.left : wg.side === -1 ? w.finishes?.right : undefined;
        const look = finishLook(fin, project, WALL_DEFAULT, onTex);
        const sel = selection?.kind === 'wall' && selection.id === w.id;
        return (
          <WallMesh
            key={wg.wallId + i}
            geometry={wg.geometry}
            look={look}
            selected={sel}
            neu={w.type === 'neu'}
            clip={clip}
            tileMax={fin?.kind === 'tile' ? fin.maxHeight : undefined}
            elevation={level.elevation}
            onClick={(e) => {
              if (!active || measureClick(e)) return;
              e.stopPropagation();
              st().select({ kind: 'wall', id: w.id });
            }}
          />
        );
      })}
      {/* Böden */}
      {roomFloors.map(({ r, geom, look }) => (
        <mesh key={'f' + r.key} geometry={geom} receiveShadow onClick={(e) => {
          if (!active || measureClick(e)) return;
          if (r.meta && st().tool === 'select') {
            e.stopPropagation();
            st().select({ kind: 'room', id: r.meta.id });
          }
        }}>
          <meshStandardMaterial color={look.color} map={look.map ?? null} roughness={look.roughness} />
        </mesh>
      ))}
      {/* Decken + Schrägen */}
      {showCeiling &&
        ceilings.map(({ r, parts }) =>
          parts.map((p) => {
            const wallId = p.key.startsWith('slope:') ? p.key.slice(6) : null;
            const w = wallId ? level.walls.find((x) => x.id === wallId) : null;
            const look = w?.finishes?.slope ? finishLook(w.finishes.slope, project, r.meta?.ceilingColor ?? '#fbfaf7', onTex) : { color: r.meta?.ceilingColor ?? '#fbfaf7', roughness: 0.95 };
            return (
              <mesh key={r.key + p.key} geometry={p.geometry} castShadow receiveShadow onClick={(e) => active && measureClick(e)}>
                <meshStandardMaterial color={look.color} map={look.map ?? null} roughness={look.roughness} side={closedRoof ? THREE.DoubleSide : THREE.FrontSide} shadowSide={THREE.DoubleSide} />
              </mesh>
            );
          }),
        )}
      {/* Treppen */}
      {level.stairs.map((s) => (
        <Stair3D key={s.id} level={level} stairId={s.id} selected={selection?.kind === 'stair' && selection.id === s.id} onSelect={() => active && st().select({ kind: 'stair', id: s.id })} />
      ))}
      {/* Öffnungen */}
      <Openings3D level={level} />
      {/* Dachfenster */}
      {level.roofWindows.map((rw) => {
        const w = level.walls.find((x) => x.id === rw.wallId);
        const pl = D.ceiling.planes.find((p) => p.wallId === rw.wallId);
        if (!w || !pl) return null;
        const c = roofWindowCorners3D(rw, pl, w).map((p) => V3(p.x, p.y, p.z));
        const geom = new THREE.BufferGeometry().setFromPoints([c[0], c[1], c[2], c[0], c[2], c[3]]);
        geom.computeVertexNormals();
        const center = c.reduce((a, b) => a.clone().add(b), new THREE.Vector3()).multiplyScalar(0.25);
        const inn = mul(perp(norm(sub(w.b, w.a))), pl.side);
        const sel = selection?.kind === 'roofWindow' && selection.id === rw.id;
        return (
          <group key={rw.id}>
            <mesh geometry={geom} onClick={(e) => { if (!active || measureClick(e)) return; e.stopPropagation(); st().select({ kind: 'roofWindow', id: rw.id }); }}>
              <meshStandardMaterial color={sel ? '#60a5fa' : '#bfe3f5'} transparent opacity={0.35} side={THREE.DoubleSide} roughness={0.05} />
            </mesh>
            <Line points={[c[0], c[1], c[2], c[3], c[0]]} color="#5b4636" lineWidth={3} />
            <rectAreaLight
              position={[center.x + inn.x * 0.05 * S * 1000 * 0, center.y - 0.05, center.z]}
              width={(rw.width * S) * 0.9}
              height={(rw.length * S) * 0.9}
              intensity={2.5}
              color="#fff6e6"
              rotation={[-Math.PI / 2, 0, 0]}
            />
          </group>
        );
      })}
      {/* Möbel */}
      {layers.moebel &&
        level.furniture.map((f) => (
          <Furniture3DItem key={f.id} f={f} level={level} active={active} selected={selection?.kind === 'furniture' && selection.id === f.id} warn={warnIds.has(f.id)} lampsOn={lampsOn} measureClick={measureClick} />
        ))}
      {/* Elektro */}
      {layers.elektro &&
        level.electrical.map((e) => {
          const ceiling = e.kind === 'lampe' || e.kind === 'rauchmelder';
          const sel = selection?.kind === 'elec' && selection.id === e.id;
          const n = rotate({ x: 0, y: 1 }, e.rotation ?? 0);
          const pos = ceiling ? V3(e.x, e.y, e.height - 30) : V3(e.x + n.x * 8, e.y + n.y * 8, e.height);
          const size = e.kind.startsWith('steckdose') ? [80 * (e.kind === 'steckdose3' ? 3 : e.kind === 'steckdose2' ? 2 : 1), 80] : [80, 80];
          return (
            <group key={e.id} position={pos} rotation={[0, -((e.rotation ?? 0) * Math.PI) / 180, 0]}>
              <mesh onClick={(ev) => { if (!active || measureClick(ev)) return; ev.stopPropagation(); st().select({ kind: 'elec', id: e.id }); }}>
                <boxGeometry args={ceiling ? [0.12, 0.05, 0.12] : [size[0] * S, size[1] * S, 0.016]} />
                <meshStandardMaterial color={sel ? '#2563eb' : e.kind === 'starkstrom' ? '#ef4444' : e.kind === 'lan' ? '#16a34a' : '#fafafa'} emissive={e.kind === 'lampe' && lampsOn ? '#fff1c4' : '#000'} emissiveIntensity={e.kind === 'lampe' && lampsOn ? 1.5 : 0} />
              </mesh>
              {e.kind === 'lampe' && lampsOn && <pointLight position={[0, -0.25, 0]} intensity={3} distance={7} decay={2} color="#ffe2b8" castShadow={false} />}
            </group>
          );
        })}
      {/* Leitungen */}
      {level.lines.map((ln) => {
        const info = LINE_INFO[ln.kind];
        if (!layers[info.layer]) return null;
        const sel = selection?.kind === 'line' && selection.id === ln.id;
        return (
          <Line
            key={ln.id}
            points={ln.points.map((p) => V3(p.x, p.y, Math.max(5, p.z)))}
            color={info.color}
            lineWidth={sel ? 6 : 3.5}
            onClick={(e) => { if (!active) return; (e as any).stopPropagation?.(); st().select({ kind: 'line', id: ln.id }); }}
          />
        );
      })}
      {/* Installationszonen */}
      {layers.zonen && active && <Zones3D level={level} />}
    </group>
  );
}

function WallMesh({ geometry, look, selected, neu, clip, onClick, tileMax, elevation }: { geometry: THREE.BufferGeometry; look: { color: string; map?: THREE.Texture; roughness: number }; selected: boolean; neu: boolean; clip: THREE.Plane[]; onClick: (e: ThreeEvent<MouseEvent>) => void; tileMax?: number; elevation: number }) {
  const planes = useMemo(() => {
    if (!tileMax) return null;
    const c = (elevation + tileMax) * S;
    return { below: [...clip, new THREE.Plane(new THREE.Vector3(0, -1, 0), c)], above: [...clip, new THREE.Plane(new THREE.Vector3(0, 1, 0), -c)] };
  }, [tileMax, elevation, clip]);
  const mat = (l: { color: string; map?: THREE.Texture; roughness: number }, cp: THREE.Plane[]) => (
    <meshStandardMaterial
      color={selected ? '#93c5fd' : l.color}
      map={l.map ?? null}
      roughness={l.roughness}
      side={THREE.DoubleSide}
      clippingPlanes={cp}
      clipShadows
      emissive={neu && !l.map ? '#3a2a00' : '#000'}
      emissiveIntensity={neu ? 0.04 : 0}
    />
  );
  if (planes) {
    return (
      <group>
        <mesh geometry={geometry} castShadow receiveShadow onClick={onClick}>{mat(look, planes.below)}</mesh>
        <mesh geometry={geometry} castShadow receiveShadow onClick={onClick}>{mat({ color: WALL_DEFAULT, roughness: 0.9 }, planes.above)}</mesh>
      </group>
    );
  }
  return (
    <mesh geometry={geometry} castShadow receiveShadow onClick={onClick}>
      {mat(look, clip)}
    </mesh>
  );
}

function Openings3D({ level }: { level: Level }) {
  const items = useMemo(() => {
    return level.openings.map((o) => {
      const w = level.walls.find((x) => x.id === o.wallId);
      if (!w) return null;
      const g = openingGeom(w, o);
      const ang = Math.atan2(g.d.y, g.d.x);
      const mid = mul(add(g.p0, g.p1), 0.5);
      if (o.type === 'window') {
        return (
          <group key={o.id} position={V3(mid.x, mid.y, o.sill + o.height / 2)} rotation={[0, -ang, 0]}>
            <mesh>
              <boxGeometry args={[o.width * S, o.height * S, 0.02]} />
              <meshStandardMaterial color="#cbe7f5" transparent opacity={0.28} roughness={0.05} />
            </mesh>
            {[
              [0, (o.height / 2 - 35) * S, o.width * S, 0.07],
              [0, -(o.height / 2 - 35) * S, o.width * S, 0.07],
              [(o.width / 2 - 35) * S, 0, 0.07, o.height * S],
              [-(o.width / 2 - 35) * S, 0, 0.07, o.height * S],
            ].map(([x, y, ww, hh], i) => (
              <mesh key={i} position={[x as number, y as number, 0]} castShadow>
                <boxGeometry args={[ww as number, hh as number, 0.07]} />
                <meshStandardMaterial color="#f5f5f5" roughness={0.5} />
              </mesh>
            ))}
            <rectAreaLight width={o.width * S * 0.9} height={o.height * S * 0.9} intensity={1.6} color="#fff4e2" position={[0, 0, ((o.swing ?? 1) === 1 ? -1 : 1) * 0]} rotation={[0, (o.swing ?? 1) === 1 ? Math.PI : 0, 0]} />
          </group>
        );
      }
      if (o.type === 'door') {
        const ds = doorSwing(w, o);
        const leafDir = norm(sub(ds.open, ds.hinge));
        const la = Math.atan2(leafDir.y, leafDir.x);
        const c = add(ds.hinge, mul(leafDir, o.width / 2));
        return (
          <group key={o.id}>
            <mesh position={V3(c.x, c.y, o.height / 2)} rotation={[0, -la, 0]} castShadow>
              <boxGeometry args={[o.width * S - 0.02, o.height * S - 0.01, 0.04]} />
              <meshStandardMaterial color="#f7f5f0" roughness={0.6} />
            </mesh>
          </group>
        );
      }
      return null;
    });
  }, [level.openings, level.walls]);
  return <>{items}</>;
}

function Stair3D({ level, stairId, selected, onSelect }: { level: Level; stairId: string; selected: boolean; onSelect: () => void }) {
  const s = level.stairs.find((x) => x.id === stairId)!;
  const H = level.elevation > 0 ? level.elevation : 2750;
  const steps = stairSteps(s);
  const n = steps.length;
  const rise = H / s.steps;
  const dirSign = s.direction === 'up' ? 1 : -1;
  const color = selected ? '#93c5fd' : '#b08d64';
  const poly = stairPolygon(s);
  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      {steps.map((st) => {
        // Index entlang Laufrichtung: aufwärts zur Ebene hin (Treppenloch: von unten kommend)
        const k = dirSign > 0 ? st.index : n - 1 - st.index;
        const topZ = s.isOpening ? -H + rise * (k + 1) : rise * (k + 1);
        const c = st.poly.reduce((a, b) => add(a, b), { x: 0, y: 0 });
        const cc = mul(c, 1 / 4);
        const len = dist(st.poly[0], st.poly[1]);
        return (
          <mesh key={st.index} position={V3(cc.x, cc.y, topZ - 25)} rotation={[0, (-s.rotation * Math.PI) / 180, 0]} castShadow receiveShadow>
            <boxGeometry args={[len * S, 0.05, s.width * S]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
        );
      })}
      {/* Geländer */}
      {(['left', 'right'] as const).map((side) => {
        if (!s.railing[side]) return null;
        const a = side === 'left' ? poly[0] : poly[3], b = side === 'left' ? poly[1] : poly[2];
        return <Line key={side} points={[V3(a.x, a.y, 950), V3(b.x, b.y, 950)]} color="#444" lineWidth={4} />;
      })}
      {(['left', 'right'] as const).map((side) => {
        if (!s.railing[side]) return null;
        const a = side === 'left' ? poly[0] : poly[3], b = side === 'left' ? poly[1] : poly[2];
        const L = dist(a, b);
        const N = Math.max(2, Math.round(L / 120));
        return (
          <group key={side + 'p'}>
            {Array.from({ length: N + 1 }, (_, i) => {
              const p = add(a, mul(sub(b, a), i / N));
              return (
                <mesh key={i} position={V3(p.x, p.y, 475)}>
                  <boxGeometry args={[0.02, 0.95, 0.02]} />
                  <meshStandardMaterial color="#555" />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

function Furniture3DItem({ f, level, active, selected, warn, lampsOn, measureClick }: { f: Furniture; level: Level; active: boolean; selected: boolean; warn: boolean; lampsOn: boolean; measureClick: (e: ThreeEvent<MouseEvent>) => boolean }) {
  const st = useStore.getState;
  const { controls, camera, gl } = useThree() as any;
  const dragging = useRef<{ off: Vec2 } | null>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -level.elevation * S), [level.elevation]);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const toFloor = (e: PointerEvent) => {
    const r = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, hit) ? { x: hit.x / S, y: hit.z / S } : null;
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const p = toFloor(e);
      if (!p) return;
      st().updateLevel((l) => {
        const ff = l.furniture.find((x) => x.id === f.id);
        if (ff) {
          ff.x = Math.round((p.x - dragging.current!.off.x) / 10) * 10;
          ff.y = Math.round((p.y - dragging.current!.off.y) / 10) * 10;
        }
      });
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = null;
      if (controls) controls.enabled = true;
      st().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });
  return (
    <group
      position={V3(f.x, f.y, f.elevation)}
      rotation={[0, (-f.rotation * Math.PI) / 180, 0]}
      onClick={(e) => {
        if (!active) return;
        if (measureClick(e)) return;
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (!active || st().tool !== 'select' || st().view3d.mode === 'walk') return;
        e.stopPropagation();
        st().select({ kind: 'furniture', id: f.id });
        const p = toFloor(e.nativeEvent);
        if (!p) return;
        dragging.current = { off: { x: p.x - f.x, y: p.y - f.y } };
        if (controls) controls.enabled = false;
        st().beginGesture();
      }}
    >
      <FurnitureModel f={f} lampsOn={lampsOn} />
      {(selected || warn) && (
        <lineSegments position={[0, (f.height * S) / 2, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(f.width * S + 0.02, f.height * S + 0.02, f.depth * S + 0.02)]} />
          <lineBasicMaterial color={selected ? '#2563eb' : '#dc2626'} />
        </lineSegments>
      )}
    </group>
  );
}

function Zones3D({ level }: { level: Level }) {
  const D = derive(level);
  const meshes = useMemo(() => {
    const res: { pos: THREE.Vector3; rotY: number; w: number; h: number }[] = [];
    for (const w of D.wallsPlanned) {
      const d = norm(sub(w.b, w.a));
      const n = perp(d);
      const ang = Math.atan2(d.y, d.x);
      for (const side of [1, -1] as const) {
        const vz = verticalZones(level, w, side, D.wallsPlanned, D.footprints.get(w.id));
        const off = mul(n, side * (w.thickness / 2 + 3));
        const mid = add(add(w.a, mul(d, (vz.sStart + vz.sEnd) / 2)), off);
        const probe = add(mid, mul(n, side * 200));
        const ch = D.ceiling.heightAt(probe);
        const worktop = isWorktopRoom(D.rooms, probe);
        for (const [a, b] of horizontalZonesAt(ch, worktop)) {
          res.push({ pos: V3(mid.x, mid.y, (a + b) / 2), rotY: -ang, w: vz.sEnd - vz.sStart, h: b - a });
        }
        for (const [a, b] of vz.vertical) {
          const c = add(add(w.a, mul(d, (a + b) / 2)), off);
          const hh = D.ceiling.heightAt(add(c, mul(n, side * 50)));
          res.push({ pos: V3(c.x, c.y, hh / 2), rotY: -ang, w: b - a, h: hh });
        }
      }
    }
    return res;
  }, [D, level]);
  return (
    <>
      {meshes.map((m, i) => (
        <mesh key={i} position={m.pos} rotation={[0, m.rotY, 0]}>
          <planeGeometry args={[m.w * S, m.h * S]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

function Measure3D({ points }: { points: { x: number; y: number; z: number }[] }) {
  const pts = points.map((p) => V3(p.x, p.y, p.z));
  return (
    <group>
      {pts.length > 1 && <Line points={pts} color="#e11d48" lineWidth={3} depthTest={false} />}
      {pts.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.025, 12, 8]} />
          <meshBasicMaterial color="#e11d48" depthTest={false} />
        </mesh>
      ))}
      {points.slice(1).map((p, i) => {
        const a = points[i];
        const d = Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
        const m = V3((a.x + p.x) / 2, (a.y + p.y) / 2, (a.z + p.z) / 2);
        return (
          <Html key={i} position={m} center style={{ pointerEvents: 'none' }}>
            <div style={{ background: '#e11d48', color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtCm(d)} cm</div>
          </Html>
        );
      })}
    </group>
  );
}

function Controls({ level, camRef }: { level: Level; camRef: React.MutableRefObject<{ cam: THREE.Camera; target: THREE.Vector3 } | null> }) {
  const mode = useStore((s) => s.view3d.mode);
  const req = useStore((s) => s.cameraRequest);
  const eye = useStore((s) => s.project.settings.eyeHeight);
  const { camera } = useThree();
  const orbit = useRef<any>(null);
  const D = derive(level);
  const pts = [...D.footprints.values()].flatMap((f) => f.polygon);
  const bb = pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 8000, maxY: 8000, w: 8000, h: 8000 };
  const center = new THREE.Vector3((bb.minX + bb.w / 2) * S, level.elevation * S, (bb.minY + bb.h / 2) * S);
  const fitted = useRef('');

  useEffect(() => {
    if (mode !== 'orbit' || fitted.current === level.id) return;
    fitted.current = level.id;
    const R = Math.max(bb.w, bb.h) * S;
    camera.position.set(center.x - R * 0.25, center.y + R * 0.95, center.z + R * 0.75);
    orbit.current?.target.copy(center);
    orbit.current?.update();
  }, [level.id, mode]);

  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!req) return;
    useStore.getState().setView3d({ mode: req.mode });
    camera.position.set(...req.position);
    if (req.mode === 'orbit') {
      setTimeout(() => {
        orbit.current?.target.set(...req.target);
        orbit.current?.update();
        invalidate();
      }, 30);
    } else camera.lookAt(new THREE.Vector3(...req.target));
    invalidate();
  }, [req?.nonce]);

  useEffect(() => {
    if (mode === 'walk') {
      // Startpunkt: Raum mit größter Fläche, Mitte, Augenhöhe
      const r = [...D.rooms].sort((a, b) => b.area - a.area)[0];
      const p = r ? r.labelPoint : { x: center.x / S, y: center.z / S };
      // Blick zum entferntesten Punkt des Raums
      let far = { x: center.x / S, y: center.z / S }, best = 0;
      for (const q of r?.clear[0]?.[0] ?? []) {
        const d = dist(q, p);
        if (d > best) {
          best = d;
          far = q;
        }
      }
      if (!req || req.mode !== 'walk') {
        camera.position.set(p.x * S, (level.elevation + eye) * S, p.y * S);
        camera.lookAt(far.x * S, (level.elevation + eye * 0.85) * S, far.y * S);
      }
    } else {
      fitted.current = '';
    }
  }, [mode]);

  useFrame(() => {
    camRef.current = { cam: camera, target: mode === 'orbit' && orbit.current ? orbit.current.target.clone() : camera.getWorldDirection(new THREE.Vector3()).add(camera.position) };
  });

  if (mode === 'walk') return <WalkControls level={level} eye={eye} />;
  return <OrbitControls ref={orbit} makeDefault target={center} maxPolarAngle={Math.PI * 0.495} enableDamping dampingFactor={0.12} />;
}

function WalkControls({ level, eye }: { level: Level; eye: number }) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const D = derive(level);
  const wallPolys = useMemo(() => [...D.footprints.values()].map((f) => f.polygon), [D]);
  useEffect(() => {
    const kd = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const ku = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);
  const blocked = (x: number, y: number) => {
    const r = 200;
    for (const poly of wallPolys)
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]])
        if (pointInPolygon({ x: x + dx, y: y + dy }, poly)) return true;
    return false;
  };
  useFrame((_, dt) => {
    const k = keys.current;
    const speed = (k.ShiftLeft || k.ShiftRight ? 3.2 : 1.5) * Math.min(dt, 0.05);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const mv = new THREE.Vector3();
    if (k.KeyW || k.ArrowUp) mv.add(fwd);
    if (k.KeyS || k.ArrowDown) mv.sub(fwd);
    if (k.KeyD || k.ArrowRight) mv.add(right);
    if (k.KeyA || k.ArrowLeft) mv.sub(right);
    if (mv.lengthSq() > 0) {
      mv.normalize().multiplyScalar(speed);
      const nx = camera.position.x + mv.x, nz = camera.position.z + mv.z;
      if (!blocked(nx / S, camera.position.z / S)) camera.position.x = nx;
      if (!blocked(camera.position.x / S, nz / S)) camera.position.z = nz;
    }
    // Kopfhöhe unter Schräge begrenzen
    const ch = D.ceiling.heightAt({ x: camera.position.x / S, y: camera.position.z / S });
    camera.position.y = (level.elevation + Math.min(eye, ch - 120)) * S;
  });
  return <PointerLockControls makeDefault />;
}
