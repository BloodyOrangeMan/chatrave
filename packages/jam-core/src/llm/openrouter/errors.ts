export type OpenRouterErrorCode = 'auth' | 'rate_limit' | 'network' | 'parse' | 'unknown';

export interface OpenRouterError extends Error {
  code: OpenRouterErrorCode;
  retryable: boolean;
  status?: number;
}

export function makeOpenRouterError(
  message: string,
  code: OpenRouterErrorCode,
  retryable: boolean,
  status?: number,
): OpenRouterError {
  const error = new Error(message) as OpenRouterError;
  error.code = code;
  error.retryable = retryable;
  error.status = status;
  return error;
}

export function mapHttpStatusToError(status: number, body: string): OpenRouterError {
  if (status === 401 || status === 403) {
    return makeOpenRouterError(`OpenRouter authentication failed: ${body}`, 'auth', false, status);
  }
  if (status === 429) {
    return makeOpenRouterError(`OpenRouter rate limited: ${body}`, 'rate_limit', true, status);
  }
  if (status >= 500) {
    return makeOpenRouterError(`OpenRouter server error (${status}): ${body}`, 'network', true, status);
  }
  return makeOpenRouterError(`OpenRouter request failed (${status}): ${body}`, 'unknown', false, status);
}
