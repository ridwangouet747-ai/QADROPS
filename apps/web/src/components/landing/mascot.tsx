import { useId } from "react";
import { cn } from "@/components/ui/cn";

/*
 * Mascotte Qadr Ops : INTERPRÉTATION VECTORIELLE PROVISOIRE du logo officiel (pieuvre bleue qui fait un clin
 * d'œil et tient un sac blanc marqué d'un maillon). Le propriétaire n'a fourni qu'une capture de 118 × 205 px :
 * ce dessin sert la page en attendant le fichier source et ne doit pas devenir l'icône de l'application
 * (docs/design/direction-artistique.md § 5). Couleurs : jetons du thème uniquement.
 */
const v = (name: string) => `var(--color-${name})`;

export function Mascot({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const body = `qm-body-${id}`;
  const limb = `qm-limb-${id}`;
  return (
    <svg viewBox="0 0 220 210" className={cn("block overflow-visible", className)} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={body} cx="34%" cy="26%" r="78%">
          <stop offset="0" style={{ stopColor: v("qadr-400") }} />
          <stop offset="0.5" style={{ stopColor: v("qadr-600") }} />
          <stop offset="1" style={{ stopColor: v("qadr-900") }} />
        </radialGradient>
        <linearGradient id={limb} x1="0" y1="100" x2="0" y2="195" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: v("qadr-600") }} />
          <stop offset="1" style={{ stopColor: v("qadr-800") }} />
        </linearGradient>
      </defs>

      {/* Tentacules arrière */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="17" style={{ stroke: `url(#${limb})` }}>
        <path d="M68 114 C42 118 22 138 30 160 C36 176 60 176 60 160 C60 151 51 148 46 153" />
        <path d="M86 126 C76 152 80 178 102 186 C117 191 126 177 114 171" />
        <path d="M122 126 C126 148 138 166 160 174" />
      </g>
      <g style={{ fill: v("qadr-200") }}>
        <circle cx="37" cy="166" r="2.6" /><circle cx="46" cy="172" r="2.6" /><circle cx="55" cy="170" r="2.4" />
        <circle cx="107" cy="184" r="2.6" /><circle cx="116" cy="181" r="2.4" />
      </g>

      {/* Tête */}
      <ellipse cx="104" cy="82" rx="57" ry="55" style={{ fill: `url(#${body})` }} />
      <ellipse cx="80" cy="50" rx="17" ry="9" transform="rotate(-24 80 50)" style={{ fill: v("white"), opacity: 0.22 }} />

      {/* Visage : un œil ouvert, un clin d'œil */}
      <ellipse cx="85" cy="86" rx="12.5" ry="14.5" style={{ fill: v("white") }} />
      <circle cx="87.5" cy="89" r="7.6" style={{ fill: v("ink") }} />
      <circle cx="90.5" cy="85" r="2.7" style={{ fill: v("white") }} />
      <path d="M112 89 Q122 79 133 89" fill="none" strokeWidth="4.6" strokeLinecap="round" style={{ stroke: v("ink") }} />
      <ellipse cx="73" cy="106" rx="7.5" ry="4.2" style={{ fill: v("qadr-300"), opacity: 0.75 }} />
      <ellipse cx="137" cy="104" rx="7.5" ry="4.2" style={{ fill: v("qadr-300"), opacity: 0.75 }} />
      <path d="M97 105 Q105 114 113 105" fill="none" strokeWidth="4.2" strokeLinecap="round" style={{ stroke: v("ink") }} />

      {/* Sac blanc et son maillon */}
      <g transform="rotate(-8 152 150)">
        <path d="M137 122 C137 100 167 100 167 122" fill="none" strokeWidth="6" strokeLinecap="round" style={{ stroke: v("white") }} />
        <rect x="124" y="119" width="57" height="60" rx="11" style={{ fill: v("white") }} />
        <rect x="168" y="119" width="13" height="60" rx="6" style={{ fill: v("qadr-100") }} />
        <g fill="none" strokeWidth="4.4" style={{ stroke: v("qadr-600") }}>
          <rect x="134" y="140" width="22" height="12" rx="6" transform="rotate(-38 145 146)" />
          <rect x="147" y="148" width="22" height="12" rx="6" transform="rotate(-38 158 154)" />
        </g>
      </g>

      {/* Tentacule qui tient l'anse, devant le sac */}
      <path d="M140 104 C160 90 182 98 176 118 C173 128 162 128 160 121" fill="none" strokeWidth="16" strokeLinecap="round" style={{ stroke: `url(#${limb})` }} />
    </svg>
  );
}

/** Marque du menu : mascotte et nom. Le nom reste en lettres latines dans toutes les langues. */
export function BrandMark({ className, mascotClassName, textClassName }: { className?: string; mascotClassName?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mascot className={cn("size-9 shrink-0", mascotClassName)} />
      <span dir="ltr" className={cn("font-display text-[1.2rem] font-bold tracking-[-0.02em] whitespace-nowrap", textClassName)}>Qadr Ops</span>
    </span>
  );
}
