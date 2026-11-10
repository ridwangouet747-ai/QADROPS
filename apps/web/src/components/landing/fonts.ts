import { Rubik } from "next/font/google";

/**
 * Police des titres de la page publique (docs/design/direction-artistique.md § 3). Rubik couvre le latin et
 * l'arabe avec les mêmes graisses : les titres arabes ne retombent plus sur la police du système.
 * Licence SIL Open Font License 1.1.
 */
export const displayFont = Rubik({ subsets: ["latin", "arabic"], weight: ["600", "700", "800"], display: "swap", variable: "--font-rubik" });
