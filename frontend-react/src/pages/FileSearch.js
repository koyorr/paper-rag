import { Search, FileText, Sparkles } from "lucide-react";
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

export default function FileSearch() {
    const [question, setQuestion] = useState("");
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function search(customQuestion) {
        const text = (customQuestion ?? question).trim();
        if (!text || loading) return;

        setLoading(true);
        setError("");

        try {
            // 预设的 RAG 问答接口（qaApi.ask）
            const data = await qaApi.ask(text, 3);

            setResult(data);
            addRecentSession({
                mode: "rag",
                question: text,
                answer: data.answer,
            });
            recordApiUsage(data.usage);
        } catch (err) {
            console.error(err);
            setResult(null);
            setError(err.message || "检索失败，请检查后端服务。");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="inner-page">
            <div className="page-title">
                <span>PAPER SEARCH</span>
                <h1>文件检索</h1>
                <p>使用语义检索查找论文中的相关内容</p>
            </div>

            <div className="search-large">
                <Search size={20} />
                <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") search();
                    }}
                    placeholder="输入研究问题、关键词..."
                />
                <button onClick={() => search()}>
                    {loading ? "检索中" : "检索"}
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
                    <h3>检索失败</h3>
                    <p style={{ color: "#d9534f" }}>{error}</p>
                </div>
            )}

            {result && (
                <div className="search-result-card">
                    <h3>AI 检索结果</h3>
                    <p>{result.answer}</p>

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
                    <p>输入问题后，AI 将从论文知识库中检索相关内容</p>
                </div>
            )}
        </div>
    );
}