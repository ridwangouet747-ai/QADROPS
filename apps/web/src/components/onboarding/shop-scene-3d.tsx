"use client";

/*
 * Scène 3D de l'inscription (mission 08, reprise le 2026-11-10) : une boutique en coupe construite avec des
 * primitives Three.js, sans modèle ni texture externe. La boutique est ouverte (pas de toit au-dessus de la
 * salle, mur côté caméra abaissé) pour que l'intérieur se lise d'un coup d'œil, et chaque secteur a son
 * propre aménagement. Rendu à la demande (frameloop="demand") : chaque transition GSAP demande une image,
 * rien ne tourne au repos. Hors écran ou onglet masqué, la boucle est arrêtée (frameloop="never").
 * Géométries et matériaux sont partagés (un cube, un cylindre, une sphère, un matériau par couleur) et
 * libérés au démontage ; les textures créées à la main sont libérées explicitement.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import * as THREE from "three";
import { fittedCamera, sceneFov, type SceneFrame } from "@/lib/onboarding/scene-framing";
import { activities, samePlan, type Activity, type ScenePlan, type SceneStage } from "@/lib/onboarding/wizard";

gsap.registerPlugin(useGSAP);

type Tier = "high" | "low";
type Triple = [number, number, number];
/* Bleus de la marque (jetons de globals.css) et quelques teintes de matière pour les objets (sable, acier, terre cuite). */
const colors = {
  plinth: "#dbe5fa", plinthEdge: "#c5d4f7", night: "#03108e", nightSoft: "#0b1ea6", wall: "#fbfcff", floor: "#edf2fb",
  brand: "#1853d7", brandSoft: "#5d88e8", glass: "#c3d4f8", warm: "#95b1f0", sand: "#d8cfbf", sandDark: "#b9ad98",
  steel: "#636c82", leaf: "#3f9c74", bulb: "#ffd166", clay: "#c98562", white: "#ffffff",
};

/* Ressources partagées : ~200 objets, mais trois géométries et un matériau par couleur. dispose() libère la
   mémoire graphique sans détruire l'objet : un remontage (mode strict de React) les renvoie à la carte. */
const kit = { box: null as THREE.BoxGeometry | null, cylinder: null as THREE.CylinderGeometry | null, sphere: null as THREE.SphereGeometry | null, materials: new Map<string, THREE.MeshStandardMaterial>() };
const boxGeometry = () => (kit.box ??= new THREE.BoxGeometry(1, 1, 1));
const cylinderGeometry = () => (kit.cylinder ??= new THREE.CylinderGeometry(1, 1, 1, 18));
const sphereGeometry = () => (kit.sphere ??= new THREE.SphereGeometry(1, 14, 10));
function paint(color: string, emissive?: string, opacity?: number) {
  const key = `${color}|${emissive ?? ""}|${opacity ?? 1}`;
  let material = kit.materials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.02, emissive: emissive ?? "#000000", emissiveIntensity: emissive ? 0.9 : 0, transparent: opacity !== undefined, opacity: opacity ?? 1, depthWrite: opacity === undefined });
    kit.materials.set(key, material);
  }
  return material;
}
function disposeKit() {
  kit.box?.dispose(); kit.cylinder?.dispose(); kit.sphere?.dispose();
  kit.materials.forEach((material) => material.dispose());
}

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

function Box({ size, position, color, rotation, emissive, opacity }: { size: Triple; position: Triple; color: string; rotation?: Triple; emissive?: string; opacity?: number }) {
  return <mesh geometry={boxGeometry()} material={paint(color, emissive, opacity)} position={position} rotation={rotation} scale={size} dispose={null} />;
}

function Cylinder({ radius, height, position, color, rotation, emissive }: { radius: number; height: number; position: Triple; color: string; rotation?: Triple; emissive?: string }) {
  return <mesh geometry={cylinderGeometry()} material={paint(color, emissive)} position={position} rotation={rotation} scale={[radius, height, radius]} dispose={null} />;
}

function Ball({ radius, position, color, emissive }: { radius: number; position: Triple; color: string; emissive?: string }) {
  return <mesh geometry={sphereGeometry()} material={paint(color, emissive)} position={position} scale={radius} dispose={null} />;
}

/** Socle rond : sa propre géométrie (beaucoup de segments pour un bord lisse), libérée par React Three Fiber. */
function Disc({ radius, height, y, color, segments }: { radius: number; height: number; y: number; color: string; segments: number }) {
  return (
    <mesh position={[0, y, 0]} material={paint(color)}>
      <cylinderGeometry args={[radius, radius, height, segments]} />
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
    <group ref={board} position={[0, 3.39, -1.2]}>
      {/* L'enseigne tient debout sur l'avancée du toit, au fond : elle ne cache jamais l'intérieur. */}
      <Box size={[0.1, 0.5, 0.1]} position={[-1.05, -0.5, -0.08]} color={colors.nightSoft} />
      <Box size={[0.1, 0.5, 0.1]} position={[1.05, -0.5, -0.08]} color={colors.nightSoft} />
      <Box size={[2.9, 0.82, 0.12]} position={[0, 0, -0.05]} color={colors.night} />
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[2.78, 0.7]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ Mobilier */

const floorY = 0.24;
const cycle = <T,>(list: readonly T[], index: number) => list[((index % list.length) + list.length) % list.length]!;

/** Rayonnage adossé au mur du fond : montants, tablettes, et trois emplacements par tablette. */
function Shelf({ x, z = -1.4, tier, items }: { x: number; z?: number; tier: Tier; items: (level: number, slot: number) => ReactNode }) {
  const levels = tier === "high" ? [0.45, 1.05, 1.65] : [0.6, 1.4];
  return (
    <group position={[x, floorY, z]}>
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

/** Panneau accroché au mur de gauche (outils, accessoires). */
function WallBoard({ z, y = 1.65, width, height, children }: { z: number; y?: number; width: number; height: number; children: ReactNode }) {
  return (
    <group position={[-2.33, y, z]}>
      <Box size={[0.05, height, width]} position={[0, 0, 0]} color={colors.plinthEdge} />
      <group position={[0.05, 0, 0]}>{children}</group>
    </group>
  );
}

type SetProps = { show: boolean; tier: Tier };
/* Chaque groupe d'un aménagement apparaît à son tour : le changement de secteur se voit se construire. */
const part = (show: boolean, index: number) => ({ show, mode: "pop" as const, delay: 0.08 + index * 0.13 });

/** Quincaillerie : peinture et pièces en rayon, tubes debout, palette de ciment, briques, panneau d'outils. */
function HardwareSet({ show, tier }: SetProps) {
  const dense = tier === "high";
  const cans = [colors.brand, colors.white, colors.warm, colors.nightSoft];
  return (
    <group>
      <Reveal {...part(show, 0)}>
        <Shelf x={-1.5} tier={tier} items={(level, slot) => (
          <>
            <Cylinder radius={0.1} height={0.22} position={[0, 0.11, 0]} color={cycle(cans, level + slot)} />
            <Cylinder radius={0.105} height={0.03} position={[0, 0.23, 0]} color={colors.steel} />
          </>
        )} />
        <Shelf x={-0.05} tier={tier} items={(level, slot) => (level + slot) % 2
          ? <Box size={[0.3, 0.2, 0.3]} position={[0, 0.1, 0]} color={slot % 2 ? colors.sand : colors.sandDark} />
          : <Cylinder radius={0.05} height={0.34} rotation={[0, 0, Math.PI / 2]} position={[0, 0.06, 0]} color={colors.steel} />} />
      </Reveal>
      <Reveal {...part(show, 1)}>
        <group position={[1.75, floorY, -1.3]}>
          <Box size={[0.8, 0.14, 0.55]} position={[0, 0.07, 0]} color={colors.nightSoft} />
          <Box size={[0.8, 0.06, 0.08]} position={[0, 1.2, -0.22]} color={colors.steel} />
          {(dense ? [-0.3, -0.18, -0.06, 0.06, 0.18, 0.3] : [-0.26, -0.09, 0.09, 0.26]).map((x, index) => (
            <Cylinder key={x} radius={0.04} height={1.7 + (index % 3) * 0.2} rotation={[-0.08, 0, 0]} position={[x, 0.95 + (index % 3) * 0.1, -0.08]} color={cycle([colors.steel, colors.white, colors.brand], index)} />
          ))}
        </group>
      </Reveal>
      <Reveal {...part(show, 2)}>
        {/* Palette de sacs de ciment, au milieu de la salle. */}
        <group position={[1.0, floorY, 0.2]}>
          <Box size={[1.2, 0.08, 0.86]} position={[0, 0.04, 0]} color={colors.sandDark} />
          {[0, 1, 2].flatMap((layer) => (layer === 2 ? [0] : [-0.28, 0.28]).map((x) => (
            <group key={`${layer}-${x}`} position={[x, 0.17 + layer * 0.19, 0]} rotation={[0, layer % 2 ? 0.08 : -0.05, 0]}>
              <Box size={[0.52, 0.18, 0.72]} position={[0, 0, 0]} color={layer % 2 ? colors.sandDark : colors.sand} />
              <Box size={[0.525, 0.185, 0.16]} position={[0, 0, 0]} color={colors.brand} />
            </group>
          )))}
        </group>
        {/* Tas de briques, près de la vitrine. */}
        <group position={[1.6, floorY, 1.05]}>
          {(dense ? [0, 1, 2] : [0, 1]).flatMap((layer) => [-0.24, 0, 0.24].flatMap((x) => [-0.07, 0.07].map((z) => (
            <Box key={`${layer}-${x}-${z}`} size={[0.21, 0.1, 0.11]} position={[x + (layer % 2 ? 0.06 : 0), 0.06 + layer * 0.115, z]} color={colors.clay} />
          ))))}
        </group>
      </Reveal>
      <Reveal {...part(show, 3)}>
        <WallBoard z={-0.55} width={1.7} height={1.1}>
          {/* Marteau, scie, clé, niveau. */}
          <Box size={[0.04, 0.5, 0.05]} position={[0, -0.05, -0.6]} color={colors.sandDark} />
          <Box size={[0.07, 0.11, 0.24]} position={[0, 0.24, -0.6]} color={colors.night} />
          <Box size={[0.03, 0.2, 0.5]} position={[0, 0.12, -0.08]} color={colors.steel} />
          <Box size={[0.05, 0.2, 0.16]} position={[0, 0.12, -0.38]} color={colors.sandDark} />
          <Box size={[0.03, 0.5, 0.07]} position={[0, -0.06, 0.36]} rotation={[0.5, 0, 0]} color={colors.steel} />
          <Box size={[0.04, 0.09, 0.7]} position={[0, -0.36, -0.05]} color={colors.bulb} />
          <Box size={[0.04, 0.42, 0.06]} position={[0, 0.02, 0.66]} color={colors.brand} />
        </WallBoard>
        {/* Pots de peinture au sol. */}
        {([[0.0, 0.95, colors.brand], [0.36, 1.12, colors.white], [-0.3, 1.2, colors.warm]] as const).map(([x, z, color]) => (
          <group key={x} position={[x, floorY, z]}>
            <Cylinder radius={0.15} height={0.28} position={[0, 0.14, 0]} color={color} />
            <Cylinder radius={0.155} height={0.03} position={[0, 0.29, 0]} color={colors.steel} />
          </group>
        ))}
      </Reveal>
    </group>
  );
}

/** Téléphonie : mur d'écrans allumés, vitrines, grand téléphone de présentation, accessoires. */
function PhonesSet({ show, tier }: SetProps) {
  const dense = tier === "high";
  const screens = [colors.brand, colors.brandSoft, colors.glass];
  const columns = dense ? [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5] : [-1.35, -0.45, 0.45, 1.35];
  return (
    <group>
      <Reveal {...part(show, 0)}>
        <group position={[-0.45, 1.6, -1.63]}>
          <Box size={[3.6, 1.55, 0.06]} position={[0, 0, 0]} color={colors.night} />
          {[0.36, -0.36].flatMap((y, row) => columns.map((x, column) => (
            <group key={`${row}-${x}`} position={[x, y, 0.05]}>
              <Box size={[0.3, 0.56, 0.04]} position={[0, 0, 0]} color={colors.nightSoft} />
              <Box size={[0.25, 0.49, 0.012]} position={[0, 0, 0.022]} color={cycle(screens, row + column)} emissive={cycle([colors.brand, colors.brandSoft], row + column)} />
            </group>
          )))}
        </group>
      </Reveal>
      <Reveal {...part(show, 1)}>
        {[0.1, 1.42].map((x) => (
          <group key={x} position={[x, floorY, 0.3]}>
            <Box size={[1.1, 0.7, 0.62]} position={[0, 0.35, 0]} color={colors.white} />
            <Box size={[1.1, 0.05, 0.62]} position={[0, 0.72, 0]} color={colors.brand} />
            <Box size={[1.1, 0.22, 0.62]} position={[0, 0.86, 0]} color={colors.glass} opacity={0.3} />
            {(dense ? [-0.36, -0.12, 0.12, 0.36] : [-0.3, 0, 0.3]).map((px, index) => (
              <group key={px} position={[px, 1.03, 0]} rotation={[-0.75, 0, 0]}>
                <Box size={[0.17, 0.32, 0.03]} position={[0, 0, 0]} color={colors.night} />
                <Box size={[0.14, 0.27, 0.01]} position={[0, 0, 0.018]} color={cycle(screens, index)} emissive={colors.brand} />
              </group>
            ))}
          </group>
        ))}
      </Reveal>
      <Reveal {...part(show, 2)}>
        {/* Grand téléphone de présentation, dans l'angle. */}
        <group position={[1.82, floorY, -1.15]} rotation={[0, -0.45, 0]}>
          <Box size={[0.7, 0.12, 0.46]} position={[0, 0.06, 0]} color={colors.nightSoft} />
          <Box size={[0.66, 1.42, 0.09]} position={[0, 0.86, 0]} color={colors.night} />
          <Box size={[0.56, 1.26, 0.012]} position={[0, 0.88, 0.05]} color={colors.brandSoft} emissive={colors.brand} />
          <Box size={[0.18, 0.03, 0.014]} position={[0, 0.31, 0.052]} color={colors.white} />
        </group>
      </Reveal>
      <Reveal {...part(show, 3)}>
        <WallBoard z={-0.5} width={1.8} height={1.3}>
          {[0.42, 0, -0.42].flatMap((y, row) => (dense ? [-0.68, -0.34, 0, 0.34, 0.68] : [-0.56, 0, 0.56]).map((z, column) => (
            <Box key={`${row}-${z}`} size={[0.05, 0.3, 0.2]} position={[0, y, z]} color={cycle([colors.brand, colors.white, colors.warm, colors.nightSoft, colors.brandSoft], row * 2 + column)} />
          )))}
        </WallBoard>
        {/* Borne de recharge près de l'entrée. */}
        <group position={[0.75, floorY, 1.12]}>
          <Cylinder radius={0.26} height={0.52} position={[0, 0.26, 0]} color={colors.white} />
          <Cylinder radius={0.2} height={0.03} position={[0, 0.535, 0]} color={colors.brandSoft} emissive={colors.brand} />
        </group>
      </Reveal>
    </group>
  );
}

/** Vêtements : portant au mur, cabine d'essayage, mannequins, table de piles pliées, miroir et chaussures. */
function ClothingSet({ show, tier }: SetProps) {
  const dense = tier === "high";
  const cloth = [colors.brand, colors.white, colors.warm, colors.night, colors.brandSoft, colors.sand];
  const hangers = dense ? 10 : 7;
  return (
    <group>
      <Reveal {...part(show, 0)}>
        <group position={[-0.6, floorY, -1.42]}>
          <Cylinder radius={0.03} height={1.72} position={[-1.45, 0.86, 0]} color={colors.steel} />
          <Cylinder radius={0.03} height={1.72} position={[1.45, 0.86, 0]} color={colors.steel} />
          <Cylinder radius={0.025} height={2.9} rotation={[0, 0, Math.PI / 2]} position={[0, 1.7, 0]} color={colors.steel} />
          {Array.from({ length: hangers }, (_, index) => {
            const x = -1.25 + (index * 2.5) / (hangers - 1);
            const length = index % 3 === 1 ? 0.5 : 0.78;
            return (
              <group key={index} position={[x, 0, 0]}>
                <Box size={[0.2, 0.03, 0.03]} position={[0, 1.62, 0.02]} color={colors.steel} />
                <Box size={[0.22, length, 0.1]} position={[0, 1.6 - length / 2, 0.04]} color={cycle(cloth, index)} />
              </group>
            );
          })}
          <Box size={[2.9, 0.06, 0.42]} position={[0, 0.32, 0.02]} color={colors.wall} />
          {(dense ? [-1.1, -0.55, 0, 0.55, 1.1] : [-0.9, 0, 0.9]).map((x, index) => <Box key={x} size={[0.34, 0.12, 0.3]} position={[x, 0.41, 0.02]} color={cycle(cloth, index + 2)} />)}
        </group>
      </Reveal>
      <Reveal {...part(show, 1)}>
        {/* Cabine d'essayage dans l'angle. */}
        <group position={[1.78, floorY, -1.05]}>
          <Cylinder radius={0.03} height={1.9} position={[-0.5, 0.95, 0.3]} color={colors.steel} />
          <Cylinder radius={0.03} height={1.9} position={[0.5, 0.95, 0.3]} color={colors.steel} />
          <Cylinder radius={0.025} height={1.06} rotation={[0, 0, Math.PI / 2]} position={[0, 1.88, 0.3]} color={colors.steel} />
          {[-0.36, -0.12, 0.12, 0.36].map((x, index) => <Box key={x} size={[0.25, 1.6, 0.07]} position={[x, 1.05, 0.3 + (index % 2 ? 0.03 : -0.03)]} color={index % 2 ? colors.brandSoft : colors.warm} />)}
        </group>
      </Reveal>
      <Reveal {...part(show, 2)}>
        {([[0.35, 0.95, colors.brand], [1.55, 0.7, colors.white]] as const).map(([x, z, color]) => (
          <group key={x} position={[x, floorY, z]}>
            <Cylinder radius={0.2} height={0.05} position={[0, 0.025, 0]} color={colors.steel} />
            <Cylinder radius={0.025} height={0.72} position={[0, 0.4, 0]} color={colors.steel} />
            <Box size={[0.32, 0.16, 0.2]} position={[0, 0.78, 0]} color={colors.nightSoft} />
            <Box size={[0.38, 0.5, 0.22]} position={[0, 1.1, 0]} color={color} />
            <Ball radius={0.11} position={[0, 1.5, 0]} color={colors.sand} />
          </group>
        ))}
      </Reveal>
      <Reveal {...part(show, 3)}>
        {/* Table de présentation : piles pliées. */}
        <group position={[0.85, floorY, -0.3]}>
          <Box size={[1.1, 0.42, 0.62]} position={[0, 0.21, 0]} color={colors.white} />
          {[-0.36, 0, 0.36].flatMap((x, pile) => [0, 1, 2].slice(0, dense ? 3 : 2).map((layer) => (
            <Box key={`${x}-${layer}`} size={[0.28, 0.07, 0.36]} position={[x, 0.46 + layer * 0.075, 0]} color={cycle(cloth, pile * 2 + layer)} />
          )))}
        </group>
        {/* Miroir et étagères à chaussures, sur le mur de gauche. */}
        <group position={[-2.33, floorY, 0]}>
          <Box size={[0.05, 1.7, 0.72]} position={[0, 1.0, -1.05]} color={colors.night} />
          <Box size={[0.03, 1.56, 0.6]} position={[0.035, 1.0, -1.05]} color={colors.glass} emissive={colors.warm} />
          {[1.0, 1.55].map((y, row) => (
            <group key={y} position={[0.16, y, -0.1]}>
              <Box size={[0.3, 0.05, 1.1]} position={[0, 0, 0]} color={colors.wall} />
              {[-0.38, 0, 0.38].map((z, index) => <Box key={z} size={[0.22, 0.11, 0.24]} position={[0, 0.08, z]} color={cycle(cloth, row + index * 2)} />)}
            </group>
          ))}
        </group>
      </Reveal>
    </group>
  );
}

/** Commerce général : conserves et bouteilles en rayon, réfrigérateur, cageots de produits frais, sacs de riz, bidons. */
function GeneralSet({ show, tier }: SetProps) {
  const dense = tier === "high";
  const labels = [colors.warm, colors.brand, colors.leaf, colors.brandSoft, colors.clay, colors.bulb];
  const shelfItem = (level: number, slot: number, offset: number) => {
    const kind = (level + slot + offset) % 3;
    if (kind === 0) return <Box size={[0.26, 0.28, 0.22]} position={[0, 0.14, 0]} color={cycle(labels, level * 2 + slot + offset)} />;
    if (kind === 1) return (
      <>
        <Cylinder radius={0.075} height={0.2} position={[-0.09, 0.1, 0]} color={cycle(labels, level + slot * 2 + offset)} />
        <Cylinder radius={0.075} height={0.2} position={[0.09, 0.1, 0]} color={cycle(labels, level + slot * 2 + offset + 3)} />
      </>
    );
    return (
      <>
        {[-0.11, 0, 0.11].map((x, index) => <Cylinder key={x} radius={0.04} height={0.3} position={[x, 0.15, 0]} color={cycle([colors.leaf, colors.brand, colors.clay], index + level + offset)} />)}
      </>
    );
  };
  return (
    <group>
      <Reveal {...part(show, 0)}>
        <Shelf x={-1.5} tier={tier} items={(level, slot) => shelfItem(level, slot, 0)} />
        <Shelf x={-0.05} tier={tier} items={(level, slot) => shelfItem(level, slot, 1)} />
      </Reveal>
      <Reveal {...part(show, 1)}>
        {/* Réfrigérateur vitré dans l'angle. */}
        <group position={[1.75, floorY, -1.32]}>
          <Box size={[0.95, 1.9, 0.62]} position={[0, 0.95, 0]} color={colors.white} />
          <Box size={[0.95, 0.26, 0.64]} position={[0, 1.78, 0]} color={colors.brand} />
          <Box size={[0.8, 1.42, 0.02]} position={[0, 0.88, 0.315]} color={colors.glass} emissive={colors.brandSoft} />
          {[0.45, 0.9, 1.35].map((y, row) => (
            <group key={y} position={[0, y, 0.33]}>
              <Box size={[0.78, 0.03, 0.02]} position={[0, -0.02, 0]} color={colors.white} />
              {[-0.26, 0, 0.26].map((x, index) => <Box key={x} size={[0.12, 0.22, 0.02]} position={[x, 0.11, 0]} color={cycle([colors.leaf, colors.clay, colors.brand, colors.bulb], row + index)} />)}
            </group>
          ))}
          <Box size={[0.04, 0.9, 0.05]} position={[0.42, 0.95, 0.35]} color={colors.night} />
        </group>
      </Reveal>
      <Reveal {...part(show, 2)}>
        {/* Cageots de produits frais. */}
        {([[0.7, 0.3, colors.leaf], [1.45, 0.3, colors.bulb], [1.1, 1.0, colors.clay]] as const).map(([x, z, color]) => (
          <group key={x} position={[x, floorY, z]}>
            <Box size={[0.62, 0.3, 0.46]} position={[0, 0.15, 0]} color={colors.sandDark} />
            <Box size={[0.54, 0.04, 0.38]} position={[0, 0.3, 0]} color={colors.sand} />
            {[-0.17, 0, 0.17].flatMap((px) => (dense ? [-0.09, 0.09] : [0]).map((pz) => <Ball key={`${px}-${pz}`} radius={0.085} position={[px, 0.37, pz]} color={color} />))}
          </group>
        ))}
      </Reveal>
      <Reveal {...part(show, 3)}>
        {/* Sacs de riz empilés et bidons. */}
        <group position={[-0.1, floorY, 1.05]}>
          {[0, 1, 2].map((layer) => <Box key={layer} size={[0.56, 0.2, 0.38]} position={[layer === 1 ? 0.05 : 0, 0.1 + layer * 0.205, 0]} rotation={[0, layer % 2 ? 0.12 : -0.06, 0]} color={layer % 2 ? colors.sandDark : colors.sand} />)}
        </group>
        {[0.05, 0.36].map((x) => (
          <group key={x} position={[x, floorY, -0.45]}>
            <Box size={[0.24, 0.4, 0.3]} position={[0, 0.2, 0]} color={colors.brand} />
            <Cylinder radius={0.045} height={0.06} position={[0.05, 0.43, 0.08]} color={colors.white} />
          </group>
        ))}
        {/* Bouteilles sur le mur de gauche. */}
        <group position={[-2.17, floorY, -0.45]}>
          {[1.1, 1.65].map((y, row) => (
            <group key={y} position={[0, y, 0]}>
              <Box size={[0.3, 0.05, 1.5]} position={[0, 0, 0]} color={colors.wall} />
              {(dense ? [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6] : [-0.5, -0.17, 0.17, 0.5]).map((z, index) => <Cylinder key={z} radius={0.05} height={0.3} position={[0, 0.18, z]} color={cycle([colors.leaf, colors.brand, colors.clay, colors.white], row + index)} />)}
            </group>
          ))}
        </group>
      </Reveal>
    </group>
  );
}

const activitySets: Record<Activity, (props: SetProps) => ReactNode> = { hardware: HardwareSet, phones: PhonesSet, clothing: ClothingSet, general: GeneralSet };

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

/* ------------------------------------------------------------------ Caméra */

/** Zones du cadre couvertes par l'interface (pastilles du haut, légende du bas), en pixels. */
export type SceneInset = SceneFrame["inset"];

/**
 * Caméra : un seul état (position, point visé, décalage du pointeur, recul bref) composé à chaque image.
 * Le cadrage vient de `fittedCamera` : la distance la plus courte qui garde le socle et la boutique
 * entiers dans la zone libre du cadre. Les glissements sont des quickTo qui se recalent sur la nouvelle
 * cible sans repartir de zéro : un changement d'étape, un redimensionnement (bandeau mobile qui se réduit
 * pendant la saisie) et la parallaxe ne se disputent plus la même propriété, d'où l'absence d'à-coups.
 */
function Rig({ stage, tier, inset, activity }: { stage: SceneStage; tier: Tier; inset: SceneInset; activity: Activity | null }) {
  const { camera, invalidate, gl, size } = useThree();
  const rig = useRef({ position: new THREE.Vector3(), target: new THREE.Vector3(), offset: { x: 0 }, pull: { value: 1 } });
  const movers = useRef<((value: number) => void)[] | null>(null);
  const apply = useCallback(() => {
    const { position, target, offset, pull } = rig.current;
    camera.position.copy(position).sub(target).multiplyScalar(pull.value).add(target);
    camera.position.x += offset.x;
    camera.lookAt(target);
    invalidate();
  }, [camera, invalidate]);

  const { top, bottom, side } = inset;
  useEffect(() => {
    if (size.width < 2 || size.height < 2) return;
    const goal = fittedCamera(stage, { width: size.width, height: size.height, inset: { top, bottom, side } });
    const values = [...goal.position, ...goal.target];
    if (!movers.current) {
      // Premier cadrage immédiat ; ensuite tout glisse.
      rig.current.position.set(...(goal.position as Triple));
      rig.current.target.set(...(goal.target as Triple));
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
  }, [stage, size.width, size.height, top, bottom, side, apply]);

  // Changement de secteur : la caméra recule un instant puis revient, le temps que le nouvel aménagement se pose.
  // Un recul (jamais une avancée) : le socle reste entier dans le cadre pendant le mouvement.
  const seen = useRef<Activity | null>(null);
  useEffect(() => {
    const previous = seen.current;
    seen.current = activity;
    if (!activity || !previous || previous === activity) return;
    gsap.fromTo(rig.current.pull, { value: 1.06 }, { value: 1, duration: 0.95, ease: "power3.out", overwrite: true, onUpdate: apply });
  }, [activity, apply]);

  useEffect(() => () => { gsap.killTweensOf([rig.current.position, rig.current.target, rig.current.offset, rig.current.pull]); }, []);

  useEffect(() => {
    if (tier !== "high") return;
    // Parallaxe très discrète au pointeur, uniquement sur ordinateur performant ; elle décale la caméra sans toucher au cadrage d'étape.
    const element = gl.domElement;
    const xTo = gsap.quickTo(rig.current.offset, "x", { duration: 1.2, ease: "power3", onUpdate: apply });
    const onMove = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      xTo(((event.clientX - bounds.left) / bounds.width - 0.5) * 0.4);
    };
    const onLeave = () => xTo(0);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    return () => { element.removeEventListener("pointermove", onMove); element.removeEventListener("pointerleave", onLeave); };
  }, [gl, apply, tier]);
  return null;
}

/* ------------------------------------------------------------------ Boutique */

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
    if (light.current) gsap.to(light.current, { intensity: plan.welcome ? 6 : plan.finished ? 3.2 : plan.lights ? 1.8 : 0, duration: 0.9, ease: "power2.out", overwrite: true, onUpdate: invalidate });
  }, { dependencies: [plan.welcome, plan.finished, plan.lights] });

  return (
    <group position={[0, -0.2, 0]}>
      <ContactShadow />
      <Disc radius={3.9} height={0.32} y={-0.16} color={colors.plinth} segments={tier === "high" ? 64 : 32} />
      <Disc radius={3.95} height={0.06} y={-0.32} color={colors.plinthEdge} segments={tier === "high" ? 64 : 32} />

      <Grow amount={plan.groundwork}>
        <Box size={[5.4, 0.2, 4.0]} position={[0, 0.1, 0]} color={colors.nightSoft} />
        <Box size={[5.0, 0.04, 3.6]} position={[0, 0.22, 0]} color={colors.floor} />
      </Grow>

      {/* Boutique en coupe : mur du fond et mur de gauche entiers, mur de droite (côté caméra) et façade abaissés. */}
      <Reveal show={plan.structure} mode="grow" delay={0.05}>
        <Box size={[4.9, 2.5, 0.16]} position={[0, 1.45, -1.75]} color={colors.wall} />
        <Box size={[0.16, 2.5, 3.5]} position={[-2.45, 1.45, -0.05]} color={colors.wall} />
        <Box size={[0.24, 0.1, 3.6]} position={[-2.45, 2.75, -0.05]} color={colors.night} />
        <Box size={[0.16, 2.5, 0.95]} position={[2.45, 1.45, -1.32]} color={colors.wall} />
        <Box size={[0.24, 0.1, 0.5]} position={[2.45, 2.75, -1.1]} color={colors.night} />
        <Box size={[0.16, 0.75, 2.55]} position={[2.45, 0.575, 0.42]} color={colors.wall} />
        <Box size={[0.24, 0.08, 2.6]} position={[2.45, 0.99, 0.42]} color={colors.night} />
        {/* Façade : murets, vitres basses et montants de la porte. */}
        <Box size={[0.3, 0.95, 0.3]} position={[-2.3, 0.675, 1.62]} color={colors.nightSoft} />
        <Box size={[0.3, 0.95, 0.3]} position={[2.3, 0.675, 1.62]} color={colors.nightSoft} />
        <Box size={[1.4, 0.6, 0.2]} position={[-1.45, 0.5, 1.64]} color={colors.wall} />
        <Box size={[1.4, 0.6, 0.2]} position={[1.45, 0.5, 1.64]} color={colors.wall} />
        <Box size={[1.4, 0.06, 0.26]} position={[-1.45, 0.83, 1.64]} color={colors.night} />
        <Box size={[1.4, 0.06, 0.26]} position={[1.45, 0.83, 1.64]} color={colors.night} />
        <Box size={[0.1, 2.0, 0.12]} position={[-0.75, 1.2, 1.66]} color={colors.night} />
        <Box size={[0.1, 2.0, 0.12]} position={[0.75, 1.2, 1.66]} color={colors.night} />
        <Box size={[1.6, 0.12, 0.14]} position={[0, 2.22, 1.66]} color={colors.night} />
      </Reveal>

      {/* Avancée de toit au fond (porte l'enseigne et les lampes) et store rayé au-dessus de la porte. */}
      <Reveal show={plan.structure} mode="drop" delay={0.25} position={[0, 0, 0]}>
        <Box size={[5.3, 0.2, 1.15]} position={[0, 2.8, -1.3]} color={colors.night} />
        {Array.from({ length: 4 }, (_, stripe) => (
          <Box key={stripe} size={[0.4, 0.05, 0.62]} rotation={[0.42, 0, 0]} position={[-0.6 + stripe * 0.4, 2.16, 1.98]} color={stripe % 2 ? colors.white : colors.brand} />
        ))}
      </Reveal>

      <group ref={doorLeft} position={[-0.35, 0, 0]}>
        <Reveal show={plan.structure} mode="pop" delay={0.4}><Box size={[0.68, 1.8, 0.04]} position={[0, 1.14, 1.68]} color={colors.glass} opacity={0.28} /></Reveal>
      </group>
      <group ref={doorRight} position={[0.35, 0, 0]}>
        <Reveal show={plan.structure} mode="pop" delay={0.45}><Box size={[0.68, 1.8, 0.04]} position={[0, 1.14, 1.68]} color={colors.glass} opacity={0.28} /></Reveal>
      </group>

      {activities.map((activity) => {
        const ActivitySet = activitySets[activity];
        return <ActivitySet key={activity} show={plan.activity === activity} tier={tier} />;
      })}

      {/* Comptoir et caisse, près de l'entrée. */}
      <Reveal show={plan.interior} mode="pop" delay={0.1}>
        <group position={[-1.3, 0, 0.82]}>
          <Box size={[1.4, 0.8, 0.55]} position={[0, 0.64, 0]} color={colors.nightSoft} />
          <Box size={[1.5, 0.06, 0.66]} position={[0, 1.07, 0]} color={colors.white} />
          <Box size={[0.36, 0.2, 0.3]} position={[0.36, 1.2, 0]} color={colors.night} />
          <Box size={[0.3, 0.2, 0.02]} position={[0.36, 1.4, -0.08]} rotation={[-0.3, 0, 0]} color={colors.brandSoft} emissive={colors.brand} />
        </group>
      </Reveal>

      {/* Lampes suspendues au bord de l'avancée de toit. */}
      <Reveal show={plan.lights} mode="drop" position={[0, 0, 0]}>
        {[-1.6, 0, 1.6].map((x) => (
          <group key={x} position={[x, 0, -0.62]}>
            <Box size={[0.05, 0.05, 0.3]} position={[0, 2.68, -0.05]} color={colors.night} />
            <Cylinder radius={0.012} height={0.3} position={[0, 2.52, 0.08]} color={colors.steel} />
            <Ball radius={0.13} position={[0, 2.3, 0.08]} color={colors.bulb} emissive={colors.bulb} />
          </group>
        ))}
      </Reveal>

      <Reveal show={plan.finished} mode="pop" delay={0.15}>
        {[-2.95, 2.95].map((x) => (
          <group key={x} position={[x, 0, 2.4]}>
            <Cylinder radius={0.2} height={0.36} position={[0, 0.18, 0]} color={colors.nightSoft} />
            <mesh position={[0, 0.62, 0]} material={paint(colors.leaf)}><icosahedronGeometry args={[0.36, tier === "high" ? 1 : 0]} /></mesh>
          </group>
        ))}
        <group position={[-3.25, 0, 1.7]}>
          <Cylinder radius={0.05} height={2.6} position={[0, 1.3, 0]} color={colors.nightSoft} />
          <Ball radius={0.16} position={[0, 2.62, 0]} color={colors.bulb} emissive={colors.bulb} />
        </group>
        <Box size={[0.5, 0.2, 0.03]} position={[0, 2.0, 1.74]} color={colors.white} />
        <Box size={[0.36, 0.06, 0.01]} position={[0, 2.0, 1.76]} color={colors.leaf} />
      </Reveal>

      <pointLight ref={light} position={[0, 2.2, 0.2]} color={colors.bulb} intensity={0} distance={7} decay={1.6} />
      <Confetti active={plan.welcome} count={tier === "high" ? 60 : 24} />
    </group>
  );
}

/**
 * Canvas : DPR plafonné, pas d'antialiasing ni de puissance maximale sur un appareil modeste,
 * aucun post-traitement, aucune ombre dynamique. Signale toute perte de contexte WebGL pour
 * basculer vers le rendu léger.
 */
export default function ShopScene3D({ plan, stage, tier, logo, inset, onContextLost }: { plan: ScenePlan; stage: SceneStage; tier: Tier; logo: string; inset: SceneInset; onContextLost: () => void }) {
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
  // Géométries et matériaux partagés : libérés quand la scène quitte la page.
  useEffect(() => disposeKit, []);
  return (
    <div ref={wrapper} className="absolute inset-0">
      <Canvas
        frameloop={visible ? "demand" : "never"}
        dpr={tier === "high" ? [1, 1.75] : [1, 1.25]}
        camera={{ position: [8, 8, 10], fov: sceneFov, near: 0.1, far: 120 }}
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
        <directionalLight position={[6, 10, 7]} intensity={1.6} />
        <Rig stage={stage} tier={tier} inset={inset} activity={plan.activity} />
        <Shop plan={plan} tier={tier} />
        <group position={[0, -0.2, 0]}>
          <Reveal show={plan.sign} mode="pop" delay={0.15}><Sign text={plan.signText} logo={plan.logo ? logo : null} tier={tier} /></Reveal>
        </group>
      </Canvas>
    </div>
  );
}
