// GPT-6 is a reasoning model; reserve headroom for reasoning tokens.
function openAIOptions(model, requested) {
  const tokens = Number.isFinite(requested) ? requested : 3500;
  if (/^gpt-6(?:\.|-|$)/.test(model)) return { max_completion_tokens: Math.min(40000, Math.max(6000, tokens + 6000)), reasoning_effort: 'low' };
  return { max_tokens: tokens };
}
module.exports={openAIOptions};
