import { Suspense } from "react";
import { BusinessPicker } from "@/components/auth/account-screens";

export const metadata = { title: "Choisir un commerce · QADR OPS", robots: { index: false } };

export default function Page() {
  return <Suspense><BusinessPicker /></Suspense>;
}
