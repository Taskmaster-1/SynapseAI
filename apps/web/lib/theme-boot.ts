export const THEME_KEY = "synapse-theme";

/** Applies the saved theme before first paint so there's no flash. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
