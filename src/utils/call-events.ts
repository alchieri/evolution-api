/** Dispatch every call event without mutating provider identities in the webhook. */
export async function dispatchCallEvents<T extends { id: string; from: string; status: string }>(
  calls: readonly T[],
  actions: {
    reject?: (call: T) => Promise<unknown>;
    reply?: (call: T) => Promise<unknown>;
    publish: (call: T) => unknown;
  },
) {
  const errors: unknown[] = [];
  for (const call of calls) {
    try {
      if (call.status === 'offer') {
        await actions.reject?.(call);
        await actions.reply?.(call);
      }
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await actions.publish(call);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Call batch processing failed');
}

export const callingCapabilities = Object.freeze({
  receive: false,
  initiate: false,
  audio: false,
  video: false,
  recording: false,
  transfer: false,
  observedEvents: true,
  reason: 'CALL_MEDIA_NOT_SUPPORTED',
});

export function unsupportedCall(): never {
  throw {
    status: 501,
    error: 'Not Implemented',
    message: ['Áudio e vídeo de chamadas ainda não estão disponíveis nesta integração.'],
  };
}
