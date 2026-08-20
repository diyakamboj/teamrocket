import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  /**
   * Read once, during the first render.
   *
   * This used to default to "light" and adopt the stored value in an
   * effect, which raced the effect below: that one writes on the initial
   * render too, so it put "light" back into storage before the read had
   * been applied. StrictMode's double mount then read that clobbered value,
   * and dark mode never survived a reload.
   */
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("resumeiq-theme");
    return stored === "dark" || stored === "light" ? stored : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("resumeiq-theme", theme);
  }, [theme]);

  return (
    <ThemeCtx.Provider
      value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
