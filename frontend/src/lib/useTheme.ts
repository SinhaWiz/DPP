import { useEffect } from "react";
import { useUi } from "@/store/uiStore";

/** Applies the chosen theme to <html data-theme>; "system" removes the attribute so the OS decides. */
export function useTheme() {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  return theme;
}
