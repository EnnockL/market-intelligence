"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "mi-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"glass" | "terminal">("glass");

  useEffect(() => {
    const active = document.documentElement.getAttribute("data-theme") === "terminal" ? "terminal" : "glass";
    setTheme(active);
  }, []);

  function toggle() {
    const next = theme === "terminal" ? "glass" : "terminal";
    setTheme(next);
    if (next === "terminal") {
      document.documentElement.setAttribute("data-theme", "terminal");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label="Toggle theme"
      title={theme === "terminal" ? "Switch to Glass theme" : "Switch to Terminal theme"}
    >
      {theme === "terminal" ? "Terminal" : "Glass"}
    </button>
  );
}
