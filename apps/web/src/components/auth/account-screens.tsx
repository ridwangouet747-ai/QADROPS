"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Monogram } from "@/components/ui/data-display";
import { Alert, Badge, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Icon, type IconName } from "@/components/ui/icon";
import { authClient } from "@/lib/auth/client";
import { signOutAndResetAnalytics } from "@/lib/auth/logout";
import { intlLocale } from "@/lib/i18n/config";
import { AuthShell } from "./auth-shell";

/** Logo du commerce : petite image (≤ 256 px) en data URL, que next/image n'optimiserait pas. */
function LogoImage({ src, className }: { src: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- data URL déjà réduite à 256 px côté client
  return <img src={src} alt="" className={cn("border border-line bg-surface object-contain", className)} />;
}

const activities = [["hardware", "box"], ["phones", "store"], ["general", "cart"], ["clothing", "grid"]] as const satisfies readonly (readonly [string, IconName])[];
type Activity = (typeof activities)[number][0];

/** Réduit le logo à 256 px dans le navigateur : moins de données envoyées, rendu net sur les reçus. */
export async function downscaleLogo(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8_000_000) throw new Error("type");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function OnboardingForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", activity: "" as Activity | "", phone: "", address: "" });
  const [logo, setLogo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pickLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { setLogo(await downscaleLogo(file)); setError(""); } catch { setError(t("onboarding.logoInvalid")); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.name.trim().length < 2 || !form.activity) { setError(t("onboarding.nameRequired")); return; }
    setBusy(true); setError("");
    const response = await fetch("/api/account/businesses", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name.trim(), activity: form.activity, phone: form.phone.trim() || undefined, address: form.address.trim() || undefined, logo: logo ?? undefined }) }).catch(() => null);
    if (!response?.ok) { setError(t("onboarding.failed")); setBusy(false); return; }
    router.push("/business/dashboard");
  };

  return (
    <AuthShell wide title={t("onboarding.title")} intro={t("onboarding.intro")}>
      <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("onboarding.name")}>{(props) => <Input {...props} dir="auto" autoFocus maxLength={120} placeholder={t("onboarding.namePlaceholder")} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold text-ink">{t("onboarding.activity")}</legend>
          <div role="radiogroup" aria-label={t("onboarding.activity")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {activities.map(([value, icon]) => {
              const selected = form.activity === value;
              return (
                <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => setForm({ ...form, activity: value })}
                  className={cn("grid min-h-24 cursor-pointer justify-items-center content-center gap-2 rounded-[16px] border p-3 text-sm font-semibold transition-colors",
                    selected ? "border-brand bg-brand-soft text-brand-strong shadow-brand" : "border-line bg-surface text-fg hover:border-brand-tint")}>
                  <span className={cn("grid size-10 place-items-center rounded-full", selected ? "bg-brand-gradient text-white" : "bg-surface-muted text-brand")}><Icon name={icon} /></span>
                  {t(`onboarding.activities.${value}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("onboarding.phone")}>{(props) => <Input {...props} type="tel" dir="ltr" maxLength={40} autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />}</Field>
          <Field label={t("onboarding.address")}>{(props) => <Input {...props} dir="auto" maxLength={200} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />}</Field>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-semibold text-ink">{t("onboarding.logo")}</span>
          <div className="flex flex-wrap items-center gap-3">
            {logo ? <LogoImage src={logo} className="size-16 rounded-[16px]" /> : <span className="grid size-16 place-items-center rounded-[16px] border border-dashed border-line-strong text-fg-subtle"><Icon name="store" /></span>}
            <label className={buttonClasses({ variant: "secondary", className: "cursor-pointer" })}>
              <Icon name="download" className="size-4" />{t("onboarding.logoChoose")}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void pickLogo(event)} />
            </label>
            {logo && <Button variant="ghost" onClick={() => setLogo(null)}>{t("onboarding.logoRemove")}</Button>}
          </div>
          <p className="m-0 text-sm text-fg-muted">{t("onboarding.logoHint")}</p>
        </div>
        <p className="m-0 rounded-[14px] bg-paper p-3 text-sm text-fg-muted">{t("onboarding.currency")}</p>
        <Button type="submit" size="lg" block loading={busy} icon={<Icon name="check" />}>{busy ? t("onboarding.submitting") : t("onboarding.submit")}</Button>
      </form>
    </AuthShell>
  );
}

type Business = { id: string; name: string; logo: string | null; role: string; disabled: boolean; active: boolean };

export function BusinessPicker() {
  const { t } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<{ businesses: Business[]; isPlatformAdmin: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    fetch("/api/account/me", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) { router.replace("/login?expired=1"); return; }
      setData(await response.json() as { businesses: Business[]; isPlatformAdmin: boolean });
    }).catch(() => setError(t("errors.network")));
  }, [router, t]);
  const choose = async (business: Business) => {
    setBusy(business.id); setError("");
    const response = await fetch("/api/account/active-business", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: business.id }) }).catch(() => null);
    if (!response?.ok) { setError(t("selectBusiness.failed")); setBusy(""); return; }
    router.push("/business/dashboard");
  };
  return (
    <AuthShell title={t("selectBusiness.title")} intro={t("selectBusiness.intro")}
      footer={<button type="button" onClick={() => void signOutAndResetAnalytics().then(() => router.push("/login"))} className="cursor-pointer border-0 bg-transparent font-semibold text-fg-muted underline">{t("auth.logout")}</button>}>
      <div className="grid gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {!data ? [0, 1].map((index) => <Skeleton key={index} className="h-16 rounded-[16px]" />) : data.businesses.length === 0 ? <p className="m-0 text-sm text-fg-muted">{t("selectBusiness.none")}</p> : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {data.businesses.map((business) => (
              <li key={business.id}>
                <button type="button" disabled={business.disabled || busy !== ""} onClick={() => void choose(business)} aria-label={t("selectBusiness.open", { name: business.name })}
                  className={cn("flex w-full cursor-pointer items-center gap-3 rounded-[16px] border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    business.active ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand-tint")}>
                  {business.logo ? <LogoImage src={business.logo} className="size-11 rounded-[13px]" /> : <Monogram text={business.name} className="size-11 rounded-[13px]" />}
                  <span className="grid min-w-0 flex-1">
                    <strong dir="auto" className="truncate text-ink">{business.name}</strong>
                    <small className="text-xs text-fg-subtle">{t(`roles.${business.role as "owner"}`)}</small>
                  </span>
                  {business.disabled ? <Badge tone="danger">{t("selectBusiness.disabled")}</Badge> : business.active ? <Badge tone="brand">{t("selectBusiness.current")}</Badge> : <Icon name="forward" className="text-fg-subtle" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Link href="/onboarding" className={buttonClasses({ variant: "secondary", block: true, className: "no-underline" })}><Icon name="plus" className="size-4" />{t("selectBusiness.create")}</Link>
        {data?.isPlatformAdmin && <Link href="/platform" className={buttonClasses({ variant: "ghost", block: true, className: "no-underline" })}>{t("selectBusiness.platform")}</Link>}
      </div>
    </AuthShell>
  );
}

type Invitation = { id: string; role: string | null; businessName: string; logo: string | null; state: "pending" | "expired" | "accepted" | "rejected" | "canceled"; expiresAt: string; email: string; needsEmailVerification: boolean };

export function InvitationView({ invitationId }: { invitationId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [invitation, setInvitation] = useState<Invitation | null | "missing">(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/account/invitations/${encodeURIComponent(invitationId)}`, { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) { router.replace(`/login?next=${encodeURIComponent(`/invitations/${invitationId}`)}`); return; }
      if (!response.ok) { setInvitation("missing"); return; }
      setInvitation((await response.json() as { invitation: Invitation }).invitation);
    }).catch(() => setError(t("errors.network")));
  }, [invitationId, router, t]);
  const [verification, setVerification] = useState<"idle" | "sending" | "sent" | "unavailable">("idle");
  const accept = async () => {
    setBusy(true); setError("");
    const response = await fetch(`/api/account/invitations/${encodeURIComponent(invitationId)}`, { method: "POST" }).catch(() => null);
    if (response?.status === 403 && invitation && invitation !== "missing") { setInvitation({ ...invitation, needsEmailVerification: true }); setBusy(false); return; }
    if (!response?.ok) { setError(t("invitation.used")); setBusy(false); return; }
    router.push("/business/dashboard");
  };
  // Lien de confirmation envoyé à l'adresse du compte connecté ; il ramène sur cette invitation.
  const sendVerification = async (email: string) => {
    setVerification("sending"); setError("");
    const { error: failure } = await authClient.sendVerificationEmail({ email, callbackURL: `/invitations/${encodeURIComponent(invitationId)}` }).catch(() => ({ error: { status: 0 } }));
    if (!failure) { setVerification("sent"); return; }
    setVerification(failure.status === 400 ? "unavailable" : "idle");
    if (failure.status !== 400) setError(t("errors.generic"));
  };
  const switchAccount = () => void signOutAndResetAnalytics().then(() => router.push(`/login?next=${encodeURIComponent(`/invitations/${invitationId}`)}`));
  const loaded = invitation && invitation !== "missing" ? invitation : null;
  return (
    <AuthShell title={t("invitation.title")} intro={loaded ? t("invitation.intro", { business: loaded.businessName }) : undefined}>
      <div className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {invitation === null ? <Skeleton className="h-24 rounded-[16px]" /> : invitation === "missing" ? (
          <><Alert tone="warning">{t("invitation.notFound")}</Alert><Button variant="secondary" block onClick={switchAccount}>{t("invitation.switchAccount")}</Button></>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-[16px] bg-paper p-3">
              {invitation.logo ? <LogoImage src={invitation.logo} className="size-12 rounded-[14px]" /> : <Monogram text={invitation.businessName} className="size-12 rounded-[14px]" />}
              <div className="min-w-0">
                <strong dir="auto" className="block truncate text-ink">{invitation.businessName}</strong>
                <small className="text-sm text-fg-muted">{t("invitation.role", { role: t(`roles.${(invitation.role ?? "member") as "owner"}`) })}</small>
              </div>
            </div>
            {invitation.state === "pending" && invitation.needsEmailVerification ? (
              <div className="grid gap-3">
                <Alert tone="info"><strong className="block text-ink">{t("invitation.verifyTitle")}</strong>{t("invitation.verifyBody", { email: invitation.email })}</Alert>
                {verification === "sent" && <Alert tone="success">{t("invitation.verifySent", { email: invitation.email })}</Alert>}
                {verification === "unavailable" && <Alert tone="warning">{t("invitation.verifyUnavailable")}</Alert>}
                {verification !== "sent" && verification !== "unavailable" && (
                  <Button size="lg" block loading={verification === "sending"} onClick={() => void sendVerification(invitation.email)} icon={<Icon name="check" />}>{t("invitation.verifySend")}</Button>
                )}
                <Button variant="secondary" block onClick={() => window.location.reload()}>{t("invitation.verifyRefresh")}</Button>
              </div>
            ) : invitation.state === "pending" ? (
              <>
                <p className="m-0 text-sm text-fg-muted">{t("invitation.expires", { date: new Date(invitation.expiresAt).toLocaleString(intlLocale[locale], { dateStyle: "medium", timeStyle: "short" }) })}</p>
                <Button size="lg" block loading={busy} onClick={() => void accept()} icon={<Icon name="check" />}>{busy ? t("invitation.accepting") : t("invitation.accept")}</Button>
              </>
            ) : <Alert tone="warning">{invitation.state === "expired" ? t("invitation.expired") : t("invitation.used")}</Alert>}
          </>
        )}
      </div>
    </AuthShell>
  );
}
