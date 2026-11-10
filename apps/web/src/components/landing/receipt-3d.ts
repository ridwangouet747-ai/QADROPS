import {
  CanvasTexture, Color, DirectionalLight, DoubleSide, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Scene, WebGLRenderer,
} from "three";
import type { ReceiptData } from "./receipt";

/*
 * Ticket de caisse en 3D : un plan courbé (bas du ticket qui s'enroule vers le lecteur), texturé par un canvas
 * qui reprend exactement le contenu du ticket HTML. Aucun modèle externe : Blender n'est pas installé sur le
 * poste de travail (docs/design/direction-artistique.md § 7). Le rendu s'arrête hors de l'écran et quand
 * l'onglet est caché ; tout est libéré au démontage.
 */

const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim() || fallback;

function drawReceipt(data: ReceiptData, width: number, aspect: number) {
  const height = Math.round(width * aspect);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const u = width / 100;
  const pad = 9 * u;
  const tooth = 4 * u;
  const ink = token("ink", "#171b26");
  const muted = token("fg-muted", "#545d72");
  const rule = token("line-strong", "#c2cbdc");

  // Papier avec bord inférieur dentelé (transparent sous les dents, coupé par alphaTest).
  ctx.fillStyle = token("white", "#ffffff");
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(width, 0);
  ctx.lineTo(width, height - tooth);
  for (let x = width; x > 0; x -= tooth * 2) {
    ctx.lineTo(x - tooth, height);
    ctx.lineTo(Math.max(0, x - tooth * 2), height - tooth);
  }
  ctx.closePath();
  ctx.fill();

  const rtl = data.dir === "rtl";
  ctx.direction = data.dir;
  const startX = rtl ? width - pad : pad;
  const endX = rtl ? pad : width - pad;
  const startAlign: CanvasTextAlign = rtl ? "right" : "left";
  const endAlign: CanvasTextAlign = rtl ? "left" : "right";
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const size = 4.9 * u;
  const lh = size * 1.55;
  let y = 10 * u + size;

  const text = (value: string, x: number, align: CanvasTextAlign, color: string, weight = 400, scale = 1) => {
    ctx.font = `${weight} ${size * scale}px ${mono}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };
  const dashed = () => {
    y += lh * 0.35;
    ctx.strokeStyle = rule;
    ctx.lineWidth = Math.max(1, u * 0.35);
    ctx.setLineDash([u * 1.2, u * 1]);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
    ctx.setLineDash([]);
    y += lh * 0.95;
  };

  text(data.shop, width / 2, "center", ink, 700, 1.12);
  y += lh;
  text(data.sale, width / 2, "center", muted);
  y += lh * 0.4;
  dashed();
  for (const line of data.lines) {
    text(line.label, startX, startAlign, ink, 600);
    y += lh;
    ctx.direction = "ltr";
    text(line.detail, startX, startAlign, muted);
    text(line.amount, endX, endAlign, ink);
    ctx.direction = data.dir;
    y += lh * 1.25;
  }
  y -= lh * 0.6;
  dashed();
  for (const total of data.totals) {
    text(total.label, startX, startAlign, ink, total.strong ? 700 : 400, total.strong ? 1.15 : 1);
    ctx.direction = "ltr";
    text(total.amount, endX, endAlign, ink, total.strong ? 700 : 400, total.strong ? 1.15 : 1);
    ctx.direction = data.dir;
    y += lh;
  }
  y += lh * 0.6;
  text(data.thanks, width / 2, "center", muted);
  return canvas;
}

export function mountReceipt3d(canvas: HTMLCanvasElement, paper: HTMLElement, data: ReceiptData, tier: "high" | "low", onReady: () => void, onStale: () => void) {
  const box = paper.getBoundingClientRect();
  const aspect = box.height > 0 && box.width > 0 ? box.height / box.width : 1.6;

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: tier === "high", powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === "high" ? 1.5 : 1.25));
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 1, 0.1, 50);

  const geometry = new PlaneGeometry(1, aspect, 16, 48);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const t = position.getY(index) / aspect + 0.5; // 0 en bas, 1 en haut
    const curl = Math.max(0, 0.3 - t) ** 2 * 2.8; // le bas du ticket s'enroule vers le lecteur
    const wave = Math.sin(t * Math.PI * 1.7) * 0.03;
    position.setZ(index, curl + wave - x * x * 0.07);
  }
  geometry.computeVertexNormals();

  const texture = new CanvasTexture(drawReceipt(data, tier === "high" ? 768 : 512, aspect));
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0, side: DoubleSide, alphaTest: 0.5 });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);
  scene.add(new HemisphereLight(new Color(token("white", "#ffffff")), new Color(token("qadr-200", "#c5d4f7")), 2.4));
  const key = new DirectionalLight(new Color(token("white", "#ffffff")), 1.2);
  key.position.set(1.6, 2.2, 3);
  scene.add(key);

  let stale = false;
  const fit = () => {
    // Le ticket HTML a changé de proportions (rotation de l'écran, autre point de rupture) : la géométrie,
    // calculée au montage, ne lui correspond plus. On demande un nouveau montage plutôt que d'étirer le ticket.
    const now = paper.getBoundingClientRect();
    if (!stale && now.width > 0 && Math.abs(now.height / now.width - aspect) / aspect > 0.04) {
      stale = true;
      onStale();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    // Le canvas déborde de 20 % de chaque côté : le ticket occupe 1/1,4 de la hauteur visible, à la place du ticket HTML.
    camera.position.set(0, 0, (aspect * 1.4) / 2 / Math.tan((camera.fov * Math.PI) / 360));
    camera.updateProjectionMatrix();
  };
  fit();

  const pointer = { x: 0, y: 0 };
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const onPointer = (event: PointerEvent) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  };
  if (finePointer) window.addEventListener("pointermove", onPointer, { passive: true });

  let visible = true;
  let frame = 0;
  let ready = false;
  const started = performance.now();
  const render = (now: number) => {
    frame = 0;
    const time = (now - started) / 1000;
    mesh.rotation.y = Math.sin(time * 0.45) * 0.2 + pointer.x * 0.16;
    mesh.rotation.x = -0.06 + Math.sin(time * 0.35) * 0.04 + pointer.y * 0.08;
    mesh.position.y = Math.sin(time * 0.8) * 0.015;
    renderer.render(scene, camera);
    if (!ready) { ready = true; onReady(); }
    schedule();
  };
  const schedule = () => {
    if (!frame && visible && document.visibilityState === "visible") frame = requestAnimationFrame(render);
  };
  const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };

  const observer = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) schedule(); else stop();
  });
  observer.observe(canvas);
  const onVisibility = () => (document.visibilityState === "visible" ? schedule() : stop());
  document.addEventListener("visibilitychange", onVisibility);
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(canvas);
  resizeObserver.observe(paper);
  schedule();

  return () => {
    stop();
    observer.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pointermove", onPointer);
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
