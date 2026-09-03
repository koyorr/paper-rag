# API 接口文档

> paper-rag v1.0.0 · 后端 `http://127.0.0.1:3000` · RAG 服务 `http://127.0.0.1:8000`

## 通用约定

### 请求头（前端请求层自动注入）

| Header | 说明 |
| --- | --- |
| `x-user-id` | 用户 ID（未接入 JWT，先用它模拟） |
| `Authorization: Bearer <token>` | 预留鉴权 |
| `x-provider` | 服务商（deepseek / openai / qwen / ollama …） |
| `x-api-key` | API Key |
| `x-api-url` | Base URL |
| `x-chat-model` | 对话模型 |
| `x-embedding-model` | 嵌入模型 |
| `x-rag-top-k` / `x-rag-chunk-size` / `x-rag-chunk-overlap` / `x-rag-temperature` | RAG 参数 |

### 错误格式

```json
{ "message": "错误说明", "error": "可选详情" }
```

---

## 一、后端（Express，:3000）

### 1. 健康检查

```
GET /health
```

```json
{ "status": "ok", "service": "express" }
```

### 2. 文档上传

```
POST /api/documents/upload
Content-Type: multipart/form-data
字段：file（仅 PDF，≤10MB）
```

- 自动去重（大小 + 快速指纹 + SHA-256）
- 入库后调用 RAG `/ingest` 分块向量化，成功后文档状态置为 `READY`

响应：

```json
{
  "message": "文档上传并入库成功",
  "duplicate": false,
  "documentId": 1,
  "originalName": "xxx.pdf",
  "chunks": 12,
  "uploadTime": "2026/8/29 10:00:00"
}
```

重复文件返回 `409` 与 `duplicate: true`。

### 3. 文档列表 / 打开 / 删除 / 重新解析

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/documents` | 文档列表（含 fileHash / 状态 / 分块数） |
| GET | `/api/documents/:id/file` | 打开论文 PDF（inline 预览，`%PDF` 流） |
| DELETE | `/api/documents/:id` | 删除文档：物理文件 + Chroma 向量 + MySQL 记录 |
| POST | `/api/documents/:id/reindex` | 重新解析入库：删除旧向量后重新分块向量化 |

- 上传时**总是计算文件 SHA-256**（`fileHash`），文档状态在 `fileHash` 生成且向量化完成后才置为 `READY`

### 4. RAG 问答

```
POST /api/qa/ask
```

```json
{
  "question": "这篇论文的研究方法是什么？",
  "top_k": 3,
  "model": "qwen2.5:7b-instruct-q5_K_M",
  "temperature": 0.3
}
```

后端转发到 RAG `/query`，返回：

```json
{
  "answer": "回答内容...",
  "sources": [ { "document_id": 1, "source": "xxx.pdf", "page": 3 } ],
  "usage": { "input_tokens": 2635, "output_tokens": 546, "total_tokens": 3181 }
}
```

- 检索时会自动并入主命中文档的开头几块（标题/摘要），便于回答「某某论文讲了什么」这类问题
- `usage` 为 token 用量，前端据此记录 API 用量

### 5. 流式输出（论文问答 / AI 对话）

`POST /api/qa/ask` 与 `POST /api/chat` 在请求头带 `Accept: text/event-stream` 时返回 SSE 流，逐 token 输出：

```
data: {"type":"delta","content":"一段增量文本"}
data: {"type":"sources","sources":[{...}]}      # 仅论文问答
data: {"type":"usage","usage":{...}}
data: {"type":"done"}
```

不带该请求头则返回原有 JSON。前端收到 `type: error` 事件表示流中出错。

### 6. 语义检索

```
GET /api/qa/search?query=关键词&top_k=5
```

- `query` / `q`：检索词（必填）
- `top_k` / `topK`：返回条数，默认 5，1–20

后端转发到 RAG `/search`，只做向量检索、**不调用大模型**，返回：

```json
{
  "results": [
    {
      "document_id": 3,
      "source": "xxx.pdf",
      "page": 2,
      "chunk_index": 5,
      "content": "命中片段原文...",
      "score": 0.8234
    }
  ],
  "count": 1
}
```

### 6. 通用 AI 对话

```
POST /api/chat
```

```json
{
  "message": "你好",
  "history": [
    { "role": "user", "content": "介绍一下 RAG" },
    { "role": "assistant", "content": "RAG 是检索增强生成..." }
  ],
  "model": "deepseek-chat",
  "temperature": 0.3
}
```

- `history` 可选，多轮对话上下文（role: system / user / assistant）
- `model` / `temperature` 可请求级覆盖；未传则使用运行时配置
- API Key / Base URL 通过请求头 `x-api-key` / `x-api-url` 下发，也可在 body 传 `api_key` / `api_url`

后端转发到 RAG `/chat`，返回：

```json
{
  "message": "回答内容...",
  "usage": { "input_tokens": 12, "output_tokens": 30, "total_tokens": 42 }
}
```

### 7. 配置同步

```
POST /api/config
```

```json
{
  "provider": "ollama",
  "apiKey": "",
  "apiUrl": "http://127.0.0.1:11434/v1",
  "model": "qwen2.5:7b-instruct-q5_K_M",
  "embeddingModel": "qwen3-embedding:8b-q4_K_M",
  "topK": 3,
  "chunkSize": 800,
  "chunkOverlap": 80,
  "temperature": 0.3
}
```

后端暂存配置并转发给 RAG `/config`：

```json
{
  "status": "ok",
  "synced": true,
  "rag": { "synced": true, "error": null },
  "config": { "...": "..." }
}
```

```
GET /api/config
```

返回后端已保存的配置。

---

## 二、RAG 服务（FastAPI，:8000）

### 1. 健康检查

```
GET /health
```

```json
{ "status": "ok", "service": "python-rag" }
```

### 2. 文档入库（分块 + 向量化）

```
POST /ingest
```

```json
{
  "document_id": 1,
  "stored_name": "uuid.pdf",
  "original_name": "论文.pdf",
  "user_id": 1,
  "chunk_size": 800,
  "chunk_overlap": 80
}
```

- `chunk_size`: 200–3000，默认 800
- `chunk_overlap`: 0–300，默认 80
- 文件必须存在于 `backend/uploads/`

响应：

```json
{ "status": "success", "document_id": 1, "chunks": 12 }
```

### 3. 向量检索 + 问答

```
POST /query
```

```json
{
  "question": "什么是RAG？",
  "user_id": 1,
  "top_k": 3,
  "model": "qwen2.5:7b-instruct-q5_K_M",
  "temperature": 0.3,
  "api_key": "可选覆盖"
}
```

- 按 `user_id` 数据隔离检索
- `model` / `temperature` / `api_key` 可请求级覆盖；未传则使用运行时配置

### 4. 纯语义检索

```
POST /search
```

```json
{ "query": "关键词", "user_id": 1, "top_k": 5 }
```

- 按 `user_id` 数据隔离检索
- 只返回命中片段与相似度分数，不调用大模型

### 5. 通用 AI 对话

```
POST /chat
```

```json
{
  "message": "你好",
  "history": [ { "role": "user", "content": "介绍一下 RAG" } ],
  "model": "deepseek-chat",
  "temperature": 0.3,
  "api_key": "可选覆盖",
  "api_url": "可选覆盖"
}
```

- 不检索知识库，直接调用配置的对话模型
- `model` / `temperature` / `api_key` / `api_url` 可请求级覆盖；未传则使用运行时配置

### 6. 删除文档向量

```
POST /delete
```

```json
{ "user_id": 1, "document_id": 5 }
```

按 `user_id + document_id` 删除该文档在向量库中的全部块。

### 7. 流式输出

`POST /query` 与 `POST /chat` 在请求头带 `Accept: text/event-stream` 时返回 SSE 流（`delta` / `sources` / `usage` / `done`），否则返回 JSON。

### 8. 配置管理

```
POST /config
```

兼容前端 camelCase 与后端 snake_case 字段：

```json
{
  "provider": "ollama",
  "apiKey": "sk-...",
  "apiUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen-plus",
  "embeddingModel": "text-embedding-v4",
  "temperature": 0.2
}
```

- 对话模型 / 温度 / Base URL / API Key **立即生效**
- 切换服务商或嵌入模型返回 `restart_required: true`，**需重启 RAG 服务后重建向量库**
- 配置持久化到 `rag_service/runtime_config.json`，重启 / 热重载后自动恢复
- 服务商为 `ollama` 时使用独立向量库 `rag_service/chroma_db_ollama`，避免与云端索引维度冲突

```
GET /config
```

```json
{ "status": "ok", "config": { "provider": "ollama", "api_key": "sk-ws-***", "..." : "..." } }
```

> API Key 会脱敏返回（仅显示前 6 位）。
