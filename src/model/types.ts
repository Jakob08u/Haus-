// Zentrales Datenmodell. Alle Längen in Millimetern, Winkel in Grad.
// Koordinaten im Grundriss: x nach rechts, y nach unten (wie SVG).
// 3D: three.x = x/1000, three.z = y/1000, three.y = Höhe/1000.

export type Id = string;
export interface Vec2 { x: number; y: number }

export type WallType = 'bestand' | 'neu' | 'abriss';

export interface Slope {
  /** Seite der Wand, zu der die Schräge ansteigt (Raumseite): 1 = links von a→b, -1 = rechts */
  side: 1 | -1;
  /** Kniestockhöhe an der Wandinnenseite */
  knee: number;
  /**
   * Wie die Neigung angegeben ist:
   * pitch = Winkel · ridge = Firsthöhe + Abstand · length = Länge der Schräge (entlang der Schräge
   * bis zur flachen Decke) · depth = waagrechte Tiefe der Schräge bis zur flachen Decke
   */
  mode: 'pitch' | 'ridge' | 'length' | 'depth';
  /** Dachneigung in Grad (mode = pitch) */
  pitchDeg: number;
  /** Länge der Schräge entlang der Fläche (mode = length) */
  slopeLength?: number;
  /** waagrechte Tiefe der Schräge (mode = depth) */
  slopeDepth?: number;
  /** Firsthöhe über Fußboden (mode = ridge) */
  ridgeHeight?: number;
  /** waagrechter Abstand Wandinnenseite → First (mode = ridge) */
  ridgeDistance?: number;
}

export type FinishKind = 'none' | 'paint' | 'wallpaper' | 'tile';

export interface SurfaceFinish {
  kind: FinishKind;
  /** Farbe bei kind = paint (hex) */
  color?: string;
  /** Material-ID aus project.materials (Tapete/Fliese) */
  materialId?: Id;
  /** nur bis zu einer Höhe (z. B. Fliesenspiegel), sonst volle Höhe */
  maxHeight?: number;
}

export interface Wall {
  id: Id;
  a: Vec2;
  b: Vec2;
  thickness: number;
  type: WallType;
  /** optionale feste Höhe; sonst Raumhöhe/Dachschräge der Ebene */
  height?: number;
  slope?: Slope;
  /** Oberflächen: left = links von a→b, right = rechts; slopeSurface = Schräge über der Wand */
  finishes?: { left?: SurfaceFinish; right?: SurfaceFinish; slope?: SurfaceFinish };
  label?: string;
}

export type OpeningType = 'door' | 'window' | 'passage';

export interface Opening {
  id: Id;
  type: OpeningType;
  wallId: Id;
  /** Abstand vom Wandanfang a bis zur Öffnungsmitte (entlang Mittellinie) */
  offset: number;
  width: number;
  height: number;
  /** Brüstungshöhe (Fenster) */
  sill: number;
  /** Tür: Anschlagseite (Band) bezogen auf a→b: 'a' = Band an der a-Seite der Öffnung */
  hinge?: 'a' | 'b';
  /** Tür/Fenster: Aufschlag zur linken (1) oder rechten (-1) Wandseite */
  swing?: 1 | -1;
}

export interface RoofWindow {
  id: Id;
  /** Wand mit Dachschräge, in deren Schräge das Fenster sitzt */
  wallId: Id;
  offset: number;
  width: number;
  /** Länge entlang der Schräge */
  length: number;
  /** Höhe der Unterkante über Fußboden */
  bottomHeight: number;
}

export interface Stair {
  id: Id;
  /** Mittelpunkt */
  x: number;
  y: number;
  /** Länge in Laufrichtung, Breite quer */
  length: number;
  width: number;
  rotation: number;
  steps: number;
  /** Treppenloch in dieser Ebene (Treppe führt nach unten) */
  isOpening: boolean;
  /** Geländer an den Längsseiten */
  railing: { left: boolean; right: boolean; end: boolean };
  /** Laufrichtung: 'up' = Treppe steigt in Richtung rotation, 'down' = fällt */
  direction: 'up' | 'down';
}

export type FloorPattern = 'third' | 'half' | 'random' | 'straight' | 'herringbone' | 'shipdeck';

export interface FloorFinish {
  materialId?: Id;
  color?: string;
  pattern: FloorPattern;
  rotation: number;
  /** Verschnitt in Prozent, überschreibt Projektstandard */
  waste?: number;
  /** Türlaibungen mitrechnen */
  includeReveals?: boolean;
}

export interface RoomMeta {
  id: Id;
  name: string;
  /** Punkt innerhalb des Raums, über den der automatisch erkannte Raum zugeordnet wird */
  seed: Vec2;
  floor?: FloorFinish;
  /** lichte Höhe der flachen Decke in diesem Raum (sonst Deckenhöhe der Ebene) */
  ceilingHeight?: number;
  ceilingColor?: string;
  usage?: string;
}

export type FurnitureCategory =
  | 'bett' | 'sofa' | 'schrank' | 'regal' | 'tisch' | 'stuhl' | 'kommode' | 'schreibtisch'
  | 'lampe' | 'sessel' | 'tv' | 'teppich' | 'spiegel' | 'pflanze'
  | 'wc' | 'waschbecken' | 'dusche' | 'wanne' | 'waschmaschine' | 'heizkoerper' | 'sonstiges';

export interface ConnectionPoint {
  kind: 'wasser_kalt' | 'wasser_warm' | 'abwasser' | 'strom' | 'heizung';
  /** lokal zum Möbelmittelpunkt (vor Drehung), z = Höhe über Boden */
  x: number;
  y: number;
  z: number;
}

export interface Furniture {
  id: Id;
  name: string;
  category: FurnitureCategory;
  /** Mittelpunkt */
  x: number;
  y: number;
  /** Höhe der Unterkante (z. B. Hängeschrank) */
  elevation: number;
  rotation: number;
  /** Breite (lokal x), Tiefe (lokal y, Vorderseite bei +y), Höhe */
  width: number;
  depth: number;
  height: number;
  color: string;
  /** Hersteller-/Shop-Infos */
  url?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  modelUrl?: string;
  /** Schranktüren: Anzahl Flügel, für Schwenkbereich */
  doors?: number;
  doorType?: 'hinged' | 'sliding' | 'none';
  connections?: ConnectionPoint[];
  /** zusätzliche Bewegungsfläche überschreiben */
  clearanceFront?: number;
  clearanceSide?: number;
  note?: string;
}

export type ElecKind =
  | 'steckdose1' | 'steckdose2' | 'steckdose3' | 'schalter' | 'serienschalter' | 'wechselschalter'
  | 'lampe' | 'wandlampe' | 'lan' | 'antenne' | 'starkstrom' | 'smarthome' | 'rauchmelder' | 'verteiler';

export interface ElecSymbol {
  id: Id;
  kind: ElecKind;
  x: number;
  y: number;
  /** Montagehöhe über Fußboden (Mitte) */
  height: number;
  /** Wand, an der das Symbol sitzt (für Zonenprüfung); Deckenauslässe ohne Wand */
  wallId?: Id;
  /** Seite der Wand (1 links / -1 rechts) */
  side?: 1 | -1;
  rotation?: number;
  label?: string;
  /** über Arbeitsfläche (Standardhöhe 115 cm) */
  aboveWorktop?: boolean;
}

export type LineKind = 'strom' | 'wasser_kalt' | 'wasser_warm' | 'abwasser' | 'heizung' | 'lan';
export type LineSurface = 'wand' | 'decke' | 'boden';

export interface LinePoint { x: number; y: number; z: number }

export interface ServiceLine {
  id: Id;
  kind: LineKind;
  surface: LineSurface;
  points: LinePoint[];
  label?: string;
  diameter?: number;
}

export interface Dimension {
  id: Id;
  a: Vec2;
  b: Vec2;
  offset: number;
}

export interface Background {
  src: string;
  /** Position der linken oberen Bildecke in mm */
  x: number;
  y: number;
  /** mm pro Bildpixel */
  scale: number;
  /** Verzerrung Höhe/Breite (nur für nicht maßstäbliche Skizzen, sonst 1) */
  aspect?: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  naturalWidth: number;
  naturalHeight: number;
}

export interface Level {
  id: Id;
  name: string;
  /** Höhe Fußboden über Bezugsebene */
  elevation: number;
  /** flache Decke / Kehlbalkenlage */
  ceilingHeight: number;
  /** Deckenstärke (für Treppenhöhe / Stapelung) */
  slabThickness: number;
  background?: Background;
  walls: Wall[];
  openings: Opening[];
  roofWindows: RoofWindow[];
  stairs: Stair[];
  rooms: RoomMeta[];
  furniture: Furniture[];
  electrical: ElecSymbol[];
  lines: ServiceLine[];
  dimensions: Dimension[];
}

export type MaterialKind = 'wallpaper' | 'tile' | 'floor' | 'paint';

export interface Material {
  id: Id;
  kind: MaterialKind;
  name: string;
  /** Bild als data-URL (lokal gespeichert) */
  image?: string;
  color: string;
  price?: number;
  url?: string;
  // Tapete
  rollWidth?: number;
  rollLength?: number;
  repeat?: number;
  /** versetzter Ansatz */
  repeatOffset?: boolean;
  // Fliese / Diele
  tileLength?: number;
  tileWidth?: number;
  joint?: number;
  /** Paketinhalt in m² (Boden/Fliese) */
  packageArea?: number;
  /** Paketinhalt in Stück (alternativ) */
  packagePieces?: number;
  /** Ergiebigkeit Farbe m²/l und Gebinde l */
  coverage?: number;
  containerLiters?: number;
}

export interface SavedCamera {
  id: Id;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  levelId: Id;
  mode: 'orbit' | 'walk';
}

export type AssumptionStatus = 'offen' | 'bestaetigt';

export interface Assumption {
  id: Id;
  text: string;
  /** Referenz auf Objekt, z. B. "wall:w12" oder "level:dg" */
  ref?: string;
  levelId?: Id;
  status: AssumptionStatus;
}

export interface Settings {
  gridSize: number;
  snapGrid: boolean;
  snapAngle: boolean;
  snapEndpoints: boolean;
  defaultWallThickness: number;
  defaultWallType: WallType;
  /** Bewegungsflächen */
  clearance: {
    schrank: number;
    bettSeite: number;
    bettFuss: number;
    schreibtisch: number;
    wc: number;
    waschbecken: number;
    dusche: number;
    tuer: number;
    allgemein: number;
  };
  wastePercent: number;
  defaultHeights: {
    steckdose: number;
    schalter: number;
    arbeitsflaeche: number;
  };
  eyeHeight: number;
}

export interface Project {
  version: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  levels: Level[];
  materials: Material[];
  cameras: SavedCamera[];
  assumptions: Assumption[];
  settings: Settings;
}

export type LayerKey =
  | 'grundriss' | 'hintergrund' | 'raster' | 'masse' | 'raeume' | 'moebel' | 'elektro'
  | 'strom' | 'wasser' | 'abwasser' | 'heizung' | 'lan' | 'zonen' | 'schraegen' | 'bewegung' | 'warnungen' | 'unterlage';
