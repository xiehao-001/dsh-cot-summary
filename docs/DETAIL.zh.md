# 思考摘要

在展开的思考内容块顶部添加一条摘要栏：模型思考结束后，由指定模型把思考草稿压缩为 2-3 句摘要——默认两行截断，鼠标悬停展开全文，点击固定展开。

## 模型选择（插件详情页「配置」区，保存后即时生效）

- **transport = dsh-llm**：使用已接入 DSH 的任意模型。provider/model 留空则跟随会话默认模型；也可成对显式填写（例如 provider 填 deepseek-account、model 填 deepseek-flash）。
- **transport = openai**：直连任意 OpenAI 兼容端点——Ollama（默认地址 http://localhost:11434/v1）、LM Studio、vLLM 或任意托管 /v1。model 填端点内的模型名，例如 qwen2.5:3b；本地端点 apiKey 留空。

## 其他设置

- language：摘要输出语言（auto 跟随思考语言 / zh / en）
- minChars：短于此长度的思考不做总结（默认 120）
- maxChars：发送给总结模型的思考文本上限，超长取头尾（默认 24000）
- maxOutputTokens：摘要输出 token 上限（默认 400）
- timeoutSeconds：单次总结超时（默认 90）

## 缓存与隐私

摘要按思考原文在 Host 内存中缓存，重复展开不再计费。展开的思考内容会发送给所选模型，可能包含私有代码或对话细节；使用本地端点（如 Ollama）时数据不出本机。
