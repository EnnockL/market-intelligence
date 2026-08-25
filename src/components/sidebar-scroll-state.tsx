"use client";

import { useEffect } from "react";

export function SidebarScrollState() {
  useEffect(() => {
    const update = () => {
      if (window.scrollY > 12) document.documentElement.setAttribute("data-scrolled", "true");
      else document.documentElement.removeAttribute("data-scrolled");
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      document.documentElement.removeAttribute("data-scrolled");
    };
  }, []);
  return null;
}
