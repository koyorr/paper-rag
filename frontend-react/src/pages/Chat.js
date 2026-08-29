import { useLocation } from "react-router-dom";
import ChatSession from "../components/ChatSession.js";

export default function Chat() {
    const location = useLocation();

    return (
        <div className="chat-page">
            <ChatSession
                fullPage
                initialMode={location.state?.mode ?? "rag"}
                initialMessages={location.state?.messages ?? []}
            />
        </div>
    );
}