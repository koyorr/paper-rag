import { Search, FileText, Sparkles, MessageSquareText, Database } from "lucide-react";
import { useState } from "react";
import { qaApi } from "../api/request.js";
import { addRecentSession, recordApiUsage } from "../utils/chatStorage.js";

// 常用示例问题
const EXAMPLES = [
    "这篇论文的研究方法是什么？",
    "论文的主要结论有哪些？",
    "对比不同论文的实验结果",
    "论文中提到的数据集是什么？",
];

const TOP_K = 5;

export default function FileSearch() {
    // 检索模式：search = 纯语义检索（不调用大模型）；ask = 检索 + AI 问答
    const [mode, setMode] = useState("search");
    const [question, setQuestion] = useState("");
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function search(customQuestion) {
        const text = (customQuestion ?? question).trim();
        if (!text || loading) return;

        setLoading(true);
        setError("");
        setResult(null);

        try {
            let data;
            if (mode === "search") {
                // 纯语义检索：向量库查找，不调用大模型
                data = await qaApi.search({ query: text, topK: TOP_K });
                addRecentSession({
                    mode: "search",
                    question: text,
                    answer: data.results?.[0]?.content ?? "",
                });
            } else {
                // 检索 + 大模型生成回答（RAG 问答，流式输出）
                setResult({ answer: "", sources: [], usage: {} });
                let answer = "";
                let sources = [];
                let usage = {};
                await qaApi.askStream(text, { topK: TOP_K }, (evt) => {
                    if (evt.type === "delta") {
                        answer += evt.content || "";
                        setResult((r) => ({ ...r, answer }));
                    } else if (evt.type === "sources") {
                        sources = evt.sources || [];
                        setResult((r) => ({ ...r, sources }));
                    } else if (evt.type === "usage") {
                        usage = evt.usage || {};
                    }
                });
                setResult({ answer: answer || "AI 没有返回内容", sources, usage });
                addRecentSession({
                    mode: "rag",
                    question: text,
                    answer: answer || "",
                });
                recordApiUsage(usage);
            }

            setResult(data);
        } catch (err) {
            console.error(err);
            setResult(null);
            setError(err.message || "检索失败，请检查后端服务。");
        } finally {
            setLoading(false);
        }
    }

    // Chroma 返回的是距离分数（L2 越小越相关），这里换算成同批结果内的相对相关度
    const hitScores = (result?.results ?? [])
        .map((item) => item.score)
        .filter((s) => s != null && Number.isFinite(s));
    const maxScore = hitScores.length ? Math.max(...hitScores) : null;
    const minScore = hitScores.length ? Math.min(...hitScores) : null;
    function relevancePercent(item) {
        if (maxScore == null || minScore == null || maxScore === minScore) {
            return 100;
        }
        return Math.round(((maxScore - item.score) / (maxScore - minScore)) * 100);
    }

    return (
        <div className="inner-page">
            <div className="page-title">
                <span>PAPER SEARCH</span>
                <h1>文件检索</h1>
                <p>使用语义检索查找论文中的相关内容</p>
            </div>

            {/* 检索 / 问答 模式切换 */}
            <div className="search-mode-tabs">
                <button
                    className={mode === "search" ? "active" : ""}
                    onClick={() => {
                        setMode("search");
                        setResult(null);
                        setError("");
                    }}
                >
                    <Database size={15} />
                    语义检索
                </button>
                <button
                    className={mode === "ask" ? "active" : ""}
                    onClick={() => {
                        setMode("ask");
                        setResult(null);
                        setError("");
                    }}
                >
                    <MessageSquareText size={15} />
                    AI 问答
                </button>
            </div>

            <div className="search-large">
                <Search size={20} />
                <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") search();
                    }}
                    placeholder={
                        mode === "search"
                            ? "输入关键词、句子，检索相关论文片段..."
                            : "输入研究问题、关键词..."
                    }
                />
                <button onClick={() => search()}>
                    {loading ? (mode === "search" ? "检索中" : "回答中") : "检索"}
                </button>
            </div>

            {/* 示例问题 */}
            <div className="search-examples">
                {EXAMPLES.map((item) => (
                    <button
                        key={item}
                        className="search-example"
                        onClick={() => {
                            setQuestion(item);
                            search(item);
                        }}
                        disabled={loading}
                    >
                        {item}
                    </button>
                ))}
            </div>

            {error && (
                <div className="search-result-card">
                    <h3>{mode === "search" ? "检索失败" : "问答失败"}</h3>
                    <p style={{ color: "#d9534f" }}>{error}</p>
                </div>
            )}

            {/* 纯语义检索结果：按相关度展示命中的论文片段 */}
            {mode === "search" && result && !error && (
                <div className="search-result-card">
                    <h3>
                        <Database size={17} />
                        检索结果
                        {result.count != null && (
                            <span className="result-count">共 {result.count} 条</span>
                        )}
                    </h3>

                    {result.results?.length > 0 ? (
                        <div className="search-hit-list">
                            {result.results.map((item, index) => (
                                <div className="search-hit" key={index}>
                                    <div className="search-hit-meta">
                                        <FileText size={14} />
                                        <span>{item.source ?? "未知文件"}</span>
                                        {item.page != null && <span>· 第 {item.page} 页</span>}
                                        {item.score != null && (
                                            <span className="search-hit-score">
                                                相关度 {relevancePercent(item)}%
                                            </span>
                                        )}
                                    </div>
                                    <p className="search-hit-content">{item.content}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="search-empty-tip">
                            <Sparkles size={16} />
                            知识库中没有找到相关内容，请先上传论文文件。
                        </div>
                    )}
                </div>
            )}

            {/* AI 问答结果：大模型回答 + 来源 */}
            {mode === "ask" && result && !error && (
                <div className="search-result-card">
                    <h3>AI 检索结果</h3>
                    <p>{result.answer || "正在思考..."}</p>

                    {result.sources?.length > 0 && (
                        <div className="source-list">
                            <div className="result-meta">
                                <Sparkles size={14} />
                                共引用 {result.sources.length} 个来源
                            </div>
                            {result.sources.map((source, index) => (
                                <div className="source-item" key={index}>
                                    <FileText size={15} />
                                    <span>
                                        {source.source}
                                        {source.page != null &&
                                            ` · 第 ${source.page} 页`}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {!result && !error && !loading && (
                <div className="empty-state">
                    <Sparkles size={32} />
                    <p>
                        {mode === "search"
                            ? "输入关键词后，将从论文知识库中检索最相关的片段"
                            : "输入问题后，AI 将从论文知识库中检索相关内容并回答"}
                    </p>
                </div>
            )}
        </div>
    );
}
