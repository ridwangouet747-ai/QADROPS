import { describe, expect, it } from "vitest";
import { fittedCamera, projectPoint, scenePoints, type SceneFrame } from "./scene-framing";
import { wizardSteps, type SceneStage } from "./wizard";

const stages: SceneStage[] = [...wizardSteps, "welcome"];
const frames: Record<string, SceneFrame> = {
  "colonne ordinateur": { width: 698, height: 760, inset: { top: 84, bottom: 132, side: 28 } },
  "colonne large": { width: 900, height: 700, inset: { top: 84, bottom: 132, side: 28 } },
  "bandeau téléphone": { width: 358, height: 230, inset: { top: 8, bottom: 8, side: 8 } },
  "bandeau clavier ouvert": { width: 358, height: 96, inset: { top: 4, bottom: 4, side: 8 } },
  "téléphone étroit": { width: 288, height: 192, inset: { top: 8, bottom: 8, side: 8 } },
};

/** Bornes de la zone libre, en coordonnées normalisées. */
function safeArea(frame: SceneFrame) {
  return { x: 1 - (2 * frame.inset.side) / frame.width, top: 1 - (2 * frame.inset.top) / frame.height, bottom: -(1 - (2 * frame.inset.bottom) / frame.height) };
}

describe("cadrage de la boutique 3D", () => {
  for (const [name, frame] of Object.entries(frames)) {
    for (const stage of stages) {
      it(`garde le socle et la boutique entiers dans la zone libre (${name}, étape ${stage})`, () => {
        const camera = fittedCamera(stage, frame);
        const safe = safeArea(frame);
        const projected = scenePoints(stage).map((point) => projectPoint(point, camera, frame));
        const tolerance = 1e-3;
        for (const point of projected) {
          expect(point.depth).toBeGreaterThan(0);
          expect(Math.abs(point.x)).toBeLessThanOrEqual(safe.x + tolerance);
          expect(point.y).toBeLessThanOrEqual(safe.top + tolerance);
          expect(point.y).toBeGreaterThanOrEqual(safe.bottom - tolerance);
        }
      });

      it(`ne réduit pas la scène plus que nécessaire (${name}, étape ${stage})`, () => {
        const camera = fittedCamera(stage, frame);
        const safe = safeArea(frame);
        const projected = scenePoints(stage).map((point) => projectPoint(point, camera, frame));
        const usedX = Math.max(...projected.map((point) => Math.abs(point.x))) / safe.x;
        const usedY = (Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y))) / (safe.top - safe.bottom);
        // Au moins un des deux axes est rempli : la scène touche un bord de la zone libre.
        expect(Math.max(usedX, usedY)).toBeGreaterThan(0.995);
      });
    }
  }

  it("centre le contenu dans la zone libre, pas dans le cadre entier", () => {
    const frame = frames["colonne ordinateur"]!;
    const camera = fittedCamera("review", frame);
    const safe = safeArea(frame);
    const ys = scenePoints("review").map((point) => projectPoint(point, camera, frame).y);
    const marginTop = safe.top - Math.max(...ys);
    const marginBottom = Math.min(...ys) - safe.bottom;
    expect(Math.abs(marginTop - marginBottom)).toBeLessThan(0.02);
  });

  it("inclut le bord bas du socle à toutes les étapes", () => {
    for (const stage of stages) {
      const lowest = Math.min(...scenePoints(stage).map((point) => point[1]));
      expect(lowest).toBeCloseTo(-0.55, 5);
    }
  });
});
