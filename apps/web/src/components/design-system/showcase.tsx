"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, SearchField, Segmented } from "@/components/ui/controls";
import { Alert, Badge, EmptyState, ProgressBar, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, PageHeader } from "@/components/ui/layout";
import { QuantityInput } from "@/components/ui/quantity-input";

const swatches = [
  ["canvas", "bg-canvas"], ["paper", "bg-paper"], ["surface", "bg-surface"], ["line", "bg-line"],
  ["ink", "bg-ink"], ["brand", "bg-brand"], ["brand-soft", "bg-brand-soft"], ["cta", "bg-cta"], ["cta-mark", "bg-cta-mark"],
  ["ok", "bg-ok"], ["warn", "bg-warn"], ["danger", "bg-danger"], ["info", "bg-info"],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card><h2 className="m-0 mb-3 text-lg font-bold text-ink">{title}</h2>{children}</Card>;
}

/** Vitrine interne des jetons et composants, utilisée pour les vérifications visuelles et RTL. */
export function DesignSystemShowcase() {
  const { t } = useI18n();
  const [quantity, setQuantity] = useState("2,5");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"a" | "b" | "c">("a");
  const [open, setOpen] = useState(false);
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6">
      <PageHeader kicker="QADR OPS" title={t("designSystem.title")} actions={<LanguageSwitcher />}>{t("designSystem.intro")}</PageHeader>
      <Alert tone="info">{t("designSystem.sampleNotice")}</Alert>

      <Section title={t("designSystem.colors")}>
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-7">
          {swatches.map(([name, swatch]) => (
            <li key={name} className="grid gap-1 text-xs text-fg-muted">
              <span className={`h-12 rounded-md border border-line ${swatch}`} />
              <code dir="ltr" className="text-start">{name}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("designSystem.typography")}>
        <p className="m-0 font-heading text-[2rem] leading-tight text-ink">{t("designSystem.headingSample")}</p>
        <p className="m-0 mt-2 text-fg">{t("designSystem.bodySample")}</p>
        <p className="m-0 mt-2 text-sm text-fg-muted"><span className="numeric">12 500 XOF · 2,5 kg · +225 07 00 00 00</span></p>
      </Section>

      <Section title={t("designSystem.buttons")}>
        <div className="flex flex-wrap gap-2">
          <Button>{t("designSystem.primary")}</Button>
          <Button variant="cta">{t("designSystem.cta")}</Button>
          <Button variant="secondary">{t("designSystem.secondary")}</Button>
          <Button variant="ghost" icon={<Icon name="back" />}>{t("common.back")}</Button>
          <Button variant="danger">{t("designSystem.danger")}</Button>
          <Button loading>{t("designSystem.loadingButton")}</Button>
          <Button disabled>{t("designSystem.secondary")}</Button>
        </div>
      </Section>

      <Section title={t("designSystem.fields")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("inventory.line.countLabel")} hint={t("designSystem.sampleHint")}>
            {(props) => <QuantityInput id={props.id} describedBy={props["aria-describedby"]} value={quantity} onChange={setQuantity} unit={t("designSystem.sampleUnit")} />}
          </Field>
          <Field label={t("inventory.start.scopeLabel")} error={t("designSystem.sampleError")}>
            {(props) => <Select {...props}><option>{t("inventory.start.scopeAll")}</option></Select>}
          </Field>
          <Field label={t("inventory.csv.product")}>
            {(props) => <Input {...props} defaultValue={t("designSystem.sampleProduct")} />}
          </Field>
          <div className="grid gap-1.5">
            <span className="text-sm font-semibold text-ink">{t("common.search")}</span>
            <SearchField value={query} onChange={setQuery} label={t("common.search")} placeholder={t("inventory.detail.searchPlaceholder")} />
          </div>
        </div>
      </Section>

      <Section title={t("designSystem.feedback")}>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{t("inventory.status.counting")}</Badge>
            <Badge tone="warning">{t("inventory.status.submitted")}</Badge>
            <Badge tone="success">{t("inventory.status.validated")}</Badge>
            <Badge>{t("inventory.status.canceled")}</Badge>
            <Badge tone="danger">{t("inventory.line.stateError")}</Badge>
            <Badge tone="brand">{t("designSystem.cta")}</Badge>
          </div>
          <Alert tone="success">{t("inventory.actions.submitted")}</Alert>
          <Alert tone="warning">{t("common.offline")}</Alert>
          <Alert tone="danger" onDismiss={() => undefined} dismissLabel={t("common.close")}>{t("common.genericError")}</Alert>
          <ProgressBar value={12} max={40} label={t("inventory.detail.progress", { counted: 12, total: 40 })} />
          <Segmented label={t("inventory.detail.filterLabel")} value={filter} onChange={setFilter}
            options={[{ value: "a", label: t("inventory.detail.filters.todo"), count: 28 }, { value: "b", label: t("inventory.detail.filters.counted"), count: 12 }, { value: "c", label: t("inventory.detail.filters.variance"), count: 3 }]} />
          <Button variant="secondary" onClick={() => setOpen(true)}>{t("designSystem.openDialog")}</Button>
        </div>
      </Section>

      <Section title={t("designSystem.surfaces")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <EmptyState title={t("designSystem.emptyTitle")}>{t("designSystem.emptyBody")}</EmptyState>
          <div className="grid gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-10 w-2/3" /></div>
        </div>
      </Section>

      <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} title={t("designSystem.dialogTitle")} confirmLabel={t("common.confirm")}>
        {t("designSystem.dialogBody")}
      </ConfirmDialog>
    </main>
  );
}
