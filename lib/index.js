// Host side of dsh-cot-summary.
// Exposes the `cotSummary` Typert-remote service: summarizes one expanded
// reasoning text with a configurable model — either a model already wired into
// DSH through `ctx.llm`, or an external OpenAI-compatible endpoint (Ollama,
// LM Studio, vLLM, any hosted /v1) fetched directly.
import { createHash, randomUUID } from 'node:crypto';
import { Service } from '@deepseek-ai/cordis';
import z from '../vendor/schemastery.mjs';

/** Property name the Typert gateway reads to discover remote-marked methods. */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

const SUMMARY_PROMPT_VERSION = 1;

const SYSTEM_ZH = '你是严谨的思考过程摘要器。阅读模型的一段思考草稿，用 2 到 3 句中文概括：它在解决什么问题、得出的关键结论或方案、接下来要做什么。只输出摘要正文，不要标题、前缀、列表或评价。草稿可能中断或残缺，忽略与最终结论无关的反复纠结。';

const SYSTEM_EN = 'You are a precise summarizer of model reasoning drafts. Read the draft and summarize it in 2 to 3 sentences in English: what problem it works on, the key conclusion or plan it reaches, and what it does next. Output only the summary text, without titles, prefixes, lists, or commentary. The draft may be cut off; ignore flailing that is irrelevant to the final conclusion.';

const Config = z.object({
  transport: z.union([z.const('dsh-llm'), z.const('openai')]).default('dsh-llm').volatile(),
  provider: z.string().default('').volatile(),
  model: z.string().default('').volatile(),
  baseUrl: z.string().default('http://localhost:11434/v1').volatile(),
  apiKey: z.string().default('').volatile(),
  language: z.union([z.const('auto'), z.const('zh'), z.const('en')]).default('auto').volatile(),
  minChars: z.number().step(1).min(0).max(4000).default(120).volatile(),
  maxChars: z.number().step(1).min(400).max(200000).default(24000).volatile(),
  maxOutputTokens: z.number().step(1).min(64).max(4096).default(800).volatile(),
  timeoutSeconds: z.number().step(1).min(5).max(300).default(90).volatile(),
});

/**
 * @param {string} text - candidate reasoning text.
 * @returns {boolean} true when the text contains CJK ideographs.
 */
function containsCjk(text) {
  return /[\u3400-\u9fff]/.test(text);
}

/**
 * Keep the head and the tail of an oversized draft, dropping the middle.
 * @param {string} text - full reasoning text.
 * @param {number} maxChars - budget in UTF-16 code units.
 * @returns {string} text that fits the budget or the untouched input.
 */
function truncateMiddle(text, maxChars) {
  if (text.length <= maxChars) return text;
  const headLength = Math.floor(maxChars * 0.7);
  const tailLength = maxChars - headLength;
  return `${text.slice(0, headLength)}\n…[middle omitted]…\n${text.slice(text.length - tailLength)}`;
}

/**
 * Build the summarization prompt pair for one draft.
 * @param {string} text - already truncated reasoning text.
 * @param {"auto" | "zh" | "en"} language - output language preference.
 * @returns {{system: string, user: string}} system and user prompt texts.
 */
function buildPrompt(text, language) {
  const languageOut = language === 'auto' ? (containsCjk(text) ? 'zh' : 'en') : language;
  const system = languageOut === 'zh' ? SYSTEM_ZH : SYSTEM_EN;
  const user = `Thinking draft:\n<<<\n${text}\n>>>`;
  return { system, user };
}

/**
 * Summarize expanded reasoning through a configurable model.
 * Remote surface: `summarize(request, signal)` returning the summary text.
 */
export default class CotSummaryService extends Service {
  static Config = Config;
  static inject = ['llm', 'agentDefaultModel'];

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
   * @param {object} config - validated volatile configuration fields.
   */
  constructor(ctx, config) {
    super(ctx, 'cotSummary');
    this.config = config;
    this.typertRemote = Object.freeze({ service: this, serviceKey: 'cotSummary', namespace: 'cotSummary' });
    /** @type {Map<string, string>} insertion-ordered summary cache. */
    this.cache = new Map();
  }

  /**
   * Read one volatile configuration field.
   * @param {string} key - Config field name.
   * @returns {unknown} current value.
   */
  setting(key) {
    const field = this.config[key];
    return field !== null && typeof field === 'object' && typeof field.get === 'function' ? field.get() : field;
  }

  /** Snapshot every configuration field once per request. */
  readConfig() {
    return {
      transport: this.setting('transport'),
      provider: this.setting('provider'),
      model: this.setting('model'),
      baseUrl: this.setting('baseUrl'),
      apiKey: this.setting('apiKey'),
      language: this.setting('language'),
      minChars: this.setting('minChars'),
      maxChars: this.setting('maxChars'),
      maxOutputTokens: this.setting('maxOutputTokens'),
      timeoutSeconds: this.setting('timeoutSeconds'),
    };
  }

  /**
   * Merge per-request overrides over the configured defaults.
   * @param {object | undefined} prefs - optional client preferences.
   * @returns {ReturnType<CotSummaryService['readConfig']>} effective configuration.
   */
  effectiveConfig(prefs) {
    const config = this.readConfig();
    if (prefs === null || typeof prefs !== 'object') return config;
    const text = key => (typeof prefs[key] === 'string' ? prefs[key].trim() : '');
    const count = key => (Number.isFinite(prefs[key]) ? Number(prefs[key]) : void 0);
    const transport = text('transport');
    if (transport === 'dsh-llm' || transport === 'openai') config.transport = transport;
    for (const key of ['provider', 'model', 'baseUrl', 'apiKey']) {
      const value = text(key);
      if (value !== '') config[key] = value;
    }
    const language = text('language');
    if (language === 'auto' || language === 'zh' || language === 'en') config.language = language;
    for (const key of ['minChars', 'maxChars', 'maxOutputTokens', 'timeoutSeconds']) {
      const value = count(key);
      if (value !== void 0 && value >= 1) config[key] = Math.round(value);
    }
    return config;
  }

  /**
   * Report the models this deployment can summarize with.
   * @param {AbortSignal} signal - gateway cancellation signal.
   * @returns {Promise<{current: {provider: string, model: string}, providers: {id: string, name: string}[]}>} routes.
   */
  async routes(signal) {
    signal?.throwIfAborted();
    const selection = this.ctx.agentDefaultModel.currentSelection();
    const providers = this.ctx.llm.listProviders().map(provider => ({ id: provider.id, name: provider.name }));
    return {
      current: {
        provider: typeof selection?.provider === 'string' ? selection.provider : '',
        model: typeof selection?.model === 'string' ? selection.model : '',
      },
      providers,
    };
  }

  /**
   * Summarize one expanded reasoning text.
   * @param {{text: string, sessionId?: string, prefs?: object}} request - client request.
   * @param {AbortSignal} signal - gateway cancellation signal.
   * @returns {Promise<string>} summary text; empty when the draft is too short.
   */
  async summarize(request, signal) {
    const text = typeof request?.text === 'string' ? request.text.trim() : '';
    if (text === '') return '';
    const config = this.effectiveConfig(request?.prefs);
    if (text.length < config.minChars) return '';
    const cacheKey = createHash('sha256').update(JSON.stringify([
      SUMMARY_PROMPT_VERSION,
      config.transport,
      config.transport === 'openai' ? config.baseUrl : '',
      config.provider,
      config.model,
      config.language,
      text,
    ])).digest('hex');
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }
    const prompt = buildPrompt(truncateMiddle(text, config.maxChars), config.language);
    const timeout = AbortSignal.timeout(config.timeoutSeconds * 1000);
    const requestSignal = signal instanceof AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
    let summary;
    try {
      summary = config.transport === 'openai'
        ? await this.viaOpenAi(prompt, config, requestSignal)
        : await this.viaDshLlm(prompt, request?.sessionId, config, requestSignal);
    } catch (error) {
      console.error('[cot-summary] summarize failed:', error);
      throw error;
    }
    const value = summary.trim();
    if (value === '') throw new Error('cot-summary: the model returned no text');
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(cacheKey, value);
    return value;
  }

  /**
   * Direct OpenAI-compatible chat completion (Ollama, LM Studio, hosted /v1).
   * @param {{system: string, user: string}} prompt - prompt pair.
   * @param {ReturnType<CotSummaryService['readConfig']>} config - config snapshot.
   * @param {AbortSignal} signal - combined cancellation and timeout signal.
   * @returns {Promise<string>} assistant message text.
   */
  async viaOpenAi(prompt, config, signal) {
    if (config.model === '') throw new Error('cot-summary: set "model" for the openai transport');
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers = { 'content-type': 'application/json' };
    if (config.apiKey !== '') {
      headers.authorization = config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
    }
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: config.maxOutputTokens,
          stream: false,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        }),
      });
    } catch (error) {
      throw new Error(`cot-summary: request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 400);
      throw new Error(`cot-summary: endpoint responded ${response.status} ${detail}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('');
    return '';
  }

  /**
   * Summarize through a model already wired into DSH.
   * @param {{system: string, user: string}} prompt - prompt pair.
   * @param {string | undefined} sessionId - originating session, when supplied.
   * @param {ReturnType<CotSummaryService['readConfig']>} config - config snapshot.
   * @param {AbortSignal} signal - combined cancellation and timeout signal.
   * @returns {Promise<string>} streamed assistant text.
   */
  async viaDshLlm(prompt, sessionId, config, signal) {
    let provider = config.provider;
    let model = config.model;
    if (provider === '' || model === '') {
      const selection = this.ctx.agentDefaultModel.currentSelection();
      if (provider === '') provider = typeof selection?.provider === 'string' ? selection.provider : '';
      if (model === '') model = typeof selection?.model === 'string' ? selection.model : '';
    }
    if (provider === '' || model === '') {
      throw new Error('cot-summary: no model route; pick a provider and model in the plugin settings');
    }
    const call = await this.ctx.llm.prepareCall(
      { provider, model, maxTokens: config.maxOutputTokens },
      signal,
      controls => ({ ...controls }),
    );
    const messages = [Object.freeze({
      id: randomUUID(),
      role: 'user',
      content: Object.freeze([Object.freeze({ type: 'text', text: prompt.user })]),
      source: Object.freeze({ kind: 'cot-summary' }),
    })];
    /** @type {Record<string, unknown>} */
    const options = { ...call.config, messages, system: prompt.system, purpose: 'cot-summary', signal };
    if (typeof sessionId === 'string' && sessionId !== '') options.sessionId = sessionId;
    let output = '';
    for await (const chunk of call.stream(options)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        output += chunk.text;
        continue;
      }
      if (chunk?.type !== 'finish') continue;
      const reason = chunk.reason;
      if (reason?.kind === 'error') {
        const failure = reason.failure;
        const detail = typeof failure?.message === 'string' && failure.message !== ''
          ? failure.message
          : typeof failure?.code === 'string' && failure.code !== '' ? failure.code : 'model call failed';
        throw new Error(`cot-summary: ${provider}/${model} — ${detail}`);
      }
      if (reason?.kind === 'aborted' && output.trim() === '') throw new Error('cot-summary: the model call was aborted');
      if (reason?.kind === 'max-tokens' && output.trim() === '') {
        throw new Error(`cot-summary: ${provider}/${model} — the output budget ran out before any summary text; raise "Max output tokens"`);
      }
    }
    return output;
  }
}

Object.defineProperty(CotSummaryService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: 'summarize', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'routes', invocation: Object.freeze({ kind: 'direct' }) }),
    ]),
  }),
});
