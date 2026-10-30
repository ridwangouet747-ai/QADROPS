"use client";

import { useEffect } from "react";
import { initializeAnalytics } from "@/lib/analytics/client";

export function AnalyticsProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    initializeAnalytics();
  }, []);
  return children;
}
