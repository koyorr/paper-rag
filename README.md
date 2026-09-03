# PAPER RAG · 论文知识库系统

> **paper-rag** · v1.0.0  
> 面向科研场景的论文知识库：文件管理 + 语义检索 + 检索增强问答（RAG），支持云端大模型与本地 Ollama 双模式接入。

---

## ✨ 功能特性

- 📚 **论文文件管理**：上传 / 删除 / 重新上传，表格内排序、筛选、列宽拖拽
- 🔍 **语义检索**：基于向量库的论文语义检索，来源可溯源
- 🤖 **RAG 问答**：论文检索 + AI 对话双模式，回答严格基于知识库内容
- ⚙️ **可视化设置**：前端设置页输入并保存 API / 模型 / RAG 参数，实时同步到后端与 RAG 服务
- 🌐 **多服务商支持**：DeepSeek、OpenAI、阿里云 Qwen（国内/国际版）、Kimi、智谱 GLM、百度千帆、腾讯混元、MiniMax、硅基流动、Groq、xAI、Mistral 等
- 💻 **本地 Ollama**：自动读取本地已下载模型，用于本地嵌入或对话，离线可用
- 🎨 **现代 SaaS 风格**：PingFang Pro 字体、玻璃拟态导航、胶囊交互、精致卡片

---

## 🏗️ 系统架构

```
┌─────────────────────┐        ┌──────────────────────┐
│  frontend-react     │  HTTP  │  backend (Express)   │
│  React 19 + Vite    │ ─────► │  :3000               │
│  · 文件管理 / 检索    │        │  · 文档上传 / 去重      │
│  · RAG 对话          │        │  · 问答转发            │
│  · 系统设置(同步配置)  │        │  · 配置接收/存储        │
└─────────────────────┘        └──────────┬───────────┘
                                          │ 服务端调用
                                          ▼
┌────────────────────────────────────────────────────────┐
│  rag_service (FastAPI)  :8000                          │
│  · PDF 解析 + 文本分块     · 向量化入库 (Chroma)          │
│  · 向量检索               · LLM 生成回答                 │
│  · 运行时配置 (POST /config)                            │
│  · 支持 DashScope / Ollama 双引擎                       │
└────────────────────────────────────────────────────────┘
```

数据流：**前端设置 → 保存到本地 → `POST /api/config`(后端) + `POST /config`(RAG) → RAG 运行时生效**；所有业务请求同时携带 `x-api-key / x-chat-model / x-rag-*` 请求头。

---

## 🧱 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19 · Vite 8 · React Router 7 · lucide-react · axios |
| 后端 | Node.js · Express 5 · Prisma (MySQL) · Multer |
| RAG 服务 | Python 3.11 · FastAPI · LangChain · Chroma · DashScope / Ollama |
| 部署 | 本地三服务独立运行（见下方快速开始） |

---

## 📁 目录结构

```
paper-rag/
├── frontend-react/        # React 前端（Vite）
│   ├── src/
│   │   ├── api/           # 接口层（预设后端 & RAG 接口）
│   │   ├── components/    # Header / 设置抽屉 / 聊天气泡 等
│   │   ├── hooks/         # 自定义 Hooks（抽屉拖拽等）
│   │   ├── pages/         # 首页 / 文件管理 / 检索 / 期刊库 / 会话等
│   │   ├── store/         # 用户配置 / Toast 状态
│   │   └── styles/        # 全局样式
│   └── package.json
├── backend/               # Express 后端
│   ├── src/
│   │   ├── routes/        # documents / qa / config
│   │   ├── services/      # ragService（转发 RAG）
│   │   └── middleware/    # Multer 上传
│   ├── prisma/            # 数据库模型与迁移
│   └── package.json
├── rag_service/           # Python RAG 服务
│   └── app/main.py        # FastAPI 入口（ingest / query / config）
├── docs/API.md            # 接口文档
├── .env.example           # 环境变量示例（backend / rag_service）
└── VERSION                # 版本号
```

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20、npm
- Python 3.11（RAG 服务使用独立 venv）
- MySQL（后端数据，`backend/.env` 中 `DATABASE_URL`）
- 可选：Ollama（本地模型接入）

### 1. 启动 RAG 服务（:8000）

```bash
cd rag_service
py -3.11 -m venv .venv
.venv/Scripts/activate          # Windows
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
# 配置 .env（参考 .env.example）：DASHSCOPE_API_KEY 等
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
# 检查本地端口是否占用
netstat -ano | findstr :8000  
```

### 2. 启动后端（:3000）

```bash
cd backend
npm install
cp .env.example .env            # 填入 DATABASE_URL
#npx prisma migrate deploy       # 初始化数据库
npx prisma migrate reset        # 重置数据库（仅限开发环境）
npx prisma db push              # 根据schema.prisma 直接同步数据库结构，适合开发环境
node src/app.js
```

### 3. 启动前端（:5173）

```bash
cd frontend-react
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。

---

## ⚙️ 设置与配置

点击右上角「设置」齿轮进入设置页，共三个页签：

- **API 设置**：选择服务商自动填充 Base URL（阿里云 Qwen 可选中国大陆版 / 国际版），填写 API Key；支持「测试连接」探测后端与 RAG 服务连通性
- **模型设置**：对话模型 / 嵌入模型下拉随服务商联动；选择 **Ollama（本地）** 后自动读取本机已下载模型
- **RAG 参数**：Top K、Chunk Size、Chunk Overlap、Temperature

保存后配置会写入本地并同步到后端与 RAG 服务；切换服务商或嵌入模型时，保存提示会说明**需重启 RAG 服务后重建向量库生效**。

> 提示：Ollama 本地接入时 Base URL 为 `http://127.0.0.1:11434/v1`，API Key 可留空；嵌入模型建议使用 `nomic-embed-text`、`bge-m3`、`mxbai-embed-large` 等。

---

## 📡 接口一览

详见 [docs/API.md](docs/API.md)。

| 服务 | 主要接口 |
| --- | --- |
| 后端 :3000 | `GET /health` · `POST /api/documents/upload` · `GET /api/documents` · `DELETE /api/documents/:id` · `POST /api/qa/ask` · `GET /api/qa/search` · `POST /api/chat` · `POST /api/config` |
| RAG :8000 | `GET /health` · `POST /ingest` · `POST /query` · `POST /search` · `POST /chat` · `GET/POST /config` |

---

## 📌 版本记录

### v1.0.0（2026-08-29）
- 首个正式版本
- 完成前端页面（首页 / 文件管理 / 文件检索 / 期刊文献库 / 会话 / API 用量）
- 打通前端设置 → 后端 → RAG 服务的配置同步与连通
- 支持多服务商与阿里云 Qwen 国内 / 国际双区域
- 支持本地 Ollama 嵌入与对话（自动读取已下载模型）
- 修复后端 `/api/qa/ask` 转发缺陷，修复 RAG 服务 LLM Base URL 缺失问题
- 升级首页为现代 SaaS 风格（PingFang Pro、玻璃拟态、胶囊交互）
