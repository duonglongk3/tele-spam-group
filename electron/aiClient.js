const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_MODEL = 'gpt-4o-mini';

function getAiBaseUrl() {
  return OPENAI_BASE_URL;
}

function getAiModel() {
  return OPENAI_MODEL;
}

function sanitizeAiErrorText(value) {
  return String(value || '')
    .replace(/\b(?:sk|pp__)[A-Za-z0-9_*.-]{8,}\b/g, '[REDACTED_API_KEY]')
    .slice(0, 300);
}

function parseAiResponse(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  if (!trimmed.includes('data:')) return null;

  let id = null;
  let model = null;
  let finishReason = null;
  let usage = null;
  let content = '';
  let reasoningContent = '';
  const toolCallsMap = new Map();

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const dataStr = line.slice(5).trim();
    if (!dataStr || dataStr === '[DONE]') continue;
    try {
      const chunk = JSON.parse(dataStr);
      if (chunk.id) id = chunk.id;
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (delta.content) content += delta.content;
      if (delta.reasoning_content) reasoningContent += delta.reasoning_content;
      if (delta.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index || 0;
          if (!toolCallsMap.has(index)) {
            toolCallsMap.set(index, {
              id: toolCall.id || '',
              type: toolCall.type || 'function',
              function: {
                name: toolCall.function?.name || '',
                arguments: toolCall.function?.arguments || '',
              },
            });
          } else {
            const existing = toolCallsMap.get(index);
            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.type) existing.type = toolCall.type;
            if (toolCall.function?.name) existing.function.name += toolCall.function.name;
            if (toolCall.function?.arguments) existing.function.arguments += toolCall.function.arguments;
          }
        }
      }
    } catch (_) {}
  }

  const cleanContent = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>\s*<\/think>/g, '')
    .trim();
  if (!id && !cleanContent && !reasoningContent && toolCallsMap.size === 0) return null;

  const message = { role: 'assistant', content: cleanContent };
  if (reasoningContent) message.reasoning_content = reasoningContent;
  const toolCalls = Array.from(toolCallsMap.values());
  if (toolCalls.length) message.tool_calls = toolCalls;

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason || 'stop' }],
    usage,
  };
}

let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 10;
const requestQueue = [];

function acquireLock() {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    requestQueue.push(resolve);
  });
}

function releaseLock() {
  activeRequests--;
  if (requestQueue.length > 0) {
    const nextResolve = requestQueue.shift();
    activeRequests++;
    nextResolve();
  }
}

async function createChatCompletion(settings, messages, options = {}) {
  await acquireLock();
  try {
    const {
      temperature = 0.45,
      maxTokens = 700,
      sessionPrefix = 'ai',
      responseFormat,
      timeoutMs = 0,
    } = options;
    const selectedModel = getAiModel();
    let sessionId = `${sessionPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const maxRetries = 3;
    let delay = 1500;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const body = {
          model: selectedModel,
          messages,
          temperature,
          max_tokens: maxTokens,
        };
        if (responseFormat) body.response_format = responseFormat;
        const fetchOptions = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.openaiApiKey}`,
          },
          body: JSON.stringify(body),
        };
        if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
          fetchOptions.signal = AbortSignal.timeout(Number(timeoutMs));
        }
        const response = await fetch(`${getAiBaseUrl(settings)}/chat/completions`, fetchOptions);
        const raw = await response.text();

        // Nếu gặp lỗi Gateway/Server tạm thời, thử lại ở lượt sau
        if (!response.ok && [500, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
          console.warn(`[AI API] Lượt thử ${attempt} thất bại với mã ${response.status}. Thử lại sau ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }

        const json = parseAiResponse(raw);
        if (!response.ok) {
          throw new Error(
            `AI API ${response.status} ${response.statusText}: ${sanitizeAiErrorText(raw)}`,
          );
        }

        return {
          raw,
          json,
          content: json?.choices?.[0]?.message?.content || raw,
          model: selectedModel,
          sessionId,
        };
      } catch (err) {
        const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('aborted');
        const isNetworkError = err.message?.includes('fetch') || err.message?.includes('network') || err.message?.includes('getaddrinfo');
        
        if ((isTimeout || isNetworkError) && attempt < maxRetries) {
          console.warn(`[AI API] Lượt thử ${attempt} thất bại do lỗi kết nối: ${err.message}. Thử lại sau ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        throw err;
      }
    }
  } finally {
    releaseLock();
  }
}

function parseJsonContent(content) {
  const text = String(content || '').trim();
  if (!text) throw new Error('AI returned empty content');

  try {
    return JSON.parse(text);
  } catch (_) {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(text.slice(first, last + 1));
  }

  throw new Error('AI returned invalid JSON object');
}
async function createJsonChatCompletion(settings, messages, options = {}) {
  const {
    maxJsonRetries = 2,
    validateJson,
    repairPrompt = 'Your previous response was not valid for the required JSON schema. Return JSON only, no markdown, no explanation, and match the exact schema requested.',
    ...chatOptions
  } = options;
  let currentMessages = messages;
  let lastError = null;
  let lastContent = '';

  for (let attempt = 0; attempt <= maxJsonRetries; attempt++) {
    const result = await createChatCompletion(settings, currentMessages, {
      ...chatOptions,
      responseFormat: chatOptions.responseFormat || { type: 'json_object' },
    });
    lastContent = result.content || '{}';

    try {
      const parsed = parseJsonContent(lastContent);
      if (typeof validateJson === 'function') {
        const validation = validateJson(parsed);
        if (validation !== true) {
          throw new Error(typeof validation === 'string' ? validation : 'JSON schema validation failed');
        }
      }
      return parsed;
    } catch (err) {
      lastError = err;
      if (attempt >= maxJsonRetries) break;
      console.warn(`[AI JSON] Invalid format on attempt ${attempt + 1}: ${err.message}. Asking model to regenerate.`);
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: lastContent.slice(0, 4000) },
        { role: 'user', content: `${repairPrompt}\nValidation error: ${err.message}` },
      ];
    }
  }

  throw new Error(`AI returned invalid JSON after ${maxJsonRetries + 1} attempts: ${lastError?.message || 'unknown error'}. Raw: ${lastContent.slice(0, 300)}`);
}

module.exports = {
  createChatCompletion,
  createJsonChatCompletion,
  getAiBaseUrl,
  getAiModel,
  parseAiResponse,
};


