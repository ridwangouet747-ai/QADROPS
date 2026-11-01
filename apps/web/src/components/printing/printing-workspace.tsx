"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { formatDateTime } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/translate";
import {
  agentPrinterStatus, agentStatus, forgetPairing, listAgentPrinters, normalizeAgentUrl, pairWithAgent, printThroughAgent, readPairing, savePairing,
  type AgentPrinter, type Pairing,
} from "@/lib/printing/agent-client";
import { parseStatus } from "@/lib/printing/escpos";
import { track } from "@/lib/analytics/client";

type Setup = { enabled: boolean; autoPrint: boolean; permissions: { configure: boolean; print: boolean };
  devices: { id: string; name: string; transport: string; paperWidthMm: number; agentId: string | null; lastStatus: string | null; lastSeenAt: string | null }[] };
type Job = { id: string; kind: "receipt" | "test"; status: "pending" | "printed" | "failed" | "uncertain" | "canceled"; errorCode: string | null; saleId: string | null; reference: string | null; deviceName: string; createdAt: string };

const errorKeys = new Set(["not_paired", "agent_unreachable", "timeout", "module_disabled", "not_found", "connection_refused", "disconnected", "paper_out", "unreachable", "communication_error", "busy", "unsupported_platform", "network", "server"]);
const statusTone = { pending: "info", printed: "success", failed: "danger", uncertain: "warning", canceled: "neutral" } as const;

export function PrintingWorkspace() {
  const { t } = useI18n();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [failure, setFailure] = useState<"load" | "forbidden" | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning" | "info"; text: string } | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const errorText = (code?: string) => t(`printing.errors.${code && errorKeys.has(code) ? code : "generic"}` as MessageKey);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/business/printing", { cache: "no-store" });
      if (response.status === 403) { setFailure("forbidden"); return; }
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as Setup;
      setSetup(body); setFailure(null);
      if (body.enabled) {
        const history = await fetch("/api/business/printing/jobs?limit=15", { cache: "no-store" }).then((result) => result.json()) as { jobs?: Job[] };
        setJobs(history.jobs ?? []);
      }
    } catch { setFailure("load"); }
  }, []);
  useEffect(() => { void load(); setPairing(readPairing()); }, [load]);

  if (failure === "forbidden") return <><PageHeader title={t("printing.title")}>{t("printing.intro")}</PageHeader><EmptyState icon="shield" title={t("printing.forbidden")} /></>;
  if (failure === "load") return <><PageHeader title={t("printing.title")}>{t("printing.intro")}</PageHeader><Alert tone="danger">{t("printing.loadFailed")}</Alert></>;

  const saveSettings = async (enabled: boolean, autoPrint: boolean) => {
    if (enabled !== setup?.enabled) track("printer_module_toggled", { enabled });
    const response = await fetch("/api/business/printing", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, autoPrint }) });
    if (response.ok) setSetup(await response.json() as Setup);
    void load();
  };
  const report = (result: { status: string; error?: string; preview?: string[] | null }) => {
    if (result.preview) setPreview(result.preview);
    setNotice(result.status === "printed" ? { tone: "success", text: result.error === "already_printed" ? t("printing.results.already") : t("printing.results.printed") }
      : result.status === "uncertain" ? { tone: "warning", text: t("printing.results.uncertain") } : { tone: "danger", text: t("printing.results.failed", { error: errorText(result.error) }) });
    void load();
  };
  const resolveJob = async (job: Job, printed: boolean) => {
    await fetch(`/api/business/printing/jobs/${encodeURIComponent(job.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: printed ? "printed" : "failed", errorCode: printed ? undefined : "not_printed" }) });
    if (!printed && job.saleId) report(await printThroughAgent({ kind: "receipt", saleId: job.saleId, reprintOfJobId: job.id }));
    else void load();
  };
  const device = setup?.devices.find((item) => item.id === pairing?.deviceId) ?? null;

  return (
    <div>
      <PageHeader title={t("printing.title")}>{t("printing.intro")}</PageHeader>
      {notice && <Alert tone={notice.tone} className="mb-4" onDismiss={() => setNotice(null)} dismissLabel={t("common.close")}>{notice.text}</Alert>}
      {!setup ? <Skeleton className="h-48 rounded-xl" /> : (
        <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="grid gap-4 [&>*]:min-w-0">
            <Card className="grid gap-3" aria-labelledby="printing-module">
              <CardTitle id="printing-module" title={t("printing.module.title")} aside={<Badge tone={setup.enabled ? "success" : "neutral"}>{setup.enabled ? t("printing.module.enabled") : t("printing.module.disabled")}</Badge>} />
              {setup.permissions.configure && (setup.enabled ? (
                <>
                  <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 size-5 accent-[var(--color-brand)]" checked={setup.autoPrint} onChange={(event) => void saveSettings(true, event.target.checked)} />
                    <span><span className="block font-semibold text-ink">{t("printing.module.auto")}</span><span className="block text-fg-muted">{t("printing.module.autoHint")}</span></span></label>
                  <Button variant="ghost" onClick={() => void saveSettings(false, false)}>{t("printing.module.disable")}</Button>
                </>
              ) : <Button variant="cta" size="lg" block icon={<Icon name="printer" />} onClick={() => void saveSettings(true, false)}>{t("printing.module.enable")}</Button>)}
            </Card>
            {setup.enabled && <AgentStep pairing={pairing} canConfigure={setup.permissions.configure} onPaired={(value) => { setPairing(value); void load(); }} onForget={() => { forgetPairing(); setPairing(null); }} />}
            {setup.enabled && pairing && device && (
              <Card className="grid gap-3" aria-labelledby="printing-test">
                <CardTitle id="printing-test" title={t("printing.test.title")} aside={<span className="text-sm text-fg-muted">{device.name} · {device.paperWidthMm} mm</span>} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button variant="secondary" onClick={async () => {
                    const result = await agentPrinterStatus(pairing);
                    if (!result.reachable) { setNotice({ tone: "danger", text: t("printing.test.states.unreachable") }); return; }
                    if (!result.status) { setNotice({ tone: "info", text: t("printing.test.states.unknown") }); return; }
                    const state = parseStatus(result.status);
                    const problems = (["paperOut", "coverOpen", "cutterError", "offline", "paperLow"] as const).filter((key) => state[key]);
                    setNotice(problems.length ? { tone: "warning", text: problems.map((key) => t(`printing.test.states.${key}`)).join(" ") }
                      : Object.values(state).every((value) => value === null) ? { tone: "info", text: t("printing.test.states.unknown") } : { tone: "success", text: t("printing.test.states.ok") });
                  }} icon={<Icon name="activity" />}>{t("printing.test.status")}</Button>
                  <Button variant="primary" onClick={async () => { const result = await printThroughAgent({ kind: "test" }); track("printer_test_printed", { result: result.status === "printed" ? "success" : "failure" }); report(result); }} icon={<Icon name="printer" />}>{t("printing.test.print")}</Button>
                </div>
                {preview && (
                  <figure className="m-0">
                    <figcaption className="mb-2 text-xs font-semibold text-fg-subtle">{t("printing.test.preview")}</figcaption>
                    <pre dir="ltr" className="m-0 overflow-x-auto rounded-[14px] border border-line bg-white p-3 font-mono text-[0.72rem] leading-snug text-ink">{preview.join("\n")}</pre>
                  </figure>
                )}
                <p className="m-0 text-xs text-fg-subtle">{t("printing.arabic")}</p>
              </Card>
            )}
          </div>
          <div className="grid gap-4 [&>*]:min-w-0">
            {setup.enabled && <Card aria-labelledby="printing-devices">
              <CardTitle id="printing-devices" title={t("printing.devices.title")} />
              {setup.devices.length === 0 ? <p className="m-0 mt-3 text-sm text-fg-muted">{t("printing.devices.empty")}</p> : (
                <ul className="m-0 mt-3 grid list-none gap-2 p-0">{setup.devices.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-line bg-paper px-3 py-2">
                    <span className="min-w-0 text-sm"><span className="block font-semibold text-ink" dir="auto">{item.name}</span>
                      <span className="block text-xs text-fg-subtle">{t(`printing.printer.transports.${item.transport as "tcp"}`)} · {item.paperWidthMm} mm{item.id === pairing?.deviceId ? ` · ${t("printing.devices.thisBrowser")}` : ""}</span></span>
                    {setup.permissions.configure && <Button variant="ghost" onClick={async () => { await fetch(`/api/business/printing/devices/${encodeURIComponent(item.id)}`, { method: "DELETE" }); if (item.id === pairing?.deviceId) { forgetPairing(); setPairing(null); } void load(); }}>{t("printing.devices.remove")}</Button>}
                  </li>
                ))}</ul>
              )}
            </Card>}
            {setup.enabled && <Card aria-labelledby="printing-history">
              <CardTitle id="printing-history" title={t("printing.history.title")} />
              {!jobs ? <Skeleton className="mt-3 h-24 rounded-[14px]" /> : jobs.length === 0 ? <p className="m-0 mt-3 text-sm text-fg-muted">{t("printing.history.empty")}</p> : (
                <ul className="m-0 mt-3 grid list-none gap-2 p-0">{jobs.map((job) => (
                  <li key={job.id} className="rounded-[14px] border border-line bg-paper px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{t(`printing.kinds.${job.kind}`)}{job.reference ? ` · ${job.reference}` : ""}</span>
                      <Badge tone={statusTone[job.status]}>{t(`printing.statuses.${job.status}`)}</Badge>
                    </div>
                    <p className="m-0 text-xs text-fg-subtle">{job.deviceName} · {formatDateTime(job.createdAt, "fr")}{job.errorCode ? ` · ${errorText(job.errorCode)}` : ""}</p>
                    {job.status === "uncertain" && <div className="mt-2 grid gap-2">
                      <p className="m-0 text-xs text-warn">{t("printing.history.uncertainHint")}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => void resolveJob(job, true)}>{t("printing.history.wasPrinted")}</Button>
                        <Button variant="ghost" onClick={() => void resolveJob(job, false)}>{t("printing.history.notPrinted")}</Button>
                      </div></div>}
                    {job.kind === "receipt" && job.saleId && (job.status === "printed" || job.status === "failed") && pairing &&
                      <Button variant="ghost" className="mt-1" onClick={async () => report(await printThroughAgent({ kind: "receipt", saleId: job.saleId!, reprintOfJobId: job.id }))} icon={<Icon name="printer" />}>{t("printing.history.reprint")}</Button>}
                  </li>
                ))}</ul>
              )}
            </Card>}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentStep({ pairing, canConfigure, onPaired, onForget }: { pairing: Pairing | null; canConfigure: boolean; onPaired: (pairing: Pairing) => void; onForget: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(pairing?.agentUrl ?? "http://127.0.0.1:17777");
  const [state, setState] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [code, setCode] = useState("");
  const [paired, setPaired] = useState<{ agentUrl: string; agentId: string; token: string } | null>(null);
  const [printers, setPrinters] = useState<AgentPrinter[]>([]);
  const [choice, setChoice] = useState({ printerId: "", name: "", width: 80 as 58 | 80 });
  const [busy, setBusy] = useState(false);

  if (pairing && !paired) return (
    <Card className="grid gap-3" aria-labelledby="printing-agent">
      <CardTitle id="printing-agent" title={t("printing.agent.title")} />
      <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ok"><Icon name="check" className="size-4" />{t("printing.agent.paired")}</p>
      <p className="m-0 text-xs text-fg-subtle" dir="ltr">{pairing.agentUrl}</p>
      <Button variant="ghost" onClick={onForget}>{t("printing.agent.unpair")}</Button>
    </Card>
  );

  const check = async () => {
    const origin = normalizeAgentUrl(url);
    if (!origin) { setState({ tone: "danger", text: t("printing.agent.notFound") }); return null; }
    const status = await agentStatus(origin);
    if (!status.reachable) { setState({ tone: "danger", text: t("printing.agent.notFound") }); return null; }
    if (!status.allowed) { setState({ tone: "warning", text: t("printing.agent.notAllowed") }); return null; }
    setState({ tone: "success", text: t("printing.agent.found", { version: status.version }) });
    return origin;
  };
  const pair = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const origin = await check();
      if (!origin) return;
      const result = await pairWithAgent(origin, code);
      if (!result.ok) { setState({ tone: "danger", text: t(`printing.agent.errors.${["wrong_code", "too_many_attempts", "pairing_closed"].includes(result.error) ? result.error as "wrong_code" : "pairing_failed"}`) }); return; }
      const list = await listAgentPrinters(origin, result.token);
      setPaired({ agentUrl: origin, agentId: result.agentId, token: result.token }); setPrinters(list);
      if (list[0]) setChoice({ printerId: list[0].id, name: list[0].name, width: list[0].paperWidthMm === 58 ? 58 : 80 });
    } finally { setBusy(false); }
  };
  const register = async () => {
    if (!paired) return;
    const printer = printers.find((item) => item.id === choice.printerId);
    if (!printer) return;
    setBusy(true);
    try {
      const response = await fetch("/api/business/printing/devices", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: choice.name.trim() || printer.name, transport: printer.transport, profile: ["epson", "xprinter", "star"].includes(printer.profile) ? printer.profile : "generic", paperWidthMm: choice.width, agentId: paired.agentId }) });
      if (!response.ok) { setState({ tone: "danger", text: t("printing.errors.server") }); return; }
      const { id } = await response.json() as { id: string };
      const value: Pairing = { ...paired, deviceId: id, printerId: printer.id };
      savePairing(value); onPaired(value); setPaired(null);
    } finally { setBusy(false); }
  };

  return (
    <Card className="grid gap-3" aria-labelledby="printing-agent">
      <CardTitle id="printing-agent" title={paired ? t("printing.printer.title") : t("printing.agent.title")} />
      {state && <Alert tone={state.tone}>{state.text}</Alert>}
      {!canConfigure ? null : !paired ? (
        <form className="grid gap-3" onSubmit={pair} noValidate>
          <p className="m-0 text-sm text-fg-muted">{t("printing.agent.lead")}</p>
          <div className="flex items-end gap-2">
            <Field className="min-w-0 flex-1" label={t("printing.agent.url")}>{(props) => <Input {...props} dir="ltr" value={url} onChange={(event) => setUrl(event.target.value)} />}</Field>
            <Button variant="secondary" onClick={() => void check()}>{t("printing.agent.check")}</Button>
          </div>
          <Field label={t("printing.agent.code")}>{(props) => <Input {...props} dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} className="text-center font-mono text-xl tracking-[0.3em]" />}</Field>
          <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 8}>{t("printing.agent.pair")}</Button>
        </form>
      ) : printers.length === 0 ? <p className="m-0 text-sm text-fg-muted">{t("printing.printer.none")}</p> : (
        <div className="grid gap-3">
          <Field label={t("printing.printer.choose")}>{(props) => <Select {...props} value={choice.printerId} onChange={(event) => {
            const printer = printers.find((item) => item.id === event.target.value)!;
            setChoice({ printerId: printer.id, name: printer.name, width: printer.paperWidthMm === 58 ? 58 : 80 });
          }}>{printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name} · {t(`printing.printer.transports.${printer.transport as "tcp"}`)}</option>)}</Select>}</Field>
          <Field label={t("printing.printer.name")}>{(props) => <Input {...props} maxLength={80} value={choice.name} onChange={(event) => setChoice({ ...choice, name: event.target.value })} />}</Field>
          <Field label={t("printing.printer.width")}>{(props) => <Select {...props} value={String(choice.width)} onChange={(event) => setChoice({ ...choice, width: event.target.value === "58" ? 58 : 80 })}><option value="58">58 mm</option><option value="80">80 mm</option></Select>}</Field>
          <Button variant="primary" loading={busy} onClick={() => void register()} icon={<Icon name="check" />}>{t("printing.printer.save")}</Button>
        </div>
      )}
    </Card>
  );
}
