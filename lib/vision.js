/**
 * Known image-capable model families for OpenAI-compatible endpoints.
 * This is a convenience heuristic, not a provider capability API: a proxy can
 * still reject images even when its model name looks multimodal.
 */
const VISION_PATTERNS = [
  /deepseek-flash/i,
  /deepseek.*vision/i,
  /deepseek.*vl/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-5/i,
  /claude-(3|4)/i,
  /gemini/i,
  /qwen.*vl/i,
  /qwen.*vision/i,
  /llava/i,
  /vision/i,
];

export function supportsVision(model) {
  const name = String(model || '').trim();
  if (!name) return false;
  return VISION_PATTERNS.some((pattern) => pattern.test(name));
}
