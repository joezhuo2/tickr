import { mount } from "svelte";
import "./theme.css";
import App from "./App.svelte";
import { install } from "./lib/micro";
import { applyCustom, loadCustom } from "./lib/display";

import { invoke } from "@tauri-apps/api/core";

const reportError = (message: string, source?: string, stack?: string) => invoke("report_ui_error", { message, source, stack }).catch(() => {});
window.addEventListener("error", (e) => reportError(e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined, e.error?.stack));
window.addEventListener("unhandledrejection", (e) => reportError(String(e.reason?.message ?? e.reason), "unhandledrejection", e.reason?.stack));

applyCustom(document.documentElement, loadCustom());

mount(App, { target: document.getElementById("app")! });
install();
