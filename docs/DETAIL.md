# Reasoning Summary

Adds a summary bar to the top of each expanded reasoning block: when the model finishes thinking, a chosen model compresses the draft into a 2-3 sentence summary - clamped to two lines, expanded on hover, pinned open on click.

## Model selection (Configuration on the plugin page, live after save)

- transport = dsh-llm: uses any model already connected to DSH. Leave provider/model empty to follow the session default model, or fill both (e.g. deepseek-account / deepseek-flash).
- transport = openai: connects directly to any OpenAI-compatible endpoint - Ollama (default http://localhost:11434/v1), LM Studio, vLLM, or any hosted /v1. Set model to the endpoint model name, e.g. qwen2.5:3b; leave apiKey empty for local endpoints.

## Other settings

- language: summary language (auto follows the reasoning language / zh / en)
- minChars: skip summaries for reasoning shorter than this (default 120)
- maxChars: input budget sent to the summarizer, head+tail kept (default 24000)
- maxOutputTokens: summary output cap (default 400)
- timeoutSeconds: per-request timeout (default 90)

## Cache & privacy

Summaries are cached in Host memory per reasoning text; re-expanding costs nothing. Expanded reasoning is sent to the chosen model and may contain private code or conversation details; local endpoints such as Ollama keep data on your machine.
