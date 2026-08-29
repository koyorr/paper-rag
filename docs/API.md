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

### 3. 文档列表 / 详情 / 删除

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/documents` | 文档列表 |
| GET | `/api/documents/:id` | 文档详情 |
| DELETE | `/api/documents/:id` | 删除文档 |
| POST | `/api/documents/:id/reindex` | 重新解析入库（预设） |

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
  "sources": [ { "document_id": 1, "source": "xxx.pdf", "page": 3 } ]
}
```

### 5. 通用 AI 对话（预设）

```
POST /api/chat
```

```json
{ "message": "你好", "model": "deepseek-chat", "temperature": 0.3 }
```

### 6. 配置同步

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

### 4. 配置管理

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
