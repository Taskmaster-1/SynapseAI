export const THEME_KEY = "synapse-theme";

/**
 * Applies the saved theme before first paint so there's no flash. Paper (light) is the
 * default; "system" follows the OS and "dark" is opt-in.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="system")document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;
