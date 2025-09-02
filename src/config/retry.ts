/**
 * Centralized retry configuration for network operations
 */

export const RetryConfig = {
  // Default retry attempts for most operations
  DEFAULT_RETRIES: 3,
  
  // Retry attempts for rate-limit prone operations
  RATE_LIMIT_RETRIES: 7,
  
  // Initial delay between retries (ms)
  DEFAULT_DELAY: 1000,
  
  // Initial delay for rate-limit prone operations (ms)
  RATE_LIMIT_DELAY: 3000,
  
  // Maximum delay between retries (ms)
  MAX_DELAY: 30000,
  
  // Exponential backoff multiplier
  BACKOFF_MULTIPLIER: 2,
  
  // Minimal delay between sequential operations to avoid rate limits
  OPERATION_DELAY: 200,
  
  // Delay after pool creation to ensure chain state updates
  POOL_CREATION_DELAY: 2000
} as const;

export type RetryConfigType = typeof RetryConfig;