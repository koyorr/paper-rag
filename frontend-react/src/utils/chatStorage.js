const HISTORY_KEY = "paperhub_recent_sessions";
const USAGE_KEY = "paperhub_api_usage";

function safeParse(value, fallback) {
    try {
        return JSON.parse(value) ?? fallback;
    } catch {
        return fallback;
    }
}

export function getRecentSessions() {
    return safeParse(localStorage.getItem(HISTORY_KEY), []);
}

export function addRecentSession({ mode, question, answer }) {
    const history = getRecentSessions();

    const item = {
        id: crypto.randomUUID(),
        mode,
        type: mode === "rag" || mode === "search" ? "检索" : "AI对话",
        title: question.length > 36 ? question.slice(0, 36) + "..." : question,
        preview: answer ? answer.slice(0, 80) : "",
        createdAt: new Date().toISOString(),
    };

    const newHistory = [item, ...history].slice(0, 30);

    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));

    window.dispatchEvent(new Event("paperhub:history-updated"));
}

function normalizeUsage(usage) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const month = today.slice(0, 7);

    if (usage.date !== today) {
        usage.date = today;
        usage.todayRequests = 0;
    }

    if (usage.month !== month) {
        usage.month = month;
        usage.monthRequests = 0;
    }

    return usage;
}

export function getApiUsage() {
    const usage = safeParse(localStorage.getItem(USAGE_KEY), {
        date: "",
        month: "",
        todayRequests: 0,
        monthRequests: 0,
        totalTokens: 0,
        provider: "DeepSeek",
    });

    return normalizeUsage(usage);
}

export function recordApiUsage(apiUsage = {}) {
    const usage = getApiUsage();

    usage.todayRequests += 1;
    usage.monthRequests += 1;

    usage.totalTokens += apiUsage.total_tokens ?? apiUsage.totalTokens ?? 0;

    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));

    window.dispatchEvent(new Event("paperhub:usage-updated"));
}