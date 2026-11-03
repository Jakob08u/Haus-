import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { LayerKey, Level, Project, Vec2, ElecKind, LineKind, LineSurface, FurnitureCategory, OpeningType, Furniture } from '../model/types';

setAutoFreeze(false);

export type SelKind = 'wall' | 'opening' | 'roofWindow' | 'stair' | 'room' | 'furniture' | 'elec' | 'line' | 'dimension' | 'linePoint' | 'wallEnd';
export interface Selection {
  kind: SelKind;
  id: string;
  /** Zusatz (z. B. Punktindex bei Leitungen, 'a'|'b' bei Wandenden) */
  sub?: string | number;
}

export type Tool =
  | 'select' | 'wall' | 'door' | 'window' | 'passage' | 'roofWindow' | 'stair' | 'room' | 'dimension'
  | 'measure' | 'calibrate' | 'furniture' | 'elec' | 'line' | 'pan';

export type PanelKey = 'eigenschaften' | 'raeume' | 'moebel' | 'elektro' | 'material' | 'pruefen' | 'annahmen' | 'export';

export interface MeasureState {
  points: { x: number; y: number; z: number }[];
  /** 2D oder 3D */
  space: '2d' | '3d';
}

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  gesture: boolean;
  gestureStart: Project | null;
  levelId: string;
  view: '2d' | '3d' | 'split';
  tool: Tool;
  selection: Selection | null;
  layers: Record<LayerKey, boolean>;
  panel: PanelKey;
  toolOpts: {
    elecKind: ElecKind;
    lineKind: LineKind;
    lineSurface: LineSurface;
    lineHeight: number;
    furnitureCategory: FurnitureCategory;
    /** Vorlage beim Platzieren (z. B. aus Link-Import) */
    furnitureTemplate: Partial<Furniture> | null;
    openingType: OpeningType;
  };
  view3d: { mode: 'orbit' | 'walk'; showCeiling: boolean; showRoof: boolean; allLevels: boolean; sun: number; lampsOn: boolean };
  measure: MeasureState;
  status: string;
  /** Kamera-Wunsch (Laden gespeicherter Ansicht) */
  cameraRequest: { position: [number, number, number]; target: [number, number, number]; mode: 'orbit' | 'walk'; nonce: number } | null;
  cursor: Vec2 | null;

  setProject: (p: Project, keepHistory?: boolean) => void;
  update: (recipe: (draft: Project) => void) => void;
  updateLevel: (recipe: (lvl: Level, p: Project) => void, levelId?: string) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection | null) => void;
  setTool: (t: Tool) => void;
  setView: (v: State['view']) => void;
  setLevel: (id: string) => void;
  toggleLayer: (k: LayerKey, v?: boolean) => void;
  setPanel: (p: PanelKey) => void;
  setToolOpts: (o: Partial<State['toolOpts']>) => void;
  setView3d: (o: Partial<State['view3d']>) => void;
  setMeasure: (m: Partial<MeasureState>) => void;
  setStatus: (s: string) => void;
  requestCamera: (c: Omit<NonNullable<State['cameraRequest']>, 'nonce'>) => void;
  setCursor: (p: Vec2 | null) => void;
}

const HISTORY_MAX = 150;

export const defaultLayers: Record<LayerKey, boolean> = {
  grundriss: true,
  hintergrund: true,
  raster: true,
  masse: true,
  raeume: true,
  moebel: true,
  elektro: true,
  strom: true,
  wasser: true,
  abwasser: true,
  heizung: true,
  lan: true,
  zonen: false,
  schraegen: true,
  bewegung: true,
  warnungen: true,
};

export const useStore = create<State>((set, get) => ({
  project: null as unknown as Project,
  past: [],
  future: [],
  gesture: false,
  gestureStart: null,
  levelId: '',
  view: '2d',
  tool: 'select',
  selection: null,
  layers: { ...defaultLayers },
  panel: 'eigenschaften',
  toolOpts: {
    elecKind: 'steckdose2',
    lineKind: 'strom',
    lineSurface: 'wand',
    lineHeight: 300,
    furnitureCategory: 'schrank',
    furnitureTemplate: null,
    openingType: 'door',
  },
  view3d: { mode: 'orbit', showCeiling: true, showRoof: false, allLevels: false, sun: 0.65, lampsOn: true },
  measure: { points: [], space: '2d' },
  status: '',
  cameraRequest: null,
  cursor: null,

  setProject: (p, keepHistory = false) =>
    set((s) => ({
      project: p,
      past: keepHistory && s.project ? [...s.past, s.project].slice(-HISTORY_MAX) : [],
      future: [],
      levelId: p.levels.some((l) => l.id === s.levelId) ? s.levelId : p.levels[0]?.id ?? '',
      selection: null,
    })),

  update: (recipe) =>
    set((s) => {
      const next = produce(s.project, (d) => {
        recipe(d);
        d.updatedAt = new Date().toISOString();
      });
      if (next === s.project) return {};
      if (s.gesture) return { project: next, future: [] };
      return { project: next, past: [...s.past, s.project].slice(-HISTORY_MAX), future: [] };
    }),

  updateLevel: (recipe, levelId) => {
    const lid = levelId ?? get().levelId;
    get().update((d) => {
      const lvl = d.levels.find((l) => l.id === lid);
      if (lvl) recipe(lvl, d);
    });
  },

  beginGesture: () => set((s) => (s.gesture ? {} : { gesture: true, gestureStart: s.project })),
  endGesture: () =>
    set((s) => {
      if (!s.gesture) return {};
      const changed = s.gestureStart && s.gestureStart !== s.project;
      return {
        gesture: false,
        gestureStart: null,
        past: changed ? [...s.past, s.gestureStart!].slice(-HISTORY_MAX) : s.past,
      };
    }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const prev = s.past[s.past.length - 1];
      return { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], selection: null };
    }),
  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[0];
      return { project: next, past: [...s.past, s.project], future: s.future.slice(1), selection: null };
    }),

  select: (selection) => set({ selection }),
  setTool: (tool) => set({ tool, measure: { points: [], space: get().measure.space } }),
  setView: (view) => set({ view }),
  setLevel: (levelId) => set({ levelId, selection: null }),
  toggleLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v ?? !s.layers[k] } })),
  setPanel: (panel) => set({ panel }),
  setToolOpts: (o) => set((s) => ({ toolOpts: { ...s.toolOpts, ...o } })),
  setView3d: (o) => set((s) => ({ view3d: { ...s.view3d, ...o } })),
  setMeasure: (m) => set((s) => ({ measure: { ...s.measure, ...m } })),
  setStatus: (status) => set({ status }),
  requestCamera: (c) => set({ cameraRequest: { ...c, nonce: Math.random() } }),
  setCursor: (cursor) => set({ cursor }),
}));

export const useLevel = (): Level => {
  const project = useStore((s) => s.project);
  const levelId = useStore((s) => s.levelId);
  return project.levels.find((l) => l.id === levelId) ?? project.levels[0];
};

export const getLevel = (): Level => {
  const s = useStore.getState();
  return s.project.levels.find((l) => l.id === s.levelId) ?? s.project.levels[0];
};
