"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { downscaleLogo } from "@/components/auth/account-screens";
import { PasswordInput, securityHeaders, turnstileRejected } from "@/components/auth/auth-forms";
import { TurnstileWidget, turnstileSiteKey } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Icon, type IconName } from "@/components/ui/icon";
import { authClient } from "@/lib/auth/client";
import { safeNext } from "@/lib/client/redirect";
import type { MessageKey } from "@/lib/i18n/translate";
import {
  accountSchema, activities, businessSchema, draftStorageKey, emptyBusiness, newCreationKey, parseDraft, scenePlan, serializeDraft,
  storeFormats, toCreateBusinessPayload, wizardSteps, type AccountValues, type BusinessValues, type SceneStage, type WizardStep,
} from "@/lib/onboarding/wizard";
import { OnboardingScene } from "./onboarding-scene";

gsap.registerPlugin(useGSAP);

const stepFields: Record<Exclude<WizardStep, "account" | "review">, (keyof BusinessValues)[]> = {
  identity: ["businessName", "activity", "storeFormat"], details: ["phone", "address"], branding: ["logo", "displayName"],
};
const activityIcons: Record<(typeof activities)[number], IconName> = { hardware: "box", phones: "store", general: "cart", clothing: "grid" };
const emptyAccount: AccountValues = { name: "", email: "", password: "", confirm: "" };

/** Lecture sûre du stockage de session (bloqué en navigation privée stricte). */
const storage = {
  read: () => { try { return sessionStorage.getItem(draftStorageKey); } catch { return null; } },
  write: (value: string) => { try { sessionStorage.setItem(draftStorageKey, value); } catch { /* sans brouillon */ } },
  clear: () => { try { sessionStorage.removeItem(draftStorageKey); } catch { /* rien à effacer */ } },
};

/**
 * Inscription et création du commerce en cinq étapes (mission 08). Better Auth crée le compte à
 * l'étape 1 ; la route existante POST /api/account/businesses crée le commerce à la fin, avec une
 * clé de création qui rend un nouvel essai sans danger. L'écran de bienvenue n'apparaît qu'après la
 * réponse 201 du serveur. Le mot de passe n'est jamais conservé hors du champ de saisie.
 */
export function OnboardingWizard({ entry }: { entry: "register" | "onboarding" }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [step, setStep] = useState<WizardStep>(entry === "onboarding" ? "identity" : "account");
  const [direction, setDirection] = useState(1);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [creationKey, setCreationKey] = useState("");
  const [phase, setPhase] = useState<"form" | "submitting" | "welcome">("form");
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [security, setSecurity] = useState<{ token: string | null; resetKey: number }>({ token: null, resetKey: 0 });
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const welcomeRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  // Tant que la page n'est pas hydratée, aucun envoi natif du formulaire (qui contournerait la validation).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // Une seule scène montée (un seul contexte WebGL) : colonne de droite sur grand écran, bandeau au-dessus du formulaire sinon.
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const query = matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const account = useForm<AccountValues>({ resolver: zodResolver(accountSchema), defaultValues: emptyAccount, mode: "onTouched" });
  const business = useForm<BusinessValues>({ resolver: zodResolver(businessSchema), defaultValues: emptyBusiness, mode: "onTouched" });
  const values = useWatch({ control: business.control }) as BusinessValues;
  const accountName = useWatch({ control: account.control, name: "name" });
  const accountEmail = useWatch({ control: account.control, name: "email" });

  /* Reprise du brouillon et de la session existante. */
  useEffect(() => {
    const draft = parseDraft(storage.read());
    setCreationKey(draft?.creationKey ?? newCreationKey());
    if (draft) {
      business.reset({ ...emptyBusiness, ...draft.business });
      account.reset({ ...emptyAccount, name: draft.account.name, email: draft.account.email });
      if (draft.step !== "account") { setStep(draft.step); setRestored(true); }
    }
    fetch("/api/account/me", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) { if (entry === "onboarding") router.replace("/login?next=/onboarding"); return; }
      const me = await response.json() as { user?: { email?: string } };
      setSessionEmail(me.user?.email ?? "");
      setStep((current) => (current === "account" ? "identity" : current));
    }).catch(() => undefined);
    // Lecture unique au montage.
  }, []);

  /* Sauvegarde continue du brouillon (sans mot de passe). */
  useEffect(() => {
    if (!creationKey || phase === "welcome") return;
    storage.write(serializeDraft({ step, creationKey, business: { ...emptyBusiness, ...values }, account: { name: accountName, email: accountEmail } }));
  }, [values, step, creationKey, accountName, accountEmail, phase]);

  /* Transition d'étape : fondu et léger glissement, rien si l'utilisateur réduit les animations. */
  useGSAP(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(panel.current, { autoAlpha: 0, x: 28 * direction * (document.dir === "rtl" ? -1 : 1) }, { autoAlpha: 1, x: 0, duration: 0.45, ease: "power3.out", clearProps: "transform" });
      gsap.from(panel.current?.querySelectorAll("[data-field]") ?? [], { autoAlpha: 0, y: 10, duration: 0.35, stagger: 0.05, delay: 0.08, ease: "power2.out", clearProps: "all" });
    });
    heading.current?.focus({ preventScroll: true });
    return () => media.revert();
  }, { dependencies: [step], scope: root });

  useGSAP(() => {
    if (phase !== "welcome" || !welcomeRef.current) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline()
        .from(welcomeRef.current, { autoAlpha: 0, y: 16, scale: 0.98, duration: 0.6, ease: "power3.out" })
        .from(welcomeRef.current!.querySelectorAll("[data-welcome]"), { autoAlpha: 0, y: 10, stagger: 0.08, duration: 0.4, ease: "power2.out" }, "-=0.3")
        .fromTo(welcomeRef.current!.querySelector("[data-progress]"), { scaleX: 0 }, { scaleX: 1, duration: 3.6, ease: "none" }, "<");
    });
    return () => media.revert();
  }, { dependencies: [phase], scope: root });

  const index = wizardSteps.indexOf(step);
  const minimum = sessionEmail !== null ? 1 : 0;
  const go = useCallback((target: WizardStep) => {
    setDirection(wizardSteps.indexOf(target) >= wizardSteps.indexOf(step) ? 1 : -1);
    setError("");
    setStep(target);
  }, [step]);

  const submitAccount = account.handleSubmit(async (input) => {
    if (turnstileSiteKey && !security.token) { setError(t("auth.turnstile.required")); return; }
    setPhase("submitting"); setError("");
    const { error: failure } = await authClient.signUp.email({ name: input.name.trim(), email: input.email.trim(), password: input.password, fetchOptions: securityHeaders(security.token) })
      .catch(() => ({ error: { status: 0 } as { status: number; code?: string; message?: string } }));
    // Le mot de passe quitte le formulaire dès la réponse, réussie ou non.
    account.resetField("password"); account.resetField("confirm");
    setPhase("form");
    if (failure) {
      setSecurity((current) => ({ token: null, resetKey: current.resetKey + 1 }));
      setError(turnstileRejected(failure) ? t("auth.turnstile.failed") : failure.status === 0 ? t("wizard.errors.network") : t("wizard.errors.accountFailed"));
      return;
    }
    setSessionEmail(input.email.trim());
    if (next) { storage.clear(); router.push(next); return; }
    go("identity");
  });

  const continueFrom = async (current: Exclude<WizardStep, "account" | "review">) => {
    const fields = stepFields[current];
    const ok = await business.trigger(fields, { shouldFocus: true });
    if (!ok) { setError(t("wizard.errors.summary")); return; }
    go(wizardSteps[wizardSteps.indexOf(current) + 1]!);
  };

  const create = async () => {
    const parsed = businessSchema.safeParse(values);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.path[0];
      const target = (Object.keys(stepFields) as (keyof typeof stepFields)[]).find((key) => stepFields[key].includes(first as keyof BusinessValues));
      if (target) { go(target); void business.trigger(stepFields[target]); }
      return;
    }
    setPhase("submitting"); setError("");
    let response: Response;
    try {
      response = await fetch("/api/account/businesses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toCreateBusinessPayload(parsed.data, creationKey)) });
    } catch {
      setPhase("form"); setError(t("wizard.errors.network")); return;
    }
    if (response.status !== 201) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setPhase("form");
      setError(locale === "fr" && body.error ? `${body.error} ${t("wizard.errors.createFailed")}` : t("wizard.errors.createFailed"));
      return;
    }
    // Confirmation du serveur reçue : seulement maintenant, la bienvenue.
    storage.clear();
    setPhase("welcome");
    setTimeout(() => router.push("/business/dashboard"), 3800);
  };

  const onLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { business.setError("logo", { message: "wizard.errors.logoType" }); return; }
    setLogoBusy(true);
    try {
      const data = await downscaleLogo(file);
      business.setValue("logo", data, { shouldValidate: true, shouldDirty: true });
    } catch { business.setError("logo", { message: "wizard.errors.logoType" }); } finally { setLogoBusy(false); }
  };

  const stage: SceneStage = phase === "welcome" ? "welcome" : step;
  const plan = useMemo(() => scenePlan(stage, { ...emptyBusiness, ...values }), [stage, values]);
  const fieldError = (message?: string) => (message ? t(message as MessageKey) : undefined);
  const businessErrors = business.formState.errors;
  const accountErrors = account.formState.errors;
  const businessLabel = values.displayName?.trim() || values.businessName?.trim() || "";

  return (
    <div ref={root} className="min-h-dvh overflow-x-clip bg-canvas lg:grid lg:h-dvh lg:grid-cols-[minmax(460px,0.92fr)_minmax(0,1.08fr)] lg:overflow-hidden">
      {/* Zone formulaire */}
      <div className="flex min-h-dvh min-w-0 flex-col px-4 pt-4 pb-6 sm:px-8 lg:h-dvh lg:min-h-0 lg:overflow-y-auto lg:px-12 lg:pt-7">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" dir="ltr" aria-label="QADR OPS" className="flex items-center gap-2.5 text-ink no-underline">
            <span className="grid size-10 place-items-center rounded-[13px] bg-brand-gradient text-lg font-extrabold text-white shadow-brand">Q</span>
            <strong className="text-[1.05rem] font-extrabold tracking-[-0.02em]">QADR OPS</strong>
          </Link>
          <LanguageSwitcher />
        </header>

        {/* Scène compacte sur téléphone et tablette, réduite quand le clavier est ouvert (champ actif). */}
        <div className="group/scene mt-4 lg:hidden">
          {desktop === false ? <OnboardingScene plan={plan} stage={stage} logo={values.logo ?? ""}
            className="relative h-[min(30vh,230px)] rounded-[24px] bg-[radial-gradient(120%_90%_at_50%_10%,#ffffff_0%,#eeecfe_60%,#e3e0fb_100%)] transition-[height] duration-300 [.wizard-typing_&]:h-[96px]" /> : <div className="h-[min(30vh,230px)] rounded-[24px] bg-surface-muted" />}
          <p className="m-0 mt-2 text-center text-[0.8rem] font-semibold text-fg-muted" aria-live="polite">{t(`wizard.scene.captions.${stage}`)}</p>
        </div>

        <main className="mx-auto my-auto w-full max-w-[520px] py-6" onFocusCapture={(event) => { if ((event.target as HTMLElement).tagName === "INPUT") root.current?.classList.add("wizard-typing"); }} onBlurCapture={() => root.current?.classList.remove("wizard-typing")}>
          {phase === "welcome" ? (
            <div ref={welcomeRef} className="rounded-xl border border-line bg-surface p-6 text-center shadow-card sm:p-8" role="status" aria-live="polite">
              <span data-welcome className="mx-auto grid size-14 place-items-center rounded-full bg-brand-gradient text-white shadow-brand"><Icon name="check" className="size-7" /></span>
              <h1 data-welcome className="m-0 mt-5 text-[1.9rem] leading-tight font-bold tracking-[-0.03em] text-ink">{t("wizard.welcome.title")}</h1>
              <p data-welcome className="m-0 mt-2 text-fg-muted">{t("wizard.welcome.body", { business: `⁨${businessLabel}⁩` })}</p>
              <span className="mt-6 block h-1.5 overflow-hidden rounded-full bg-surface-muted"><span data-progress className="block h-full origin-left rounded-full bg-brand rtl:origin-right" /></span>
              <p data-welcome className="m-0 mt-2 text-[0.8rem] text-fg-subtle">{t("wizard.welcome.redirecting")}</p>
              <Button data-welcome className="mt-5" size="lg" block onClick={() => router.push("/business/dashboard")} icon={<Icon name="forward" />}>{t("wizard.actions.goDashboard")}</Button>
            </div>
          ) : (
            <>
              <Stepper current={index} minimum={minimum} />
              {restored && <div className="mt-4"><Alert tone="info" onDismiss={() => setRestored(false)} dismissLabel={t("common.close")}>{t("wizard.restored")}</Alert></div>}
              <div ref={panel} className="mt-5">
                <p className="m-0 text-[0.8rem] font-semibold text-brand-strong">{t("wizard.progress", { current: index + 1, total: wizardSteps.length })}</p>
                <h1 ref={heading} tabIndex={-1} className="m-0 mt-1 text-[1.8rem] leading-tight font-bold tracking-[-0.03em] text-ink outline-none sm:text-[2.1rem]">{t(`wizard.steps.${step}.title`)}</h1>
                <p className="m-0 mt-1.5 text-[0.95rem] text-fg-muted">{t(`wizard.steps.${step}.description`)}</p>

                <div className="mt-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
                  {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

                  {step === "account" && (
                    <form method="post" noValidate onSubmit={(event) => void submitAccount(event)} className="grid gap-4">
                      <div data-field><Field label={t("wizard.fields.name")} error={fieldError(accountErrors.name?.message)}>{(props) => <Input {...props} {...account.register("name")} dir="auto" autoComplete="name" maxLength={100} />}</Field></div>
                      <div data-field><Field label={t("wizard.fields.email")} error={fieldError(accountErrors.email?.message)}>{(props) => <Input {...props} {...account.register("email")} type="email" dir="ltr" autoComplete="email" inputMode="email" />}</Field></div>
                      <div data-field className="grid items-start gap-4 sm:grid-cols-2">
                        <Field label={t("wizard.fields.password")} hint={t("wizard.fields.passwordHint")} error={fieldError(accountErrors.password?.message)}>
                          {(props) => <PasswordInput id={props.id} describedBy={props["aria-describedby"]} invalid={props["aria-invalid"]} autoComplete="new-password" value={account.watch("password")} onChange={(value) => account.setValue("password", value, { shouldValidate: account.formState.isSubmitted })} />}
                        </Field>
                        <Field label={t("wizard.fields.confirm")} error={fieldError(accountErrors.confirm?.message)}>
                          {(props) => <PasswordInput id={props.id} describedBy={props["aria-describedby"]} invalid={props["aria-invalid"]} autoComplete="new-password" value={account.watch("confirm")} onChange={(value) => account.setValue("confirm", value, { shouldValidate: account.formState.isSubmitted })} />}
                        </Field>
                      </div>
                      <div data-field><TurnstileWidget action="register" resetKey={security.resetKey} onToken={(token) => setSecurity((current) => ({ ...current, token }))} /></div>
                      <Button type="submit" size="lg" block loading={phase === "submitting"} disabled={!hydrated || (Boolean(turnstileSiteKey) && !security.token)} icon={<Icon name="forward" />}>
                        {phase === "submitting" ? t("wizard.actions.creatingAccount") : t("wizard.actions.createAccount")}
                      </Button>
                    </form>
                  )}

                  {step === "identity" && (
                    <form method="post" noValidate onSubmit={(event) => { event.preventDefault(); void continueFrom("identity"); }} className="grid gap-5">
                      <div data-field><Field label={t("wizard.fields.businessName")} error={fieldError(businessErrors.businessName?.message)}>{(props) => <Input {...props} {...business.register("businessName")} dir="auto" maxLength={120} placeholder={t("wizard.fields.businessNamePlaceholder")} autoComplete="organization" />}</Field></div>
                      <fieldset data-field className="m-0 grid gap-2 border-0 p-0">
                        <legend className="mb-2 text-sm font-semibold text-ink">{t("wizard.fields.activity")}</legend>
                        <div className="grid grid-cols-2 gap-2.5">
                          {activities.map((activity) => (
                            <Choice key={activity} name="activity" value={activity} checked={values.activity === activity} onSelect={() => business.setValue("activity", activity, { shouldValidate: true })}>
                              <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand-strong"><Icon name={activityIcons[activity]} /></span>
                              <span className="min-w-0"><strong className="block text-[0.88rem] text-ink">{t(`wizard.activities.${activity}`)}</strong><span className="block text-[0.74rem] text-fg-muted">{t(`wizard.activityHints.${activity}`)}</span></span>
                            </Choice>
                          ))}
                        </div>
                        {businessErrors.activity && <p className="m-0 text-sm font-medium text-danger">{fieldError(businessErrors.activity.message)}</p>}
                      </fieldset>
                      <fieldset data-field className="m-0 grid gap-2 border-0 p-0">
                        <legend className="mb-2 text-sm font-semibold text-ink">{t("wizard.fields.storeFormat")}</legend>
                        <div className="flex flex-wrap gap-2">
                          {storeFormats.map((format) => (
                            <label key={format} className={cn("inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[0.86rem] font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40", values.storeFormat === format ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand-tint")}>
                              <input type="radio" name="storeFormat" value={format} checked={values.storeFormat === format} onChange={() => business.setValue("storeFormat", format, { shouldValidate: true })} className="sr-only" />
                              {t(`wizard.formats.${format}`)}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <StepActions onBack={index > minimum ? () => go(wizardSteps[index - 1]!) : undefined} />
                    </form>
                  )}

                  {step === "details" && (
                    <form method="post" noValidate onSubmit={(event) => { event.preventDefault(); void continueFrom("details"); }} className="grid gap-4">
                      <div data-field><Field label={`${t("wizard.fields.phone")} (${t("wizard.fields.optional")})`} error={fieldError(businessErrors.phone?.message)}>{(props) => <Input {...props} {...business.register("phone")} type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={40} placeholder={t("wizard.fields.phonePlaceholder")} />}</Field></div>
                      <div data-field><Field label={`${t("wizard.fields.address")} (${t("wizard.fields.optional")})`} error={fieldError(businessErrors.address?.message)}>{(props) => <Input {...props} {...business.register("address")} dir="auto" autoComplete="street-address" maxLength={200} placeholder={t("wizard.fields.addressPlaceholder")} />}</Field></div>
                      <StepActions onBack={() => go("identity")} />
                    </form>
                  )}

                  {step === "branding" && (
                    <form method="post" noValidate onSubmit={(event) => { event.preventDefault(); void continueFrom("branding"); }} className="grid gap-4">
                      <div data-field className="grid gap-2">
                        <span className="text-sm font-semibold text-ink">{t("wizard.fields.logo")} ({t("wizard.fields.optional")})</span>
                        <div className="flex flex-wrap items-center gap-3">
                          {values.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element -- data URL déjà réduite à 256 px
                            <img src={values.logo} alt={t("wizard.review.logoAlt")} className="size-16 rounded-[16px] border border-line bg-surface object-contain" />
                          ) : <span className="grid size-16 place-items-center rounded-[16px] border border-dashed border-line-strong text-fg-subtle"><Icon name="store" /></span>}
                          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 text-[0.86rem] font-semibold text-ink hover:border-brand-tint has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40">
                            <Icon name="download" className="size-4" />{logoBusy ? t("common.loading") : t("wizard.fields.chooseLogo")}
                            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void onLogo(event)} />
                          </label>
                          {values.logo && <Button variant="ghost" onClick={() => business.setValue("logo", "", { shouldValidate: true })}>{t("wizard.fields.removeLogo")}</Button>}
                        </div>
                        <p className="m-0 text-[0.8rem] text-fg-muted">{t("wizard.fields.logoHint")}</p>
                        {businessErrors.logo && <p className="m-0 text-sm font-medium text-danger">{fieldError(businessErrors.logo.message)}</p>}
                      </div>
                      <div data-field><Field label={`${t("wizard.fields.displayName")} (${t("wizard.fields.optional")})`} hint={t("wizard.fields.displayNameHint")} error={fieldError(businessErrors.displayName?.message)}>{(props) => <Input {...props} {...business.register("displayName")} dir="auto" maxLength={80} placeholder={values.businessName} />}</Field></div>
                      <StepActions onBack={() => go("details")} />
                    </form>
                  )}

                  {step === "review" && (
                    <div className="grid gap-3">
                      <ReviewBlock title={t("wizard.review.business")} onEdit={() => go("identity")}>
                        <strong dir="auto" className="block text-ink">{values.businessName}</strong>
                        <span className="text-fg-muted">{t(`wizard.activities.${values.activity}`)} · {t(`wizard.formats.${values.storeFormat}`)}</span>
                      </ReviewBlock>
                      <ReviewBlock title={t("wizard.review.contact")} onEdit={() => go("details")}>
                        <span dir="ltr" className="block">{values.phone || t("wizard.review.none")}</span>
                        <span dir="auto" className="block text-fg-muted">{values.address || t("wizard.review.none")}</span>
                      </ReviewBlock>
                      <ReviewBlock title={t("wizard.review.branding")} onEdit={() => go("branding")}>
                        <span className="flex items-center gap-3">
                          {values.logo
                            // eslint-disable-next-line @next/next/no-img-element -- data URL déjà réduite à 256 px
                            ? <img src={values.logo} alt={t("wizard.review.logoAlt")} className="size-10 rounded-[12px] border border-line object-contain" />
                            : <span className="text-fg-muted">{t("wizard.review.none")}</span>}
                          <span dir="auto">{values.displayName || values.businessName}</span>
                        </span>
                      </ReviewBlock>
                      <p className="m-0 flex items-center gap-2 text-[0.8rem] text-fg-muted"><Icon name="info" className="size-4" />{t("wizard.review.currency")}</p>
                      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                        <Button variant="secondary" onClick={() => go("branding")} icon={<Icon name="back" />} disabled={phase === "submitting"}>{t("wizard.actions.back")}</Button>
                        <Button size="lg" loading={phase === "submitting"} onClick={() => void create()} icon={<Icon name="check" />}>{phase === "submitting" ? t("wizard.actions.creating") : t("wizard.actions.create")}</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <p className="m-0 mt-5 text-center text-sm text-fg-muted">
                {sessionEmail ? t("wizard.actions.signedInAs", { email: sessionEmail }) : <>{t("wizard.actions.login")} <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-strong no-underline">{t("wizard.actions.loginLink")}</Link></>}
              </p>
            </>
          )}
        </main>
      </div>

      {/* Zone scène (ordinateur) */}
      <aside className="relative hidden p-5 lg:block" aria-label={t("wizard.scene.label")}>
        <div className="relative h-full overflow-hidden rounded-[32px] bg-[radial-gradient(120%_90%_at_50%_0%,#ffffff_0%,#eeecfe_55%,#dcd7fb_100%)] shadow-raised">
          {desktop && <OnboardingScene plan={plan} stage={stage} logo={values.logo ?? ""} className="absolute inset-0" />}
          <div className="pointer-events-none absolute inset-x-6 top-6 flex items-center justify-between gap-3">
            <span className="rounded-full bg-white/80 px-4 py-2 text-[0.8rem] font-semibold text-ink shadow-card backdrop-blur-sm">{t("wizard.tagline")}</span>
            <span className="numeric rounded-full bg-night px-3 py-1.5 text-[0.78rem] font-semibold text-white">{Math.min(index + 1, 5)}/5</span>
          </div>
          <p className="pointer-events-none absolute inset-x-6 bottom-6 m-0 rounded-[20px] bg-night/90 px-5 py-4 text-[1rem] font-semibold text-white shadow-raised backdrop-blur-sm" aria-live="polite">
            {t(`wizard.scene.captions.${stage}`)}
            {businessLabel && stage !== "account" && <span dir="auto" className="mt-0.5 block truncate text-[0.82rem] font-medium text-night-fg">{businessLabel}</span>}
          </p>
        </div>
      </aside>
    </div>
  );
}

function Stepper({ current, minimum }: { current: number; minimum: number }) {
  const { t } = useI18n();
  return (
    <ol className="m-0 grid list-none grid-cols-5 gap-1.5 p-0" aria-label={t("wizard.progress", { current: current + 1, total: wizardSteps.length })}>
      {wizardSteps.map((step, index) => (
        <li key={step} aria-current={index === current ? "step" : undefined} className="min-w-0">
          <span className={cn("block h-1.5 rounded-full transition-colors duration-500 motion-reduce:transition-none", index < current ? "bg-brand" : index === current ? "bg-brand-strong" : "bg-line", index < minimum && "bg-brand-tint")} />
          <span className={cn("mt-1.5 block truncate text-[0.7rem] font-semibold", index === current ? "text-ink" : "text-fg-subtle")}>{t(`wizard.short.${step}`)}</span>
        </li>
      ))}
    </ol>
  );
}

function Choice({ name, value, checked, onSelect, children }: { name: string; value: string; checked: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <label className={cn("flex min-h-[72px] cursor-pointer items-center gap-3 rounded-[18px] border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40", checked ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand-tint")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

function StepActions({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
      {onBack ? <Button variant="secondary" onClick={onBack} icon={<Icon name="back" />}>{t("wizard.actions.back")}</Button> : <span />}
      <Button type="submit" size="lg" disabled={!hydrated} icon={<Icon name="forward" />}>{t("wizard.actions.next")}</Button>
    </div>
  );
}

function ReviewBlock({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="flex items-start justify-between gap-3 rounded-[18px] border border-line bg-paper p-4 text-[0.9rem]">
      <div className="min-w-0"><h2 className="m-0 mb-1 text-[0.78rem] font-semibold tracking-wide text-fg-subtle uppercase">{title}</h2>{children}</div>
      <Button variant="ghost" onClick={onEdit} icon={<Icon name="edit" className="size-4" />}>{t("wizard.actions.edit")}</Button>
    </section>
  );
}
