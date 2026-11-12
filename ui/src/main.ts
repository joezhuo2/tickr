import { mount } from "svelte";
import "./theme.css";
import App from "./App.svelte";
import { install } from "./lib/micro";

mount(App, { target: document.getElementById("app")! });
install();
