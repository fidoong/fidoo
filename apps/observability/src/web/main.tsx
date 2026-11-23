import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { applyTheme, readStoredTheme } from "./lib/theme.js";
import "./styles/index.css";

applyTheme(readStoredTheme());
const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<App />);
