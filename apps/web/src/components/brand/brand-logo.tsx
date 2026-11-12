import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/components/ui/cn";
import { brand, type BrandTone } from "@/lib/brand";

/*
 * Logo Qadr Ops : le seul composant qui affiche la marque (page publique, connexion, inscription, application,
 * console). Les fichiers viennent de `lib/brand.ts` ; changer le logo ne demande de toucher aucun écran.
 * Composant sans état : utilisable dans un composant serveur comme dans un composant client.
 *
 * `cn` ne fusionne pas les classes Tailwind en conflit : les classes passées REMPLACENT celles par défaut.
 */

/** La mascotte seule (décor de la page publique, marque dans un logo). Décorative par défaut. */
export function BrandMascot({ tone = "color", className, priority = false, alt = "" }: { tone?: BrandTone; className?: string; priority?: boolean; alt?: string }) {
  const file = tone === "mono" ? brand.markMono : brand.mark;
  // SVG servi tel quel (`unoptimized`) : l'optimiseur d'images de Next.js ne traite pas les SVG.
  return <Image src={file.src} width={file.width} height={file.height} alt={alt} aria-hidden={alt === "" ? true : undefined} unoptimized priority={priority} draggable={false} className={cn("block select-none", className ?? "h-10 w-auto")} />;
}

type BrandLogoProps = {
  /** `full` : marque et nom ; `compact` : marque réduite et nom ; `icon` : marque seule (le nom reste lu par les lecteurs d'écran). */
  variant?: "full" | "compact" | "icon";
  tone?: BrandTone;
  /** Nom en capitales (application) ou en casse de titre (page publique). */
  casing?: "upper" | "title";
  className?: string;
  markClassName?: string;
  nameClassName?: string;
  /** Classes du bloc nom + sous-titre (pour le masquer à certaines largeurs). */
  labelClassName?: string;
  /** Sous-titre facultatif sous le nom (slogan, « Administration »). */
  tagline?: ReactNode;
  priority?: boolean;
};

export function BrandLogo({ variant = "full", tone = "color", casing = "upper", className, markClassName, nameClassName, labelClassName, tagline, priority }: BrandLogoProps) {
  const name = casing === "upper" ? brand.name.toUpperCase() : brand.name;
  const mark = markClassName ?? (variant === "compact" ? "h-8 w-auto shrink-0" : "h-10 w-auto shrink-0");
  // Le nom reste en lettres latines, de gauche à droite, dans toutes les langues.
  return (
    <span dir="ltr" className={cn("inline-flex items-center", variant === "compact" ? "gap-2" : "gap-2.5", className)}>
      <BrandMascot tone={tone} className={mark} priority={priority} />
      {variant === "icon" ? <span className="sr-only">{brand.name}</span> : (
        <span className={labelClassName ?? "grid leading-none"}>
          <strong className={nameClassName ?? cn("font-extrabold tracking-[-0.02em] whitespace-nowrap", variant === "compact" ? "text-[0.95rem]" : "text-[1.05rem]")}>{name}</strong>
          {tagline}
        </span>
      )}
    </span>
  );
}
