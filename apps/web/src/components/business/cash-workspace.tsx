"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { FormDialog } from "@/components/ui/controls";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { formatDateTime, formatTime, formatXof } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/translate";

type Breakdown = Record<"openingFloatXof" | "cashSalesXof" | "receivableCashXof" | "openingDebtCashXof" | "movementsInXof" | "expensesCashXof" | "supplierCashXof" | "refundsCashXof" | "movementsOutXof" | "inflowsXof" | "outflowsXof" | "expectedXof", string>;
type Session = {
  id: string; userId: string; userName: string; status: "open" | "closed" | "validated"; openingFloatXof: string; openedAt: string; closedAt: string | null;
  countedCashXof: string | null; expectedCashXof: string | null; differenceXof: string | null; closingNote: string | null; validationNote: string | null; breakdown: Breakdown | null;
};
type Overview = {
  current: Session | null; sessions: Session[];
  comparison: { userId: string; userName: string; closedCount: number; differenceXof: string; shortCount: number }[];
  permissions: { open: boolean; audit: boolean; validate: boolean; manage: boolean };
};

const errorCodes = new Set(["already_open", "already_closed", "already_validated", "not_closed", "justification_required", "self_validation", "forbidden", "not_found"]);
const statusTone = { open: "brand", closed: "warning", validated: "success" } as const;

/** Montant XOF saisi au clavier numérique : chiffres seulement, sans zéros de tête ni décimale. */
const digits = (value: string) => value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 15);

/**
 * Envoi d'une opération de caisse. La clé d'opération est gardée tant que la même saisie est
 * renvoyée (coupure réseau, double appui) : le serveur rejoue alors le premier résultat.
 */
function useCashAction() {
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const send = useCallback(async (url: string, body: Record<string, string | undefined>): Promise<{ ok: true; data: unknown } | { ok: false; code: string }> => {
    if (sending.current) return { ok: false, code: "busy" };
    const fingerprint = JSON.stringify([url, body]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: `cash-${crypto.randomUUID()}` };
    sending.current = true; setBusy(true);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: attempt.current.key }) });
      const data = await response.json().catch(() => null) as { code?: string } | null;
      if (!response.ok) return { ok: false, code: data?.code && errorCodes.has(data.code) ? data.code : response.status === 403 ? "forbidden" : "generic" };
      attempt.current = null;
      return { ok: true, data };
    } catch { return { ok: false, code: "network" }; } finally { sending.current = false; setBusy(false); }
  }, []);
  return { send, busy };
}

export function CashWorkspace() {
  const { t } = useI18n();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [failure, setFailure] = useState<"load" | "forbidden" | null>(null);
  const [closing, setClosing] = useState<Session | null>(null);
  const [validating, setValidating] = useState<Session | null>(null);
  const [movement, setMovement] = useState<"in" | "out" | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/business/cash", { cache: "no-store" });
      if (response.status === 403) { setFailure("forbidden"); return; }
      if (!response.ok) throw new Error(String(response.status));
      setOverview(await response.json() as Overview); setFailure(null);
    } catch { setFailure("load"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (failure === "forbidden") return <><PageHeader title={t("cash.title")}>{t("cash.intro")}</PageHeader><EmptyState icon="shield" title={t("cash.forbidden")} /></>;

  const current = overview?.current ?? null;
  return (
    <div>
      <PageHeader title={t("cash.title")}>{t("cash.intro")}</PageHeader>
      {failure === "load" && <Alert tone="danger" className="mb-4">{t("cash.loadFailed")} <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-inherit underline" onClick={() => void load()}>{t("common.retry")}</button></Alert>}
      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice("")} dismissLabel={t("common.close")}>{notice}</Alert>}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="grid gap-4 [&>*]:min-w-0">
          {!overview ? <Skeleton className="h-64 rounded-xl" /> : current ? (
            <CurrentSession session={current} onRefresh={load} onMovement={setMovement} onClose={() => setClosing(current)} />
          ) : overview.permissions.open ? <OpenCard onOpened={load} /> : null}
          <p className="m-0 flex gap-2 rounded-[16px] bg-brand-soft p-3.5 text-sm text-brand-strong"><Icon name="info" className="mt-0.5 size-4 shrink-0" />{t("cash.onlyCash")}</p>
        </div>
        <div className="grid gap-4 [&>*]:min-w-0">
          {overview?.permissions.audit && overview.comparison.length > 0 && <Comparison rows={overview.comparison} />}
          <History overview={overview} onValidate={setValidating} onCloseFor={setClosing} />
        </div>
      </div>
      {movement && current && <MovementDialog direction={movement} sessionId={current.id} onClose={() => setMovement(null)} onSaved={() => { setMovement(null); setNotice(t("cash.movement.saved")); void load(); }} />}
      {closing && <CloseDialog session={closing} own={closing.id === current?.id} onClose={() => setClosing(null)} onClosed={() => void load()} />}
      {validating && <ValidateDialog session={validating} onClose={() => setValidating(null)} onValidated={() => { setValidating(null); void load(); }} />}
    </div>
  );
}

function OpenCard({ onOpened }: { onOpened: () => Promise<void> }) {
  const { t } = useI18n();
  const { send, busy } = useCashAction();
  const [float, setFloat] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (float === "") { setError(t("cash.errors.amount")); return; }
    const result = await send("/api/business/cash", { openingFloatXof: float, note: note.trim() || undefined });
    if (!result.ok) { if (result.code !== "busy") setError(t(`cash.errors.${result.code}` as MessageKey)); return; }
    await onOpened();
  };
  return (
    <Card aria-labelledby="cash-open-title" className="grid gap-4">
      <CardTitle id="cash-open-title" title={t("cash.open.title")} aside={<span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="wallet" /></span>} />
      <p className="m-0 text-sm text-fg-muted">{t("cash.open.lead")}</p>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("cash.open.float")} hint={t("cash.open.floatHint")}>
          {(props) => <AmountInput {...props} value={float} onChange={(value) => { setFloat(value); setError(""); }} />}
        </Field>
        <Field label={t("cash.open.note")}>{(props) => <Input {...props} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />}</Field>
        <Button type="submit" variant="cta" size="lg" block loading={busy} icon={<Icon name="check" />}>{t("cash.open.submit")}</Button>
      </form>
    </Card>
  );
}

function AmountInput({ value, onChange, ...props }: { id: string; "aria-describedby"?: string; "aria-invalid"?: true; value: string; onChange: (value: string) => void }) {
  return <Input {...props} dir="ltr" inputMode="numeric" autoComplete="off" enterKeyHint="done" value={value} onChange={(event) => onChange(digits(event.target.value))}
    className="numeric text-center text-2xl font-bold tracking-[-0.02em]" placeholder="0" />;
}

const lines: { key: keyof Breakdown; label: MessageKey; sign: "+" | "−" | "" }[] = [
  { key: "openingFloatXof", label: "cash.current.float", sign: "" },
  { key: "cashSalesXof", label: "cash.current.cashSales", sign: "+" },
  { key: "receivableCashXof", label: "cash.current.receivableCash", sign: "+" },
  { key: "openingDebtCashXof", label: "cash.current.openingDebtCash", sign: "+" },
  { key: "movementsInXof", label: "cash.current.movementsIn", sign: "+" },
  { key: "expensesCashXof", label: "cash.current.expensesCash", sign: "−" },
  { key: "supplierCashXof", label: "cash.current.supplierCash", sign: "−" },
  { key: "refundsCashXof", label: "cash.current.refundsCash", sign: "−" },
  { key: "movementsOutXof", label: "cash.current.movementsOut", sign: "−" },
];

function CurrentSession({ session, onRefresh, onMovement, onClose }: { session: Session; onRefresh: () => Promise<void>; onMovement: (direction: "in" | "out") => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const breakdown = session.breakdown;
  return (
    <Card tone="night" aria-labelledby="cash-current-title" className="grid gap-4">
      <CardTitle inverse id="cash-current-title" eyebrow={t("cash.current.since", { time: formatTime(session.openedAt, locale) })} title={t("cash.current.title")}
        aside={<button type="button" onClick={() => void onRefresh()} aria-label={t("cash.current.refresh")} className="grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-white/10 text-white hover:bg-white/20"><Icon name="activity" /></button>} />
      <div className="rounded-[18px] bg-night-soft/70 p-4">
        <p className="m-0 text-sm text-night-fg">{t("cash.current.expected")}</p>
        <p className="numeric m-0 mt-1 text-[2.1rem] leading-tight font-bold tracking-[-0.03em] text-white">{formatXof(breakdown?.expectedXof, locale)}</p>
      </div>
      {breakdown && (
        <details className="group rounded-[16px] bg-night-soft/40 px-4 py-3">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
            {t("cash.current.detail")}<Icon name="chevronDown" className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <dl className="m-0 mt-2 grid gap-1.5">
            {lines.filter((line) => line.key === "openingFloatXof" || breakdown[line.key] !== "0").map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="text-night-fg">{t(line.label)}</dt>
                <dd className="numeric m-0 font-semibold text-white">{line.sign}{line.sign && " "}{formatXof(breakdown[line.key], locale)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => onMovement("in")} icon={<Icon name="arrowDown" />}>{t("cash.current.addIn")}</Button>
        <Button variant="secondary" onClick={() => onMovement("out")} icon={<Icon name="arrowUp" />}>{t("cash.current.addOut")}</Button>
      </div>
      <Button variant="cta" size="lg" block onClick={onClose} icon={<Icon name="check" />}>{t("cash.current.close")}</Button>
    </Card>
  );
}

function MovementDialog({ direction, sessionId, onClose, onSaved }: { direction: "in" | "out"; sessionId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { send, busy } = useCashAction();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!amount || amount === "0") { setError(t("cash.errors.amount")); return; }
    if (!reason.trim()) { setError(t("cash.errors.reason")); return; }
    const result = await send(`/api/business/cash/${encodeURIComponent(sessionId)}/movements`, { direction, amountXof: amount, reason: reason.trim() });
    if (!result.ok) { if (result.code !== "busy") setError(t(`cash.errors.${result.code}` as MessageKey)); return; }
    onSaved();
  };
  return (
    <FormDialog open title={t(direction === "in" ? "cash.movement.inTitle" : "cash.movement.outTitle")} onClose={onClose} labelledBy="cash-movement-title">
      <form className="grid gap-4" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("cash.movement.amount")}>{(props) => <AmountInput {...props} value={amount} onChange={(value) => { setAmount(value); setError(""); }} />}</Field>
        <Field label={t("cash.movement.reason")} hint={t("cash.movement.reasonHint")}>{(props) => <Input {...props} value={reason} maxLength={240} onChange={(event) => { setReason(event.target.value); setError(""); }} />}</Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>{t("cash.movement.submit")}</Button>
      </form>
    </FormDialog>
  );
}

/** Clôture en deux temps : saisir le montant compté, voir l'écart calculé, justifier si besoin, confirmer. */
function CloseDialog({ session, own, onClose, onClosed }: { session: Session; own: boolean; onClose: () => void; onClosed: () => void }) {
  const { t, locale } = useI18n();
  const { send, busy } = useCashAction();
  const [step, setStep] = useState<"count" | "review" | "done">("count");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ expectedXof: string; countedXof: string; differenceXof: string } | null>(null);
  // Clôture pour un autre membre : la liste ne porte pas le calcul en cours, on le lit avant d'afficher l'écart.
  const [live, setLive] = useState<Breakdown | null>(session.breakdown);
  useEffect(() => {
    if (session.breakdown) return;
    let alive = true;
    void fetch(`/api/business/cash/${encodeURIComponent(session.id)}`, { cache: "no-store" }).then(async (response) => {
      if (response.ok && alive) setLive(((await response.json()) as { session: Session }).session.breakdown);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [session]);
  // Aperçu seulement : le serveur recalcule le montant attendu sous verrou au moment de la clôture.
  const expected = live?.expectedXof ?? "0";
  const preview = counted === "" ? 0n : BigInt(counted) - BigInt(expected);
  const shown = result ? BigInt(result.differenceXof) : preview;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step === "count") { if (counted === "" || !live) { setError(t(live ? "cash.errors.amount" : "cash.errors.generic")); return; } setError(""); setStep("review"); return; }
    if (preview !== 0n && !note.trim()) { setError(t("cash.errors.justification_required")); return; }
    const outcome = await send(`/api/business/cash/${encodeURIComponent(session.id)}/close`, { countedCashXof: counted, note: note.trim() || undefined });
    if (!outcome.ok) { if (outcome.code !== "busy") setError(t(`cash.errors.${outcome.code}` as MessageKey)); return; }
    setResult((outcome.data as { session: { expectedXof: string; countedXof: string; differenceXof: string } }).session);
    setStep("done"); onClosed();
  };
  const differenceText = shown === 0n ? t("cash.close.exact") : shown < 0n ? t("cash.close.short", { amount: formatXof(-shown, locale) }) : t("cash.close.over", { amount: formatXof(shown, locale) });
  return (
    <FormDialog open title={own ? t("cash.close.title") : t("cash.close.forPerson", { name: session.userName })} onClose={onClose} labelledBy="cash-close-title">
      {step === "done" && result ? (
        <div className="grid gap-4" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-gradient text-white shadow-brand"><Icon name="check" className="size-6" /></span>
            <div><p className="m-0 text-lg font-bold text-ink">{t("cash.close.done")}</p><p className="m-0 text-sm text-fg-muted">{t("cash.close.doneLead")}</p></div>
          </div>
          <Summary expected={result.expectedXof} counted={result.countedXof} difference={result.differenceXof} text={differenceText} />
          <Button variant="secondary" size="lg" block onClick={onClose}>{t("common.close")}</Button>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          {step === "count" ? (
            <>
              <p className="m-0 text-sm text-fg-muted">{t("cash.close.countLead")}</p>
              <Field label={t("cash.close.counted")}>{(props) => <AmountInput {...props} value={counted} onChange={(value) => { setCounted(value); setError(""); }} />}</Field>
              <Button type="submit" variant="primary" size="lg" block icon={<Icon name="forward" />}>{t("cash.close.next")}</Button>
            </>
          ) : (
            <>
              <Summary expected={expected} counted={counted} difference={preview.toString()} text={differenceText} />
              <Field label={preview === 0n ? t("cash.close.note") : t("cash.close.justification")} hint={preview === 0n ? undefined : t("cash.close.justificationHint")}>
                {(props) => <Textarea {...props} rows={3} maxLength={500} value={note} onChange={(event) => { setNote(event.target.value); setError(""); }} />}
              </Field>
              <Alert tone="warning">{t("cash.close.irreversible")}</Alert>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="secondary" size="lg" disabled={busy} onClick={() => { setError(""); setStep("count"); }}>{t("cash.close.back")}</Button>
                <Button type="submit" variant="cta" size="lg" loading={busy} icon={<Icon name="check" />}>{t("cash.close.confirm")}</Button>
              </div>
            </>
          )}
        </form>
      )}
    </FormDialog>
  );
}

function Summary({ expected, counted, difference, text }: { expected: string; counted: string; difference: string; text: string }) {
  const { t, locale } = useI18n();
  const value = BigInt(difference);
  return (
    <dl className="m-0 grid gap-2 rounded-[16px] border border-line bg-paper p-4">
      <div className="flex items-baseline justify-between gap-3"><dt className="text-sm text-fg-muted">{t("cash.close.expected")}</dt><dd className="numeric m-0 font-semibold text-ink">{formatXof(expected, locale)}</dd></div>
      <div className="flex items-baseline justify-between gap-3"><dt className="text-sm text-fg-muted">{t("cash.close.counted")}</dt><dd className="numeric m-0 font-semibold text-ink">{formatXof(counted, locale)}</dd></div>
      <div className={cn("mt-1 flex items-baseline justify-between gap-3 rounded-[12px] px-3 py-2", value === 0n ? "bg-ok-soft text-ok" : value < 0n ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>
        <dt className="text-sm font-semibold">{t("cash.close.difference")}</dt>
        <dd className="m-0 text-end"><span className="numeric block text-lg font-bold">{value > 0n ? "+" : value < 0n ? "−" : ""}{formatXof(value < 0n ? -value : value, locale)}</span><span className="block text-xs font-semibold">{text}</span></dd>
      </div>
    </dl>
  );
}

function ValidateDialog({ session, onClose, onValidated }: { session: Session; onClose: () => void; onValidated: () => void }) {
  const { t } = useI18n();
  const { send, busy } = useCashAction();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await send(`/api/business/cash/${encodeURIComponent(session.id)}/validate`, { note: note.trim() || undefined });
    if (!result.ok) { if (result.code !== "busy") setError(t(`cash.errors.${result.code}` as MessageKey)); return; }
    onValidated();
  };
  return (
    <FormDialog open title={t("cash.validate.title")} onClose={onClose} labelledBy="cash-validate-title">
      <form className="grid gap-4" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="m-0 text-sm text-fg-muted">{t("cash.validate.lead", { name: session.userName })}</p>
        <Field label={t("cash.validate.note")}>{(props) => <Textarea {...props} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />}</Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<Icon name="shield" />}>{t("cash.validate.confirm")}</Button>
      </form>
    </FormDialog>
  );
}

function Comparison({ rows }: { rows: Overview["comparison"] }) {
  const { t, locale } = useI18n();
  return (
    <Card aria-labelledby="cash-comparison-title">
      <CardTitle id="cash-comparison-title" title={t("cash.comparison.title")} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead><tr className="text-start text-xs text-fg-subtle">
            <th scope="col" className="py-2 text-start font-semibold">{t("cash.comparison.name")}</th><th scope="col" className="py-2 text-end font-semibold">{t("cash.comparison.closures")}</th>
            <th scope="col" className="py-2 text-end font-semibold">{t("cash.comparison.short")}</th><th scope="col" className="py-2 text-end font-semibold">{t("cash.comparison.total")}</th>
          </tr></thead>
          <tbody>{rows.map((row) => {
            const value = BigInt(row.differenceXof);
            return (
              <tr key={row.userId} className="border-t border-line">
                <th scope="row" className="py-2.5 text-start font-semibold text-ink" dir="auto">{row.userName}</th>
                <td className="numeric py-2.5 text-end">{row.closedCount}</td><td className="numeric py-2.5 text-end">{row.shortCount}</td>
                <td className={cn("numeric py-2.5 text-end font-bold", value < 0n ? "text-danger" : value > 0n ? "text-warn" : "text-ok")}>{value > 0n ? "+" : value < 0n ? "−" : ""}{formatXof(value < 0n ? -value : value, locale)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Card>
  );
}

function History({ overview, onValidate, onCloseFor }: { overview: Overview | null; onValidate: (session: Session) => void; onCloseFor: (session: Session) => void }) {
  const { t, locale } = useI18n();
  return (
    <Card aria-labelledby="cash-history-title">
      <CardTitle id="cash-history-title" title={overview?.permissions.audit ? t("cash.history.titleAll") : t("cash.history.title")} />
      {!overview ? <Skeleton className="mt-3 h-32 rounded-[16px]" /> : overview.sessions.length === 0 ? <p className="m-0 mt-3 text-sm text-fg-muted">{t("cash.history.empty")}</p> : (
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {overview.sessions.map((session) => {
            const difference = session.differenceXof === null ? null : BigInt(session.differenceXof);
            const mine = session.id === overview.current?.id;
            return (
              <li key={session.id} className="rounded-[16px] border border-line bg-paper p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 font-semibold text-ink" dir="auto">{session.userName}{mine && <span className="text-fg-subtle"> · {t("cash.history.you")}</span>}</p>
                  <Badge tone={statusTone[session.status]}>{t(`cash.status.${session.status}`)}</Badge>
                </div>
                <p className="m-0 mt-1 text-xs text-fg-subtle">{session.closedAt ? t("cash.history.closed", { date: formatDateTime(session.closedAt, locale) }) : t("cash.history.opened", { date: formatDateTime(session.openedAt, locale) })}</p>
                {difference !== null && (
                  <dl className="m-0 mt-2 grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-xs text-fg-subtle">{t("cash.history.expected")}</dt><dd className="numeric m-0 font-semibold">{formatXof(session.expectedCashXof, locale)}</dd></div>
                    <div><dt className="text-xs text-fg-subtle">{t("cash.history.counted")}</dt><dd className="numeric m-0 font-semibold">{formatXof(session.countedCashXof, locale)}</dd></div>
                    <div><dt className="text-xs text-fg-subtle">{t("cash.history.difference")}</dt><dd className={cn("numeric m-0 font-bold", difference < 0n ? "text-danger" : difference > 0n ? "text-warn" : "text-ok")}>{difference > 0n ? "+" : difference < 0n ? "−" : ""}{formatXof(difference < 0n ? -difference : difference, locale)}</dd></div>
                  </dl>
                )}
                {session.closingNote && <p className="m-0 mt-2 text-sm text-fg-muted" dir="auto">{t("cash.history.justification", { text: session.closingNote })}</p>}
                {session.validationNote && <p className="m-0 mt-1 text-sm text-fg-muted" dir="auto">{t("cash.history.validation", { text: session.validationNote })}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {session.status === "closed" && overview.permissions.validate && <Button variant="secondary" onClick={() => onValidate(session)} icon={<Icon name="shield" />}>{t("cash.history.validate")}</Button>}
                  {session.status === "open" && !mine && overview.permissions.manage && <Button variant="ghost" onClick={() => onCloseFor(session)}>{t("cash.history.closeFor")}</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
