import { Sparkles } from "lucide-react";

export default function Home() {
    return (
        <div className="page home-page">
            <section className="hero">
                <div className="hero-orb hero-orb-a" />
                <div className="hero-orb hero-orb-b" />
                <div className="hero-deco hero-deco-capsule-a" />
                <div className="hero-deco hero-deco-capsule-b" />
                <div className="hero-eyebrow">
                    <Sparkles size={14} />
                    AI POWERED PAPER KNOWLEDGE SYSTEM
                </div>
                <div className="hero-title">
                    <span className="hero-title-light">RESEARCH</span>
                    <span className="hero-title-strong">KNOWLEDGE HUB</span>
                </div>
                <p>沉淀论文知识 · 让每一次检索与对话都有据可依</p>
            </section>
        </div>
    );
}
