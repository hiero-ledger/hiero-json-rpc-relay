// SPDX-License-Identifier: Apache-2.0

/** Label used for any method name that is not tracked individually. */
export const UNKNOWN_METHOD_LABEL = 'unknown';

// The configured unknown-label limit must stay strictly below this ceiling
export const UNKNOWN_METHOD_LABELS_CEILING = 1000;

// Real RPC method names are short `namespace_operation` strings, so anything longer or outside this
// character set is never retained as its own label.
const MAX_METHOD_LABEL_LENGTH = 64;
const VALID_METHOD_LABEL = /^[A-Za-z0-9_]+$/;

/**
 * Builds a labeler that keeps the per-method metric label to a bounded set of values.
 *
 * Known methods pass through as-is; unknown names are kept up to the limit, after which the rest
 * collapse to {@link UNKNOWN_METHOD_LABEL}, as do names that are oversized or malformed.
 *
 * @param knownMethods - Names always recorded verbatim, never counted against the limit.
 * @param unknownLabelsLimit - Distinct unknown names to keep before collapsing the rest.
 * @returns A function mapping a raw method name to a bounded label value.
 */
export function createMethodMetricLabeler(
  knownMethods: Iterable<string>,
  unknownLabelsLimit: number,
): (method: unknown) => string {
  const known = new Set(knownMethods);
  const trackedUnknown = new Set<string>();
  const limit = Math.max(0, unknownLabelsLimit);

  return (method: unknown): string => {
    if (typeof method !== 'string') return UNKNOWN_METHOD_LABEL;
    if (known.has(method)) return method;

    // Reject oversized or malformed names before they can consume a tracking slot.
    if (method.length > MAX_METHOD_LABEL_LENGTH || !VALID_METHOD_LABEL.test(method)) return UNKNOWN_METHOD_LABEL;

    if (trackedUnknown.has(method)) return method;
    if (trackedUnknown.size < limit) {
      trackedUnknown.add(method);
      return method;
    }
    return UNKNOWN_METHOD_LABEL;
  };
}
