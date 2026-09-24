import { createRoot } from "react-dom/client";
import "@applemusic-like-lyrics/core/style.css";
import App from "./App";
import "./styles.css";

// AMLL owns an imperative renderer; React StrictMode's development remount
// cycle disposes that renderer before its second mount.
createRoot(document.getElementById("root")!).render(<App />);
