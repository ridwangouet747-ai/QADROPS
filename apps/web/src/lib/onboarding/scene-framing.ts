import type { SceneStage } from "./wizard";

/*
 * Cadrage de la boutique 3D de l'inscription. Fonctions pures (aucune dépendance à Three.js), testées
 * sans navigateur : la caméra est placée à la distance la plus courte qui garde TOUS les points de la
 * scène (socle compris) dans la zone libre du cadre, c'est-à-dire hors des pastilles du haut et de la
 * légende du bas. Le résultat est exact quel que soit le format : colonne portrait sur ordinateur,
 * bandeau large sur téléphone, bandeau très plat quand le clavier est ouvert.
 */
export type Vec3 = readonly [number, number, number];
/** Cadre en pixels ; `inset` = zones couvertes par l'interface, où rien d'essentiel ne doit se trouver. */
export type SceneFrame = { width: number; height: number; inset: { top: number; bottom: number; side: number } };

export const sceneFov = 34;

/* Décalage vertical du groupe « boutique » dans la scène (voir ShopBody). */
const groupY = -0.2;
const plinthRadius = 3.95;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** Direction de vue (du centre de la scène vers la caméra) par étape : trois-quarts avant droit, en plongée. */
export const sceneDirections: Record<SceneStage, Vec3> = {
  account: [0.5, 0.62, 0.7],
  identity: [0.56, 0.6, 0.74],
  details: [0.44, 0.68, 0.72],
  branding: [0.36, 0.44, 0.9],
  review: [0.6, 0.56, 0.72],
  welcome: [0.3, 0.46, 0.9],
};

/**
 * Points que le cadre doit contenir : le bord du socle (haut et bas) à toutes les étapes, puis le volume
 * de la boutique (murs, enseigne sur le toit, plantes et lampadaire) dès que la façade peut apparaître.
 */
export function scenePoints(stage: SceneStage): Vec3[] {
  const points: Vec3[] = [];
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    points.push([Math.cos(angle) * plinthRadius, groupY - 0.35, Math.sin(angle) * plinthRadius]);
    points.push([Math.cos(angle) * plinthRadius, groupY, Math.sin(angle) * plinthRadius]);
  }
  if (stage === "account") {
    // Dalle seule : un peu d'air au-dessus pour que la montée des fondations reste dans le cadre.
    for (const x of [-2.7, 2.7]) for (const z of [-2, 2]) points.push([x, groupY + 0.9, z]);
    return points;
  }
  for (const x of [-2.75, 2.75]) for (const z of [-2.1, 2.45]) points.push([x, groupY + 2.75, z]);
  // Enseigne posée sur l'avancée du toit, lampadaire et plantes de finition.
  for (const x of [-1.5, 1.5]) points.push([x, groupY + 3.82, -1.2]);
  points.push([-3.25, groupY + 2.85, 1.7], [-2.95, groupY + 1.1, 2.4], [2.95, groupY + 1.1, 2.4]);
  return points;
}

/** Minimum d'une fonction convexe sur [lo, hi] (recherche ternaire). */
function argmin(lo: number, hi: number, cost: (value: number) => number) {
  let a = lo;
  let b = hi;
  for (let step = 0; step < 60; step += 1) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (cost(m1) <= cost(m2)) b = m2; else a = m1;
  }
  return (a + b) / 2;
}

/**
 * Caméra la plus proche qui garde `points` dans la zone libre de `frame`, pour une direction de vue donnée.
 * Le point visé est choisi pour centrer le contenu dans cette zone (et non dans le cadre entier).
 */
export function frameCamera(direction: Vec3, points: Vec3[], frame: SceneFrame, fovDegrees = sceneFov) {
  const width = Math.max(frame.width, 1);
  const height = Math.max(frame.height, 1);
  const d = normalize(direction);
  const forward = scale(d, -1);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tanV = Math.tan((fovDegrees * Math.PI) / 360);
  const tanH = tanV * (width / height);
  // Zone libre en coordonnées normalisées (-1 à 1) ; jamais moins de 30 % du cadre, même sur un bandeau très plat.
  const sx = Math.max(0.3, 1 - (2 * frame.inset.side) / width);
  const yHi = Math.max(0.15, 1 - (2 * frame.inset.top) / height);
  const yLo = Math.max(0.15, 1 - (2 * frame.inset.bottom) / height);

  const local = points.map((point) => ({ x: dot(point, right), y: dot(point, up), z: dot(point, forward) }));
  const xs = local.map((point) => point.x);
  const ys = local.map((point) => point.y);
  const needX = (shift: number) => Math.max(...local.map((p) => Math.abs(p.x - shift) / (sx * tanH) - p.z));
  const needY = (shift: number) => Math.max(...local.map((p) => Math.max((p.y - shift) / (yHi * tanV), (shift - p.y) / (yLo * tanV)) - p.z));
  const shiftX = argmin(Math.min(...xs), Math.max(...xs), needX);
  const shiftY = argmin(Math.min(...ys), Math.max(...ys), needY);
  const distance = Math.max(needX(shiftX), needY(shiftY));

  // À cette distance, l'axe le moins contraint a du jeu : on y centre le contenu.
  const center = (lows: number[], highs: number[], fallback: number) => {
    const lo = Math.max(...lows);
    const hi = Math.min(...highs);
    return lo <= hi ? (lo + hi) / 2 : fallback;
  };
  const a = center(local.map((p) => p.x - sx * tanH * (distance + p.z)), local.map((p) => p.x + sx * tanH * (distance + p.z)), shiftX);
  const b = center(local.map((p) => p.y - yHi * tanV * (distance + p.z)), local.map((p) => p.y + yLo * tanV * (distance + p.z)), shiftY);
  const target = add(scale(right, a), scale(up, b));
  return { position: add(target, scale(d, distance)), target, distance };
}

/** Projection d'un point (coordonnées normalisées du cadre), pour les tests et le contrôle visuel. */
export function projectPoint(point: Vec3, camera: { position: Vec3; target: Vec3 }, frame: Pick<SceneFrame, "width" | "height">, fovDegrees = sceneFov) {
  const forward = normalize([camera.target[0] - camera.position[0], camera.target[1] - camera.position[1], camera.target[2] - camera.position[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const v: Vec3 = [point[0] - camera.position[0], point[1] - camera.position[1], point[2] - camera.position[2]];
  const tanV = Math.tan((fovDegrees * Math.PI) / 360);
  const depth = dot(v, forward);
  return { x: dot(v, right) / (depth * tanV * (frame.width / frame.height)), y: dot(v, up) / (depth * tanV), depth };
}

export function fittedCamera(stage: SceneStage, frame: SceneFrame) {
  return frameCamera(sceneDirections[stage], scenePoints(stage), frame);
}
