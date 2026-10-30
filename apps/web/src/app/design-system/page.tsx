import { notFound } from "next/navigation";
import { DesignSystemShowcase } from "@/components/design-system/showcase";

export const metadata = { title: "Design system · QADR OPS", robots: { index: false } };

/** Vitrine interne : jamais servie en production. */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSystemShowcase />;
}
