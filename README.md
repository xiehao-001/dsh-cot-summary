# dsh-cot-summary

在思考（reasoning）UI 上显示由指定模型生成的思考摘要。

## 效果

展开的推理内容块顶部出现一条摘要栏：

- 模型思考结束后自动调用摘要模型，生成 2-3 句摘要；
- 默认一行截断，**鼠标悬停展开全文**，**点击固定展开**（📌），再击取消固定；
- 总结中显示 spinner，失败显示"重试"；摘要按思考原文缓存（host 内存 + client 内存）。

## 安装

在 DSH GUI 会话中让 agent 执行 plugin_manager `install_bundle`，target 传本目录绝对路径；
或在 profile 目录手工 `pnpm add file:<本目录>` 并把 `cordis.patch.yml` 内容并入 profile 的 patch。

## 配置（插件设置页，volatile 即时生效）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `transport` | `dsh-llm` | `dsh-llm`=用已接入 DSH 的模型；`openai`=直连 OpenAI 兼容端点 |
| `provider` | `` | dsh-llm 传输的 provider（与 model 成对填写；留空跟随会话默认模型） |
| `model` | `` | 模型名；dsh-llm 与 openai 共用此字段 |
| `baseUrl` | `http://localhost:11434/v1` | openai 传输端点（Ollama / LM Studio / vLLM / 托管 /v1） |
| `apiKey` | `` | openai 传输的 Bearer key（Ollama 留空） |
| `language` | `auto` | 摘要输出语言：`auto`（随思考文本）/ `zh` / `en` |
| `minChars` | `120` | 短于该长度的思考不总结 |
| `maxChars` | `24000` | 发送给摘要模型的思考文本上限（保头尾、掐中间） |
| `maxOutputTokens` | `400` | 摘要输出上限 |
| `timeoutSeconds` | `90` | 单次摘要请求超时 |

### 例：用本机 Ollama 小模型

```
transport: openai
baseUrl:   http://localhost:11434/v1
model:     qwen2.5:3b
```

### 例：固定用 DSH 里某个模型

```
transport: dsh-llm
provider:  deepseek-account
model:     deepseek-flash
```

若 GUI 设置页不可用，可把同样的键写进 profile `cordis.patch.yml` 里本插件条目的 `config:` 下。

## 组成

- `lib/index.js`（host）：`cotSummary` Typert remote 服务，`summarize(request, signal)`；
  两种传输（`ctx.llm.prepareCall` / 直连 fetch），sha256 内存缓存。
- `lib/client.js`（web 客户端）：注册 `conversation.chat.reasoning.body` 槽，
  摘要栏 + 悬停/固定交互，防抖 400ms，流式思考期间不触发。

## 隐私

展开的思考内容会发送给所选摘要模型（可能是外源端点），其中可能包含私有代码或对话细节。
