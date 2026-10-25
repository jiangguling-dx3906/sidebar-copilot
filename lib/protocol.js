/**
 * Small, dependency-free protocol helpers shared by the side panel and tests.
 * The page side reports a result; the panel binds it to a target/document and
 * decides whether the action is verified, failed, or uncertain.
 */

export function makeRequestId(prefix = 'req') {
  const random =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function makeTarget({ tabId, frameId = 0, documentId = '', url = '' } = {}) {
  return {
    tabId: Number(tabId) || 0,
    frameId: Number(frameId) || 0,
    documentId: String(documentId || ''),
    url: String(url || ''),
  };
}

export function sameDocument(expected, actual) {
  if (!expected?.documentId || !actual?.documentId) return true;
  return expected.documentId === actual.documentId;
}

export function sameTab(expected, actual) {
  if (expected?.tabId == null || actual?.tabId == null) return true;
  return Number(expected.tabId) === Number(actual.tabId);
}

/**
 * Normalize a page-side result into the wire status. `uncertain` means the
 * action may have happened but its postcondition could not be confirmed.
 */
export function classifyResult(result, { documentChanged = false } = {}) {
  if (!result || result.ok === false) {
    return { status: 'error', error: result?.error || 'action failed', result };
  }
  if (documentChanged) {
    return {
      status: 'uncertain',
      result: {
        ...result,
        verified: false,
        uncertain: true,
        postcondition: { type: 'documentChanged', matched: false },
      },
    };
  }
  if (result.uncertain || result.verified === false) {
    return { status: 'uncertain', result: { ...result, uncertain: true } };
  }
  return { status: 'ok', result: { ...result, verified: true } };
}

export function isTerminalStatus(status) {
  return status === 'ok' || status === 'error' || status === 'uncertain' || status === 'cancelled';
}
