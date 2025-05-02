import React from "react";

// Temporary implementation - will be expanded later
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return children;
}

export function useTheme() {
  return {
    theme: "dark",
    setTheme: () => {}
  };
}