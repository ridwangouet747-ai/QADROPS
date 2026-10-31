import type { SceneStage } from "./wizard";

/*
 * Animation Lottie de la boutique, pour les téléphones et appareils modestes (mission 08).
 * Construite en code (aucun fichier à télécharger, aucune ressource externe) : formes vectorielles
 * simples, 30 images/s, une séquence par étape. Les éléments propres à une activité portent une
 * classe (act-hardware…) masquée en CSS selon le choix ; le nom et le logo sont superposés en HTML.
 */

export const lottieSize = { width: 480, height: 360 };
export const lottieFrames = 210;
/** Fin de séquence de chaque étape : on joue jusqu'à cette image, puis l'animation s'arrête. */
export const lottieSegments: Record<SceneStage, [number, number]> = {
  account: [0, 30], identity: [30, 70], details: [70, 110], branding: [110, 140], review: [140, 170], welcome: [170, 210],
};
/** Zones de superposition HTML (en % de l'animation) : enseigne et pastille du logo. */
export const lottieOverlays = {
  sign: { left: 34.4, top: 17.2, width: 31.3, height: 9.4 },
  logo: { left: 35.8, top: 18.6, width: 5, height: 6.7 },
};

type Vec = number[];
const palette = {
  ground: "#e4e1f6", plinth: "#c9c3fb", night: "#1b1a2e", nightSoft: "#2a2942", wall: "#ffffff", glass: "#d9d4fd",
  brand: "#5b4df2", brandSoft: "#8b80f9", lavender: "#eeecfe", warm: "#ff9f7a", sand: "#d8cfbf", sandDark: "#b9ad98",
  steel: "#6e6c8a", leaf: "#3f9c74", bulb: "#ffd166", white: "#ffffff",
};

const rgb = (hex: string): Vec => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).concat(1);
const fixed = (value: number | Vec) => ({ a: 0, k: value });
const ease = (dimensions: number) => ({ i: { x: Array(dimensions).fill(0.22), y: Array(dimensions).fill(1) }, o: { x: Array(dimensions).fill(0.6), y: Array(dimensions).fill(0) } });
function animated(frames: [number, Vec][]) {
  const dims = frames[0]![1].length;
  return { a: 1, k: frames.map(([t, s], index) => (index < frames.length - 1 ? { t, s, ...ease(dims) } : { t, s })) };
}
const transform = () => ({ ty: "tr", p: fixed([0, 0]), a: fixed([0, 0]), s: fixed([100, 100]), r: fixed(0), o: fixed(100), sk: fixed(0), sa: fixed(0) });

function rect(x: number, y: number, w: number, h: number, color: string, radius = 0) {
  return { ty: "gr", it: [{ ty: "rc", d: 1, p: fixed([x + w / 2, y + h / 2]), s: fixed([w, h]), r: fixed(radius) }, { ty: "fl", c: fixed(rgb(color)), o: fixed(100), r: 1 }, transform()] };
}
function ellipse(cx: number, cy: number, w: number, h: number, color: string, opacity = 100) {
  return { ty: "gr", it: [{ ty: "el", d: 1, p: fixed([cx, cy]), s: fixed([w, h]) }, { ty: "fl", c: fixed(rgb(color)), o: fixed(opacity), r: 1 }, transform()] };
}

type LayerOptions = {
  anchor: Vec; opacity?: [number, number][]; position?: [number, Vec][]; scale?: [number, Vec][]; rotation?: [number, number][]; className?: string;
};
let index = 0;
function layer(name: string, shapes: object[], options: LayerOptions) {
  index += 1;
  const { anchor } = options;
  return {
    ddd: 0, ind: index, ty: 4, nm: name, sr: 1, ip: 0, op: lottieFrames, st: 0, ao: 0, bm: 0,
    ...(options.className ? { cl: options.className } : {}),
    ks: {
      o: options.opacity ? animated(options.opacity.map(([t, v]) => [t, [v]])) : fixed(100),
      r: options.rotation ? animated(options.rotation.map(([t, v]) => [t, [v]])) : fixed(0),
      p: options.position ? animated(options.position) : fixed(anchor),
      a: fixed(anchor),
      s: options.scale ? animated(options.scale) : fixed([100, 100, 100]),
    },
    shapes,
  };
}

/** Apparition « posée » : monte légèrement en fondu entre start et start + 14 images. */
const rise = (anchor: Vec, start: number, offset = 18): Pick<LayerOptions, "opacity" | "position"> => ({
  opacity: [[start, 0], [start + 10, 100]],
  position: [[start, [anchor[0]!, anchor[1]! + offset]], [start + 14, anchor]],
});
/** Apparition « posée » d'un objet : grandit depuis son point d'ancrage. */
const pop = (start: number, length = 12): Pick<LayerOptions, "opacity" | "scale"> => ({
  opacity: [[start, 0], [start + 4, 100]],
  scale: [[start, [0, 0, 100]], [start + length, [100, 100, 100]]],
});

function activityProps() {
  const hardware = [
    rect(136, 172, 54, 4, palette.steel), rect(136, 192, 54, 4, palette.steel),
    rect(140, 176, 14, 15, palette.sand, 3), rect(157, 176, 14, 15, palette.sandDark, 3), rect(174, 180, 12, 11, palette.sand, 3),
    rect(142, 199, 44, 13, palette.sandDark, 3),
    rect(296, 168, 4, 40, palette.steel, 2), rect(286, 166, 24, 8, palette.night, 2),
    rect(316, 172, 26, 4, palette.steel, 2), rect(316, 182, 26, 4, palette.steel, 2), rect(316, 192, 26, 4, palette.brandSoft, 2),
    rect(70, 246, 30, 18, palette.sand, 5), rect(74, 232, 26, 16, palette.sandDark, 5), rect(102, 250, 24, 14, palette.sand, 5),
  ];
  const phones = [
    ...[140, 156, 172].map((x) => rect(x, 172, 12, 22, palette.night, 3)), ...[142, 158, 174].map((x) => rect(x, 175, 8, 15, palette.brandSoft, 2)),
    rect(136, 198, 56, 8, palette.white, 3),
    ...[292, 310, 328].map((x) => rect(x, 170, 14, 26, palette.night, 4)), ...[294, 312, 330].map((x) => rect(x, 174, 10, 18, palette.brand, 2)),
    rect(288, 200, 58, 8, palette.white, 3),
    rect(72, 236, 34, 28, palette.night, 6), rect(76, 240, 26, 18, palette.brandSoft, 3),
  ];
  const clothing = [
    rect(136, 170, 56, 3, palette.steel, 2),
    ...([[140, palette.brand], [158, palette.warm], [176, palette.brandSoft]] as const).map(([x, color]) => rect(x, 174, 14, 24, color, 4)),
    rect(288, 170, 58, 3, palette.steel, 2),
    ...([[292, palette.warm], [310, palette.night], [328, palette.brand]] as const).map(([x, color]) => rect(x, 174, 14, 26, color, 4)),
    rect(70, 252, 36, 6, palette.brandSoft, 2), rect(72, 246, 32, 6, palette.warm, 2), rect(74, 240, 28, 6, palette.brand, 2),
  ];
  const general = [
    rect(136, 186, 56, 3, palette.steel), rect(136, 206, 56, 3, palette.steel),
    ...([[139, palette.warm], [149, palette.brand], [159, palette.leaf], [169, palette.brandSoft], [179, palette.warm]] as const).map(([x, color]) => rect(x, 172, 8, 14, color, 2)),
    ...([[140, palette.sand], [156, palette.brandSoft], [172, palette.sandDark]] as const).map(([x, color]) => rect(x, 192, 14, 14, color, 2)),
    ...([[292, palette.leaf], [304, palette.warm], [316, palette.brand], [328, palette.sand]] as const).map(([x, color]) => rect(x, 174, 10, 30, color, 3)),
    rect(70, 244, 36, 20, palette.sandDark, 4), rect(74, 236, 12, 10, palette.warm, 5), rect(88, 236, 12, 10, palette.leaf, 5),
  ];
  return ([["hardware", hardware], ["phones", phones], ["clothing", clothing], ["general", general]] as const)
    .map(([key, shapes]) => layer(`activité ${key}`, shapes, { anchor: [240, 210], className: `act-${key}`, ...pop(54, 14) }));
}

function confetti() {
  const colors = [palette.brand, palette.warm, palette.brandSoft, palette.bulb, palette.leaf];
  return Array.from({ length: 16 }, (_, item) => {
    const x = 70 + ((item * 89) % 340);
    const start = 176 + (item % 6) * 3;
    return layer(`confetti ${item}`, [rect(x - 3, -6, 6, 10, colors[item % colors.length]!, 2)], {
      anchor: [x, -1], opacity: [[start, 0], [start + 2, 100], [start + 26, 100], [start + 32, 0]],
      position: [[start, [x, -1]], [start + 32, [x + ((item % 3) - 1) * 18, 230 + (item % 4) * 14]]],
      rotation: [[start, 0], [start + 32, (item % 2 ? 1 : -1) * 220]],
    });
  });
}

export function buildShopLottie() {
  index = 0;
  const signAnchor = [240, 96];
  const layers = [
    ...confetti(),
    layer("halo de bienvenue", [ellipse(240, 79, 190, 70, palette.brandSoft, 35)], { anchor: [240, 79], opacity: [[170, 0], [182, 100], [206, 0]], scale: [[170, [60, 60, 100]], [206, [130, 130, 100]]] }),
    layer("pastille logo", [ellipse(184, 79, 26, 26, palette.white)], { anchor: [184, 79], ...pop(112, 10) }),
    layer("enseigne", [rect(165, 62, 150, 34, palette.brand, 10)], { anchor: signAnchor, ...pop(46, 14) }),
    layer("plantes", [rect(84, 238, 18, 24, palette.nightSoft, 4), ellipse(93, 232, 30, 26, palette.leaf), rect(378, 238, 18, 24, palette.nightSoft, 4), ellipse(387, 232, 30, 26, palette.leaf)], { anchor: [240, 262], ...pop(142, 14) }),
    layer("panneau ouvert", [rect(222, 172, 36, 14, palette.white, 4), rect(226, 177, 28, 4, palette.leaf, 2)], { anchor: [240, 172], ...pop(148, 10) }),
    layer("lumières", [ellipse(162, 188, 70, 50, palette.bulb, 22), ellipse(318, 188, 70, 50, palette.bulb, 22)], { anchor: [240, 188], opacity: [[146, 0], [160, 100]] }),
    layer("réverbère", [rect(406, 168, 5, 104, palette.nightSoft, 2), rect(398, 160, 21, 9, palette.night, 4), ellipse(408, 172, 12, 10, palette.bulb)], { anchor: [408, 272], ...rise([408, 272], 74, 24) }),
    layer("comptoir", [rect(216, 228, 48, 26, palette.nightSoft, 4), rect(212, 224, 56, 6, palette.night, 3)], { anchor: [240, 254], ...rise([240, 254], 78) }),
    ...activityProps(),
    layer("porte gauche", [rect(205, 165, 35, 90, palette.glass, 3)], { anchor: [222, 210], opacity: [[50, 0], [62, 100]], position: [[50, [222, 222]], [62, [222, 210]], [176, [222, 210]], [192, [196, 210]]] }),
    layer("porte droite", [rect(240, 165, 35, 90, palette.glass, 3)], { anchor: [258, 210], opacity: [[50, 0], [62, 100]], position: [[50, [258, 222]], [62, [258, 210]], [176, [258, 210]], [192, [284, 210]]] }),
    layer("vitrines", [rect(130, 160, 66, 56, palette.lavender, 6), rect(284, 160, 66, 56, palette.lavender, 6)], { anchor: [240, 188], ...rise([240, 188], 48, 12) }),
    layer("store", Array.from({ length: 7 }, (_, stripe) => rect(100 + stripe * 40, 120, 40, 22, stripe % 2 ? palette.white : palette.brand, 0)), { anchor: [240, 120], opacity: [[42, 0], [50, 100]], scale: [[42, [100, 0, 100]], [56, [100, 100, 100]]] }),
    layer("toit", [rect(92, 96, 296, 26, palette.night, 8)], { anchor: [240, 109], opacity: [[36, 0], [44, 100]], position: [[36, [240, 84]], [50, [240, 109]]] }),
    layer("murs", [rect(105, 118, 270, 137, palette.wall, 4), rect(105, 110, 20, 145, palette.nightSoft, 4), rect(355, 110, 20, 145, palette.nightSoft, 4)], { anchor: [240, 255], opacity: [[30, 0], [40, 100]], scale: [[30, [100, 0, 100]], [48, [100, 100, 100]]] }),
    layer("fondations", [rect(90, 252, 300, 20, palette.night, 6)], { anchor: [240, 272], opacity: [[6, 0], [12, 100]], scale: [[6, [100, 0, 100]], [22, [100, 100, 100]]] }),
    layer("socle", [rect(60, 268, 360, 24, palette.plinth, 12)], { anchor: [240, 292], ...rise([240, 292], 0, 12) }),
    layer("ombre", [ellipse(240, 300, 400, 48, palette.ground)], { anchor: [240, 300], opacity: [[0, 0], [12, 100]] }),
  ];
  return { v: "5.7.4", fr: 30, ip: 0, op: lottieFrames, w: lottieSize.width, h: lottieSize.height, nm: "Boutique Qadr Ops", ddd: 0, assets: [], layers };
}
