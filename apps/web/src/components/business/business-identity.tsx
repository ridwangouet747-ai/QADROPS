import { cn } from "@/components/ui/cn";

/**
 * Logo du commerçant (data URL de 256 px au plus, enregistrée dans `organization.logo`), ou son initiale.
 * `object-contain` : le logo garde ses proportions, quelle que soit sa forme. Même rendu partout où le commerce
 * apparaît (en-tête, choix du commerce, réglages).
 */
export function BusinessLogo({ name, logo, className }: { name: string; logo?: string | null; className?: string }) {
  // Fond et bordure choisis une seule fois : cn() ne départage pas deux classes Tailwind concurrentes.
  const frame = (skin: string) => cn("grid shrink-0 place-items-center overflow-hidden rounded-[12px] border", skin, className ?? "size-10");
  if (logo && logo.startsWith("data:image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- data URL déjà réduite à 256 px ; next/image ne l'optimiserait pas
    return <span className={frame("border-line bg-surface")}><img src={logo} alt="" className="size-full object-contain p-0.5" draggable={false} /></span>;
  }
  return (
    <span aria-hidden="true" className={frame("border-transparent bg-brand-soft text-[0.95rem] font-bold text-brand-strong")}>
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
