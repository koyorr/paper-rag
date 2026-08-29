import { Library, ExternalLink, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { documentApi } from "../api/request.js";

const BASE_JOURNALS = [
    { name: "IEEE", category: "Engineering / AI", year: "2026", source: "IEEE", count: 0 },
    { name: "Nature", category: "Science", year: "2026", source: "Nature", count: 0 },
    { name: "Elsevier", category: "Research", year: "2026", source: "ScienceDirect", count: 0 },
    { name: "arXiv", category: "Computer Science", year: "2026", source: "arXiv", count: 0 },
];

export default function JournalLibrary() {
    const [journals, setJournals] = useState(BASE_JOURNALS);
    const [keyword, setKeyword] = useState("");
    const [activeCategory, setActiveCategory] = useState("全部");

    // 同步后端期刊数据（预设接口）；失败时保持内置数据
    useEffect(() => {
        documentApi
            .list()
            .then((data) => {
                if (data?.journals?.length) {
                    setJournals(data.journals);
                }
            })
            .catch(() => {
                // 后端未就绪，保持默认期刊列表
            });
    }, []);

    const categories = useMemo(
        () => ["全部", ...new Set(journals.map((j) => j.category))],
        [journals]
    );

    // 按分类 + 关键词过滤
    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return journals.filter((j) => {
            const matchCategory =
                activeCategory === "全部" || j.category === activeCategory;
            const matchKeyword =
                !kw ||
                j.name.toLowerCase().includes(kw) ||
                j.category.toLowerCase().includes(kw) ||
                j.source.toLowerCase().includes(kw);
            return matchCategory && matchKeyword;
        });
    }, [journals, keyword, activeCategory]);

    const totalDocs = journals.reduce(
        (sum, j) => sum + (Number(j.count) || 0),
        0
    );

    return (
        <div className="inner-page">
            <div className="page-title">
                <span>RESEARCH LIBRARY</span>
                <h1>期刊文献库</h1>
                <p>管理期刊、来源、年份和研究方向</p>
            </div>

            {/* 分类筛选 */}
            <div className="category-chips">
                {categories.map((category) => (
                    <button
                        key={category}
                        className={`category-chip ${
                            activeCategory === category ? "active" : ""
                        }`}
                        onClick={() => setActiveCategory(category)}
                    >
                        {category}
                    </button>
                ))}
            </div>

            {/* 关键词搜索 */}
            <div className="table-toolbar">
                <div className="toolbar-search">
                    <Search size={15} />
                    <input
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="搜索期刊、分类或来源..."
                    />
                </div>
                <span className="toolbar-count">
                    共 {filtered.length} 个期刊 · 文档 {totalDocs} 篇
                </span>
            </div>

            <div className="journal-table">
                <div className="journal-head">
                    <span>期刊</span>
                    <span>分类</span>
                    <span>年份</span>
                    <span>来源</span>
                    <span>文档数</span>
                </div>

                {filtered.map((journal) => (
                    <div className="journal-row" key={journal.name}>
                        <strong>
                            <Library size={16} />
                            {journal.name}
                        </strong>
                        <span>{journal.category}</span>
                        <span>{journal.year}</span>
                        <span>
                            {journal.source}
                            <ExternalLink size={13} />
                        </span>
                        <span>{journal.count}</span>
                    </div>
                ))}

                {filtered.length === 0 && (
                    <div className="empty-table-message">
                        没有匹配的期刊
                    </div>
                )}
            </div>
        </div>
    );
}