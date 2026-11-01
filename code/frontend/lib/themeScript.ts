export const SETTINGS_KEY = "fmbs.settings";

/** Runs before first paint so a stored theme never flashes the wrong colors. */
export const themeScript = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||"{}"),r=document.documentElement;if(s.theme==="light"||s.theme==="dark")r.dataset.theme=s.theme;if(s.palette)r.dataset.palette=s.palette;var c={light:"#f3f1ea",dark:"#0f100c"},t=s.theme==="light"||s.theme==="dark"?s.theme:null;if(t)document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=c[t]})}catch(e){}`;
