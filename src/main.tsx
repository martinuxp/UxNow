import { createRoot } from "react-dom/client";
import "@applemusic-like-lyrics/core/style.css";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";

// AMLL owns an imperative renderer; React StrictMode's development remount
// cycle disposes that renderer before its second mount.
createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
