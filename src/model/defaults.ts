import type {
  ElecKind, Furniture, FurnitureCategory, Level, LineKind, Material, Project, Settings, Wall, Opening,
} from './types';
import { uid } from '../geometry/vec';

export const defaultSettings = (): Settings => ({
  gridSize: 100,
  snapGrid: true,
  snapAngle: true,
  snapEndpoints: true,
  defaultWallThickness: 100,
  defaultWallType: 'neu',
  clearance: {
    schrank: 700,
    bettSeite: 600,
    bettFuss: 600,
    schreibtisch: 1000,
    wc: 700,
    waschbecken: 700,
    dusche: 700,
    tuer: 0,
    allgemein: 500,
  },
  wastePercent: 10,
  defaultHeights: { steckdose: 300, schalter: 1050, arbeitsflaeche: 1150 },
  eyeHeight: 1650,
});

export const emptyLevel = (name = 'Ebene', elevation = 0): Level => ({
  id: uid('lvl'),
  name,
  elevation,
  ceilingHeight: 2500,
  slabThickness: 250,
  walls: [],
  openings: [],
  roofWindows: [],
  stairs: [],
  rooms: [],
  furniture: [],
  electrical: [],
  lines: [],
  dimensions: [],
});

export const emptyProject = (): Project => {
  const now = new Date().toISOString();
  return {
    version: 1,
    name: 'Neues Projekt',
    createdAt: now,
    updatedAt: now,
    levels: [emptyLevel('Dachgeschoss')],
    materials: defaultMaterials(),
    cameras: [],
    assumptions: [],
    settings: defaultSettings(),
  };
};

export function newWall(a: { x: number; y: number }, b: { x: number; y: number }, s: Settings): Wall {
  return { id: uid('w'), a, b, thickness: s.defaultWallThickness, type: s.defaultWallType };
}

export function newOpening(type: Opening['type'], wallId: string, offset: number): Opening {
  if (type === 'window') return { id: uid('o'), type, wallId, offset, width: 1000, height: 1200, sill: 900, swing: 1, hinge: 'a' };
  if (type === 'passage') return { id: uid('o'), type, wallId, offset, width: 900, height: 2010, sill: 0 };
  return { id: uid('o'), type, wallId, offset, width: 885, height: 2010, sill: 0, swing: 1, hinge: 'a' };
}

export const WALL_TYPE_INFO = {
  bestand: { label: 'Bestand', fill: '#4b4f58', stroke: '#22252b' },
  neu: { label: 'Neu (Trockenbau)', fill: '#e7b416', stroke: '#8a6a00' },
  abriss: { label: 'Abriss', fill: 'rgba(220,38,38,0.15)', stroke: '#dc2626' },
} as const;

export const CATEGORY_INFO: Record<FurnitureCategory, { label: string; color: string; w: number; d: number; h: number }> = {
  bett: { label: 'Bett', color: '#c8b8a0', w: 1600, d: 2000, h: 450 },
  sofa: { label: 'Sofa', color: '#6b7a8f', w: 2000, d: 900, h: 850 },
  sessel: { label: 'Sessel', color: '#7a6b8f', w: 800, d: 800, h: 900 },
  schrank: { label: 'Schrank', color: '#e8e4dc', w: 1000, d: 600, h: 2000 },
  regal: { label: 'Regal', color: '#d9c7a7', w: 800, d: 300, h: 2000 },
  tisch: { label: 'Tisch', color: '#b08d64', w: 1400, d: 800, h: 750 },
  stuhl: { label: 'Stuhl', color: '#8d6e4f', w: 450, d: 500, h: 900 },
  kommode: { label: 'Kommode', color: '#e2d6c2', w: 800, d: 450, h: 800 },
  schreibtisch: { label: 'Schreibtisch', color: '#c9a77c', w: 1400, d: 700, h: 740 },
  lampe: { label: 'Lampe', color: '#f2e2b0', w: 400, d: 400, h: 1600 },
  tv: { label: 'TV/Lowboard', color: '#333333', w: 1600, d: 400, h: 500 },
  teppich: { label: 'Teppich', color: '#a3826c', w: 1600, d: 2300, h: 10 },
  spiegel: { label: 'Spiegel', color: '#c6d4dc', w: 600, d: 30, h: 800 },
  pflanze: { label: 'Pflanze', color: '#4f8a4a', w: 500, d: 500, h: 1200 },
  wc: { label: 'WC', color: '#ffffff', w: 380, d: 560, h: 400 },
  waschbecken: { label: 'Waschbecken', color: '#ffffff', w: 600, d: 470, h: 850 },
  dusche: { label: 'Dusche', color: '#dfe9ef', w: 900, d: 900, h: 2000 },
  wanne: { label: 'Badewanne', color: '#ffffff', w: 1700, d: 750, h: 600 },
  waschmaschine: { label: 'Waschmaschine', color: '#f4f4f4', w: 600, d: 600, h: 850 },
  heizkoerper: { label: 'Heizkörper', color: '#f0f0f0', w: 800, d: 100, h: 600 },
  sonstiges: { label: 'Sonstiges', color: '#9aa5b1', w: 600, d: 600, h: 600 },
};

export function newFurniture(category: FurnitureCategory, x: number, y: number, extra: Partial<Furniture> = {}): Furniture {
  const info = CATEGORY_INFO[category];
  const f: Furniture = {
    id: uid('f'),
    name: info.label,
    category,
    x,
    y,
    elevation: 0,
    rotation: 0,
    width: info.w,
    depth: info.d,
    height: info.h,
    color: info.color,
    ...extra,
  };
  if (category === 'schrank' && f.doors == null) {
    f.doors = Math.max(1, Math.round(f.width / 500));
    f.doorType = f.doorType ?? 'hinged';
  }
  if (!f.connections) f.connections = defaultConnections(category, f);
  return f;
}

export function defaultConnections(cat: FurnitureCategory, f: Pick<Furniture, 'width' | 'depth'>): Furniture['connections'] {
  const back = -f.depth / 2;
  switch (cat) {
    case 'wc':
      return [
        { kind: 'abwasser', x: 0, y: back, z: 230 },
        { kind: 'wasser_kalt', x: 120, y: back, z: 1000 },
      ];
    case 'waschbecken':
      return [
        { kind: 'abwasser', x: 0, y: back, z: 550 },
        { kind: 'wasser_kalt', x: -80, y: back, z: 550 },
        { kind: 'wasser_warm', x: 80, y: back, z: 550 },
      ];
    case 'dusche':
      return [
        { kind: 'abwasser', x: 0, y: 0, z: 0 },
        { kind: 'wasser_kalt', x: -80, y: back, z: 1100 },
        { kind: 'wasser_warm', x: 80, y: back, z: 1100 },
      ];
    case 'wanne':
      return [
        { kind: 'abwasser', x: -f.width / 2 + 200, y: 0, z: 0 },
        { kind: 'wasser_kalt', x: -f.width / 2 + 100, y: back, z: 700 },
        { kind: 'wasser_warm', x: -f.width / 2 + 200, y: back, z: 700 },
      ];
    case 'waschmaschine':
      return [
        { kind: 'abwasser', x: 150, y: back, z: 600 },
        { kind: 'wasser_kalt', x: -150, y: back, z: 1100 },
        { kind: 'strom', x: 0, y: back, z: 1100 },
      ];
    case 'heizkoerper':
      return [
        { kind: 'heizung', x: -f.width / 2 + 50, y: 0, z: 70 },
        { kind: 'heizung', x: f.width / 2 - 50, y: 0, z: 70 },
      ];
    default:
      return [];
  }
}

export const ELEC_INFO: Record<ElecKind, { label: string; heightKey?: 'steckdose' | 'schalter'; defaultHeight: number; ceiling?: boolean }> = {
  steckdose1: { label: 'Steckdose 1-fach', heightKey: 'steckdose', defaultHeight: 300 },
  steckdose2: { label: 'Steckdose 2-fach', heightKey: 'steckdose', defaultHeight: 300 },
  steckdose3: { label: 'Steckdose 3-fach', heightKey: 'steckdose', defaultHeight: 300 },
  schalter: { label: 'Schalter', heightKey: 'schalter', defaultHeight: 1050 },
  serienschalter: { label: 'Serienschalter', heightKey: 'schalter', defaultHeight: 1050 },
  wechselschalter: { label: 'Wechselschalter', heightKey: 'schalter', defaultHeight: 1050 },
  lampe: { label: 'Lampenauslass Decke', defaultHeight: 2400, ceiling: true },
  wandlampe: { label: 'Wandauslass Lampe', defaultHeight: 1800 },
  lan: { label: 'LAN-Dose', heightKey: 'steckdose', defaultHeight: 300 },
  antenne: { label: 'Antennendose', heightKey: 'steckdose', defaultHeight: 300 },
  starkstrom: { label: 'Starkstrom (400 V)', heightKey: 'steckdose', defaultHeight: 300 },
  smarthome: { label: 'Smart-Home-Gerät', defaultHeight: 1500 },
  rauchmelder: { label: 'Rauchmelder', defaultHeight: 2400, ceiling: true },
  verteiler: { label: 'Unterverteilung', defaultHeight: 1400 },
};

export const LINE_INFO: Record<LineKind, { label: string; color: string; layer: 'strom' | 'wasser' | 'abwasser' | 'heizung' | 'lan' }> = {
  strom: { label: 'Strom', color: '#e11d48', layer: 'strom' },
  wasser_kalt: { label: 'Wasser kalt', color: '#2563eb', layer: 'wasser' },
  wasser_warm: { label: 'Wasser warm', color: '#f97316', layer: 'wasser' },
  abwasser: { label: 'Abwasser', color: '#78716c', layer: 'abwasser' },
  heizung: { label: 'Heizung', color: '#b91c1c', layer: 'heizung' },
  lan: { label: 'LAN', color: '#16a34a', layer: 'lan' },
};

export function defaultMaterials(): Material[] {
  return [
    { id: 'mat_vinyl_eiche', kind: 'floor', name: 'Vinyl Eiche natur (Beispiel)', color: '#c9a678', tileLength: 1220, tileWidth: 180, joint: 0, packageArea: 2196000 },
    { id: 'mat_fliese_grau', kind: 'tile', name: 'Fliese grau 60×30 (Beispiel)', color: '#b8b8b4', tileLength: 600, tileWidth: 300, joint: 3, packageArea: 1440000 },
    { id: 'mat_fliese_weiss', kind: 'tile', name: 'Wandfliese weiß 30×60 (Beispiel)', color: '#f2f2ef', tileLength: 600, tileWidth: 300, joint: 2, packageArea: 1440000 },
    { id: 'mat_tapete_vlies', kind: 'wallpaper', name: 'Vliestapete (Beispiel)', color: '#e9e2d4', rollWidth: 530, rollLength: 10050, repeat: 640, repeatOffset: false },
    { id: 'mat_farbe_weiss', kind: 'paint', name: 'Wandfarbe weiß', color: '#f7f7f4', coverage: 7, containerLiters: 10 },
  ];
}
