/** Assemble des classes conditionnelles sans dépendance externe. */
export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
