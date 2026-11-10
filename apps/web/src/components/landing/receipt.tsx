import { cn } from "@/components/ui/cn";

/**
 * Contenu d'un ticket d'exemple, partagé par la version HTML (rendu serveur, repli sans WebGL) et la version
 * 3D (texture dessinée dans un canvas). Les noms de produits restent ceux saisis par le commerçant : ils ne
 * sont pas traduits. Toutes les valeurs sont des données de démonstration.
 */
export type ReceiptData = {
  dir: "ltr" | "rtl";
  shop: string;
  sale: string;
  lines: { label: string; detail: string; amount: string }[];
  totals: { label: string; amount: string; strong?: boolean }[];
  thanks: string;
};

export function ReceiptPaper({ data, className }: { data: ReceiptData; className?: string }) {
  return (
    <div dir={data.dir} className={cn("receipt-edge bg-white px-[9%] pt-[10%] pb-[16%] font-mono text-[clamp(0.56rem,calc(1.6vw+0.2rem),0.68rem)] leading-[1.55] text-ink", className)}>
      <p className="m-0 text-center text-[clamp(0.64rem,calc(1.8vw+0.25rem),0.78rem)] font-bold">{data.shop}</p>
      <p className="m-0 text-center text-fg-subtle">{data.sale}</p>
      <div className="my-2.5 border-t border-dashed border-line-strong" />
      {data.lines.map((line) => (
        <div key={line.label} className="mb-1.5">
          <p className="m-0 font-semibold" dir="ltr">{line.label}</p>
          <p className="m-0 flex justify-between gap-2 text-fg-muted"><span dir="ltr">{line.detail}</span><span dir="ltr" className="text-ink">{line.amount}</span></p>
        </div>
      ))}
      <div className="my-2.5 border-t border-dashed border-line-strong" />
      {data.totals.map((total) => (
        <p key={total.label} className={cn("m-0 flex justify-between gap-2", total.strong && "text-[clamp(0.66rem,calc(1.8vw+0.28rem),0.8rem)] font-bold")}>
          <span>{total.label}</span><span dir="ltr">{total.amount}</span>
        </p>
      ))}
      <p className="m-0 mt-3 text-center text-fg-subtle">{data.thanks}</p>
    </div>
  );
}
