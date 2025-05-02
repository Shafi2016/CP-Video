import React from "react";

// Simplified theme implementation
export function ThemeProvider(props: { children: React.ReactNode }) {
  return props.children;
}

// Simple theme hook
export function useTheme() {
  const [theme, setInternalTheme] = React.useState("light");
  
  const setTheme = (newTheme: string) => {
    setInternalTheme(newTheme);
  };

  return { theme, setTheme };
}
