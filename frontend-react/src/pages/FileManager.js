import {
    UploadCloud,
    FileText,
    CheckCircle2,
    Loader2,
    Trash2,
    RotateCw,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    RefreshCw,
    Search,
    Filter,
    FilterX,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { documentApi } from "../api/request.js";
import {
    getUserConfig,
    getChatConfig,
    getEmbeddingConfig,
} from "../store/userConfig.js";
import { openSettings } from "../store/settingsStore.js";
import { showToast } from "../store/toastStore.js";

const LOCAL_KEY = "paperhub_files";

/** 状态筛选项的展示文案 */
const STATUS_LABELS = {
    ready: "READY",
    processing: "PROCESSING",
    error: "ERROR",
};

/** 归一化后端返回的文档字段 */
function normalizeServerFile(item) {
    return {
        id: item.id ?? item.documentId,
        name: item.originalName ?? item.name ?? "未命名文档",
        size: item.size ?? 0,
        chunks: item.chunkCount ?? item.chunks ?? 0,
        status: (item.status || "ready").toLowerCase(),
        time:
            item.uploadTime ??
            (item.createdAt
                ? new Date(item.createdAt).toLocaleString("zh-CN")
                : new Date().toLocaleString("zh-CN")),
        uploadTime: item.createdAt ?? item.uploadTime ?? new Date().toISOString(),
        file: null,
        errorMsg: item.errorMsg ?? null,
    };
}

/** 上传前置校验：对话 / 嵌入两侧的模型与 API 是否都已配置（支持分别设置） */
function isConfigReady() {
    const cfg = getUserConfig();
    const chat = getChatConfig(cfg);
    const emb = getEmbeddingConfig(cfg);
    const chatOk =
        !!chat.provider &&
        (chat.provider === "ollama" || !!chat.apiKey) &&
        !!chat.model;
    const embOk =
        !!emb.provider &&
        (emb.provider === "ollama" || !!emb.apiKey) &&
        !!emb.model;
    return chatOk && embOk;
}

export default function FileManager() {
    const [selectedFiles, setSelectedFiles] = useState([]); // 当前选中的 File 对象
    // 表格中勾选待删除的文档 id
    const [checkedIds, setCheckedIds] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [message, setMessage] = useState("");
    const [messageType, setMessageType] = useState("info"); // info, success, error
    const [filterText, setFilterText] = useState("");
    // 状态筛选：null（全部）| "ready" | "processing" | "error"
    const [statusFilter, setStatusFilter] = useState(null);
    const [statusFilterOpen, setStatusFilterOpen] = useState(false);
    const statusFilterRef = useRef(null);
    const fileInputRef = useRef(null);

    // 上传前置配置是否就绪（保存设置后通过 user-config-change 事件刷新）
    const [configReady, setConfigReady] = useState(() => isConfigReady());
    useEffect(() => {
        const refresh = () => setConfigReady(isConfigReady());
        window.addEventListener("user-config-change", refresh);
        return () => window.removeEventListener("user-config-change", refresh);
    }, []);

    // 本地文件列表（含状态）
    const [files, setFiles] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(LOCAL_KEY)) ?? [];
        } catch {
            return [];
        }
    });

    // 排序状态
    const [sortConfig, setSortConfig] = useState({ key: null, direction: null });

    // 列宽状态（初始值，单位px）
    const [columnWidths, setColumnWidths] = useState({
        check: 44,
        index: 60,
        name: 200,
        size: 100,
        chunks: 100,
        time: 150,
        status: 120,
        actions: 180,
    });

    // 拖拽调整列宽相关
    const [resizing, setResizing] = useState(null); // { column, startX, startWidth }

    // 自动保存到 localStorage
    useEffect(() => {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(files));
    }, [files]);

    // 点击表头筛选下拉外部时关闭
    useEffect(() => {
        function handler(e) {
            if (
                statusFilterRef.current &&
                !statusFilterRef.current.contains(e.target)
            ) {
                setStatusFilterOpen(false);
            }
        }
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // 全局清理拖拽事件
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!resizing) return;
            const { column, startX, startWidth } = resizing;
            const deltaX = e.clientX - startX;
            const newWidth = Math.max(40, startWidth + deltaX);
            setColumnWidths((prev) => ({ ...prev, [column]: newWidth }));
        };
        const handleMouseUp = () => {
            setResizing(null);
        };
        if (resizing) {
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        }
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [resizing]);

    // 从后端拉取文档列表（预设接口），失败时回退本地缓存
    const loadFiles = useCallback(async () => {
        setLoadingList(true);
        try {
            const data = await documentApi.list();
            const list = Array.isArray(data)
                ? data
                : data?.documents ?? data?.list ?? [];
            if (list.length) {
                const normalized = list.map(normalizeServerFile);
                setFiles(normalized);
                localStorage.setItem(LOCAL_KEY, JSON.stringify(normalized));
            }
        } catch (error) {
            console.warn("后端文档列表接口未就绪，使用本地缓存", error);
        } finally {
            setLoadingList(false);
        }
    }, []);

    // 首次挂载时尝试同步后端列表
    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    // 开始拖拽列宽
    const startResize = (e, column) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = columnWidths[column];
        setResizing({ column, startX, startWidth });
    };

    // 处理文件选择（多选）
    const handleFileSelect = (e) => {
        const fileList = Array.from(e.target.files);
        if (fileList.length === 0) return;
        setSelectedFiles(fileList);
        setMessage("");
        setMessageType("info");
        // 重置 input，以便重复选择同一文件可触发 change
        e.target.value = "";
    };

    // 清空已选文件
    const clearSelected = () => {
        setSelectedFiles([]);
    };

    // 格式化文件大小
    const formatSize = (bytes) => {
        if (!bytes || bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    };

    // 显示数值（超过999显示999+）
    const formatNumber = (num) => {
        if (num === undefined || num === null) return "-";
        return num > 999 ? "999+" : num;
    };

    // 排序处理
    const handleSort = (key) => {
        setSortConfig((prev) => {
            if (prev.key === key) {
                if (prev.direction === "asc") return { key, direction: "desc" };
                if (prev.direction === "desc") return { key: null, direction: null };
            }
            return { key, direction: "asc" };
        });
    };

    // 排序后的文件列表
    const sortedFiles = useCallback(() => {
        if (!sortConfig.key || !sortConfig.direction) return files;
        const sorted = [...files];
        const key = sortConfig.key;
        const dir = sortConfig.direction === "asc" ? 1 : -1;
        sorted.sort((a, b) => {
            let valA = a[key];
            let valB = b[key];
            if (key === "name") {
                valA = valA?.toLowerCase() || "";
                valB = valB?.toLowerCase() || "";
            } else if (key === "size" || key === "chunks") {
                valA = valA || 0;
                valB = valB || 0;
            } else if (key === "time") {
                valA = valA || "";
                valB = valB || "";
            }
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });
        return sorted;
    }, [files, sortConfig]);

    // 开始批量上传（走预设的 documentApi.upload）
    const handleUpload = async () => {
        if (selectedFiles.length === 0) return;

        // 未配置模型 / API 时拦截上传并引导去模型设置
        if (!configReady) {
            showToast("请先选择模型并配置模型参数");
            openSettings("model");
            return;
        }

        setUploading(true);
        setMessage("");
        setMessageType("info");

        // 1. 立即将每个文件添加到列表，状态为 processing
        const newFiles = selectedFiles.map((file, index) => ({
            id: `temp-${Date.now()}-${index}`,
            name: file.name,
            size: file.size,
            chunks: 0,
            status: "processing",
            time: new Date().toLocaleString(),
            uploadTime: new Date().toISOString(),
            file: file, // 保留原始 File 对象以便重新上传
            errorMsg: null,
        }));

        // 更新 UI 列表（追加到开头）
        setFiles((prev) => [...newFiles, ...prev]);

        // 清空选中状态
        setSelectedFiles([]);

        const uploadPromises = newFiles.map(async (fileItem) => {
            try {
                const data = await documentApi.upload(fileItem.file);

                const updated = {
                    ...fileItem,
                    id: data.documentId,
                    chunks: data.chunks || 0,
                    status: "ready",
                    time: data.uploadTime || new Date().toLocaleString(),
                    uploadTime: data.uploadTime || new Date().toISOString(),
                    errorMsg: null,
                };
                // 更新该文件项
                setFiles((prev) =>
                    prev.map((f) => (f.id === fileItem.id ? updated : f))
                );
                return { success: true, name: fileItem.name };
            } catch (error) {
                const errorMsg =
                    error.message || "上传失败";
                const errorItem = {
                    ...fileItem,
                    status: "error",
                    chunks: 0,
                    errorMsg,
                };
                setFiles((prev) =>
                    prev.map((f) => (f.id === fileItem.id ? errorItem : f))
                );
                return { success: false, name: fileItem.name, error: errorMsg };
            }
        });

        const results = await Promise.all(uploadPromises);
        const failed = results.filter((r) => !r.success);
        const succeeded = results.filter((r) => r.success);

        if (failed.length === 0) {
            setMessage(`全部 ${succeeded.length} 个文件上传成功`);
            setMessageType("success");
        } else {
            setMessage(
                `${succeeded.length} 个成功，${failed.length} 个失败。失败原因：${failed
                    .map((f) => f.name + ": " + f.error)
                    .join("；")}`
            );
            setMessageType("error");
        }
        setUploading(false);
        setTimeout(() => {
            setMessage("");
            setMessageType("info");
        }, 10000);
    };

    // 删除文件（走预设的 DELETE /api/documents/:id，后端未就绪时仅本地删除）
    const handleDelete = async (id) => {
        const item = files.find((f) => f.id === id);
        if (!item) return;
        if (!window.confirm(`确定删除文件「${item.name}」吗？`)) return;

        try {
            await documentApi.remove(id);
            setMessage("已删除（后端已同步）");
            setMessageType("success");
        } catch (error) {
            console.warn("后端删除接口未就绪，已仅从本地移除", error);
            setMessage("后端删除接口未就绪，已仅从本地移除");
            setMessageType("info");
        }
        setFiles((prev) => prev.filter((f) => f.id !== id));
        setCheckedIds((prev) => prev.filter((x) => x !== id));
        setTimeout(() => setMessage(""), 3000);
    };

    // 勾选 / 取消勾选
    const toggleChecked = (id) =>
        setCheckedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );

    // 批量删除勾选的文件
    const handleBatchDelete = async () => {
        const targets = files.filter((f) => checkedIds.includes(f.id));
        if (targets.length === 0) return;
        if (!window.confirm(`确定删除选中的 ${targets.length} 个文件吗？`)) return;

        let ok = 0;
        let fail = 0;
        const errors = [];
        for (const item of targets) {
            try {
                await documentApi.remove(item.id);
                ok++;
            } catch (error) {
                console.warn("删除失败", item.id, error);
                fail++;
                errors.push(item.name);
            }
        }
        setFiles((prev) => prev.filter((f) => !checkedIds.includes(f.id)));
        setCheckedIds([]);
        setMessage(
            `${ok} 个删除成功${fail ? `，${fail} 个失败（${errors.join("、")}）` : ""}`
        );
        setMessageType(fail ? "error" : "success");
        setTimeout(() => setMessage(""), 4000);
    };

    // 重新上传 = 重新解析入库（删除旧向量后重新分块向量化，避免重复上传被去重拦截）
    const handleReupload = async (fileItem) => {
        const id = fileItem.id;
        const realId =
            typeof id === "number" || /^\d+$/.test(String(id)) ? id : null;
        if (realId == null) {
            setMessage("无法重新解析，请刷新列表后再试");
            setMessageType("error");
            return;
        }

        // 设置为 processing
        setFiles((prev) =>
            prev.map((f) =>
                f.id === id
                    ? { ...f, status: "processing", chunks: 0, errorMsg: null }
                    : f
            )
        );

        try {
            const data = await documentApi.reindex(realId);

            setFiles((prev) =>
                prev.map((f) =>
                    f.id === id
                        ? {
                              ...f,
                              status: "ready",
                              chunks: data.chunks || f.chunks || 0,
                              errorMsg: null,
                          }
                        : f
                )
            );
            setMessage(`${fileItem.name} 重新解析成功`);
            setMessageType("success");
        } catch (error) {
            const errorMsg = error.message || "重新解析失败";
            setFiles((prev) =>
                prev.map((f) =>
                    f.id === id
                        ? { ...f, status: "error", errorMsg }
                        : f
                )
            );
            setMessage(`${fileItem.name} 重新解析失败：${errorMsg}`);
            setMessageType("error");
        }
        setTimeout(() => setMessage(""), 5000);
    };

    const StatusBadge = ({ status, errorMsg }) => {
        if (status === "processing") {
            return (
                <span className="status-badge processing">
                    <Loader2 size={14} className="spin" />
                    PROCESSING
                </span>
            );
        }
        if (status === "ready") {
            return (
                <span className="status-badge ready">
                    <CheckCircle2 size={14} />
                    READY
                </span>
            );
        }
        if (status === "error") {
            return (
                <span className="status-badge error" title={errorMsg || "上传失败"}>
                    ERROR
                </span>
            );
        }
        return <span className="status-badge">UNKNOWN</span>;
    };

    // 表头排序图标
    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <ArrowUpDown size={13} />;
        if (sortConfig.direction === "asc") return <ArrowUp size={13} />;
        if (sortConfig.direction === "desc") return <ArrowDown size={13} />;
        return <ArrowUpDown size={13} />;
    };

    // 渲染表头（状态列带筛选下拉）
    const renderHeader = (label, key, width) => (
        <th style={{ width: width + "px", position: "relative" }}>
            <div className="th-content">
                <span>{label}</span>
                {key === "status" && (
                    <div className="th-filter" ref={statusFilterRef}>
                        <button
                            className={`th-filter-btn ${
                                statusFilter ? "active" : ""
                            }`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setStatusFilterOpen((v) => !v);
                            }}
                            title="筛选状态"
                        >
                            <Filter size={13} />
                        </button>
                        {statusFilterOpen && (
                            <div className="th-filter-dropdown">
                                <button
                                    className={!statusFilter ? "selected" : ""}
                                    onClick={() => {
                                        setStatusFilter(null);
                                        setStatusFilterOpen(false);
                                    }}
                                >
                                    全部状态
                                </button>
                                <button
                                    className={
                                        statusFilter === "ready"
                                            ? "selected"
                                            : ""
                                    }
                                    onClick={() => {
                                        setStatusFilter("ready");
                                        setStatusFilterOpen(false);
                                    }}
                                >
                                    READY
                                </button>
                                <button
                                    className={
                                        statusFilter === "processing"
                                            ? "selected"
                                            : ""
                                    }
                                    onClick={() => {
                                        setStatusFilter("processing");
                                        setStatusFilterOpen(false);
                                    }}
                                >
                                    PROCESSING
                                </button>
                                <button
                                    className={
                                        statusFilter === "error"
                                            ? "selected"
                                            : ""
                                    }
                                    onClick={() => {
                                        setStatusFilter("error");
                                        setStatusFilterOpen(false);
                                    }}
                                >
                                    ERROR
                                </button>
                            </div>
                        )}
                    </div>
                )}
                <button className="sort-btn" onClick={() => handleSort(key)}>
                    <SortIcon columnKey={key} />
                </button>
            </div>
            <div
                className="col-resizer"
                onMouseDown={(e) => startResize(e, key)}
            />
        </th>
    );

    // 先排序，再按关键词 + 状态过滤
    const sorted = sortedFiles();
    const keyword = filterText.trim().toLowerCase();
    const filteredFiles = sorted.filter((f) => {
        const matchesKeyword = keyword
            ? f.name.toLowerCase().includes(keyword)
            : true;
        const matchesStatus = statusFilter
            ? (f.status || "ready").toLowerCase() === statusFilter
            : true;
        return matchesKeyword && matchesStatus;
    });

    return (
        <div className="inner-page">
            <div className="page-title">
                <span>FILE MANAGEMENT</span>
                <h1>文件管理</h1>
                <p>上传并管理你的研究文档</p>
            </div>

            {/* 未配置模型 / API 时的提示 */}
            {!configReady && (
                <div className="config-hint">
                    <span>请先选择模型并配置模型参数，再上传文件</span>
                    <button
                        className="config-hint-btn"
                        onClick={() => openSettings("model")}
                    >
                        去配置
                    </button>
                </div>
            )}

            {/* 上传面板 */}
            <div className="upload-panel">
                <UploadCloud size={30} />
                <div className="upload-info">
                    <strong>上传论文</strong>
                    <span>支持 PDF 文档，可一次选择多个</span>
                </div>

                <div className="file-select-wrapper">
                    <button
                        className="file-select-btn"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        选择文件
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.doc,"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: "none" }}
                    />
                </div>

                {selectedFiles.length > 0 && (
                    <div className="selected-file-info">
                        <span>{selectedFiles[0].name}</span>
                        {selectedFiles.length > 1 && (
                            <span className="extra-count">
                                等 {selectedFiles.length} 个文件
                            </span>
                        )}
                        <button
                            className="clear-selected-btn"
                            onClick={clearSelected}
                        >
                            ✕
                        </button>
                    </div>
                )}

                <button
                    className="primary-button upload-btn"
                    onClick={handleUpload}
                    disabled={selectedFiles.length === 0 || uploading}
                >
                    {uploading ? "上传中..." : "开始上传"}
                </button>
            </div>

            {message && (
                <div className={`page-message ${messageType}`}>{message}</div>
            )}

            {/* 表格工具栏：搜索 + 刷新 */}
            <div className="table-toolbar">
                <div className="toolbar-search">
                    <Search size={15} />
                    <input
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        placeholder="按文件名筛选..."
                    />
                </div>
                {statusFilter && (
                    <button
                        className="toolbar-btn filter-chip"
                        onClick={() => setStatusFilter(null)}
                        title="清除状态筛选"
                    >
                        <FilterX size={14} />
                        状态：
                        {STATUS_LABELS[statusFilter] ??
                            String(statusFilter).toUpperCase()}
                        <span className="filter-chip-x">✕</span>
                    </button>
                )}
                {checkedIds.length > 0 && (
                    <button
                        className="toolbar-btn batch-delete-btn"
                        onClick={handleBatchDelete}
                    >
                        <Trash2 size={15} />
                        删除选中（{checkedIds.length}）
                    </button>
                )}
                <button
                    className="toolbar-btn"
                    onClick={loadFiles}
                    disabled={loadingList}
                >
                    <RefreshCw size={15} className={loadingList ? "spin" : ""} />
                    {loadingList ? "同步中..." : "刷新"}
                </button>
            </div>

            {/* 文件表格 */}
            <div className="file-table-wrapper">
                <table className="file-table" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                        <col style={{ width: columnWidths.check + "px" }} />
                        <col style={{ width: columnWidths.index + "px" }} />
                        <col style={{ width: columnWidths.name + "px" }} />
                        <col style={{ width: columnWidths.size + "px" }} />
                        <col style={{ width: columnWidths.chunks + "px" }} />
                        <col style={{ width: columnWidths.time + "px" }} />
                        <col style={{ width: columnWidths.status + "px" }} />
                        <col style={{ width: columnWidths.actions + "px" }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th style={{ width: columnWidths.check + "px" }}>
                                <input
                                    type="checkbox"
                                    className="file-checkbox"
                                    checked={
                                        filteredFiles.length > 0 &&
                                        filteredFiles.every((f) =>
                                            checkedIds.includes(f.id)
                                        )
                                    }
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setCheckedIds(
                                                filteredFiles.map((f) => f.id)
                                            );
                                        } else {
                                            setCheckedIds([]);
                                        }
                                    }}
                                    title="全选"
                                />
                            </th>
                            {renderHeader("序号", "index", columnWidths.index)}
                            {renderHeader("文件名", "name", columnWidths.name)}
                            {renderHeader("文件大小", "size", columnWidths.size)}
                            {renderHeader("分块数", "chunks", columnWidths.chunks)}
                            {renderHeader("上传时间", "time", columnWidths.time)}
                            {renderHeader("状态", "status", columnWidths.status)}
                            {renderHeader("操作", "actions", columnWidths.actions)}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredFiles.map((item, index) => (
                            <tr key={item.id}>
                                <td>
                                    <input
                                        type="checkbox"
                                        className="file-checkbox"
                                        checked={checkedIds.includes(item.id)}
                                        onChange={() => toggleChecked(item.id)}
                                    />
                                </td>
                                <td>{index + 1}</td>
                                <td>
                                    <div className="file-name-cell">
                                        <FileText size={16} />
                                        {typeof item.id === "number" ||
                                        /^\d+$/.test(String(item.id)) ? (
                                            <a
                                                className="file-name-link"
                                                href={documentApi.fileUrl(item.id)}
                                                target="_blank"
                                                rel="noreferrer"
                                                title="点击打开论文"
                                            >
                                                {item.name}
                                            </a>
                                        ) : (
                                            <span>{item.name}</span>
                                        )}
                                    </div>
                                </td>
                                <td>{formatSize(item.size)}</td>
                                <td>{formatNumber(item.chunks)}</td>
                                <td>{item.time || "-"}</td>
                                <td>
                                    <StatusBadge
                                        status={item.status}
                                        errorMsg={item.errorMsg}
                                    />
                                    {item.errorMsg && (
                                        <div className="error-tooltip">
                                            {item.errorMsg}
                                        </div>
                                    )}
                                </td>
                                <td>
                                    <div className="action-buttons">
                                        <button
                                            className="action-btn reupload"
                                            onClick={() => handleReupload(item)}
                                            disabled={item.status === "processing"}
                                        >
                                            <RotateCw size={14} />
                                            重新上传
                                        </button>
                                        <button
                                            className="action-btn delete"
                                            onClick={() => handleDelete(item.id)}
                                            disabled={item.status === "processing"}
                                        >
                                            <Trash2 size={14} />
                                            删除
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {files.length === 0 && (
                    <div className="empty-table-message">
                        暂无上传文件，请选择文件上传
                    </div>
                )}
                {files.length > 0 && filteredFiles.length === 0 && (
                    <div className="empty-table-message">
                        没有匹配「{filterText}」的文件
                    </div>
                )}
            </div>
        </div>
    );
}