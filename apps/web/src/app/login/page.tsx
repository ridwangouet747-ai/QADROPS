import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Connexion · QADR OPS", robots: { index: false } };

export default function Page() {
  return <Suspense><LoginForm /></Suspense>;
}
