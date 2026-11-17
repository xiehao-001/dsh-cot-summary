// Browser side of dsh-cot-summary, in __ModuleLoader__ factory form.
// Registers a summary bar at the top of the expanded reasoning body:
// clamped by default, expanded on hover, pinned open on click. Preferences live in
// this browser's localStorage and ride along with each summarize request, so the
// settings page works without a Host settings document.
window.__ModuleLoader__.load({ id: 'dsh-cot-summary', factory: require => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
  const zod = require('zod');
  const react = require('react');
  const jsxRuntime = require('react/jsx-runtime');
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

  // --- Typert RemoteInfo, matching the protocol runtime's inline implementation ---

  class ResultValue {
    constructor(spec) { this.spec = spec; }
    get mode() { return this.spec.mode; }
    get typeSymbol() { return this.spec.typeSymbol; }
    get create() { return this.spec.create; }
    get description() { return this.spec.description; }
    get jsonSchema() {
      if (this.projection === void 0) {
        const schema = this.spec.jsonSchema;
        this.projection = { value: schema === void 0 ? void 0 : { ...schema, description: this.spec.description } };
      }
      return this.projection.value;
    }
  }

  class NamedInput {
    constructor(parameters, strict, zodFace) { this.parameters = parameters; this.strict = strict; this.zod = zodFace; }
    codec(parameter) { return this.strict ? parameter.strictCodec : parameter.codec; }
    create = () => this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map(parameter => {
      const value = this.codec(parameter).create();
      return [parameter.wire, parameter.source === 'json' && parameter.acceptsUndefined === true ? value.optional() : value.nonoptional()];
    })));
    get jsonSchema() {
      return {
        type: 'object',
        properties: Object.fromEntries(this.parameters.map(parameter => [parameter.wire, {
          ...this.codec(parameter).jsonSchema,
          ...(parameter.description === void 0 ? {} : { description: parameter.description }),
        }])),
        required: this.parameters.filter(parameter => !(parameter.source === 'json' && parameter.acceptsUndefined === true)).map(parameter => parameter.wire),
        additionalProperties: false,
      };
    }
  }

  class RemoteInfo {
    constructor(spec, zodFace) { this.spec = spec; this.zod = zodFace; }
    get package() { return this.spec.package; }
    get descriptors() { return this.resolve().descriptors; }
    get methods() { return this.resolve().methods; }
    resolve() {
      if (this.index !== void 0) return this.index;
      const descriptors = [];
      const methods = Object.create(null);
      for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
        const separator = endpoint.indexOf('/');
        const namespace = endpoint.slice(0, separator);
        const method = endpoint.slice(separator + 1);
        const parameters = definition.parameters.map(parameter => ({ ...parameter, wire: parameter.wire ?? parameter.name }));
        const descriptor = {
          ...definition,
          id: `${this.spec.package}#${endpoint}`,
          namespace,
          method,
          parameters,
          result: definition.result.description === void 0 ? definition.result : new ResultValue(definition.result),
        };
        if (definition.invocation.kind === 'direct') {
          const inputs = [];
          methods[endpoint] = Object.assign(descriptor, {
            input(options) { const strict = options?.strict === true; return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, this.zod); },
            invoke(remote, input, signal) {
              const values = parameters.map(parameter => input[parameter.wire]);
              if (definition.cancellation !== void 0) values.push(signal);
              const receiver = Reflect.get(remote, namespace);
              return Reflect.get(receiver, method).apply(receiver, values);
            },
          });
        }
        descriptors.push(descriptor);
      }
      return this.index = { descriptors, methods };
    }
  }

  function createTypertRemoteInfo(spec, zodFace) { return new RemoteInfo(spec, zodFace); }

  // --- remote contributions ---

  const PREF_FIELDS = ['transport', 'provider', 'model', 'baseUrl', 'apiKey', 'language'];
  const PREF_NUMBERS = ['minChars', 'maxChars', 'maxOutputTokens', 'timeoutSeconds'];

  const prefsSchema = () => zod.z.object(Object.fromEntries([
    ...PREF_FIELDS.map(field => [field, zod.z.string().optional()]),
    ...PREF_NUMBERS.map(field => [field, zod.z.number().optional()]),
  ])).optional();

  const requestSchema = () => zod.z.object({
    text: zod.z.string().readonly(),
    sessionId: zod.z.string().readonly().optional(),
    prefs: prefsSchema(),
  });
  const requestStrictSchema = () => zod.z.strictObject({
    text: zod.z.string().readonly(),
    sessionId: zod.z.string().readonly().optional(),
    prefs: prefsSchema(),
  });
  const requestJsonSchema = strict => ({
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Full expanded reasoning text shown in the Chat.' },
      sessionId: { type: 'string', description: 'Originating session; omitting keeps the call stateless.' },
      prefs: {
        type: 'object',
        description: 'Browser preferences overriding the Host defaults for this request.',
        properties: Object.fromEntries([
          ...PREF_FIELDS.map(field => [field, { type: 'string' }]),
          ...PREF_NUMBERS.map(field => [field, { type: 'number' }]),
        ]),
        additionalProperties: false,
      },
    },
    required: ['text'],
    additionalProperties: !strict,
  });

  const routesResultSchema = () => zod.z.object({
    current: zod.z.object({ provider: zod.z.string(), model: zod.z.string() }),
    providers: zod.z.array(zod.z.object({ id: zod.z.string(), name: zod.z.string() })),
  });

  const TYPERT_REMOTE = createTypertRemoteInfo({
    package: 'dsh-cot-summary',
    methods: {
      'cotSummary/summarize': {
        service: 'cotSummary',
        description: 'Summarize one expanded reasoning text with the configured summary model.',
        invocation: { kind: 'direct' },
        parameters: [{
          name: 'request',
          description: 'reasoning text, session identity, and browser preferences supplied by the Client.',
          source: 'json',
          codec: { mode: 'strict', typeSymbol: 'dsh-cot-summary#SummaryRequest', create: requestSchema, jsonSchema: requestJsonSchema(false) },
          strictCodec: { mode: 'strict', typeSymbol: 'dsh-cot-summary#SummaryRequest', create: requestStrictSchema, jsonSchema: requestJsonSchema(true) },
        }],
        cancellation: { parameter: 'signal' },
        result: {
          mode: 'strict',
          typeSymbol: 'string',
          create: () => zod.z.string(),
          description: 'summary text; empty when the draft is too short to summarize.',
          jsonSchema: { type: 'string' },
        },
        sourceLocation: { file: 'cot-summary-bundle/src/index.js', line: 1, column: 1 },
      },
      'cotSummary/routes': {
        service: 'cotSummary',
        description: 'Report the session model route and every provider this deployment can summarize with.',
        invocation: { kind: 'direct' },
        parameters: [],
        cancellation: { parameter: 'signal' },
        result: {
          mode: 'strict',
          typeSymbol: 'dsh-cot-summary#SummaryRoutes',
          create: routesResultSchema,
          description: 'session route plus registered providers.',
          jsonSchema: {
            type: 'object',
            properties: {
              current: {
                type: 'object',
                properties: { provider: { type: 'string' }, model: { type: 'string' } },
                required: ['provider', 'model'],
                additionalProperties: false,
              },
              providers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, name: { type: 'string' } },
                  required: ['id', 'name'],
                  additionalProperties: false,
                },
              },
            },
            required: ['current', 'providers'],
            additionalProperties: false,
          },
        },
        sourceLocation: { file: 'cot-summary-bundle/src/index.js', line: 1, column: 1 },
      },
    },
  }, zod.z);

  // --- styles (claimed by the module system for unload cleanup) ---

  const css = `
.cots_root{flex-direction:column;gap:2px;display:flex}
.cots_bar{cursor:pointer;border-radius:var(--dsw-radius-md,6px);align-items:center;gap:6px;min-height:24px;padding:2px 6px;display:flex;user-select:none}
@media (hover:hover){.cots_bar:hover{background:var(--dsw-alias-bg-inset,rgba(128,128,128,.08))}}
.cots_bar:focus-visible{outline:2px solid var(--dsw-alias-focus-ring,auto);outline-offset:-2px}
.cots_badge{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:600}
.cots_pin{opacity:.55;font-size:12px}
.cots_root[data-pinned=true] .cots_pin{opacity:1}
.cots_body{color:var(--dsw-alias-label-primary);white-space:pre-wrap;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.55;padding:0 6px 2px;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:2}
.cots_root:hover .cots_body,.cots_root[data-pinned=true] .cots_body{-webkit-line-clamp:unset}
.cots_failure{color:var(--dsw-alias-label-tertiary);font-size:12px}
.cots_error{color:var(--dsw-alias-label-tertiary);font-size:11px;padding:0 6px 4px;word-break:break-word}
.cots_spinner{animation:.9s linear infinite cots_spin}
@keyframes cots_spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.cots_spinner{animation:none}}
.cots_form{display:grid;gap:12px;padding:6px 0}
.cots_row{display:grid;gap:4px}
.cots_row label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.cots_row input,.cots_row select{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-primary,#8884);background:var(--dsw-alias-background-secondary,transparent);color:inherit;font:inherit}
.cots_grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.cots_actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cots_note{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0}
.cots_path{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}
`;
  const tagId = 'dsh-cot-summary/Summary.module.css';
  if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-cot-summary';
    tag.dataset.pluginCss = tagId;
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // --- browser preferences ---

  const PREFS_KEY = 'dsh.cotSummary.prefs.v1';
  const DEFAULT_PREFS = {
    transport: 'dsh-llm',
    provider: '',
    model: '',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    language: 'auto',
    minChars: 120,
    maxChars: 24000,
    maxOutputTokens: 800,
    timeoutSeconds: 90,
  };

  function loadPrefs() {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw === null) return { ...DEFAULT_PREFS };
      const parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' ? { ...DEFAULT_PREFS, ...parsed } : { ...DEFAULT_PREFS };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  function storePrefs(next) {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  }

  // --- summarizer ---

  const DEBOUNCE_MS = 400;
  const CACHE_LIMIT = 64;
  const cache = new Map();

  class Summarizer {
    constructor(summarize, publish) {
      this.summarize = summarize;
      this.publish = publish;
      this.controller = new AbortController();
      this.timer = void 0;
      this.pending = false;
      this.failed = false;
      this.error = '';
      this.summary = '';
      this.lastSeen = '';
      this.started = '';
    }
    isDisposed() { return this.controller.signal.aborted; }
    dispose() {
      clearTimeout(this.timer);
      this.controller.abort();
    }
    emit() {
      if (this.isDisposed()) return;
      this.publish({ summary: this.summary, pending: this.pending, failed: this.failed, error: this.error });
    }
    update(text, running) {
      this.lastSeen = text;
      if (running || this.pending) return;
      const min = Math.max(40, Number(loadPrefs().minChars) || 0);
      if (text.trim().length < min) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.run(text); }, DEBOUNCE_MS);
    }
    retry() {
      this.failed = false;
      this.error = '';
      void this.run(this.lastSeen);
    }
    async run(text) {
      if (this.isDisposed() || this.pending) return;
      if (this.started === text && (this.summary !== '' || this.pending)) return;
      const hit = cache.get(text);
      if (hit !== void 0) {
        this.summary = hit;
        this.failed = false;
        this.emit();
        return;
      }
      this.pending = true;
      this.failed = false;
      this.error = '';
      this.started = text;
      this.emit();
      try {
        const summary = await this.summarize(text, this.controller.signal);
        if (this.isDisposed()) return;
        this.pending = false;
        if (summary === '') {
          this.summary = '';
          this.failed = false;
          this.emit();
          return;
        }
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
        cache.set(text, summary);
        if (this.lastSeen === text) {
          this.summary = summary;
          this.emit();
          return;
        }
        const next = this.lastSeen;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.run(next); }, DEBOUNCE_MS);
      } catch (error) {
        if (this.isDisposed()) return;
        this.pending = false;
        this.failed = true;
        this.error = error instanceof Error ? error.message : String(error);
        this.emit();
      }
    }
  }

  // --- reasoning body component ---

  function SummaryBody(props) {
    const { text, running, t, renderFactorySlot, summarize } = props;
    const [state, setState] = react.useState({ summary: '', pending: false, failed: false, error: '' });
    const [pinned, setPinned] = react.useState(false);
    const summarizer = react.useRef(void 0);
    react.useEffect(() => {
      const instance = new Summarizer(summarize, setState);
      summarizer.current = instance;
      return () => { instance.dispose(); summarizer.current = void 0; };
    }, [summarize]);
    react.useEffect(() => { summarizer.current?.update(text, running); }, [text, running]);
    const labels = react.useMemo(() => ({
      code: {
        copyLabel: t('copy'),
        copiedLabel: t('copied'),
        toolbarLabels: { codeLabel: t('codeTitle'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') },
      },
      footnotes: t('footnotes'),
    }), [t]);
    const visible = state.summary !== '' || state.pending || state.failed;
    return jsxRuntime.jsxs('div', {
      className: 'cots_root',
      'data-pinned': pinned ? 'true' : 'false',
      children: [
        visible && jsxRuntime.jsxs('div', {
          className: 'cots_bar',
          role: 'button',
          tabIndex: 0,
          title: pinned ? t('unpin') : t('pin'),
          'aria-expanded': pinned,
          onClick: () => setPinned(value => !value),
          onKeyDown: event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setPinned(value => !value);
            }
          },
          children: [
            jsxRuntime.jsxs('span', { className: 'cots_badge', children: ['✦ ', t('title')] }),
            state.pending && jsxRuntime.jsx('span', {
              role: 'status',
              'aria-label': t('summarizing'),
              children: jsxRuntime.jsx(primitives.IconLoadingOutlineRegular, { size: 14, className: 'cots_spinner' }),
            }),
            state.pending && state.summary === '' && jsxRuntime.jsx('span', { className: 'cots_failure', children: t('summarizing') }),
            state.failed && jsxRuntime.jsx('span', { className: 'cots_failure', role: 'status', children: t('failed') }),
            state.failed && jsxRuntime.jsx(primitives.Button, {
              size: 'sm',
              variant: 'ghost',
              onClick: event => { event.stopPropagation(); summarizer.current?.retry(); },
              children: t('retry'),
            }),
            jsxRuntime.jsx('span', { className: 'cots_pin', 'aria-hidden': 'true', children: pinned ? '📌' : '' }),
          ],
        }),
        visible && jsxRuntime.jsx('div', {
          className: 'cots_body',
          children: state.summary !== '' ? state.summary : t('summarizing'),
        }),
        state.failed && state.error !== '' && jsxRuntime.jsx('div', {
          className: 'cots_error',
          role: 'status',
          children: state.error,
        }),
        renderFactorySlot('conversation.chat.reasoning.content', { text, running, labels }),
      ],
    });
  }

  // --- locale ---

  const NS = 'cotSummary';
  const en = {
    title: 'Summary',
    summarizing: 'Summarizing reasoning…',
    failed: 'Summary unavailable',
    retry: 'Retry',
    pin: 'Click to keep the summary expanded',
    unpin: 'Click to collapse with the pointer again',
    copy: 'Copy',
    copied: 'Copied',
    codeTitle: 'Code block',
    wrap: 'Wrap lines',
    unwrap: 'Unwrap lines',
    footnotes: 'Footnotes',
    settingsIntro: 'These settings are stored in this browser and sent with every summary request.',
    settingsPrivacy: 'Expanded reasoning is sent to the chosen model. Local endpoints such as Ollama keep data on this machine.',
    sessionRoute: 'Session model',
    sessionRouteUnknown: 'not reported',
    transportLabel: 'Model source',
    transportHint: 'DSH models = any model already connected to the harness. OpenAI-compatible = Ollama, LM Studio, vLLM, or any hosted /v1.',
    'transport_dsh-llm': 'Models connected to DSH',
    'transport_openai': 'OpenAI-compatible endpoint',
    providerLabel: 'DSH provider',
    providerHint: 'Follow session uses the model this conversation already runs on.',
    followSession: 'Follow the session model',
    modelLabel: 'DSH model',
    modelHint: 'Required when a provider is chosen; ignored while following the session.',
    baseUrlLabel: 'Endpoint base URL',
    baseUrlHint: 'For example http://localhost:11434/v1 for Ollama.',
    apiKeyLabel: 'Endpoint API key',
    apiKeyHint: 'Leave empty for local Ollama.',
    languageLabel: 'Summary language',
    languageHint: 'Auto follows the language of the reasoning text.',
    language_auto: 'Auto',
    language_zh: '中文',
    language_en: 'English',
    minCharsLabel: 'Min reasoning chars',
    minCharsHint: 'Skip summarizing reasoning shorter than this.',
    maxCharsLabel: 'Input char budget',
    maxCharsHint: 'Long reasoning keeps head and tail, drops the middle.',
    maxOutputTokensLabel: 'Max output tokens',
    maxOutputTokensHint: 'Output budget of the summary request.',
    timeoutSecondsLabel: 'Timeout seconds',
    timeoutSecondsHint: 'Per-request timeout for one summary.',
    settingsSave: 'Save',
    settingsSaved: 'Saved · applies to the next summary',
    settingsRefused: 'The browser refused to store these settings',
    settingsReload: 'Reload model list',
    settingsRoutesLoading: 'Reading models…',
    settingsRoutesFailed: 'Could not read the model list',
  };
  const zh = {
    title: '摘要',
    summarizing: '正在总结思考内容…',
    failed: '总结暂不可用',
    retry: '重试',
    pin: '点击固定摘要，保持展开',
    unpin: '点击恢复悬停展开',
    copy: '复制',
    copied: '已复制',
    codeTitle: '代码块',
    wrap: '换行',
    unwrap: '不换行',
    footnotes: '脚注',
    settingsIntro: '这些设置保存在本机浏览器，并随每次总结请求发送。',
    settingsPrivacy: '展开的思考内容会发送给所选模型；使用本地端点（如 Ollama）时数据不出本机。',
    sessionRoute: '会话模型',
    sessionRouteUnknown: '未获取到',
    transportLabel: '总结模型来源',
    transportHint: '已接入 DSH＝直接用本机已连好的模型；OpenAI 兼容＝Ollama、LM Studio、vLLM 或任意托管 /v1 端点。',
    'transport_dsh-llm': '已接入 DSH 的模型',
    'transport_openai': 'OpenAI 兼容端点',
    providerLabel: 'DSH provider',
    providerHint: '选择「跟随会话模型」即用当前对话正在运行的模型。',
    followSession: '跟随会话模型',
    modelLabel: 'DSH model',
    modelHint: '选定 provider 后必须填写；跟随会话时忽略。',
    baseUrlLabel: '端点地址',
    baseUrlHint: 'Ollama 通常为 http://localhost:11434/v1。',
    apiKeyLabel: '端点 API Key',
    apiKeyHint: '本地 Ollama 留空即可。',
    languageLabel: '摘要语言',
    languageHint: 'auto 跟随思考内容的语言。',
    language_auto: '自动',
    language_zh: '中文',
    language_en: 'English',
    minCharsLabel: '最短思考字数',
    minCharsHint: '短于此长度的思考不做总结。',
    maxCharsLabel: '总结输入上限',
    maxCharsHint: '超长思考取头尾、丢中间。',
    maxOutputTokensLabel: '摘要最大 tokens',
    maxOutputTokensHint: '总结请求的输出预算。',
    timeoutSecondsLabel: '超时秒数',
    timeoutSecondsHint: '单次总结请求的超时。',
    settingsSave: '保存',
    settingsSaved: '已保存 · 下次总结生效',
    settingsRefused: '浏览器拒绝了本地存储',
    settingsReload: '重新读取模型列表',
    settingsRoutesLoading: '正在读取模型…',
    settingsRoutesFailed: '无法读取模型列表',
  };

  // --- settings page ---

  function SummarySettings(props) {
    const { view, t, routes } = props;
    const [draft, setDraft] = react.useState(() => loadPrefs());
    const [note, setNote] = react.useState('');
    const [routeState, setRouteState] = react.useState({ status: 'loading', current: void 0, providers: [] });
    const readRoutes = react.useCallback(() => {
      setRouteState(previous => ({ ...previous, status: 'loading' }));
      routes().then(value => {
        setRouteState({ status: 'ready', current: value.current, providers: value.providers });
      }).catch(() => {
        setRouteState(previous => ({ ...previous, status: 'failed' }));
      });
    }, [routes]);
    react.useEffect(() => { readRoutes(); }, [readRoutes]);
    if (view !== 'page') return null;
    const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
    const openAi = draft.transport === 'openai';
    const routeLine = routeState.status === 'ready'
      ? (routeState.current.provider === '' && routeState.current.model === ''
        ? t('sessionRouteUnknown')
        : `${routeState.current.provider} / ${routeState.current.model}`)
      : routeState.status === 'loading' ? t('settingsRoutesLoading') : t('settingsRoutesFailed');
    const save = () => {
      const next = {
        ...draft,
        minChars: Math.max(0, Number(draft.minChars) || 0),
        maxChars: Math.max(400, Number(draft.maxChars) || 0),
        maxOutputTokens: Math.max(64, Number(draft.maxOutputTokens) || 0),
        timeoutSeconds: Math.max(5, Number(draft.timeoutSeconds) || 0),
      };
      setDraft(next);
      setNote(storePrefs(next) ? t('settingsSaved') : t('settingsRefused'));
    };
    const row = (key, control, hint) => jsxRuntime.jsxs('div', {
      className: 'cots_row',
      children: [
        jsxRuntime.jsx('label', { children: t(key + 'Label') }),
        control,
        jsxRuntime.jsx('p', { className: 'cots_note', children: hint ?? t(key + 'Hint') }),
      ],
    }, key);
    const textInput = (key, type) => jsxRuntime.jsx('input', {
      type: type ?? 'text',
      value: String(draft[key] ?? ''),
      onChange: event => set(key, event.target.value),
    });
    const numberInput = key => jsxRuntime.jsx('input', {
      type: 'number',
      value: String(draft[key] ?? ''),
      onChange: event => set(key, event.target.value),
    });
    const select = (key, options) => jsxRuntime.jsx('select', {
      value: String(draft[key] ?? ''),
      onChange: event => set(key, event.target.value),
      children: options.map(option => jsxRuntime.jsx('option', { value: option.value, children: option.label }, option.value)),
    });
    const providerOptions = [
      { value: '', label: t('followSession') },
      ...routeState.providers.map(provider => ({ value: provider.id, label: `${provider.name} (${provider.id})` })),
    ];
    if (draft.provider !== '' && !providerOptions.some(option => option.value === draft.provider)) {
      providerOptions.push({ value: draft.provider, label: draft.provider });
    }
    const transportOptions = [
      { value: 'dsh-llm', label: t('transport_dsh-llm') },
      { value: 'openai', label: t('transport_openai') },
    ];
    const languageOptions = [
      { value: 'auto', label: t('language_auto') },
      { value: 'zh', label: t('language_zh') },
      { value: 'en', label: t('language_en') },
    ];
    return jsxRuntime.jsxs('div', {
      className: 'cots_form',
      children: [
        jsxRuntime.jsx('p', { className: 'cots_note', children: t('settingsIntro') }),
        jsxRuntime.jsx('p', { className: 'cots_path', children: `${t('sessionRoute')}: ${routeLine}` }),
        jsxRuntime.jsx(primitives.Button, { size: 'sm', variant: 'ghost', onClick: readRoutes, children: t('settingsReload') }),
        row('transport', select('transport', transportOptions)),
        openAi ? null : row('provider', select('provider', providerOptions)),
        openAi ? null : (draft.provider === '' ? null : row('model', textInput('model'))),
        openAi ? row('baseUrl', textInput('baseUrl')) : null,
        openAi ? row('apiKey', textInput('apiKey', 'password')) : null,
        row('language', select('language', languageOptions)),
        jsxRuntime.jsxs('div', {
          className: 'cots_grid2',
          children: [
            row('minChars', numberInput('minChars')),
            row('maxChars', numberInput('maxChars')),
            row('maxOutputTokens', numberInput('maxOutputTokens')),
            row('timeoutSeconds', numberInput('timeoutSeconds')),
          ],
        }),
        jsxRuntime.jsx('p', { className: 'cots_note', children: t('settingsPrivacy') }),
        jsxRuntime.jsxs('div', {
          className: 'cots_actions',
          children: [
            jsxRuntime.jsx(primitives.Button, { size: 'sm', onClick: save, children: t('settingsSave') }),
            note !== '' && jsxRuntime.jsx('span', { role: 'status', className: 'cots_note', children: note }),
          ],
        }),
      ],
    });
  }

  // --- wiring ---

  function registerUi(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { en, zh }));
    const summarize = async (text, sessionId, signal) => {
      const prefs = loadPrefs();
      const result = await ctx.remote.cotSummary.summarize({
        text,
        prefs,
        ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
      }, signal);
      if (!result.ok) throw result.error;
      return typeof result.value === 'string' ? result.value : '';
    };
    const routes = async () => {
      const result = await ctx.remote.cotSummary.routes(void 0);
      if (!result.ok) throw result.error;
      return result.value;
    };
    ctx.slots.inject('conversation.chat.reasoning.body', () => ctx.slots.register({
      name: 'conversation.chat.reasoning.body',
      locale: NS,
      inject: sessionId => ({
        summarize: (text, signal) => summarize(text, sessionId, signal),
      }),
    }, SummaryBody));
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-cot-summary',
      locale: NS,
      inject: () => ({ routes }),
    }, SummarySettings));
  }

  const inject = ['remote', 'slots', 'locale'];

  async function apply(ctx) {
    const lifetime = new AbortController();
    ctx.on('internal/plugin', fiber => {
      if (fiber === ctx.fiber && fiber.uid === null) lifetime.abort();
    });
    ctx.effect(() => () => { lifetime.abort(); }, 'cot-summary: query cancellation');
    const unmountRemote = await ctx.remote.$mount(TYPERT_REMOTE);
    const ui = ctx.inject(['remote.cotSummary', ...inject.slice(1)], child => registerUi(child));
    try {
      await ui;
    } catch (error) {
      await ui.dispose();
      await unmountRemote();
      throw error;
    }
    return async () => {
      await ui.dispose();
      await unmountRemote();
    };
  }

  exports.apply = apply;
  exports.inject = inject;
  return module.exports;
} });
