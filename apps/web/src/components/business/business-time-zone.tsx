"use client";

import { createContext, useContext } from "react";
import { BUSINESS_DEFAULT_TIME_ZONE } from "@/lib/i18n/format";

/**
 * Fuseau du commerce actif (`business_profile.timezone`), fourni par `BusinessShell` après lecture des
 * paramètres. Les heures affichées suivent ce fuseau, jamais celui de l'appareil ; Abidjan en attendant.
 */
export const BusinessTimeZoneContext = createContext(BUSINESS_DEFAULT_TIME_ZONE);
export const useBusinessTimeZone = () => useContext(BusinessTimeZoneContext);
