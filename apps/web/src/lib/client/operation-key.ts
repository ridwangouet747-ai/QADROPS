export type OperationAttempt = { fingerprint: string; key: string } | null;

/**
 * Returns the operation key to send with a critical write (sale, purchase, expense, receivable payment).
 *
 * The key is kept while the submitted content stays identical, so retrying after a network failure or a lost
 * response reuses it and the server returns the first result instead of recording the operation twice.
 * Changing the content produces a new key. Reset `attempt.current` to null once the server has confirmed.
 */
export function operationKeyFor(attempt: { current: OperationAttempt }, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
  return attempt.current.key;
}
