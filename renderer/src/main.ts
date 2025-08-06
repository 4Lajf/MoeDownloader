import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";

// Mount the Svelte app immediately
const app = mount(App, {
  target: document.getElementById("app")!,
});

// Hide initial loading screen once Svelte app is mounted and ready
const initialLoading = document.getElementById("initial-loading");
if (initialLoading) {
  // Even longer delay to ensure progress bar stays visible throughout transition
  setTimeout(() => {
    document.body.classList.add("app-ready");
  }, 2500); // Extended delay to match longer loader window timing
}

export default app;
