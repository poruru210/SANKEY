"use client";

import { useMemo, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import Particles from "@tsparticles/react";
import type { ISourceOptions } from "@tsparticles/engine";
import { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

type ParticlesBackgroundProps = {
    theme?: "light" | "dark";
    className?: string;
};

export default function ParticlesBackground({
                                                theme: propTheme,
                                                className = "",
                                            }: ParticlesBackgroundProps) {
    const { theme: currentTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [engineInitialized, setEngineInitialized] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // エンジン初期化
    useEffect(() => {
        initParticlesEngine(async (engine) => {
            await loadSlim(engine);
            setEngineInitialized(true);
        });
    }, []);

    const effectiveTheme = propTheme || (currentTheme as "light" | "dark") || "dark";

    const options: ISourceOptions = useMemo(() => ({
        background: {
            color: "transparent",
        },
        fpsLimit: 120,
        interactivity: {
            events: {
                onClick: { enable: true, mode: "push" },
                onHover: {
                    enable: true,
                    mode: "repulse",
                    parallax: { enable: false, force: 2, smooth: 10 }
                },
                resize: {
                    enable: true,
                    delay: 0.5
                },
            },
            modes: {
                push: { quantity: 4 },
                repulse: { distance: 200, duration: 0.4 },
            },
        },
        particles: {
            color: { value: effectiveTheme === "dark" ? "#10b981" : "#059669" },
            links: {
                color: effectiveTheme === "dark" ? "#10b981" : "#059669",
                distance: 150,
                enable: true,
                opacity: effectiveTheme === "dark" ? 0.1 : 0.2,
                width: 1,
            },
            move: {
                direction: "none",
                enable: true,
                outModes: { default: "bounce" },
                random: false,
                speed: 1,
                straight: false,
            },
            number: {
                density: { enable: true, area: 800 },
                value: 80,
            },
            opacity: { value: effectiveTheme === "dark" ? 0.3 : 0.4 },
            shape: { type: "circle" },
            size: { value: { min: 1, max: 3 } },
        },
        detectRetina: true,
    }), [effectiveTheme]);

    if (!mounted || !engineInitialized) {
        return <div className={`absolute inset-0 z-0 ${className}`} />;
    }

    return (
        <Particles
            id="tsparticles"
            options={options}
            className={`absolute inset-0 z-0 ${className}`}
        />
    );
}