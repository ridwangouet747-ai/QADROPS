"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Alert } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/components/ui/cn";
import type { ReceiptDocument, ReceiptLanguage } from "@/lib/printing/receipt-document";
import { layoutReceipt, type TicketBlock } from "@/lib/printing/receipt-ticket";

/*
 * Ticket à l'écran (mission 11, phase 5, I-4 et I-5) : il affiche la même mise en page que le ticket
 * thermique (`layoutReceipt`), construite par le serveur dans la langue choisie. Aucun montant n'est
 * calculé ici. En arabe, le ticket est en `dir="rtl"` ; montants, références et dates sont isolés (`<bdi>`
 * et caractères LRI/PDI déjà posés par la mise en page).
 */

const languageNames: Record<ReceiptLanguage, string> = { fr: "Français", en: "English", ar: "العربية" };

/** Rendu pur du ticket (testable sans navigateur). */
export function ReceiptTicketView({ document, width, logoAlt, label }: { document: ReceiptDocument; width: 58 | 80; logoAlt: string; label: string }) {
  const layout = layoutReceipt(document);
  const weight = (block: { bold?: boolean; size?: "normal" | "tall" }) => cn(block.bold && "font-bold", block.size === "tall" && "text-[15px] leading-snug");
  const render = (block: TicketBlock, index: number) => {
    switch (block.type) {
      case "logo": return document.business.logo
        ? <Image key={index} src={document.business.logo} alt={logoAlt} width={180} height={80} unoptimized className="mx-auto mb-2 block h-auto max-h-12 w-auto max-w-[80%] object-contain" />
        : null;
      case "text": return <p key={index} className={cn("m-0 break-words", block.align === "center" ? "text-center" : "text-start", weight(block))}>{block.text}</p>;
      case "pair": return (
        <p key={index} className={cn("m-0 flex items-baseline justify-between gap-3", block.indent && "ps-3", weight(block))}>
          <span className="min-w-0 break-words">{block.start}</span><bdi dir="ltr" className="shrink-0 whitespace-nowrap">{block.end}</bdi>
        </p>
      );
      case "rule": return <hr key={index} className={cn("my-1.5 border-0 border-t border-[#777]", block.char === "=" ? "border-double border-t-[3px]" : "border-dashed")} />;
      case "feed": return <div key={index} aria-hidden="true" style={{ height: `${block.lines * 0.6}em` }} />;
      case "cut": return null;
    }
  };
  return (
    <article className="thermal-receipt leading-normal" dir={document.direction} lang={document.language} style={{ "--receipt-width": `${width}mm` } as React.CSSProperties} aria-label={label}>
      {layout.blocks.map(render)}
    </article>
  );
}

export function ThermalReceipt({ document, languages = ["fr", "en", "ar"] }: { document: ReceiptDocument; languages?: ReceiptLanguage[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [width, setWidth] = useState<58 | 80>(document.paperWidthMm);
  const [printError, setPrintError] = useState(false);

  function printReceipt() {
    setPrintError(false);
    try {
      if (typeof window.print !== "function") throw new Error("print_unavailable");
      window.print();
    } catch {
      setPrintError(true);
    }
  }

  return (
    <main className="receipt-page">
      <div className="mx-auto mb-3 grid max-w-[440px] gap-3 receipt-controls" aria-label={t("printing.screen.options")}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Segmented label={t("printing.screen.width")} value={String(width) as "58" | "80"} onChange={(value) => setWidth(value === "80" ? 80 : 58)}
            options={[{ value: "58", label: "58 mm" }, { value: "80", label: "80 mm" }]} />
          <Button variant="cta" onClick={printReceipt} icon={<Icon name="print" />}>{t("printing.screen.print")}</Button>
        </div>
        <Segmented label={t("printing.screen.language")} value={document.language} onChange={(value) => router.replace(`?lang=${value}`, { scroll: false })}
          options={languages.map((value) => ({ value, label: languageNames[value] }))} />
      </div>
      <p className="receipt-note-screen">{t("printing.screen.note")} {t("printing.screen.timeZone", { zone: document.sale.timeZoneLabel })}</p>
      {printError && <div className="receipt-print-error mx-auto mb-4 max-w-[440px]"><Alert tone="danger">{t("printing.screen.printUnavailable")}</Alert></div>}
      <ReceiptTicketView document={document} width={width} logoAlt={t("printing.screen.logoAlt", { name: document.business.name })} label={t("printing.screen.label", { reference: document.sale.reference })} />
    </main>
  );
}
