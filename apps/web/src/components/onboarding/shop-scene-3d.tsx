"use client";

/*
 * Scène 3D de l'inscription (mission 08) : une boutique stylisée construite avec des primitives
 * Three.js, sans modèle ni texture externe. Rendu à la demande (frameloop="demand") : chaque
 * transition GSAP demande une image, rien ne tourne au repos. Hors écran ou onglet masqué, la boucle
 * est arrêtée (frameloop="never"). Les géométries et matériaux déclarés en JSX sont libérés par
 * React Three Fiber au démontage ; les textures créées à la main sont libérées explicitement.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import * as THREE from "three";
import { samePlan, type Activity, type ScenePlan, type SceneStage } from "@/lib/onboarding/wizard";

gsap.registerPlugin(useGSAP);

type Tier = "high" | "low";
const colors = {
  plinth: "#dbe5fa", plinthEdge: "#c5d4f7", night: "#03108e", nightSoft: "#0b1ea6", wall: "#fbfcff", floor: "#edf2fb",
  brand: "#1853d7", brandSoft: "#5d88e8", glass: "#c3d4f8", warm: "#95b1f0", sand: "#d8cfbf", sandDark: "#b9ad98",
  steel: "#636c82", leaf: "#3f9c74", bulb: "#ffd166", white: "#ffffff",
};

/** Apparition pilotée par GSAP ; chaque image demandée par onUpdate (frameloop à la demande). */
function Reveal({ show, mode = "pop", delay = 0, children, position }: { show: boolean; mode?: "pop" | "grow" | "drop"; delay?: number; children: ReactNode; position?: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  useGSAP(() => {
    const group = ref.current;
    if (!group) return;
    if (show) group.visible = true;
    const target = show ? 1 : 0.001;
    // overwrite : une saisie effacée puis retapée reprend l'animation en cours au lieu de la doubler.
    const vars: gsap.TweenVars = {
      duration: show ? 0.75 : 0.3, delay: show ? delay : 0, ease: show ? (mode === "pop" ? "back.out(1.5)" : "power3.out") : "power2.in", overwrite: true,
      onUpdate: invalidate, onComplete: () => { if (!show) group.visible = false; invalidate(); },
    };
    if (mode === "grow") gsap.to(group.scale, { y: target, ...vars });
    else if (mode === "drop") {
      gsap.to(group.scale, { x: target, y: target, z: target, ...vars });
      gsap.fromTo(group.position, { y: (position?.[1] ?? 0) + (show ? 0.8 : 0) }, { y: position?.[1] ?? 0, ...vars, onComplete: undefined });
    } else gsap.to(group.scale, { x: target, y: target, z: target, ...vars });
  }, { dependencies: [show] });
  return <group ref={ref} position={position} scale={mode === "grow" ? [1, 0.001, 1] : [0.001, 0.001, 0.001]} visible={false}>{children}</group>;
}

/** Croissance continue (0 à 1) : la dalle monte d'un cran à chaque champ du compte rempli. */
function Grow({ amount, children }: { amount: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  useGSAP(() => {
    if (!ref.current) return;
    gsap.to(ref.current.scale, { y: Math.max(0.12, amount), duration: 0.55, ease: "back.out(1.6)", overwrite: true, onUpdate: invalidate });
  }, { dependencies: [amount] });
  return <group ref={ref} scale={[1, 0.12, 1]}>{children}</group>;
}

function Box({ size, position, color, rotation, emissive, opacity }: { size: [number, number, number]; position: [number, number, number]; color: string; rotation?: [number, number, number]; emissive?: string; opacity?: number }) {
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.72} metalness={0.02} emissive={emissive ?? "#000000"} emissiveIntensity={emissive ? 0.9 : 0} transparent={opacity !== undefined} opacity={opacity ?? 1} />
    </mesh>
  );
}

function Cylinder({ radius, height, position, color, rotation, segments = 16 }: { radius: number; height: number; position: [number, number, number]; color: string; rotation?: [number, number, number]; segments?: number }) {
  return (
    <mesh position={position} rotation={rotation}>
      <cylinderGeometry args={[radius, radius, height, segments]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
  );
}

/** Ombre de contact factice (dégradé radial) : aucune ombre dynamique à calculer. */
function ContactShadow() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 64);
    gradient.addColorStop(0, "rgba(27,26,46,0.28)");
    gradient.addColorStop(1, "rgba(27,26,46,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 0]}>
      <planeGeometry args={[10, 10]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/**
 * Enseigne : texture dessinée dans un canvas 2D (nom du commerce, logo). Le logo n'est décodé qu'une
 * fois par fichier ; chaque frappe redessine au plus une fois par image (requestAnimationFrame) et
 * donne un petit rebond à l'enseigne, pour que la boutique réponde au rythme de la saisie.
 */
function Sign({ text, logo, tier }: { text: string; logo: string | null; tier: Tier }) {
  const invalidate = useThree((state) => state.invalidate);
  const board = useRef<THREE.Group>(null);
  const [width, height] = tier === "high" ? [1024, 256] : [768, 192];
  const canvas = useMemo(() => Object.assign(document.createElement("canvas"), { width, height }), [width, height]);
  const texture = useMemo(() => {
    const created = new THREE.CanvasTexture(canvas);
    created.colorSpace = THREE.SRGBColorSpace;
    created.anisotropy = tier === "high" ? 4 : 1;
    return created;
  }, [canvas, tier]);
  useEffect(() => () => texture.dispose(), [texture]);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!logo) { setImage(null); return; }
    let cancelled = false;
    const loaded = new Image();
    loaded.src = logo;
    loaded.decode().then(() => { if (!cancelled) setImage(loaded); }, () => { if (!cancelled) setImage(null); });
    return () => { cancelled = true; };
  }, [logo]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const k = width / 1024;
      const context = canvas.getContext("2d")!;
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#1853d7");
      gradient.addColorStop(1, "#3168df");
      context.clearRect(0, 0, width, height);
      context.fillStyle = gradient;
      context.beginPath();
      context.roundRect(0, 0, width, height, 48 * k);
      context.fill();
      let textStart = 70 * k;
      if (image) {
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(128 * k, 128 * k, 88 * k, 0, Math.PI * 2);
        context.fill();
        const scale = Math.min((130 * k) / image.width, (130 * k) / image.height);
        context.drawImage(image, 128 * k - (image.width * scale) / 2, 128 * k - (image.height * scale) / 2, image.width * scale, image.height * scale);
        textStart = 250 * k;
      }
      const label = text || "QADR OPS";
      const rtl = /[֐-ࣿ]/.test(label);
      const room = width - textStart - 60 * k;
      let size = 104 * k;
      context.fillStyle = "#ffffff";
      context.textBaseline = "middle";
      context.direction = rtl ? "rtl" : "ltr";
      do {
        context.font = `800 ${size}px "Plus Jakarta Sans", "Noto Sans Arabic", "Segoe UI", system-ui, sans-serif`;
        size -= 4 * k;
      } while (context.measureText(label).width > room && size > 40 * k);
      context.textAlign = "center";
      context.fillText(label, textStart + (width - textStart - 40 * k) / 2, 132 * k, room);
      texture.needsUpdate = true;
      invalidate();
    });
    return () => cancelAnimationFrame(frame);
  }, [text, image, canvas, texture, invalidate, width, height]);

  // Rebond discret à chaque modification du texte (une seule animation à la fois).
  const typed = useRef(false);
  useGSAP(() => {
    if (!board.current) return;
    if (!typed.current) { typed.current = true; return; }
    gsap.fromTo(board.current.scale, { x: 1.045, y: 1.08 }, { x: 1, y: 1, duration: 0.35, ease: "back.out(3)", overwrite: true, onUpdate: invalidate });
  }, { dependencies: [text, image] });

  return (
    <group ref={board} position={[0, 3.18, 1.66]}>
      <Box size={[2.9, 0.82, 0.12]} position={[0, 0, -0.05]} color={colors.night} />
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[2.78, 0.7]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Shelf({ x, z = -1.35, tier, items }: { x: number; z?: number; tier: Tier; items: (level: number, slot: number) => ReactNode }) {
  const levels = tier === "high" ? [0.45, 1.05, 1.65] : [0.6, 1.4];
  return (
    <group position={[x, 0.2, z]}>
      <Box size={[0.06, 2.0, 0.42]} position={[-0.62, 1.0, 0]} color={colors.steel} />
      <Box size={[0.06, 2.0, 0.42]} position={[0.62, 1.0, 0]} color={colors.steel} />
      {levels.map((y, level) => (
        <group key={y} position={[0, y, 0]}>
          <Box size={[1.3, 0.05, 0.44]} position={[0, 0, 0]} color={colors.wall} />
          {[-0.4, 0, 0.4].map((slot, index) => <group key={slot} position={[slot, 0.03, 0]}>{items(level, index)}</group>)}
        </group>
      ))}
    </group>
  );
}

function ActivityProps({ activity, tier }: { activity: Activity; tier: Tier }) {
  const palette = [colors.warm, colors.brand, colors.leaf, colors.brandSoft, colors.sandDark];
  if (activity === "hardware") return (
    <group>
      <Shelf x={-1.45} tier={tier} items={(level, slot) => <Box size={[0.28, 0.24, 0.3]} position={[0, 0.13, 0]} color={(level + slot) % 2 ? colors.sand : colors.sandDark} />} />
      <Shelf x={1.45} tier={tier} items={(level, slot) => slot === 1 ? <Cylinder radius={0.05} height={0.34} rotation={[0, 0, Math.PI / 2]} position={[0, 0.08, 0]} color={colors.steel} /> : <Box size={[0.22, 0.16, 0.22]} position={[0, 0.09, 0]} color={palette[(level + slot) % palette.length]!} />} />
      {[[-2.05, 0.38, 2.15], [-1.62, 0.38, 2.2], [-1.84, 0.58, 2.18]].map(([x, y, z], index) => <Box key={index} size={[0.42, 0.2, 0.32]} position={[x!, y!, z!]} color={index % 2 ? colors.sandDark : colors.sand} />)}
      <group position={[1.2, 1.12, 0.6]} rotation={[0, 0, -0.5]}>
        <Cylinder radius={0.035} height={0.5} position={[0, 0, 0]} color={colors.sandDark} />
        <Box size={[0.24, 0.08, 0.08]} position={[0, 0.27, 0]} color={colors.night} />
      </group>
    </group>
  );
  if (activity === "phones") return (
    <group>
      {[-1.25, 1.25].map((x) => (
        <group key={x} position={[x, 0.2, 0.25]}>
          <Box size={[1.1, 0.75, 0.6]} position={[0, 0.38, 0]} color={colors.white} />
          <Box size={[1.12, 0.04, 0.62]} position={[0, 0.78, 0]} color={colors.glass} opacity={0.6} />
          {[-0.3, 0, 0.3].map((px) => (
            <group key={px} position={[px, 0.86, 0]} rotation={[-0.5, 0, 0]}>
              <Box size={[0.16, 0.3, 0.025]} position={[0, 0, 0]} color={colors.night} />
              <Box size={[0.13, 0.26, 0.005]} position={[0, 0, 0.015]} color={colors.brandSoft} emissive={colors.brand} />
            </group>
          ))}
        </group>
      ))}
      {tier === "high" && [-0.8, -0.4, 0, 0.4, 0.8].map((x) => (
        <group key={x} position={[x, 1.75, -1.6]}>
          <Box size={[0.2, 0.38, 0.03]} position={[0, 0, 0]} color={colors.night} />
          <Box size={[0.16, 0.32, 0.005]} position={[0, 0, 0.02]} color={colors.brand} emissive={colors.brandSoft} />
        </group>
      ))}
    </group>
  );
  if (activity === "clothing") return (
    <group>
      {[-1.35, 1.35].map((x, rack) => (
        <group key={x} position={[x, 0.2, -0.5]}>
          <Cylinder radius={0.03} height={1.5} position={[-0.6, 0.75, 0]} color={colors.steel} />
          <Cylinder radius={0.03} height={1.5} position={[0.6, 0.75, 0]} color={colors.steel} />
          <Cylinder radius={0.025} height={1.25} rotation={[0, 0, Math.PI / 2]} position={[0, 1.48, 0]} color={colors.steel} />
          {[-0.42, -0.14, 0.14, 0.42].slice(0, tier === "high" ? 4 : 3).map((sx, index) => (
            <Box key={sx} size={[0.08, 0.62, 0.4]} position={[sx, 1.12, 0]} color={[colors.brand, colors.warm, colors.brandSoft, colors.nightSoft][(index + rack) % 4]!} />
          ))}
        </group>
      ))}
      <group position={[-1.95, 0.2, 1.95]}>
        {[colors.brandSoft, colors.warm, colors.brand].map((color, index) => <Box key={color} size={[0.5, 0.1, 0.36]} position={[0, 0.06 + index * 0.11, 0]} color={color} />)}
      </group>
    </group>
  );
  return (
    <group>
      <Shelf x={-1.45} tier={tier} items={(level, slot) => (level + slot) % 2
        ? <Cylinder radius={0.07} height={0.2} position={[0, 0.1, 0]} color={palette[(level * 3 + slot) % palette.length]!} segments={12} />
        : <Box size={[0.24, 0.26, 0.2]} position={[0, 0.13, 0]} color={palette[(level + slot * 2) % palette.length]!} />} />
      <group position={[1.6, 0.2, -1.3]}>
        <Box size={[0.9, 1.9, 0.6]} position={[0, 0.95, 0]} color={colors.white} />
        <Box size={[0.04, 1.6, 0.02]} position={[0.3, 1.0, 0.31]} color={colors.brand} />
      </group>
      <group position={[-1.95, 0.2, 1.95]}>
        <Box size={[0.55, 0.32, 0.4]} position={[0, 0.16, 0]} color={colors.sandDark} />
        <Cylinder radius={0.08} height={0.18} position={[-0.12, 0.41, 0]} color={colors.warm} segments={12} />
        <Cylinder radius={0.08} height={0.18} position={[0.12, 0.41, 0]} color={colors.leaf} segments={12} />
      </group>
    </group>
  );
}

function Confetti({ active, count }: { active: boolean; count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const seeds = useMemo(() => Array.from({ length: count }, (_, index) => ({
    x: Math.sin(index * 12.9898) * 2.6, z: Math.cos(index * 78.233) * 1.8 + 0.8, start: 5 + (index % 7) * 0.35, spin: (index % 5) + 1,
    color: new THREE.Color([colors.brand, colors.warm, colors.brandSoft, colors.bulb, colors.leaf][index % 5]),
  })), [count]);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    seeds.forEach((seed, index) => mesh.setColorAt(index, seed.color));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [seeds]);
  useGSAP(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const progress = { value: 0 };
    mesh.visible = active;
    if (!active) return;
    gsap.to(progress, {
      value: 1, duration: 2.6, ease: "power1.in",
      onUpdate: () => {
        seeds.forEach((seed, index) => {
          const t = Math.min(1, progress.value * 1.25 + (index % 4) * -0.05);
          dummy.position.set(seed.x + Math.sin(t * 6 + index) * 0.15, seed.start - t * (seed.start + 0.2), seed.z);
          dummy.rotation.set(t * seed.spin * 4, t * seed.spin * 3, 0);
          dummy.scale.setScalar(t >= 1 ? 0.001 : 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        invalidate();
      },
    });
  }, { dependencies: [active] });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} visible={false}>
      <planeGeometry args={[0.12, 0.18]} />
      <meshBasicMaterial side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

/* Cadrage : direction de vue et point visé par étape ; la distance est calculée pour que la boutique
   (≈ 9,2 × 6,4 unités) tienne entière, quel que soit le format du cadre (colonne portrait ou bandeau). */
const fov = 34;
const views: Record<SceneStage, { direction: [number, number, number]; target: [number, number, number]; zoom: number }> = {
  account: { direction: [0.56, 0.46, 0.69], target: [0, 0.6, 0], zoom: 0.86 },
  identity: { direction: [0.4, 0.42, 0.81], target: [0, 1.4, 0], zoom: 1 },
  details: { direction: [0.3, 0.36, 0.88], target: [0, 1.2, 0.2], zoom: 0.94 },
  branding: { direction: [0.34, 0.3, 0.89], target: [0, 1.8, 0.4], zoom: 0.9 },
  review: { direction: [0.38, 0.4, 0.83], target: [0, 1.4, 0], zoom: 1 },
  welcome: { direction: [0.3, 0.26, 0.92], target: [0, 1.6, 0.6], zoom: 0.92 },
};

export function fittedCamera(stage: SceneStage, aspect: number) {
  const view = views[stage];
  const vertical = THREE.MathUtils.degToRad(fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const distance = Math.max(4.6 / Math.tan(horizontal), 3.2 / Math.tan(vertical)) * view.zoom;
  const target = new THREE.Vector3(...view.target);
  return { position: new THREE.Vector3(...view.direction).normalize().multiplyScalar(distance).add(target), target };
}

/**
 * Caméra : un seul état (position, point visé, décalage du pointeur) composé à chaque image. Les
 * glissements sont des quickTo qui se recalent sur la nouvelle cible sans repartir de zéro : un
 * changement d'étape, un redimensionnement (bandeau mobile qui se réduit pendant la saisie) et la
 * parallaxe ne se disputent plus la même propriété, d'où l'absence d'à-coups.
 */
function Rig({ stage, tier }: { stage: SceneStage; tier: Tier }) {
  const { camera, invalidate, gl, size } = useThree();
  const aspect = size.width / Math.max(size.height, 1);
  const rig = useRef({ position: new THREE.Vector3(), target: new THREE.Vector3(), offset: { x: 0 } });
  const movers = useRef<((value: number) => void)[] | null>(null);
  const apply = useCallback(() => {
    const { position, target, offset } = rig.current;
    camera.position.set(position.x + offset.x, position.y, position.z);
    camera.lookAt(target);
    invalidate();
  }, [camera, invalidate]);

  useEffect(() => {
    const goal = fittedCamera(stage, aspect);
    const values = [goal.position.x, goal.position.y, goal.position.z, goal.target.x, goal.target.y, goal.target.z];
    if (!movers.current) {
      // Premier cadrage immédiat ; ensuite tout glisse.
      rig.current.position.copy(goal.position);
      rig.current.target.copy(goal.target);
      const { position, target } = rig.current;
      const vars = { duration: 1.1, ease: "power3.out", onUpdate: apply };
      movers.current = [
        gsap.quickTo(position, "x", vars), gsap.quickTo(position, "y", vars), gsap.quickTo(position, "z", vars),
        gsap.quickTo(target, "x", vars), gsap.quickTo(target, "y", vars), gsap.quickTo(target, "z", vars),
      ];
      apply();
      return;
    }
    movers.current.forEach((move, index) => move(values[index]!));
  }, [stage, aspect, apply]);

  useEffect(() => () => { gsap.killTweensOf([rig.current.position, rig.current.target, rig.current.offset]); }, []);

  useEffect(() => {
    if (tier !== "high") return;
    // Parallaxe très discrète au pointeur, uniquement sur ordinateur performant ; elle décale la caméra sans toucher au cadrage d'étape.
    const element = gl.domElement;
    const xTo = gsap.quickTo(rig.current.offset, "x", { duration: 1.2, ease: "power3", onUpdate: apply });
    const onMove = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      xTo(((event.clientX - bounds.left) / bounds.width - 0.5) * 0.6);
    };
    const onLeave = () => xTo(0);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    return () => { element.removeEventListener("pointermove", onMove); element.removeEventListener("pointerleave", onLeave); };
  }, [gl, apply, tier]);
  return null;
}

/* La structure ne se redessine pas quand seul le texte de l'enseigne change (l'enseigne a son propre composant). */
const Shop = memo(ShopBody, (a, b) => a.tier === b.tier && samePlan({ ...a.plan, signText: "" }, { ...b.plan, signText: "" }));

function ShopBody({ plan, tier }: { plan: ScenePlan; tier: Tier }) {
  const invalidate = useThree((state) => state.invalidate);
  const doorLeft = useRef<THREE.Group>(null);
  const doorRight = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useGSAP(() => {
    const open = plan.welcome;
    if (doorLeft.current && doorRight.current) {
      gsap.to(doorLeft.current.position, { x: open ? -1.02 : -0.35, duration: 1.1, delay: open ? 0.35 : 0, ease: "power3.inOut", onUpdate: invalidate });
      gsap.to(doorRight.current.position, { x: open ? 1.02 : 0.35, duration: 1.1, delay: open ? 0.35 : 0, ease: "power3.inOut", onUpdate: invalidate });
    }
    if (light.current) gsap.to(light.current, { intensity: plan.welcome ? 7 : plan.finished ? 3.5 : plan.lights ? 1.5 : 0, duration: 0.9, ease: "power2.out", overwrite: true, onUpdate: invalidate });
  }, { dependencies: [plan.welcome, plan.finished, plan.lights] });

  return (
    <group position={[0, -0.2, 0]}>
      <ContactShadow />
      <Cylinder radius={3.9} height={0.32} position={[0, -0.16, 0]} color={colors.plinth} segments={tier === "high" ? 64 : 32} />
      <Cylinder radius={3.95} height={0.06} position={[0, -0.32, 0]} color={colors.plinthEdge} segments={tier === "high" ? 64 : 32} />

      <Grow amount={plan.groundwork}>
        <Box size={[5.4, 0.2, 4.0]} position={[0, 0.1, 0]} color={colors.nightSoft} />
        <Box size={[5.0, 0.04, 3.6]} position={[0, 0.22, 0]} color={colors.floor} />
      </Grow>

      <Reveal show={plan.structure} mode="grow" delay={0.05}>
        <Box size={[4.9, 2.5, 0.16]} position={[0, 1.45, -1.75]} color={colors.wall} />
        <Box size={[0.16, 2.5, 3.5]} position={[-2.45, 1.45, -0.05]} color={colors.wall} />
        <Box size={[0.16, 2.5, 3.5]} position={[2.45, 1.45, -0.05]} color={colors.wall} />
        <Box size={[0.36, 2.5, 0.3]} position={[-2.3, 1.45, 1.62]} color={colors.nightSoft} />
        <Box size={[0.36, 2.5, 0.3]} position={[2.3, 1.45, 1.62]} color={colors.nightSoft} />
        <Box size={[1.4, 0.55, 0.24]} position={[-1.45, 0.48, 1.64]} color={colors.wall} />
        <Box size={[1.4, 0.55, 0.24]} position={[1.45, 0.48, 1.64]} color={colors.wall} />
        <Box size={[1.4, 1.35, 0.04]} position={[-1.45, 1.42, 1.66]} color={colors.glass} opacity={0.32} />
        <Box size={[1.4, 1.35, 0.04]} position={[1.45, 1.42, 1.66]} color={colors.glass} opacity={0.32} />
        <Box size={[4.95, 0.5, 0.32]} position={[0, 2.45, 1.62]} color={colors.night} />
      </Reveal>

      <Reveal show={plan.structure} mode="drop" delay={0.25} position={[0, 0, 0]}>
        <Box size={[5.4, 0.24, 4.1]} position={[0, 2.82, -0.05]} color={colors.night} />
        {Array.from({ length: 8 }, (_, stripe) => (
          <Box key={stripe} size={[0.62, 0.05, 0.9]} rotation={[0.38, 0, 0]} position={[-2.17 + stripe * 0.62, 2.12, 2.08]} color={stripe % 2 ? colors.white : colors.brand} />
        ))}
      </Reveal>

      <group ref={doorLeft} position={[-0.35, 0, 0]}>
        <Reveal show={plan.structure} mode="pop" delay={0.4}><Box size={[0.68, 1.8, 0.04]} position={[0, 1.12, 1.7]} color={colors.glass} opacity={0.45} /></Reveal>
      </group>
      <group ref={doorRight} position={[0.35, 0, 0]}>
        <Reveal show={plan.structure} mode="pop" delay={0.45}><Box size={[0.68, 1.8, 0.04]} position={[0, 1.12, 1.7]} color={colors.glass} opacity={0.45} /></Reveal>
      </group>

      {(["hardware", "phones", "clothing", "general"] as const).map((activity) => (
        <Reveal key={activity} show={plan.activity === activity} mode="pop" delay={0.3}><ActivityProps activity={activity} tier={tier} /></Reveal>
      ))}

      <Reveal show={plan.interior} mode="pop" delay={0.1}>
        <Box size={[1.5, 0.85, 0.6]} position={[0, 0.65, -0.55]} color={colors.nightSoft} />
        <Box size={[1.6, 0.06, 0.7]} position={[0, 1.1, -0.55]} color={colors.white} />
        <Box size={[0.36, 0.24, 0.3]} position={[0.4, 1.26, -0.55]} color={colors.night} emissive={colors.brand} />
      </Reveal>

      <Reveal show={plan.lights} mode="drop" position={[0, 0, 0]}>
        {[-1.4, 0, 1.4].map((x) => <Cylinder key={x} radius={0.13} height={0.08} position={[x, 2.48, 0.1]} color={colors.bulb} />)}
      </Reveal>

      <Reveal show={plan.finished} mode="pop" delay={0.15}>
        {[-2.85, 2.85].map((x) => (
          <group key={x} position={[x, 0.2, 2.3]}>
            <Cylinder radius={0.2} height={0.36} position={[0, 0.18, 0]} color={colors.nightSoft} />
            <mesh position={[0, 0.62, 0]}><icosahedronGeometry args={[0.36, tier === "high" ? 1 : 0]} /><meshStandardMaterial color={colors.leaf} roughness={0.8} flatShading /></mesh>
          </group>
        ))}
        <group position={[3.25, 0, 0.9]}>
          <Cylinder radius={0.05} height={2.6} position={[0, 1.3, 0]} color={colors.nightSoft} />
          <mesh position={[0, 2.62, 0]}><sphereGeometry args={[0.16, 16, 12]} /><meshStandardMaterial color={colors.bulb} emissive={colors.bulb} emissiveIntensity={1.2} /></mesh>
        </group>
        <Box size={[0.5, 0.2, 0.03]} position={[0, 1.55, 1.76]} color={colors.white} />
        <Box size={[0.36, 0.06, 0.01]} position={[0, 1.55, 1.78]} color={colors.leaf} />
      </Reveal>

      <pointLight ref={light} position={[0, 2.1, 0.4]} color={colors.bulb} intensity={0} distance={7} decay={1.6} />
      <Confetti active={plan.welcome} count={tier === "high" ? 60 : 24} />
    </group>
  );
}

/**
 * Canvas : DPR plafonné, pas d'antialiasing ni de puissance maximale sur un appareil modeste,
 * aucun post-traitement, aucune ombre dynamique. Signale toute perte de contexte WebGL pour
 * basculer vers le rendu léger.
 */
export default function ShopScene3D({ plan, stage, tier, logo, onContextLost }: { plan: ScenePlan; stage: SceneStage; tier: Tier; logo: string; onContextLost: () => void }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    let onScreen = true;
    const sync = () => setVisible(onScreen && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { onScreen = Boolean(entry?.isIntersecting); sync(); });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);
  return (
    <div ref={wrapper} className="absolute inset-0">
      <Canvas
        frameloop={visible ? "demand" : "never"}
        dpr={tier === "high" ? [1, 1.75] : [1, 1.25]}
        camera={{ position: [8, 6, 10], fov, near: 0.1, far: 80 }}
        gl={{ antialias: tier === "high", powerPreference: tier === "high" ? "high-performance" : "low-power", alpha: true, preserveDrawingBuffer: false }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.domElement.addEventListener("webglcontextlost", (event) => { event.preventDefault(); onContextLost(); }, { once: true });
          if (process.env.NODE_ENV !== "production") (window as unknown as { __qadrScene?: THREE.WebGLRenderer }).__qadrScene = gl;
        }}
      >
        <ambientLight intensity={0.85} />
        <hemisphereLight args={["#ffffff", colors.plinthEdge, 0.7]} />
        <directionalLight position={[5, 9, 7]} intensity={1.6} />
        <Rig stage={stage} tier={tier} />
        <Shop plan={plan} tier={tier} />
        <group position={[0, -0.2, 0]}>
          <Reveal show={plan.sign} mode="pop" delay={0.15}><Sign text={plan.signText} logo={plan.logo ? logo : null} tier={tier} /></Reveal>
        </group>
      </Canvas>
    </div>
  );
}
