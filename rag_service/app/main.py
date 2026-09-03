import json
import os
import time
import uuid
import requests

from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI,HTTPException,Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel,Field

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import DashScopeEmbeddings, OllamaEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain_core.output_parsers import StrOutputParser
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_deepseek import ChatDeepSeek
import traceback

load_dotenv()
app = FastAPI(title="RAG Python Service")

# 允许前端（浏览器直连）跨域访问 RAG 服务
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 运行时配置：优先读取 .env，可被 POST /config 动态更新
runtime_config = {
    "provider": os.getenv('provider') or "dashscope",
    "api_key": os.getenv('DASHSCOPE_API_KEY'),
    "api_url": os.getenv('api_url') or "",
    "embedding_provider": os.getenv('embedding_provider') or "",
    "embedding_api_key": os.getenv('embedding_api_key') or "",
    "embedding_api_url": os.getenv('embedding_api_url') or "",
    "embedding_model": os.getenv('embedding_model'),
    "chat_model": os.getenv('chat_model') or "qwen3.7-plus",
    "temperature": float(os.getenv('temperature', '0.2') or 0.2),
}

OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434/v1"


APP_DIR = (Path(__file__) .resolve() .parent)
RAG_SERVICE_DIR = (APP_DIR .parent)
PROJECT_ROOT = (RAG_SERVICE_DIR .parent)


UPLOAD_DIR = (PROJECT_ROOT / "backend" / "uploads")
CHROMA_DIR = (RAG_SERVICE_DIR / "chroma_db")
UPLOAD_DIR.mkdir(parents=True,exist_ok=True)
CHROMA_DIR.mkdir(parents=True,exist_ok=True)

# 运行时配置持久化：/config 写入该文件，重启 / 热重载后自动恢复
CONFIG_FILE = RAG_SERVICE_DIR / "runtime_config.json"

def _load_runtime_config():
    try:
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            for key, value in data.items():
                if key in runtime_config:
                    runtime_config[key] = value
    except Exception:                     # noqa: BLE001
        pass

def _save_runtime_config():
    try:
        CONFIG_FILE.write_text(
            json.dumps(runtime_config, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:                     # noqa: BLE001
        pass

_load_runtime_config()

def _ollama_base_url():
    url = runtime_config.get("api_url") or OLLAMA_DEFAULT_URL
    # 原生 Ollama API 不需要 /v1 后缀
    return url.replace("/v1", "").rstrip("/")

def _embedding_provider():
    """嵌入侧服务商：separate 时用 embedding_provider，缺省回退共用 provider"""
    return runtime_config.get("embedding_provider") or runtime_config.get("provider")


def _embedding_api_key():
    """嵌入侧 API Key：缺省回退共用 api_key"""
    return runtime_config.get("embedding_api_key") or runtime_config.get("api_key")


def _embedding_api_url():
    """嵌入侧 Base URL：缺省回退共用 api_url"""
    return runtime_config.get("embedding_api_url") or runtime_config.get("api_url")


def build_embeddings():
    if _embedding_provider() == "ollama":
        # 本地 Ollama 嵌入（原生 /api/embed）
        return OllamaEmbeddings(
            model=runtime_config["embedding_model"],
            base_url=(_embedding_api_url() or OLLAMA_DEFAULT_URL).replace("/v1", "").rstrip("/"),
        )
    return DashScopeEmbeddings(
        model=runtime_config["embedding_model"],
        dashscope_api_key=_embedding_api_key(),
        max_retries=3
    )

def build_vector_store():
    persist_dir = str(CHROMA_DIR)
    if _embedding_provider() == "ollama":
        # Ollama 使用独立向量库，避免与 DashScope 索引的维度冲突
        persist_dir = str(RAG_SERVICE_DIR / "chroma_db_ollama")
        Path(persist_dir).mkdir(parents=True, exist_ok=True)
    return Chroma(
        collection_name="rag_documents",
        embedding_function=build_embeddings(),
        persist_directory=persist_dir
    )

_OLLAMA_MODEL_CACHE = {"at": 0.0, "models": None}

def _ollama_model_names():
    """获取本地 Ollama 已下载模型列表（60s 缓存）；失败返回空列表"""
    now = time.time()
    if _OLLAMA_MODEL_CACHE["models"] and now - _OLLAMA_MODEL_CACHE["at"] < 60:
        return _OLLAMA_MODEL_CACHE["models"]
    try:
        root = (_ollama_base_url() or OLLAMA_DEFAULT_URL).replace("/v1", "").rstrip("/")
        resp = requests.get(f"{root}/api/tags", timeout=5)
        models = [m.get("name") for m in resp.json().get("models", []) if m.get("name")]
        _OLLAMA_MODEL_CACHE.update(at=now, models=models)
        return models
    except Exception:                     # noqa: BLE001
        return _OLLAMA_MODEL_CACHE["models"] or []


def _resolve_chat_model(requested):
    """Ollama 模式下校验模型本地是否可用；不可用则回退到本地已下载的对话模型，
    避免前端/配置残留无效模型名（如 qwen3.7-plus）导致 404。"""
    if runtime_config.get("provider") != "ollama":
        return requested or runtime_config["chat_model"]
    available = _ollama_model_names()
    candidate = requested or runtime_config["chat_model"]
    if candidate in available:
        return candidate
    # 本地没有候选模型：优先选对话模型（排除嵌入模型），否则取第一个
    chat_candidates = [
        m for m in available
        if "embed" not in m.lower() and "nomic" not in m.lower() and "bge" not in m.lower()
    ]
    if chat_candidates:
        return chat_candidates[0]
    return available[0] if available else candidate


def build_llm(model=None, temperature=None, api_key=None, api_url=None):
    # 统一走模型可用性解析（Ollama 回退到本地已下载模型）
    model = _resolve_chat_model(model)
    if runtime_config.get("provider") == "ollama":
        # 本地 Ollama 对话（OpenAI 兼容 /v1/chat/completions）
        return ChatOpenAI(
            model=model or runtime_config["chat_model"],
            api_key=api_key or "ollama",
            base_url=api_url or runtime_config.get("api_url") or OLLAMA_DEFAULT_URL,
            temperature=(
                temperature
                if temperature is not None
                else runtime_config["temperature"]
            ),
        )
    kwargs = {
        "model": model or runtime_config["chat_model"],
        "api_key": api_key or runtime_config["api_key"],
        "temperature": (
            temperature
            if temperature is not None
            else runtime_config["temperature"]
        ),
    }
    # 前端设置中的 Base URL 作为 OpenAI 兼容接口地址（如 DashScope compatible-mode）
    base_url = api_url or runtime_config.get("api_url") or None
    if base_url:
        kwargs["base_url"] = base_url
    return ChatOpenAI(**kwargs)

embeddings = build_embeddings()
vector_store = build_vector_store()

def masked_config():
    cfg = dict(runtime_config)
    if cfg.get("api_key"):
        cfg["api_key"] = cfg["api_key"][:6] + "***"
    if cfg.get("embedding_api_key"):
        cfg["embedding_api_key"] = cfg["embedding_api_key"][:6] + "***"
    return cfg


class Ingest_Request(BaseModel):
    document_id: int
    stored_name: str
    original_name: str
    user_id: int
    chunk_size: int = Field(default=800,ge=200,le=3000)
    chunk_overlap: int = Field(default=80,ge=0,le=300)

import re
class Config_Request(BaseModel):
    # 兼容前端 camelCase 与后端 snake_case 两种字段名
    model_config = {"populate_by_name": True}
    provider: str | None = None
    api_key: str | None = Field(default=None, alias="apiKey")
    api_url: str | None = Field(default=None, alias="apiUrl")
    model: str | None = None
    chat_model: str | None = Field(default=None, alias="chatModel")
    embedding_model: str | None = Field(default=None, alias="embeddingModel")
    embedding_provider: str | None = Field(default=None, alias="embeddingProvider")
    embedding_api_key: str | None = Field(default=None, alias="embeddingApiKey")
    embedding_api_url: str | None = Field(default=None, alias="embeddingApiUrl")
    top_k: int | None = Field(default=None, alias="topK")
    chunk_size: int | None = Field(default=None, alias="chunkSize")
    chunk_overlap: int | None = Field(default=None, alias="chunkOverlap")
    temperature: float | None = None


@app.post("/config")
def update_config(request: Config_Request):
    old_provider = runtime_config.get("provider")
    old_embedding_provider = _embedding_provider()
    old_embedding_key = _embedding_api_key()
    old_embedding_url = _embedding_api_url()
    old_embedding = runtime_config["embedding_model"]

    data = request.model_dump(exclude_none=True)
    # 兼容前端字段名：model / chat_model 均作为对话模型
    updates = []
    if "chat_model" in data:
        runtime_config["chat_model"] = data.pop("chat_model")
        updates.append("chat_model")
    if "model" in data:
        runtime_config["chat_model"] = data.pop("model")
        updates.append("model")
    for key, value in data.items():
        if key in runtime_config:
            runtime_config[key] = value
            updates.append(key)

    # 对话模型 / 温度 / Base URL / Key 立即生效（build_llm 每次读取）。
    # 服务商或嵌入模型变化需要重启后重建向量库：运行时重建会与已打开的
    # Chroma 实例竞争文件锁导致阻塞，因此这里只标记 restart_required。
    embedding_changed = (
        _embedding_provider() != old_embedding_provider
        or _embedding_api_key() != old_embedding_key
        or _embedding_api_url() != old_embedding_url
        or runtime_config["embedding_model"] != old_embedding
    )

    _save_runtime_config()
    return {
        "status": "ok",
        "updated": updates,
        "embedding_changed": embedding_changed,
        "embedding_rebuilt": False,
        "rebuild_error": None,
        "restart_required": embedding_changed,
        "config": masked_config(),
    }


@app.get("/config")
def get_config():
    return {
        "status": "ok",
        "config": masked_config(),
    }


@app.post("/ingest")
def ingest_document(request: Ingest_Request):
    try:
        '''
        if (
            Path(request.stored_name).name != request.stored_name
        ):
            raise HTTPException(
                status_code=400,
                detail="非法文件名"
            )
        '''
        if not re.match(r'^[\w\-\.]+$', request.stored_name):
            raise HTTPException(400, "文件名只允许字母数字、下划线、连字符和点")

        file_path = ( UPLOAD_DIR / request.stored_name).resolve()

        if not file_path.exists():
            raise HTTPException(status_code=404,detail=f"找不到文件: {file_path}")

        if not str(file_path).startswith(str(UPLOAD_DIR.resolve())):
            raise HTTPException(400, "非法文件路径")

        # 1. 读取 PDF
        loader = PyPDFLoader(str(file_path))
        documents = loader.load()

        # 2. 文本切块
        splitter = RecursiveCharacterTextSplitter(
                chunk_size=request.chunk_size,
                chunk_overlap=request.chunk_overlap,
                separators=["\n\n","\n","。","！","？",".","!","?","；",";","，",","," ",""]
            )
        chunks = splitter.split_documents(documents)

        ids = []
        # 3. 加 metadata
        for index, chunk in enumerate(chunks):
            chunk.metadata.update({
                "user_id":request.user_id,
                "document_id":request.document_id,
                "source":request.original_name,
                "chunk_index":index
            })

            chunk_id = str(uuid.uuid5(
                    uuid.NAMESPACE_URL, f"{request.document_id}:{index}"
                ))
            ids.append(chunk_id)

        # 4. 写入 Chroma
        vector_store.add_documents(
            documents=chunks,
            ids=ids
        )

        return {
            "status":"success",
            "document_id":request.document_id,
            "chunks":len(chunks)
        }

    except HTTPException:
        raise
    except Exception as e:                                # as
        raise HTTPException(
            status_code=500,detail=str(e)                 # detail=str(e)
            )



class Query_Request(BaseModel):
    question: str
    user_id: int
    top_k: int = Field(
        default=5,
        ge=1,
        le=20
    )
    model: str | None = None
    temperature: float | None = None
    api_key: str | None = None

# 文档概览扩展：召回主命中文档的开头几块（标题页/摘要等），
# 解决“某某论文讲了什么”这类问法无法靠向量相似度命中正文的问题。
DOC_EXPAND_CHUNKS = 4

def _collect_doc_chunks(user_id, document_id, max_chunk_index):
    """返回指定文档前 max_chunk_index 个块（按 chunk_index 升序），失败返回空列表"""
    try:
        data = vector_store.get(
            where={
                "$and": [
                    {"user_id": user_id},
                    {"document_id": document_id},
                    {"chunk_index": {"$lt": max_chunk_index}},
                ]
            },
            include=["metadatas", "documents"],
        )
        metas = data.get("metadatas") or []
        docs = data.get("documents") or []
        from langchain_core.documents import Document

        pairs = []
        for m, d in zip(metas, docs):
            pairs.append((m.get("chunk_index", 0), m, d))
        pairs.sort(key=lambda x: x[0])
        return [
            (m, Document(page_content=d, metadata=dict(m)))
            for _, m, d in pairs
        ]
    except Exception:                     # noqa: BLE001
        return []


def _kb_catalog(user_id, limit=30):
    """当前用户已上传的文档清单（按 document_id 去重），用于回答“上传了哪些论文”类问题"""
    try:
        data = vector_store.get(
            where={"user_id": user_id},
            include=["metadatas"],
            limit=5000,
        )
        seen = {}
        for m in data.get("metadatas") or []:
            doc_id = m.get("document_id")
            source = m.get("source")
            if doc_id is not None and source and doc_id not in seen:
                seen[doc_id] = source
        items = [f"- {s}" for s in seen.values()]
        if len(items) > limit:
            items = items[:limit] + ["- ...（还有更多）"]
        return items
    except Exception:                     # noqa: BLE001
        return []


def _extract_usage(response):
    """从 LLM 响应中提取 token 用量（部分服务商/模型不返回，缺省为空）"""
    usage = {}
    meta = getattr(response, "usage_metadata", None)
    if isinstance(meta, dict):
        usage = {
            "input_tokens": meta.get("input_tokens"),
            "output_tokens": meta.get("output_tokens"),
            "total_tokens": meta.get("total_tokens"),
        }
    return usage


def _content_text(content):
    """兼容多模态分段返回（content 可能是 list[dict]）"""
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return content


def _sse(event: dict) -> str:
    """SSE 数据帧"""
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _wants_sse(request: Request) -> bool:
    return "text/event-stream" in (request.headers.get("accept") or "")


def _stream_llm(llm, messages):
    """流式调用 LLM，优先携带 usage；不支持 stream_usage 时回退普通流"""
    try:
        yield from llm.stream(messages, stream_usage=True)
    except TypeError:
        yield from llm.stream(messages)


def _query_prepare(payload):
    """问答检索与上下文组装，返回 (documents, merged, prompt_value, request_llm)"""
    documents = vector_store.similarity_search(
        query=payload.question,
        k=payload.top_k,
        filter={"user_id": payload.user_id}
    )

    # 文档概览扩展：把主命中文档的开头几块（标题/摘要）并入上下文，去重
    seen = set()
    merged = []
    top_doc_id = documents[0].metadata.get("document_id") if documents else None
    if top_doc_id is not None:
        for m, doc in _collect_doc_chunks(
            payload.user_id, top_doc_id, DOC_EXPAND_CHUNKS
        ):
            key = (m.get("document_id"), m.get("chunk_index"))
            if key not in seen:
                seen.add(key)
                merged.append(doc)
    for doc in documents:
        key = (doc.metadata.get("document_id"), doc.metadata.get("chunk_index"))
        if key not in seen:
            seen.add(key)
            merged.append(doc)

    contexts = []
    for doc in merged:
        source = doc.metadata.get("source", "未知文件")
        page = doc.metadata.get("page")
        if page is not None:
            page_text = f"第{page + 1}页"
        else:
            page_text = "未知页码"
        contexts.append(f"来源：{source}，页码：{page_text}：{doc.page_content}")
    context = "\n\n".join(contexts)

    catalog = _kb_catalog(payload.user_id)
    if catalog:
        catalog_lines = [f"{i}. {name}" for i, name in enumerate(catalog, 1)]
        catalog_text = "\n".join(catalog_lines)
        catalog_note = f"（共 {len(catalog)} 篇）"
    else:
        catalog_text = "（暂无文档）"
        catalog_note = ""

    system_prompt = f"""你是一个知识库问答助手。请严格根据提供的知识库内容回答问题。

当前知识库包含以下已上传文档{catalog_note}：
{catalog_text}

规则：
1. 只依据给定的知识库片段作答，不要编造知识库之外的信息。
2. 如果用户询问“上传了哪些论文/文档”，必须完整列出上面的全部文档（共 {len(catalog)} 篇），逐行输出，不得遗漏、不得合并。
3. 优先综合所有片段回答；即使信息有限（如只有标题、摘要、目录、发表论文列表），也要基于现有信息尽量给出完整回答，并指出依据的文件名。
4. 只有当给定片段与问题完全无关时，才说明“检索到的内容不足以回答这个问题”。
5. 提问提到具体作者或论文时，结合文件名与片段内容判断是哪一篇，再作答。
6. 回答时给出引用的来源文件与页码。
7. 回答格式：使用清晰的段落与换行——段落之间用空行分隔，要点用编号或项目符号分行列出，方便阅读。"""

    prompt_value = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human", "以下是通过向量检索从知识库中召回的增强内容：\n{context}\n\n用户问题：{question}"),
    ]).invoke({"question": payload.question, "context": context})

    request_llm = build_llm(
        model=payload.model,
        temperature=payload.temperature,
        api_key=payload.api_key,
    )
    return documents, merged, prompt_value, request_llm


def _query_sources(merged):
    sources = []
    for doc in merged:
        page = doc.metadata.get("page")
        item = {
            "document_id": doc.metadata.get("document_id"),
            "source": doc.metadata.get("source"),
            "page": (page + 1) if page is not None else None,
        }
        if item not in sources:
            sources.append(item)
    return sources


@app.post("/query")
def query(payload: Query_Request, request: Request):
    try:
        documents, merged, prompt_value, request_llm = _query_prepare(payload)
        if not documents:
            # 无命中：SSE 请求也返回流式事件，前端可统一处理
            if _wants_sse(request):
                def empty_gen():
                    yield _sse({"type": "delta", "content": "知识库中没有找到相关信息。"})
                    yield _sse({"type": "sources", "sources": []})
                    yield _sse({"type": "usage", "usage": {}})
                    yield _sse({"type": "done"})
                return StreamingResponse(empty_gen(), media_type="text/event-stream")
            return {
                "answer": "知识库中没有找到相关信息。",
                "sources": [],
                "usage": {},
            }

        # 流式输出（前端传 Accept: text/event-stream 时）
        if _wants_sse(request):
            def gen():
                try:
                    usage = {}
                    for chunk in _stream_llm(request_llm, prompt_value):
                        text = _content_text(chunk.content)
                        if text:
                            yield _sse({"type": "delta", "content": text})
                        meta = getattr(chunk, "usage_metadata", None)
                        if isinstance(meta, dict):
                            usage = {
                                "input_tokens": meta.get("input_tokens"),
                                "output_tokens": meta.get("output_tokens"),
                                "total_tokens": meta.get("total_tokens"),
                            }
                    yield _sse({"type": "sources", "sources": _query_sources(merged)})
                    yield _sse({"type": "usage", "usage": usage})
                    yield _sse({"type": "done"})
                except Exception as e:                    # noqa: BLE001
                    yield _sse({"type": "error", "detail": str(e)})
            return StreamingResponse(gen(), media_type="text/event-stream")

        # 非流式 JSON
        llm_response = request_llm.invoke(prompt_value)
        return {
            "answer": _content_text(llm_response.content),
            "sources": _query_sources(merged),
            "usage": _extract_usage(llm_response),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------- 通用 AI 对话（不检索知识库，直接调用大模型） ----------
class Chat_Message(BaseModel):
    role: str
    content: str


class Chat_Request(BaseModel):
    message: str
    history: list[Chat_Message] | None = None
    model: str | None = None
    temperature: float | None = None
    api_key: str | None = None
    api_url: str | None = None


@app.post("/chat")
def chat(payload: Chat_Request, request: Request):
    try:
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

        messages = []
        if payload.history:
            for item in payload.history:
                role = (item.role or "user").lower()
                content = item.content or ""
                if role == "system":
                    messages.append(SystemMessage(content=content))
                elif role == "assistant":
                    messages.append(AIMessage(content=content))
                else:
                    messages.append(HumanMessage(content=content))
        messages.append(HumanMessage(content=payload.message))

        # 回答格式提示（历史中没有 system 消息时补充）
        if not any(getattr(m, "type", "") == "system" for m in messages):
            messages.insert(0, SystemMessage(
                content=(
                    "你是一个专业、友好的 AI 助手。回答时请使用清晰的段落与换行："
                    "段落之间用空行分隔，要点用编号或项目符号分行列出，方便阅读。"
                )
            ))

        request_llm = build_llm(
            model=payload.model,
            temperature=payload.temperature,
            api_key=payload.api_key,
            api_url=payload.api_url,
        )

        if _wants_sse(request):
            def gen():
                try:
                    usage = {}
                    for chunk in _stream_llm(request_llm, messages):
                        text = _content_text(chunk.content)
                        if text:
                            yield _sse({"type": "delta", "content": text})
                        meta = getattr(chunk, "usage_metadata", None)
                        if isinstance(meta, dict):
                            usage = {
                                "input_tokens": meta.get("input_tokens"),
                                "output_tokens": meta.get("output_tokens"),
                                "total_tokens": meta.get("total_tokens"),
                            }
                    yield _sse({"type": "usage", "usage": usage})
                    yield _sse({"type": "done"})
                except Exception as e:                    # noqa: BLE001
                    yield _sse({"type": "error", "detail": str(e)})
            return StreamingResponse(gen(), media_type="text/event-stream")

        llm_response = request_llm.invoke(messages)
        return {
            "message": _content_text(llm_response.content),
            "usage": _extract_usage(llm_response),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))





# ---------- 纯语义检索（只检索向量库，不调用大模型） ----------
class Search_Request(BaseModel):
    query: str
    user_id: int
    top_k: int = Field(default=5, ge=1, le=20)

@app.post("/search")
def search(request: Search_Request):
    try:
        # 1. 向量检索（similarity_search_with_score 返回 (doc, score)）
        hits = vector_store.similarity_search_with_score(
            query=request.query,
            k=request.top_k,
            filter={"user_id": request.user_id}   # 数据隔离，限定搜索属于 user_id 的文档
        )

        # 2. 组装结果
        results = []
        for doc, score in hits:
            page = doc.metadata.get("page")
            results.append({
                "document_id": doc.metadata.get("document_id"),
                "source": doc.metadata.get("source", "未知文件"),
                "page": (page + 1) if page is not None else None,
                "chunk_index": doc.metadata.get("chunk_index"),
                "content": doc.page_content,
                "score": round(float(score), 4),
            })

        return {"results": results, "count": len(results)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




# ---------- 删除文档向量（数据隔离，按 user_id + document_id） ----------
class Delete_Request(BaseModel):
    user_id: int
    document_id: int

@app.post("/delete")
def delete_document(request: Delete_Request):
    try:
        vector_store._collection.delete(
            where={
                "$and": [
                    {"user_id": request.user_id},
                    {"document_id": request.document_id},
                ]
            }
        )
        return {
            "status": "success",
            "document_id": request.document_id,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/health")
def health():
    return {
        "status":"ok",
        "service":"python-rag"
    }