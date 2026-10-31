"use client";

/*
 * Illustration statique de secours (mouvement réduit, économie de données, avant chargement) :
 * SVG en ligne, aucun téléchargement. Les éléments apparaissent par simple fondu d'opacité, supprimé
 * si l'utilisateur demande moins de mouvement.
 */
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import type { ScenePlan } from "@/lib/onboarding/wizard";

function Layer({ show, children }: { show: boolean; children: ReactNode }) {
  return <g className={cn("transition-opacity duration-500 motion-reduce:transition-none", show ? "opacity-100" : "opacity-0")}>{children}</g>;
}

export function ShopStatic({ plan, logo }: { plan: ScenePlan; logo: string }) {
  const c = { night: "#1b1a2e", soft: "#2a2942", brand: "#5b4df2", brandSoft: "#8b80f9", lav: "#eeecfe", plinth: "#c9c3fb", glass: "#d9d4fd", warm: "#ff9f7a", sand: "#d8cfbf", leaf: "#3f9c74", bulb: "#ffd166", steel: "#6e6c8a" };
  return (
    <div className="absolute inset-0 grid place-items-center">
      <svg viewBox="0 0 480 360" className="aspect-[4/3] w-full max-w-[560px]" aria-hidden="true">
        <ellipse cx="240" cy="300" rx="200" ry="24" fill="#e4e1f6" />
        <rect x="60" y="268" width="360" height="24" rx="12" fill={c.plinth} />
        <rect x="90" y="252" width="300" height="20" rx="6" fill={c.night} />
        <Layer show={plan.structure}>
          <rect x="105" y="118" width="270" height="137" rx="4" fill="#fff" />
          <rect x="105" y="110" width="20" height="145" rx="4" fill={c.soft} /><rect x="355" y="110" width="20" height="145" rx="4" fill={c.soft} />
          <rect x="92" y="96" width="296" height="26" rx="8" fill={c.night} />
          {Array.from({ length: 7 }, (_, stripe) => <rect key={stripe} x={100 + stripe * 40} y="120" width="40" height="22" fill={stripe % 2 ? "#fff" : c.brand} />)}
          <rect x="130" y="160" width="66" height="56" rx="6" fill={c.lav} /><rect x="284" y="160" width="66" height="56" rx="6" fill={c.lav} />
          <rect x="205" y="165" width="70" height="90" rx="3" fill={c.glass} />
          <rect x="165" y="62" width="150" height="34" rx="10" fill={c.brand} />
          <text x={plan.logo ? 250 : 240} y="84" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">{plan.signText.slice(0, 22)}</text>
        </Layer>
        <Layer show={plan.activity === "hardware"}>
          <rect x="140" y="176" width="14" height="15" rx="3" fill={c.sand} /><rect x="157" y="176" width="14" height="15" rx="3" fill="#b9ad98" /><rect x="142" y="199" width="44" height="13" rx="3" fill="#b9ad98" />
          <rect x="316" y="172" width="26" height="4" rx="2" fill={c.steel} /><rect x="316" y="182" width="26" height="4" rx="2" fill={c.steel} /><rect x="70" y="246" width="30" height="18" rx="5" fill={c.sand} />
        </Layer>
        <Layer show={plan.activity === "phones"}>
          {[140, 156, 172, 292, 310, 328].map((x) => <rect key={x} x={x} y="172" width="12" height="22" rx="3" fill={c.night} />)}
          {[142, 158, 174, 294, 312, 330].map((x) => <rect key={x} x={x} y="175" width="8" height="15" rx="2" fill={c.brandSoft} />)}
        </Layer>
        <Layer show={plan.activity === "clothing"}>
          <rect x="136" y="170" width="56" height="3" fill={c.steel} /><rect x="288" y="170" width="58" height="3" fill={c.steel} />
          {([[140, c.brand], [158, c.warm], [176, c.brandSoft], [292, c.warm], [310, c.night], [328, c.brand]] as const).map(([x, color]) => <rect key={x} x={x} y="174" width="14" height="24" rx="4" fill={color} />)}
        </Layer>
        <Layer show={plan.activity === "general"}>
          {([[139, c.warm], [149, c.brand], [159, c.leaf], [169, c.brandSoft], [179, c.warm]] as const).map(([x, color]) => <rect key={x} x={x} y="172" width="8" height="14" rx="2" fill={color} />)}
          {([[292, c.leaf], [304, c.warm], [316, c.brand], [328, c.sand]] as const).map(([x, color]) => <rect key={x} x={x} y="174" width="10" height="30" rx="3" fill={color} />)}
        </Layer>
        <Layer show={plan.interior}>
          <rect x="216" y="228" width="48" height="26" rx="4" fill={c.soft} />
          <rect x="406" y="168" width="5" height="104" rx="2" fill={c.soft} /><ellipse cx="408" cy="172" rx="6" ry="5" fill={c.bulb} />
        </Layer>
        <Layer show={plan.logo}>
          <circle cx="184" cy="79" r="13" fill="#fff" />
          {logo && <image href={logo} x="174" y="69" width="20" height="20" preserveAspectRatio="xMidYMid meet" />}
        </Layer>
        <Layer show={plan.finished}>
          <ellipse cx="162" cy="188" rx="35" ry="25" fill={c.bulb} opacity="0.22" /><ellipse cx="318" cy="188" rx="35" ry="25" fill={c.bulb} opacity="0.22" />
          <rect x="84" y="238" width="18" height="24" rx="4" fill={c.soft} /><circle cx="93" cy="232" r="14" fill={c.leaf} />
          <rect x="378" y="238" width="18" height="24" rx="4" fill={c.soft} /><circle cx="387" cy="232" r="14" fill={c.leaf} />
          <rect x="222" y="172" width="36" height="14" rx="4" fill="#fff" /><rect x="226" y="177" width="28" height="4" rx="2" fill={c.leaf} />
        </Layer>
        <Layer show={plan.welcome}>
          <ellipse cx="240" cy="79" rx="110" ry="40" fill={c.brandSoft} opacity="0.25" />
        </Layer>
      </svg>
    </div>
  );
}
