import React, { useEffect } from "react";

// Simplified theme implementation
export function ThemeProvider(props: { children: React.ReactNode }) {
  // Apply the theme from localStorage on initial render
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else if (savedTheme === "light") {
      document.documentElement.classList.remove("dark");
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  }, []);

  return props.children;
}

// Simple theme hook
export function useTheme() {
  const [theme, setInternalTheme] = React.useState<"dark" | "light">(() => {
    // Check localStorage on hook initialization
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme as "dark" | "light";
    }
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  
  const setTheme = (newTheme: "dark" | "light") => {
    setInternalTheme(newTheme);
    
    // Apply theme to document
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    
    // Save preference
    localStorage.setItem("theme", newTheme);
  };

  return { theme, setTheme };
}
