import { mount } from "svelte";
import "./theme.css";
import App from "./App.svelte";
import { install } from "./lib/micro";
import { applyCustom, loadCustom } from "./lib/display";

applyCustom(document.documentElement, loadCustom());

mount(App, { target: document.getElementById("app")! });
install();
