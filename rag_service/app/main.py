import json
import os
import uuid

from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI,HTTPException
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

def build_embeddings():
    if runtime_config.get("provider") == "ollama":
        # 本地 Ollama 嵌入（原生 /api/embed）
        return OllamaEmbeddings(
            model=runtime_config["embedding_model"],
            base_url=_ollama_base_url(),
        )
    return DashScopeEmbeddings(
        model=runtime_config["embedding_model"],
        dashscope_api_key=runtime_config["api_key"],
        max_retries=3
    )

def build_vector_store():
    persist_dir = str(CHROMA_DIR)
    if runtime_config.get("provider") == "ollama":
        # Ollama 使用独立向量库，避免与 DashScope 索引的维度冲突
        persist_dir = str(RAG_SERVICE_DIR / "chroma_db_ollama")
        Path(persist_dir).mkdir(parents=True, exist_ok=True)
    return Chroma(
        collection_name="rag_documents",
        embedding_function=build_embeddings(),
        persist_directory=persist_dir
    )

def build_llm(model=None, temperature=None, api_key=None, api_url=None):
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
    top_k: int | None = Field(default=None, alias="topK")
    chunk_size: int | None = Field(default=None, alias="chunkSize")
    chunk_overlap: int | None = Field(default=None, alias="chunkOverlap")
    temperature: float | None = None


@app.post("/config")
def update_config(request: Config_Request):
    old_provider = runtime_config.get("provider")
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
        runtime_config.get("provider") != old_provider
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

@app.post("/query")
def query(request: Query_Request):
    try:
        # 1. 向量搜索
        documents = (vector_store.similarity_search(
                query=request.question,
                k=request.top_k,
                filter={"user_id":request.user_id}   # 数据隔离，限定搜索属于user_id的文档
            )
        )
        if not documents:
            return {"answer":"知识库中没有找到相关信息。","sources":[]}

        # 2. 拼接上下文
        contexts = []
        for doc in documents:
            source = (doc.metadata.get("source","未知文件"))
            page = (doc.metadata.get("page"))

            if page is not None:
                page_text = (f"第{page + 1}页")
            else:
                page_text = "未知页码"

            contexts.append(f'来源：{source},页码：{page_text},{doc.page_content}')

        context = ("\n\n".join(contexts))

        # 3. Prompt
        prompt_template = ChatPromptTemplate.from_messages([
            ("system",
                """
                你是一个知识库问答助手。请严格根据提供的知识库内容回答问题。
                规则：
                1. 不要编造知识库之外的信息。
                2. 如果知识库没有答案，请明确说明。
                3. 回答尽量准确、清晰。
                4. 必要时指出来源文件。
                """
            ),
            ("human",f"知识库内容：{context},用户问题：{request.question}")
        ])

        
        # 4. 调 模型（支持请求级覆盖；未传则用运行时配置）
        request_llm = build_llm(
            model=request.model,
            temperature=request.temperature,
            api_key=request.api_key
        )
        chain = prompt_template | request_llm | StrOutputParser()
        response = chain.invoke({"question": request.question, "context": context})

        # 5. 来源,去重
        sources = []
        for doc in documents:
            item = {
                "document_id":doc.metadata.get("document_id"),
                "source":doc.metadata.get("source"),
                "page":doc.metadata.get("page",0) + 1
            }

            if item not in sources:
                sources.append(item)

        return {
            "answer":response,
            "sources":sources
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


@app.get("/health")
def health():
    return {
        "status":"ok",
        "service":"python-rag"
    }